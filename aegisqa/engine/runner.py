"""线性工作流执行引擎。"""

from __future__ import annotations

from dataclasses import asdict
import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from pydantic import BaseModel, Field

from aegisqa.core.mapper import MappingPathError, TypeMismatchError, resolve_input_mapping, set_by_path, validate_json_schema
from aegisqa.core.security import redact_secrets
from aegisqa.datasets.service import DatasetRow, DatasetService
from aegisqa.engine.rate_limit import RateLimiter, create_rate_limiter
from aegisqa.skills.parameters import SkillParameterResolver
from aegisqa.skills.registry import SkillRegistry
from aegisqa.storage.artifacts import ArtifactStore
from aegisqa.storage.json_store import JsonStore
from aegisqa.workflows.models import WorkflowVersion


class RunRequest(BaseModel):
    """创建 Run 的请求快照。"""

    workflow: WorkflowVersion
    dataset_id: str
    dataset_version: int
    chunk_size: int | None = None
    concurrency: int | None = None
    sample_repeat_times: int | None = None
    rate_limits: dict[str, float] = Field(default_factory=dict)
    task_config_snapshot: dict[str, Any] = Field(default_factory=dict)


class RunItemStep(BaseModel):
    """单个 Run Item 的步骤轨迹。"""

    step_id: str
    skill_ref: str
    status: str = "pending"
    input_snapshot: dict[str, Any] = Field(default_factory=dict)
    output_snapshot: dict[str, Any] = Field(default_factory=dict)
    config_snapshot: dict[str, Any] = Field(default_factory=dict)
    parameter_trace: dict[str, dict[str, Any]] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)
    logs: list[str] = Field(default_factory=list)
    error: dict[str, Any] | None = None
    latency_ms: float = 0.0
    input_hash: str | None = None
    output_hash: str | None = None
    cache_hit: bool = False
    cache_key: str | None = None
    rate_limited_count: int = 0
    rate_limit_wait_ms: float = 0.0
    called_skill: bool = False


class RunItem(BaseModel):
    """批量执行中的单条样本记录。"""

    item_id: str
    run_id: str
    row_id: str
    row_index: int
    row_hash: str
    repeat_index: int = 0
    status: str = "pending"
    retry_count: int = 0
    steps: list[RunItemStep] = Field(default_factory=list)
    context_snapshot: dict[str, Any] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)
    error: dict[str, Any] | None = None
    started_at: str | None = None
    finished_at: str | None = None


class RunRecord(BaseModel):
    """一次 Workflow 执行实例。"""

    run_id: str
    status: str
    workflow: WorkflowVersion
    dataset_id: str
    dataset_version: int
    chunk_size: int
    concurrency: int
    sample_repeat_times: int = 1
    queue_messages: list[dict[str, str]] = Field(default_factory=list)
    items: list[RunItem] = Field(default_factory=list)
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    snapshot: dict[str, Any] = Field(default_factory=dict)
    canceled: bool = False
    paused: bool = False

    @property
    def total_items(self) -> int:
        return len(self.items)


class WorkflowRunner:
    """执行线性 Workflow 的服务。

    本类把 PRD 的关键执行约束集中起来：
    - 创建 Run Item 时流式消费数据集，不全量加载 rows；
    - 队列消息只携带 `item_id`；
    - 调用 Skill 前强制做输入 schema 校验；
    - Step 轨迹记录输入、输出、耗时、限速、缓存和异常。
    """

    def __init__(
        self,
        store: JsonStore,
        dataset_service: DatasetService,
        registry: SkillRegistry,
        run_repository: Any | None = None,
        rate_limiter_factory: Callable[[dict[str, float]], RateLimiter] | None = None,
        progress_save_interval_items: int = 25,
        artifact_store: ArtifactStore | None = None,
    ) -> None:
        self.store = store
        self.dataset_service = dataset_service
        self.registry = registry
        self.run_repository = run_repository
        self.rate_limiter_factory = rate_limiter_factory or create_rate_limiter
        self.progress_save_interval_items = max(1, int(progress_save_interval_items))
        self.artifact_store = artifact_store
        self._cache: dict[str, dict[str, Any]] = {}

    def create_run(self, request: RunRequest) -> RunRecord:
        dataset = self.dataset_service.get_version(request.dataset_id, request.dataset_version)
        chunk_size = request.chunk_size or request.workflow.runtime.chunk_size
        concurrency = request.concurrency or request.workflow.runtime.concurrency
        repeat_times = request.sample_repeat_times or request.workflow.runtime.sample_repeat_times
        run_id = f"run-{uuid4().hex[:12]}"
        items: list[RunItem] = []
        queue_messages: list[dict[str, str]] = []

        # 这里按 chunk 消费生成器，避免把 1000/5000 行一次性载入内存。
        for chunk in self.dataset_service.iter_row_chunks(dataset.dataset_id, dataset.version, chunk_size=chunk_size):
            for row in chunk:
                for repeat_index in range(repeat_times):
                    item = RunItem(
                        item_id=f"item-{uuid4().hex[:12]}",
                        run_id=run_id,
                        row_id=row.row_id,
                        row_index=row.row_index,
                        row_hash=row.row_hash,
                        repeat_index=repeat_index,
                    )
                    items.append(item)
                    queue_messages.append({"item_id": item.item_id})

        run = RunRecord(
            run_id=run_id,
            status="queued",
            workflow=request.workflow,
            dataset_id=dataset.dataset_id,
            dataset_version=dataset.version,
            chunk_size=chunk_size,
            concurrency=concurrency,
            sample_repeat_times=repeat_times,
            queue_messages=queue_messages,
            items=items,
            created_at=_now(),
            snapshot={
                "workflow_version": request.workflow.version_id,
                "workflow_hash": request.workflow.snapshot_hash,
                "dataset_version": dataset.version_id,
                "skill_versions": [step.skill_ref for step in request.workflow.steps],
                "runtime": {
                    "chunk_size": chunk_size,
                    "concurrency": concurrency,
                    "sample_repeat_times": repeat_times,
                    "rate_limits": request.rate_limits,
                },
                "task_config_snapshot": redact_secrets(request.task_config_snapshot),
            },
        )
        self._save_run(run)
        return run

    def execute_run(self, run_id: str, progress_callback: Callable[[RunRecord], None] | None = None) -> RunRecord:
        run = self.get_run(run_id)
        if run.canceled:
            run.status = "canceled"
            self._save_run(run)
            if progress_callback:
                progress_callback(run)
            return run
        if run.paused:
            run.status = "paused"
            self._save_run(run)
            if progress_callback:
                progress_callback(run)
            return run

        run.status = "running"
        run.started_at = run.started_at or _now()
        self._save_run(run)
        if progress_callback:
            progress_callback(run)
        limiter = self.rate_limiter_factory({key: float(value) for key, value in run.snapshot.get("runtime", {}).get("rate_limits", {}).items()})

        rows_by_id = self._rows_by_id(run.dataset_id, run.dataset_version)
        processed_since_save = 0
        for item in run.items:
            self._merge_control_flags(run)
            if run.canceled or run.paused:
                break
            if item.status == "succeeded":
                continue
            row = rows_by_id[item.row_id]
            self._execute_item(run, item, row, limiter)
            self._merge_control_flags(run)
            processed_since_save += 1
            # RunRecord 里包含所有 item，逐条完整写 JSON 会在 1000+ 样本时退化成
            # 近似平方级 I/O。进度回调仍逐条触发；本地快照按批次落盘，遇到失败、
            # 暂停或取消立即刷盘，保证用户操作和错误状态不会被延迟。
            should_flush_snapshot = (
                processed_since_save >= self.progress_save_interval_items
                or item.status == "failed"
                or run.canceled
                or run.paused
            )
            if should_flush_snapshot:
                self._save_run(run)
                processed_since_save = 0
            if progress_callback:
                progress_callback(run)
            if run.canceled or run.paused:
                break

        all_succeeded = all(item.status == "succeeded" for item in run.items)
        if run.canceled:
            run.status = "canceled"
            run.finished_at = _now()
        elif run.paused and not all_succeeded:
            run.status = "paused"
        elif all_succeeded:
            run.status = "completed"
            run.finished_at = _now()
        else:
            run.status = "failed"
            run.finished_at = _now()
        self._save_run(run)
        if progress_callback:
            progress_callback(run)
        return run

    def retry_failed_items(self, run_id: str) -> RunRecord:
        """断点续跑失败样本，不覆盖已经成功的样本。"""

        run = self.get_run(run_id)
        for item in run.items:
            if item.status == "failed":
                item.retry_count += 1
                item.status = "pending"
                item.steps = []
                item.error = None
        self._save_run(run)
        return self.execute_run(run_id)

    def cancel_run(self, run_id: str) -> RunRecord:
        run = self.get_run(run_id)
        run.canceled = True
        run.status = "canceled"
        self._save_control_flags(run)
        self._save_run(run)
        return run

    def pause_run(self, run_id: str) -> RunRecord:
        run = self.get_run(run_id)
        run.paused = True
        run.status = "paused"
        self._save_control_flags(run)
        self._save_run(run)
        return run

    def resume_run(self, run_id: str) -> RunRecord:
        run = self.get_run(run_id)
        run.paused = False
        if run.status == "paused":
            run.status = "queued"
        self._save_control_flags(run)
        self._save_run(run)
        return self.execute_run(run_id)

    def dry_run(self, workflow: WorkflowVersion, dataset_id: str, dataset_version: int, sample_size: int = 1) -> RunRecord:
        """执行 1-10 条样本的试运行。

        试运行复用正式执行逻辑，但只物化前 N 条样本，便于展示每步输入输出和类型
        校验结果，不影响完整批量 Run。
        """

        sample_size = max(1, min(sample_size, 10))
        dataset = self.dataset_service.get_version(dataset_id, dataset_version)
        run_id = f"dry-run-{uuid4().hex[:12]}"
        items: list[RunItem] = []
        for row in self.dataset_service.iter_rows(dataset.dataset_id, dataset.version, chunk_size=1):
            if len(items) >= sample_size:
                break
            items.append(
                RunItem(
                    item_id=f"item-{uuid4().hex[:12]}",
                    run_id=run_id,
                    row_id=row.row_id,
                    row_index=row.row_index,
                    row_hash=row.row_hash,
                )
            )
        run = RunRecord(
            run_id=run_id,
            status="queued",
            workflow=workflow,
            dataset_id=dataset.dataset_id,
            dataset_version=dataset.version,
            chunk_size=sample_size,
            concurrency=1,
            queue_messages=[{"item_id": item.item_id} for item in items],
            items=items,
            created_at=_now(),
            snapshot={
                "workflow_version": workflow.version_id,
                "workflow_hash": workflow.snapshot_hash,
                "dataset_version": dataset.version_id,
                "skill_versions": [step.skill_ref for step in workflow.steps],
                "dry_run": True,
            },
        )
        self._save_run(run)
        return self.execute_run(run.run_id)

    def get_run(self, run_id: str) -> RunRecord:
        if self.run_repository:
            try:
                payload = self.run_repository.get(run_id)
            except KeyError as exc:
                raise KeyError(f"Run 不存在：{run_id}") from exc
        else:
            payload = self.store.read_json(["runs", f"{run_id}.json"])
            if not payload:
                raise KeyError(f"Run 不存在：{run_id}")
        return RunRecord(**payload)

    def list_runs(self) -> list[RunRecord]:
        """列出 Run 快照，供执行中心和概览页展示最近状态。"""

        payloads = self.run_repository.list() if self.run_repository else self.store.list_json(["runs"])
        return [RunRecord(**payload) for payload in payloads]

    def list_run_summaries(self) -> list[dict[str, Any]]:
        """列出轻量 Run 摘要，避免列表接口序列化完整 item 轨迹。

        `RunRecord.items` 里可能包含 context、step 输入输出和错误详情。执行中心列表、
        Attempt 历史列表这类场景只需要状态和计数，因此直接从原始 JSON 计算摘要，
        不构造完整 `RunItem` 对象，也不把明细回传给前端。
        """

        payloads = self.run_repository.list() if self.run_repository else self.store.list_json(["runs"])
        return [_run_summary_from_payload(payload) for payload in payloads]

    def _execute_item(self, run: RunRecord, item: RunItem, row: DatasetRow, limiter: RateLimiter) -> None:
        item.status = "running"
        item.started_at = _now()
        context: dict[str, Any] = {
            "row": row.data,
            "context": {},
            "metrics": {},
            "artifacts": {},
            "errors": [],
            "steps": {},
            "meta": {
                "run_id": run.run_id,
                "item_id": item.item_id,
                "row_id": row.row_id,
                "repeat_index": item.repeat_index,
                "workflow_version": run.workflow.version_id,
                "row_hash": row.row_hash,
                "trace_id": f"trace-{uuid4().hex[:12]}",
            },
        }

        for workflow_step in run.workflow.steps:
            skill = self.registry.get(workflow_step.skill_ref)
            step = RunItemStep(step_id=workflow_step.step_id, skill_ref=workflow_step.skill_ref, status="validating")
            item.steps.append(step)
            try:
                inputs = resolve_input_mapping(workflow_step.input_mapping, context, skill.manifest.input_schema)
                step.input_snapshot = redact_secrets(inputs)
                step.input_hash = _stable_hash(inputs)
                task_config_snapshot = run.snapshot.get("task_config_snapshot", {})
                task_overrides = task_config_snapshot.get("skill_overrides", {}) if isinstance(task_config_snapshot, dict) else {}
                resolved_parameters = SkillParameterResolver(skill.manifest.config_schema).resolve(
                    workflow_config=workflow_step.config,
                    task_override=task_overrides.get(workflow_step.step_id, {}) if isinstance(task_overrides, dict) else {},
                    runtime_context=context,
                    secret_values={},
                )
                step.config_snapshot = redact_secrets(resolved_parameters.config)
                step.parameter_trace = resolved_parameters.trace
                decision = limiter.acquire(workflow_step.skill_ref)
                step.rate_limited_count = decision.rate_limited_count
                step.rate_limit_wait_ms = decision.wait_ms
                step.status = "rate_limited" if decision.rate_limited_count else "running"

                cache_key = self._cache_key(workflow_step, skill.manifest.version, inputs, resolved_parameters.config)
                step.cache_key = cache_key[:16]
                if workflow_step.cacheable and cache_key in self._cache:
                    raw_output = self._cache[cache_key]
                    step.cache_hit = True
                    step.called_skill = False
                    output = raw_output["output"]
                    metrics = raw_output.get("metrics", {})
                    latency_ms = 0.0
                    logs = ["命中 Step 级 Evaluation Cache，跳过真实 Skill 调用。"]
                else:
                    step.called_skill = True
                    result, latency_ms = skill.execute(inputs, resolved_parameters.config)
                    output = result.output
                    metrics = result.metrics
                    logs = result.logs
                    if workflow_step.cacheable:
                        self._cache[cache_key] = {"output": output, "metrics": metrics}

                validate_json_schema(output, skill.manifest.output_schema)
                metrics = self._persist_prompt_call_artifacts(run, item, step, inputs, output, metrics)
                # 标准输出命名空间固定为 `step_id.field`，下游映射可直接引用
                # `answer.answer` 这类路径；output_mapping 仅保留为旧流程的别名写入能力。
                context[workflow_step.step_id] = output
                for output_field, target_path in workflow_step.output_mapping.items():
                    if output_field in output:
                        set_by_path(context, target_path, output[output_field])
                context["steps"][workflow_step.step_id] = {"input": inputs, "output": output}
                context["metrics"].update(metrics)
                step.status = "succeeded"
                step.output_snapshot = redact_secrets(output)
                step.output_hash = _stable_hash(output)
                step.metrics = metrics
                step.logs = logs
                step.latency_ms = latency_ms
            except TypeMismatchError as exc:
                step.status = "failed"
                step.called_skill = False
                step.error = {
                    "type": "TypeMismatchError",
                    "field_path": exc.field_path,
                    "expected_type": exc.expected_type,
                    "actual_type": exc.actual_type,
                    "message": str(exc),
                }
                context["errors"].append(step.error)
                item.status = "failed"
                item.error = step.error
                break
            except (MappingPathError, Exception) as exc:  # noqa: BLE001 - Worker 边界需要捕获并落库。
                step.status = "failed"
                step.error = {"type": type(exc).__name__, "message": str(exc)}
                context["errors"].append(step.error)
                item.status = "failed"
                item.error = step.error
                break

        if item.status != "failed":
            item.status = "succeeded"
        item.context_snapshot = redact_secrets({key: value for key, value in context.items() if key != "secrets"})
        item.metrics = context["metrics"]
        item.finished_at = _now()

    def _rows_by_id(self, dataset_id: str, dataset_version: int) -> dict[str, DatasetRow]:
        # Worker 按 item_id/row_id 单条读取是生产形态；本地 MVP 为了简化单进程执行，
        # 在 execute_run 中建立索引。数据集创建和队列投递阶段仍保持流式。
        return {row.row_id: row for row in self.dataset_service.iter_rows(dataset_id, dataset_version, chunk_size=1)}

    def _cache_key(self, step: Any, skill_version: str, inputs: dict[str, Any], config: dict[str, Any]) -> str:
        payload = {
            "step_input_hash": _stable_hash(inputs),
            "skill_version_hash": hashlib.sha256(skill_version.encode("utf-8")).hexdigest(),
            "config_hash": _stable_hash(config),
            "prompt_hash": _stable_hash({"prompt": config.get("prompt") or config.get("rubric")}),
            "model_params_hash": _stable_hash({key: config.get(key) for key in ("model", "temperature", "threshold") if key in config}),
            "dependency_hash": _stable_hash({"dependencies": self.registry.get(step.skill_ref).manifest.dependencies}),
            "schema_version": "json-schema-mvp-v1",
        }
        return _stable_hash(payload)

    def _persist_prompt_call_artifacts(
        self,
        run: RunRecord,
        item: RunItem,
        step: RunItemStep,
        inputs: dict[str, Any],
        output: dict[str, Any],
        metrics: dict[str, Any],
    ) -> dict[str, Any]:
        prompt_calls = _prompt_calls_from_metrics_or_step(metrics, inputs, output, step.step_id)
        if not prompt_calls or self.artifact_store is None:
            return metrics
        updated_metrics = dict(metrics)
        persisted_calls: list[dict[str, Any]] = []
        for index, prompt_call in enumerate(prompt_calls, start=1):
            call = dict(prompt_call)
            call_artifacts = dict(call.get("artifacts") or {})
            rendered_prompt = call.get("rendered_prompt")
            if rendered_prompt is not None:
                prompt_artifact = self.artifact_store.put_bytes(
                    "rendered_prompts",
                    f"runs/{run.run_id}/items/{item.item_id}/steps/{step.step_id}/prompts/{index}.txt",
                    str(rendered_prompt).encode("utf-8"),
                    content_type="text/plain; charset=utf-8",
                    metadata={
                        "run_id": run.run_id,
                        "item_id": item.item_id,
                        "step_id": step.step_id,
                        "skill_ref": step.skill_ref,
                        "prompt_call_index": index,
                    },
                )
                call_artifacts["rendered_prompt"] = asdict(prompt_artifact)
            raw_response = call.get("raw_response")
            if raw_response is not None:
                response_artifact = self.artifact_store.put_bytes(
                    "raw_llm_responses",
                    f"runs/{run.run_id}/items/{item.item_id}/steps/{step.step_id}/responses/{index}.txt",
                    _prompt_artifact_bytes(raw_response),
                    content_type="text/plain; charset=utf-8",
                    metadata={
                        "run_id": run.run_id,
                        "item_id": item.item_id,
                        "step_id": step.step_id,
                        "skill_ref": step.skill_ref,
                        "prompt_call_index": index,
                    },
                )
                call_artifacts["raw_response"] = asdict(response_artifact)
            if call_artifacts:
                call["artifacts"] = call_artifacts
            persisted_calls.append(call)
        updated_metrics["prompt_calls"] = persisted_calls
        return updated_metrics

    def _save_run(self, run: RunRecord) -> None:
        if self.run_repository:
            self.run_repository.save(run.model_dump(mode="json"))
            return
        self.store.write_json(["runs", f"{run.run_id}.json"], run.model_dump(mode="json"))

    def _save_control_flags(self, run: RunRecord) -> None:
        """单独保存暂停/取消信号，避免执行循环频繁读取完整 Run 快照。"""

        self.store.write_json(
            ["run_controls", f"{run.run_id}.json"],
            {
                "run_id": run.run_id,
                "canceled": run.canceled,
                "paused": run.paused,
                "updated_at": _now(),
            },
        )

    def _merge_control_flags(self, run: RunRecord) -> None:
        """合并外部控制信号，避免后台执行覆盖暂停/取消请求。

        后台线程执行时会持有一份内存中的 Run；暂停/取消接口则会把控制信号写入
        store。每个 item 边界都重新读取控制位，才能保证用户操作不会被下一次保存覆盖。
        """

        control = self.store.read_json(["run_controls", f"{run.run_id}.json"], default=None) or {}
        if control.get("canceled"):
            run.canceled = True
            run.paused = False
            run.status = "canceled"
            return
        if control.get("paused"):
            run.paused = True
            run.status = "paused"


def _prompt_calls_from_metrics_or_step(metrics: dict[str, Any], inputs: dict[str, Any], output: dict[str, Any], step_id: str) -> list[dict[str, Any]]:
    existing = metrics.get("prompt_calls")
    if isinstance(existing, list):
        return [item for item in existing if isinstance(item, dict)]
    rendered_prompt = inputs.get("prompt")
    if rendered_prompt is None and isinstance(inputs.get("messages"), list):
        rendered_prompt = json.dumps(inputs["messages"], ensure_ascii=False)
    has_model_usage = any(key in metrics for key in ("model_provider", "model_name", "prompt_tokens", "completion_tokens", "total_tokens"))
    if rendered_prompt is None or not has_model_usage:
        return []
    raw_response = output.get("answer") if isinstance(output, dict) else None
    if raw_response is None and isinstance(output, dict):
        raw_response = output.get("text") or output
    token_usage = {
        key: value
        for key, value in {
            "prompt_tokens": metrics.get("prompt_tokens"),
            "completion_tokens": metrics.get("completion_tokens"),
            "total_tokens": metrics.get("total_tokens"),
        }.items()
        if value is not None
    }
    return [
        {
            "prompt_name": step_id,
            "rendered_prompt": rendered_prompt,
            "raw_response": raw_response,
            "parsed_output": output,
            "token_usage": token_usage,
            "model": metrics.get("model_name"),
            "provider": metrics.get("model_provider"),
        }
    ]


def _prompt_artifact_bytes(payload: Any) -> bytes:
    if isinstance(payload, str):
        return payload.encode("utf-8")
    return json.dumps(payload, ensure_ascii=False, indent=2, default=str).encode("utf-8")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stable_hash(payload: Any) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _run_summary_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """从持久化 Run JSON 中生成列表摘要。

    这里刻意只读取 item 的状态字段，不返回 item 明细。这样分页列表的 wire shape
    保持轻量；需要 Step/Context 的页面继续通过 `/runs/{run_id}` 或 trace 接口读取。
    """

    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    completed_items = sum(1 for item in items if isinstance(item, dict) and item.get("status") == "succeeded")
    failed_items = sum(1 for item in items if isinstance(item, dict) and item.get("status") == "failed")
    workflow = payload.get("workflow") if isinstance(payload.get("workflow"), dict) else {}
    queue_messages = payload.get("queue_messages") if isinstance(payload.get("queue_messages"), list) else []
    return {
        "run_id": payload.get("run_id"),
        "status": payload.get("status"),
        "workflow_version_id": workflow.get("version_id"),
        "workflow_name": workflow.get("name"),
        "dataset_id": payload.get("dataset_id"),
        "dataset_version": payload.get("dataset_version"),
        "chunk_size": payload.get("chunk_size"),
        "concurrency": payload.get("concurrency"),
        "sample_repeat_times": payload.get("sample_repeat_times", 1),
        "total_items": len(items),
        "completed_items": completed_items,
        "failed_items": failed_items,
        "queue_message_count": len(queue_messages),
        "created_at": payload.get("created_at"),
        "started_at": payload.get("started_at"),
        "finished_at": payload.get("finished_at"),
        "canceled": bool(payload.get("canceled", False)),
        "paused": bool(payload.get("paused", False)),
    }
