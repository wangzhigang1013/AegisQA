from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Query

from aegisqa.api.app import (
    TaskCreateRequest,
    TaskPreflightRequest,
    _build_attempt_record,
    _build_task_record,
    _ensure_task_action_allowed,
    _ensure_task_can_create_attempt,
    _get_record,
    _now,
    _refresh_task_from_run,
    _save_record,
    _task_attempts,
)
from aegisqa.api.routes.context import RouteContext
from aegisqa.api.routes.tasks import _build_task_preflight, _ensure_preflight_matches_task_request
from aegisqa.core.errors import AegisQAError
from aegisqa.engine.runner import RunRecord, RunRequest
from aegisqa.engine.task_executor import normalize_task_submission
from aegisqa.security.access import require_permission


TASK_CONTROL_PERMISSION = "run:control"


def register_task_lifecycle_routes(app: FastAPI, ctx: RouteContext) -> None:
    """注册任务创建、执行和生命周期控制路由。"""

    @app.post("/tasks")
    def create_task(request: TaskCreateRequest) -> dict[str, Any]:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            permission="run:create",
            action="task.create",
            target=request.name,
            actor=request.actor,
        )
        workflow = ctx.workflow_service.get(request.workflow_version_id)
        dataset = ctx.dataset_service.get_version(request.dataset_id, request.dataset_version)
        preflight_request = TaskPreflightRequest(
            dataset_id=request.dataset_id,
            dataset_version=request.dataset_version,
            workflow_version_id=request.workflow_version_id,
            execution_template_id=request.execution_template_id,
            evaluation_goal=request.evaluation_goal,
            quality_gate=request.quality_gate,
            cost_budget=request.cost_budget,
            sample_repeat_times=request.sample_repeat_times,
            skill_overrides=request.skill_overrides,
        )
        # 客户端传来的 Preflight 只能证明用户看过哪组参数，不能作为安全事实源。
        preflight_result = _build_task_preflight(ctx, preflight_request)
        client_preflight_id = (request.preflight_result or {}).get("preflight_id")
        if request.preflight_id and client_preflight_id and request.preflight_id != client_preflight_id:
            raise AegisQAError(
                "TASK_PREFLIGHT_STALE",
                "Preflight ID 不一致，请基于当前参数重新运行预检。",
                status_code=409,
                details={"mismatches": [{"field": "preflight_id", "expected": request.preflight_id, "actual": client_preflight_id}]},
            )
        preflight_id = request.preflight_id or client_preflight_id
        if preflight_id:
            stored_preflight = _get_record(ctx.store, "task_preflights", str(preflight_id))
            _ensure_preflight_matches_task_request(stored_preflight, request)
            preflight_result["preflight_id"] = stored_preflight["preflight_id"]
        if request.preflight_result is not None:
            _ensure_preflight_matches_task_request(request.preflight_result, request)
            if client_preflight_id and not preflight_result.get("preflight_id"):
                preflight_result["preflight_id"] = client_preflight_id
        if preflight_result.get("status") == "blocked" and not request.allow_blocked_preflight:
            blocked_checks = [check for check in preflight_result.get("checks", []) if check.get("status") == "blocked"]
            raise AegisQAError(
                "TASK_PREFLIGHT_BLOCKED",
                "Preflight 存在阻断项，必须修复后再创建任务；如确需创建，请显式开启强制创建并保留审计证据。",
                status_code=409,
                details={"preflight_result": preflight_result, "blocked_checks": blocked_checks},
            )
        run = ctx.runner.create_run(
            RunRequest(
                workflow=workflow,
                dataset_id=dataset.dataset_id,
                dataset_version=dataset.version,
                chunk_size=request.chunk_size,
                concurrency=request.concurrency,
                sample_repeat_times=request.sample_repeat_times,
                task_config_snapshot={
                    "evaluation_goal": request.evaluation_goal,
                    "execution_template_id": request.execution_template_id,
                    "quality_gate": request.quality_gate,
                    "skill_overrides": request.skill_overrides,
                    "allow_blocked_preflight": request.allow_blocked_preflight,
                },
            )
        )
        execution_config = {
            "preflight_id": preflight_result.get("preflight_id"),
            "execution_template_id": request.execution_template_id,
            "evaluation_goal": request.evaluation_goal,
            "quality_gate": request.quality_gate,
            "chunk_size": request.chunk_size,
            "concurrency": request.concurrency,
            "sample_repeat_times": request.sample_repeat_times,
            "retry": {
                "max_retries": request.max_retries,
                "backoff_seconds": request.retry_backoff_seconds,
            },
            "cost_budget": request.cost_budget,
            "skill_overrides": request.skill_overrides,
            "allow_blocked_preflight": request.allow_blocked_preflight,
        }
        task = _build_task_record(
            request.name,
            dataset.model_dump(mode="json"),
            workflow,
            run,
            execution_config=execution_config,
            evaluation_goal=request.evaluation_goal,
            quality_gate=request.quality_gate,
            preflight_result=preflight_result,
        )
        _save_record(ctx.store, "tasks", "task_id", task)
        ctx.audit_service.record(
            actor=request.actor,
            role=request.role,
            action="task.create",
            target=task["task_id"],
            detail={"role": request.role, "run_id": run.run_id, "allow_blocked_preflight": request.allow_blocked_preflight},
        )
        return task

    @app.post("/tasks/{task_id}/execute")
    def execute_task(task_id: str, background: bool = Query(default=False), role: str = "Evaluator", actor: str = "api") -> dict[str, Any]:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=role,
            permission="run:create",
            action="task.execute",
            target=task_id,
            actor=actor,
        )
        task = _get_record(ctx.store, "tasks", task_id)
        _ensure_task_action_allowed(task, "execute")
        if background:
            run = ctx.runner.get_run(task["run_id"])
            previous_started_at = run.started_at
            run.status = "running"
            run.started_at = run.started_at or _now()
            # 后台执行必须先持久化 running 状态，否则前端轮询只能看到 queued 到 completed 的跳变。
            ctx.runner._save_run(run)
            task = _refresh_task_from_run(ctx.store, task, run)
            submitted_at = _now()
            executor_backend = str(getattr(ctx.task_executor, "backend", type(ctx.task_executor).__name__))
            task["execution_state"] = {
                "executor_backend": executor_backend,
                "executor_job_id": None,
                "run_id": run.run_id,
                "submitted_at": submitted_at,
            }
            _save_record(ctx.store, "tasks", "task_id", task)

            def refresh_progress(current_run: RunRecord) -> None:
                latest_task = _get_record(ctx.store, "tasks", task_id)
                _refresh_task_from_run(ctx.store, latest_task, current_run)

            def execute_in_background() -> None:
                try:
                    ctx.runner.execute_run(task["run_id"], progress_callback=refresh_progress)
                except Exception as exc:  # noqa: BLE001 - 后台任务不能把异常丢到线程外导致前端永远停在 running。
                    failed_run = ctx.runner.get_run(task["run_id"])
                    failed_run.status = "failed"
                    failed_run.finished_at = _now()
                    ctx.runner._save_run(failed_run)
                    latest_task = _get_record(ctx.store, "tasks", task_id)
                    refreshed = _refresh_task_from_run(ctx.store, latest_task, failed_run)
                    refreshed["last_error"] = str(exc)
                    _save_record(ctx.store, "tasks", "task_id", refreshed)
                    ctx.audit_service.record(actor=actor, role=role, action="task.execute.failed", target=task_id, detail={"role": role, "error": str(exc)})

            try:
                submission = normalize_task_submission(
                    ctx.task_executor.submit(task_id=task_id, run_id=run.run_id, execute=execute_in_background),
                    default_backend=executor_backend,
                )
            except Exception as exc:  # noqa: BLE001 - 提交到外部执行器失败时必须回滚 running，避免留下假运行任务。
                rollback_run = ctx.runner.get_run(run.run_id)
                rollback_run.status = "queued"
                rollback_run.started_at = previous_started_at
                ctx.runner._save_run(rollback_run)
                latest_task = _get_record(ctx.store, "tasks", task_id)
                rolled_back_task = _refresh_task_from_run(ctx.store, latest_task, rollback_run)
                rolled_back_task["execution_state"] = {
                    "executor_backend": executor_backend,
                    "executor_job_id": None,
                    "run_id": run.run_id,
                    "submitted_at": submitted_at,
                    "submit_error": str(exc),
                    "failed_at": _now(),
                }
                _save_record(ctx.store, "tasks", "task_id", rolled_back_task)
                ctx.audit_service.record(
                    actor=actor,
                    role=role,
                    action="task.execute.submit_failed",
                    target=task_id,
                    detail={"role": role, "run_id": run.run_id, "executor_backend": executor_backend, "error": str(exc)},
                )
                raise AegisQAError(
                    "TASK_EXECUTOR_SUBMIT_FAILED",
                    "后台任务提交失败，任务已恢复为 queued，可稍后重试。",
                    status_code=503,
                    details={"executor_backend": executor_backend, "error": str(exc), "run_id": run.run_id},
                ) from exc
            latest_task = _get_record(ctx.store, "tasks", task_id)
            execution_state = dict(latest_task.get("execution_state") or task["execution_state"])
            execution_state.update(
                {
                    "executor_backend": submission["backend"],
                    "executor_job_id": submission.get("job_id"),
                    "run_id": run.run_id,
                    "submitted_at": submitted_at,
                }
            )
            latest_task["execution_state"] = execution_state
            _save_record(ctx.store, "tasks", "task_id", latest_task)
            task["execution_state"] = execution_state
            ctx.audit_service.record(
                actor=actor,
                role=role,
                action="task.execute.start",
                target=task_id,
                detail={"role": role, "run_id": run.run_id, "background": True, "executor_backend": execution_state["executor_backend"]},
            )
            return task
        run = ctx.runner.execute_run(task["run_id"])
        refreshed = _refresh_task_from_run(ctx.store, task, run)
        ctx.audit_service.record(
            actor=actor,
            role=role,
            action="task.execute.complete",
            target=task_id,
            detail={"role": role, "run_id": run.run_id, "background": False, "status": run.status},
        )
        return refreshed

    @app.post("/tasks/{task_id}/attempts")
    def create_task_attempt(task_id: str, role: str = "Evaluator", actor: str = "api") -> dict[str, Any]:
        _require_task_permission(ctx, role=role, actor=actor, permission="run:create", action="task.attempt.create", target=task_id)
        task = _get_record(ctx.store, "tasks", task_id)
        _ensure_task_can_create_attempt(task)
        workflow = ctx.workflow_service.get(task["workflow_version_id"])
        execution_config = task.get("execution_config", {})
        run = ctx.runner.create_run(
            RunRequest(
                workflow=workflow,
                dataset_id=task["dataset_id"],
                dataset_version=task["dataset_version"],
                chunk_size=execution_config.get("chunk_size"),
                concurrency=execution_config.get("concurrency"),
                sample_repeat_times=execution_config.get("sample_repeat_times"),
                task_config_snapshot={"skill_overrides": execution_config.get("skill_overrides", {})},
            )
        )
        attempts = _task_attempts(task)
        attempt_index = len(attempts) + 1
        task.update(
            {
                "run_id": run.run_id,
                "status": run.status,
                "total_items": run.total_items,
                "completed_items": 0,
                "failed_items": 0,
                "pass_rate": 0.0,
                "badcase_count": 0,
                "current_attempt": attempt_index,
                "attempts": attempts + [_build_attempt_record(run, attempt_index)],
                "updated_at": _now(),
            }
        )
        _save_record(ctx.store, "tasks", "task_id", task)
        ctx.audit_service.record(actor=actor, role=role, action="task.attempt.create", target=task["task_id"], detail={"role": role, "run_id": run.run_id, "attempt": attempt_index})
        return task

    @app.post("/tasks/{task_id}/pause")
    def pause_task(task_id: str, role: str = "Evaluator", actor: str = "api") -> dict[str, Any]:
        _require_task_permission(ctx, role=role, actor=actor, permission=TASK_CONTROL_PERMISSION, action="task.pause", target=task_id)
        task = _get_record(ctx.store, "tasks", task_id)
        _ensure_task_action_allowed(task, "pause")
        run = ctx.runner.pause_run(task["run_id"])
        refreshed = _refresh_task_from_run(ctx.store, task, run)
        _record_task_control_success(ctx, actor=actor, role=role, action="task.pause", task_id=task_id, run_id=run.run_id, status=run.status)
        return refreshed

    @app.post("/tasks/{task_id}/resume")
    def resume_task(task_id: str, role: str = "Evaluator", actor: str = "api") -> dict[str, Any]:
        _require_task_permission(ctx, role=role, actor=actor, permission=TASK_CONTROL_PERMISSION, action="task.resume", target=task_id)
        task = _get_record(ctx.store, "tasks", task_id)
        _ensure_task_action_allowed(task, "resume")
        run = ctx.runner.resume_run(task["run_id"])
        refreshed = _refresh_task_from_run(ctx.store, task, run)
        _record_task_control_success(ctx, actor=actor, role=role, action="task.resume", task_id=task_id, run_id=run.run_id, status=run.status)
        return refreshed

    @app.post("/tasks/{task_id}/cancel")
    def cancel_task(task_id: str, role: str = "Evaluator", actor: str = "api") -> dict[str, Any]:
        _require_task_permission(ctx, role=role, actor=actor, permission=TASK_CONTROL_PERMISSION, action="task.cancel", target=task_id)
        task = _get_record(ctx.store, "tasks", task_id)
        _ensure_task_action_allowed(task, "cancel")
        run = ctx.runner.cancel_run(task["run_id"])
        refreshed = _refresh_task_from_run(ctx.store, task, run)
        _record_task_control_success(ctx, actor=actor, role=role, action="task.cancel", task_id=task_id, run_id=run.run_id, status=run.status)
        return refreshed

    @app.post("/tasks/{task_id}/retry-failed")
    def retry_failed_task(task_id: str, role: str = "Evaluator", actor: str = "api") -> dict[str, Any]:
        _require_task_permission(ctx, role=role, actor=actor, permission=TASK_CONTROL_PERMISSION, action="task.retry_failed", target=task_id)
        task = _get_record(ctx.store, "tasks", task_id)
        _ensure_task_action_allowed(task, "retry")
        run = ctx.runner.retry_failed_items(task["run_id"])
        refreshed = _refresh_task_from_run(ctx.store, task, run)
        _record_task_control_success(ctx, actor=actor, role=role, action="task.retry_failed", task_id=task_id, run_id=run.run_id, status=run.status)
        return refreshed


def _require_task_permission(ctx: RouteContext, *, role: str, actor: str, permission: str, action: str, target: str) -> None:
    require_permission(
        ctx.access_control,
        ctx.audit_service,
        role=role,
        permission=permission,
        action=action,
        target=target,
        actor=actor,
    )


def _record_task_control_success(ctx: RouteContext, *, actor: str, role: str, action: str, task_id: str, run_id: str, status: str) -> None:
    ctx.audit_service.record(
        actor=actor,
        role=role,
        action=action,
        target=task_id,
        detail={"role": role, "run_id": run_id, "status": status},
    )
