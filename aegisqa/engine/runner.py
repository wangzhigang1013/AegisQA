"""线性工作流执行引擎。"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from datetime import datetime, timezone
from aegisqa.core.time import now_beijing_str, now_beijing
from typing import Any, Callable
from uuid import uuid4

from pydantic import BaseModel, Field

from aegisqa.core.errors import AegisQAError
from aegisqa.core.mapper import MappingPathError, TypeMismatchError, resolve_input_mapping, set_by_path, validate_json_schema
from aegisqa.core.security import redact_secrets
from aegisqa.datasets.service import DatasetRow, DatasetService
from aegisqa.engine.rate_limit import RateLimiter, create_rate_limiter
from aegisqa.skills.parameters import SkillParameterResolver
from aegisqa.skills.registry import SkillRegistry
from aegisqa.storage.json_store import JsonStore
from aegisqa.workflows.dag import DAGWorkflow, DAGWorkflowExecutor, DAGWorkflowStep
from aegisqa.workflows.models import WorkflowVersion

# 单步超时默认值 (秒)
_DEFAULT_STEP_TIMEOUT_SECONDS = 120
_STEP_TIMEOUT_ENV = "AEGISQA_STEP_TIMEOUT_SECONDS"

logger = logging.getLogger(__name__)


class LazyRowCache:
    """懒加载行缓存。

    对于大型数据集，按需加载行而不是一次性加载全部。
    实现了 dict-like 接口以兼容现有代码。
    """

    def __init__(
        self,
        dataset_service: DatasetService,
        dataset_id: str,
        dataset_version: int,
        initial_cache: dict[str, DatasetRow] | None = None,
    ) -> None:
        self._dataset_service = dataset_service
        self._dataset_id = dataset_id
        self._dataset_version = dataset_version
        self._cache: dict[str, DatasetRow] = initial_cache or {}
        self._loaded_all = False
        self._row_ids: set[str] | None = None

    def _ensure_all_loaded(self) -> None:
        """确保所有行已加载。"""
        if self._loaded_all:
            return
        for row in self._dataset_service.iter_rows(self._dataset_id, self._dataset_version, chunk_size=100):
            if row.row_id not in self._cache:
                self._cache[row.row_id] = row
        self._loaded_all = True

    def __getitem__(self, row_id: str) -> DatasetRow:
        """获取指定行。"""
        if row_id in self._cache:
            return self._cache[row_id]
        # 尝试按需加载
        for row in self._dataset_service.iter_rows(self._dataset_id, self._dataset_version, chunk_size=100):
            self._cache[row.row_id] = row
            if row.row_id == row_id:
                return row
        raise KeyError(f"Row not found: {row_id}")

    def get(self, row_id: str, default: Any = None) -> DatasetRow | Any:
        """获取指定行，不存在返回默认值。"""
        try:
            return self[row_id]
        except KeyError:
            return default

    def __contains__(self, row_id: str) -> bool:
        """检查行是否存在。"""
        if row_id in self._cache:
            return True
        # 尝试按需加载
        try:
            self[row_id]
            return True
        except KeyError:
            return False

    def __len__(self) -> int:
        """获取行数。"""
        self._ensure_all_loaded()
        return len(self._cache)

    def __iter__(self) -> Iterator[str]:
        """迭代行 ID。"""
        self._ensure_all_loaded()
        return iter(self._cache)

    def values(self) -> Any:
        """获取所有行。"""
        self._ensure_all_loaded()
        return self._cache.values()

    def items(self) -> Any:
        """获取所有行键值对。"""
        self._ensure_all_loaded()
        return self._cache.items()


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
    ) -> None:
        self.store = store
        self.dataset_service = dataset_service
        self.registry = registry
        self.run_repository = run_repository
        self.rate_limiter_factory = rate_limiter_factory or create_rate_limiter
        self.progress_save_interval_items = max(1, int(progress_save_interval_items))
        self._cache_ttl: int = int(os.getenv("AEGISQA_CACHE_TTL", "3600"))

        # 初始化混合缓存（内存 + Redis）
        from aegisqa.engine.redis_cache import HybridCache, RedisCache
        redis_url = os.getenv("AEGISQA_REDIS_URL")
        redis_cache = RedisCache(redis_url) if redis_url else None
        self._hybrid_cache = HybridCache(redis_cache=redis_cache, ttl_seconds=self._cache_ttl)

        # 保持向后兼容的内存缓存接口
        self._cache: dict[str, dict[str, Any]] = {}
        self._cache_created_at: dict[str, float] = {}

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
        logger.info("Run %s started (%d items)", run_id, len(run.items))
        if progress_callback:
            progress_callback(run)
        limiter = self.rate_limiter_factory({key: float(value) for key, value in run.snapshot.get("runtime", {}).get("rate_limits", {}).items()})

        rows_by_id = self._rows_by_id(run.dataset_id, run.dataset_version)

        # 从 task_config_snapshot 读取重试配置
        task_config = run.snapshot.get("task_config_snapshot", {})
        max_retries = int(task_config.get("max_retries", 1)) if isinstance(task_config, dict) else 1  # 默认重试 1 次
        retry_backoff_seconds = float(task_config.get("retry_backoff_seconds", 1.0)) if isinstance(task_config, dict) else 1.0
        run_timeout_seconds = int(task_config.get("run_timeout_seconds", 3600)) if isinstance(task_config, dict) else 3600  # 默认 1 小时
        run_started_monotonic = time.monotonic()

        # 检测是否有 DAG 结构，如果有则构建 DAG 执行器
        dag = None
        if self._has_dag_structure(run.workflow):
            try:
                dag = self._build_dag_from_graph(run.workflow)
                logger.info("Run %s: DAG execution enabled (%d edges)", run_id, len(run.workflow.graph.get("edges", [])))
            except Exception as exc:
                logger.warning("Run %s: DAG construction failed, falling back to linear execution: %s", run_id, exc)
                dag = None

        processed_since_save = 0
        for item in run.items:
            self._merge_control_flags(run)
            # Run-level 超时检查
            if time.monotonic() - run_started_monotonic > run_timeout_seconds:
                logger.warning("Run %s timed out after %ds", run_id, run_timeout_seconds)
                run.status = "timeout"
                run.finished_at = _now()
                break
            if run.canceled or run.paused:
                break
            if item.status == "succeeded":
                continue
            row = rows_by_id[item.row_id]
            logger.debug("Run %s: executing item %s (row_index=%d)", run_id, item.item_id, item.row_index)

            # 带自动重试的执行逻辑
            attempt = 0
            while True:
                if dag:
                    self._execute_item_dag(run, item, row, limiter, dag)
                else:
                    self._execute_item(run, item, row, limiter)

                if item.status != "failed" or attempt >= max_retries:
                    break
                attempt += 1
                backoff = retry_backoff_seconds * (2 ** (attempt - 1))
                logger.warning(
                    "Run %s: item %s failed (attempt %d/%d), retrying in %.1fs: %s",
                    run_id, item.item_id, attempt, max_retries, backoff,
                    item.error.get("message", "") if item.error else "",
                )
                item.retry_count = attempt
                item.status = "pending"
                item.steps = []
                item.error = None
                # 可中断的 sleep: 分段等待，每 0.5s 检查取消信号
                _interruptible_sleep(backoff, run)

            if item.status == "failed":
                logger.warning("Run %s: item %s failed after %d attempts: %s",
                    run_id, item.item_id, attempt + 1,
                    item.error.get("message", "") if item.error else "")
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
        if run.status == "timeout":
            logger.info("Run %s timed out", run_id)
        elif run.canceled:
            run.status = "canceled"
            run.finished_at = _now()
            logger.info("Run %s canceled", run_id)
        elif run.paused and not all_succeeded:
            run.status = "paused"
            logger.info("Run %s paused", run_id)
        elif all_succeeded:
            run.status = "completed"
            run.finished_at = _now()
            logger.info("Run %s completed (%d items)", run_id, len(run.items))
        else:
            run.status = "failed"
            run.finished_at = _now()
            failed_count = sum(1 for item in run.items if item.status == "failed")
            logger.warning("Run %s finished with %d failures out of %d items", run_id, failed_count, len(run.items))
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
            # Step-level 取消检查
            if run.canceled or run.paused:
                break
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
                # 实际执行速率限制等待
                if decision.wait_ms > 0:
                    _interruptible_sleep(decision.wait_ms / 1000.0, run)

                cache_key = self._cache_key(workflow_step, skill.manifest.version, inputs, resolved_parameters.config)
                step.cache_key = cache_key
                cache_valid = self._is_cache_valid(cache_key)
                if workflow_step.cacheable and cache_valid:
                    # 优先从混合缓存读取
                    cached = self._hybrid_cache.get(cache_key)
                    if cached is None:
                        cached = self._cache.get(cache_key)
                    raw_output = cached
                    step.cache_hit = True
                    step.called_skill = False
                    output = raw_output["output"]
                    metrics = raw_output.get("metrics", {})
                    latency_ms = 0.0
                    logs = ["命中 Step 级 Evaluation Cache，跳过真实 Skill 调用。"]
                    logger.debug("Step %s cache hit (key=%s)", workflow_step.step_id, cache_key[:16])
                else:
                    step.called_skill = True
                    step_timeout = _step_timeout_seconds(run)
                    result, latency_ms = _execute_with_timeout(skill, inputs, resolved_parameters.config, step_timeout)
                    output = result.output
                    metrics = result.metrics
                    logs = result.logs
                    if workflow_step.cacheable:
                        cache_value = {"output": output, "metrics": metrics}
                        # 写入混合缓存
                        self._hybrid_cache.set(cache_key, cache_value)
                        # 向后兼容：也写入内存缓存
                        self._cache[cache_key] = cache_value
                        self._cache_created_at[cache_key] = time.time()

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

    def _execute_item_dag(self, run: RunRecord, item: RunItem, row: DatasetRow, limiter: RateLimiter, dag: DAGWorkflow) -> None:
        """使用 DAG 执行器执行单个 item，支持并行步骤。"""
        item.status = "running"
        item.started_at = _now()

        # 构建 DAG 执行器
        executor = DAGWorkflowExecutor(self.registry, max_workers=run.concurrency or 4)

        # 执行 DAG
        context = executor.execute_row(dag, row.data)

        # 将 DAG 执行结果转换为 RunItemStep
        steps_by_id = {step.step_id: step for step in dag.steps}
        for step_id, step_result in context.get("steps", {}).items():
            dag_step = steps_by_id.get(step_id)
            if not dag_step:
                continue

            run_step = RunItemStep(
                step_id=step_id,
                skill_ref=dag_step.skill_ref,
                status=step_result.get("status", "unknown"),
            )

            if step_result.get("status") == "succeeded":
                run_step.input_snapshot = redact_secrets(step_result.get("input", {}))
                run_step.output_snapshot = redact_secrets(step_result.get("output", {}))
                run_step.metrics = step_result.get("metrics", {})
                run_step.latency_ms = step_result.get("latency_ms", 0.0)
                run_step.called_skill = True
            elif step_result.get("status") == "failed":
                run_step.error = step_result.get("error")
                run_step.called_skill = True
            elif step_result.get("status") == "skipped":
                run_step.called_skill = False

            item.steps.append(run_step)

        # 判断整体状态
        has_failure = any(s.get("status") == "failed" for s in context.get("steps", {}).values())
        if has_failure:
            item.status = "failed"
            first_error = next((s.get("error") for s in context.get("steps", {}).values() if s.get("status") == "failed"), None)
            item.error = first_error
        else:
            item.status = "succeeded"

        item.context_snapshot = redact_secrets({key: value for key, value in context.items() if key not in ("secrets", "steps")})
        item.metrics = context.get("metrics", {})
        item.finished_at = _now()

    def _has_dag_structure(self, workflow: WorkflowVersion) -> bool:
        """检查 workflow 是否有 DAG 结构（graph 字段包含 edges）。"""
        graph = workflow.graph
        if not graph:
            return False
        edges = graph.get("edges", [])
        return len(edges) > 0

    def _build_dag_from_graph(self, workflow: WorkflowVersion) -> DAGWorkflow:
        """从 WorkflowVersion.graph 构建 DAGWorkflow。"""
        graph = workflow.graph or {}
        nodes = {node["id"]: node for node in graph.get("nodes", [])}
        edges = graph.get("edges", [])

        # 构建依赖关系
        depends_on: dict[str, list[str]] = {node_id: [] for node_id in nodes}
        for edge in edges:
            target = edge.get("target")
            source = edge.get("source")
            if target and source and target in depends_on:
                depends_on[target].append(source)

        # 构建 DAG 步骤
        dag_steps: list[DAGWorkflowStep] = []
        for step in workflow.steps:
            node = nodes.get(step.step_id, {})
            dag_step = DAGWorkflowStep(
                step_id=step.step_id,
                skill_ref=step.skill_ref,
                depends_on=depends_on.get(step.step_id, []),
                condition=node.get("data", {}).get("condition"),
                input_mapping=step.input_mapping,
                output_mapping=step.output_mapping,
                config=step.config,
                cacheable=step.cacheable,
            )
            dag_steps.append(dag_step)

        return DAGWorkflow(name=workflow.name, steps=dag_steps)

    def _rows_by_id(self, dataset_id: str, dataset_version: int) -> dict[str, DatasetRow]:
        """加载数据集行到内存索引。

        对于小型数据集（<10000 行），直接加载到内存。
        对于大型数据集，使用懒加载缓存避免一次性占用过多内存。
        """
        # 预加载小型数据集
        rows = {}
        row_count = 0
        for row in self.dataset_service.iter_rows(dataset_id, dataset_version, chunk_size=100):
            rows[row.row_id] = row
            row_count += 1
            # 大型数据集使用懒加载
            if row_count > 10000:
                logger.warning("Dataset has %d+ rows, using lazy loading", row_count)
                return LazyRowCache(self.dataset_service, dataset_id, dataset_version, rows)
        return rows

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

    def _is_cache_valid(self, cache_key: str) -> bool:
        """检查缓存是否有效（存在且未过期）。"""
        # 优先检查混合缓存
        if self._hybrid_cache.get(cache_key) is not None:
            return True
        # 向后兼容：检查内存缓存
        if cache_key not in self._cache:
            return False
        created_at = self._cache_created_at.get(cache_key, 0)
        return (time.time() - created_at) < self._cache_ttl

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

    def get_cache_stats(self, run_id: str) -> dict[str, Any]:
        """获取 Run 的缓存统计信息。"""
        run = self.get_run(run_id)
        total_steps = 0
        cached_steps = 0
        cache_hits: dict[str, int] = {}

        for item in run.items:
            for step in item.steps:
                total_steps += 1
                if step.cache_hit:
                    cached_steps += 1
                    skill = step.skill_ref
                    cache_hits[skill] = cache_hits.get(skill, 0) + 1

        # 获取混合缓存统计
        hybrid_stats = self._hybrid_cache.get_stats()

        return {
            "run_id": run_id,
            "total_steps": total_steps,
            "cached_steps": cached_steps,
            "cache_hit_rate": cached_steps / total_steps if total_steps > 0 else 0.0,
            "cache_hits_by_skill": cache_hits,
            "cache_size": len(self._cache),
            "hybrid_cache": hybrid_stats,
        }

    def invalidate_cache(self, run_id: str | None = None, skill_ref: str | None = None) -> int:
        """失效缓存。

        Args:
            run_id: 指定 Run ID（当前未使用，预留接口）。
            skill_ref: 指定 Skill，只失效该 Skill 的缓存。

        Returns:
            失效的缓存条数。
        """
        if skill_ref:
            keys_to_remove = [k for k, v in self._cache.items() if v.get("skill_ref") == skill_ref]
        else:
            keys_to_remove = list(self._cache.keys())

        for key in keys_to_remove:
            del self._cache[key]

        return len(keys_to_remove)

    def get_cache_config(self) -> dict[str, Any]:
        """获取缓存配置。"""
        return {
            "enabled": True,
            "max_size": 10000,
            "ttl_seconds": 3600,
            "current_size": len(self._cache),
        }


def _step_timeout_seconds(run: RunRecord) -> int:
    """从环境变量或 task config 读取单步超时。"""
    task_config = run.snapshot.get("task_config_snapshot", {}) if isinstance(run.snapshot, dict) else {}
    configured = task_config.get("step_timeout_seconds")
    if configured is not None:
        return int(configured)
    env_val = os.environ.get(_STEP_TIMEOUT_ENV)
    if env_val:
        return int(env_val)
    return _DEFAULT_STEP_TIMEOUT_SECONDS


def _execute_with_timeout(skill: Any, inputs: dict, config: dict, timeout_seconds: int):
    """带超时的 Skill 执行。"""
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(skill.execute, inputs, config)
        try:
            return future.result(timeout=timeout_seconds)
        except FutureTimeoutError:
            raise AegisQAError(
                "SKILL_STEP_TIMEOUT",
                f"Skill '{skill.manifest.skill_id}' 执行超时 ({timeout_seconds}s)。",
                status_code=504,
                details={"skill_id": skill.manifest.skill_id, "timeout_seconds": timeout_seconds},
            )


def _now() -> str:
    return now_beijing_str()


def _interruptible_sleep(seconds: float, run: RunRecord) -> None:
    """可中断的 sleep: 分段等待，每 0.5s 检查取消/暂停信号。"""
    elapsed = 0.0
    while elapsed < seconds:
        chunk = min(0.5, seconds - elapsed)
        time.sleep(chunk)
        elapsed += chunk
        # 检查控制文件中的取消/暂停信号
        try:
            control_path = os.path.join("data", "aegisqa_store", "run_controls", f"{run.run_id}.json")
            if os.path.exists(control_path):
                with open(control_path) as f:
                    control = json.load(f)
                if control.get("cancel") or control.get("pause"):
                    break
        except Exception:
            pass


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
