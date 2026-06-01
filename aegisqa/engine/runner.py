"""线性工作流执行引擎。"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from aegisqa.core.mapper import MappingPathError, TypeMismatchError, resolve_input_mapping, set_by_path, validate_json_schema
from aegisqa.core.security import redact_secrets
from aegisqa.datasets.service import DatasetRow, DatasetService
from aegisqa.engine.rate_limit import InMemoryRateLimiter
from aegisqa.skills.parameters import SkillParameterResolver
from aegisqa.skills.registry import SkillRegistry
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

    def __init__(self, store: JsonStore, dataset_service: DatasetService, registry: SkillRegistry) -> None:
        self.store = store
        self.dataset_service = dataset_service
        self.registry = registry
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

    def execute_run(self, run_id: str) -> RunRecord:
        run = self.get_run(run_id)
        if run.canceled:
            run.status = "canceled"
            self._save_run(run)
            return run
        if run.paused:
            run.status = "paused"
            self._save_run(run)
            return run

        run.status = "running"
        run.started_at = run.started_at or _now()
        limiter = InMemoryRateLimiter(qps_by_skill={key: float(value) for key, value in run.snapshot.get("runtime", {}).get("rate_limits", {}).items()})

        rows_by_id = self._rows_by_id(run.dataset_id, run.dataset_version)
        for item in run.items:
            if item.status == "succeeded":
                continue
            row = rows_by_id[item.row_id]
            self._execute_item(run, item, row, limiter)

        if all(item.status == "succeeded" for item in run.items):
            run.status = "completed"
        elif run.canceled:
            run.status = "canceled"
        else:
            run.status = "failed"
        run.finished_at = _now()
        self._save_run(run)
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
        self._save_run(run)
        return run

    def pause_run(self, run_id: str) -> RunRecord:
        run = self.get_run(run_id)
        run.paused = True
        run.status = "paused"
        self._save_run(run)
        return run

    def resume_run(self, run_id: str) -> RunRecord:
        run = self.get_run(run_id)
        run.paused = False
        if run.status == "paused":
            run.status = "queued"
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
        payload = self.store.read_json(["runs", f"{run_id}.json"])
        if not payload:
            raise KeyError(f"Run 不存在：{run_id}")
        return RunRecord(**payload)

    def list_runs(self) -> list[RunRecord]:
        """列出 Run 快照，供执行中心和概览页展示最近状态。"""

        return [RunRecord(**payload) for payload in self.store.list_json(["runs"])]

    def _execute_item(self, run: RunRecord, item: RunItem, row: DatasetRow, limiter: InMemoryRateLimiter) -> None:
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

    def _save_run(self, run: RunRecord) -> None:
        self.store.write_json(["runs", f"{run.run_id}.json"], run.model_dump(mode="json"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stable_hash(payload: Any) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()
