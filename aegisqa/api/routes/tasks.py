from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException

from aegisqa.api.app import (
    RunCreateRequest,
    TaskCreateRequest,
    _build_attempt_record,
    _build_judge_score_distribution,
    _build_step_distribution,
    _build_task_record,
    _build_task_report_summary,
    _build_task_report_version_snapshot,
    _build_trace_tree,
    _ensure_task_action_allowed,
    _ensure_task_can_create_attempt,
    _get_record,
    _list_records,
    _now,
    _refresh_task_from_run,
    _save_record,
    _task_attempts,
)
from aegisqa.api.routes.context import RouteContext
from aegisqa.engine.runner import RunRecord, RunRequest
from aegisqa.reports.aggregator import aggregate_run_report, build_report_recommendations, build_report_segments
from aegisqa.reports.trace_flow import build_task_trace_flow


def register_task_routes(app: FastAPI, ctx: RouteContext) -> None:
    @app.get("/tasks")
    def list_tasks() -> list[dict[str, Any]]:
        return _list_records(ctx.store, "tasks")

    @app.post("/tasks")
    def create_task(request: TaskCreateRequest) -> dict[str, Any]:
        workflow = ctx.workflow_service.get(request.workflow_version_id)
        dataset = ctx.dataset_service.get_version(request.dataset_id, request.dataset_version)
        run = ctx.runner.create_run(
            RunRequest(
                workflow=workflow,
                dataset_id=dataset.dataset_id,
                dataset_version=dataset.version,
                chunk_size=request.chunk_size,
                concurrency=request.concurrency,
                sample_repeat_times=request.sample_repeat_times,
                task_config_snapshot={"skill_overrides": request.skill_overrides},
            )
        )
        execution_config = {
            "chunk_size": request.chunk_size,
            "concurrency": request.concurrency,
            "sample_repeat_times": request.sample_repeat_times,
            "retry": {
                "max_retries": request.max_retries,
                "backoff_seconds": request.retry_backoff_seconds,
            },
            "cost_budget": request.cost_budget,
            "skill_overrides": request.skill_overrides,
        }
        task = _build_task_record(request.name, dataset.model_dump(mode="json"), workflow, run, execution_config=execution_config)
        _save_record(ctx.store, "tasks", "task_id", task)
        ctx.audit_service.record(actor="api", action="task.create", target=task["task_id"], detail={"run_id": run.run_id})
        return task

    @app.get("/tasks/{task_id}")
    def get_task(task_id: str) -> dict[str, Any]:
        return _get_record(ctx.store, "tasks", task_id)

    @app.post("/tasks/{task_id}/execute")
    def execute_task(task_id: str) -> dict[str, Any]:
        task = _get_record(ctx.store, "tasks", task_id)
        _ensure_task_action_allowed(task, "execute")
        run = ctx.runner.execute_run(task["run_id"])
        return _refresh_task_from_run(ctx.store, task, run)

    @app.post("/tasks/{task_id}/attempts")
    def create_task_attempt(task_id: str) -> dict[str, Any]:
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
        ctx.audit_service.record(actor="api", action="task.attempt.create", target=task["task_id"], detail={"run_id": run.run_id, "attempt": attempt_index})
        return task

    @app.post("/tasks/{task_id}/pause")
    def pause_task(task_id: str) -> dict[str, Any]:
        task = _get_record(ctx.store, "tasks", task_id)
        _ensure_task_action_allowed(task, "pause")
        run = ctx.runner.pause_run(task["run_id"])
        return _refresh_task_from_run(ctx.store, task, run)

    @app.post("/tasks/{task_id}/resume")
    def resume_task(task_id: str) -> dict[str, Any]:
        task = _get_record(ctx.store, "tasks", task_id)
        _ensure_task_action_allowed(task, "resume")
        run = ctx.runner.resume_run(task["run_id"])
        return _refresh_task_from_run(ctx.store, task, run)

    @app.post("/tasks/{task_id}/cancel")
    def cancel_task(task_id: str) -> dict[str, Any]:
        task = _get_record(ctx.store, "tasks", task_id)
        _ensure_task_action_allowed(task, "cancel")
        run = ctx.runner.cancel_run(task["run_id"])
        return _refresh_task_from_run(ctx.store, task, run)

    @app.post("/tasks/{task_id}/retry-failed")
    def retry_failed_task(task_id: str) -> dict[str, Any]:
        task = _get_record(ctx.store, "tasks", task_id)
        _ensure_task_action_allowed(task, "retry")
        run = ctx.runner.retry_failed_items(task["run_id"])
        return _refresh_task_from_run(ctx.store, task, run)

    @app.get("/tasks/{task_id}/report")
    def get_task_report(task_id: str) -> dict[str, Any]:
        task = _get_record(ctx.store, "tasks", task_id)
        run = ctx.runner.get_run(task["run_id"])
        report = aggregate_run_report(run)
        segments = build_report_segments(run)
        return {
            "task": task,
            "task_summary": _build_task_report_summary(task, run),
            "version_snapshot": _build_task_report_version_snapshot(task, run),
            "step_distribution": _build_step_distribution(run),
            "judge_score_distribution": _build_judge_score_distribution(run),
            "segments": [segment.model_dump(mode="json") for segment in segments],
            "recommendations": [recommendation.model_dump(mode="json") for recommendation in build_report_recommendations(segments)],
            "report": report.model_dump(mode="json"),
            "badcases": [badcase.model_dump(mode="json") for badcase in report.badcases],
            "export_links": {
                "json": f"/runs/{task['run_id']}/report/export?file_format=json",
                "csv": f"/runs/{task['run_id']}/report/export?file_format=csv",
                "html": f"/runs/{task['run_id']}/report/export?file_format=html",
            },
        }

    @app.get("/tasks/{task_id}/trace-tree")
    def get_task_trace_tree(task_id: str) -> dict[str, Any]:
        task = _get_record(ctx.store, "tasks", task_id)
        return _build_trace_tree(ctx.runner.get_run(task["run_id"]))

    @app.get("/tasks/{task_id}/trace-flow")
    def get_task_trace_flow(task_id: str) -> dict[str, Any]:
        task = _get_record(ctx.store, "tasks", task_id)
        return build_task_trace_flow(task, ctx.runner.get_run(task["run_id"]))

    @app.post("/runs", response_model=RunRecord)
    def create_run(request: RunCreateRequest) -> RunRecord:
        return ctx.runner.create_run(
            RunRequest(
                workflow=request.workflow,
                dataset_id=request.dataset_id,
                dataset_version=request.dataset_version,
                chunk_size=request.chunk_size,
                concurrency=request.concurrency,
                sample_repeat_times=request.sample_repeat_times,
                rate_limits=request.rate_limits,
            )
        )

    @app.get("/runs", response_model=list[RunRecord])
    def list_runs() -> list[RunRecord]:
        return ctx.runner.list_runs()

    @app.post("/runs/{run_id}/execute", response_model=RunRecord)
    def execute_run(run_id: str) -> RunRecord:
        try:
            return ctx.runner.execute_run(run_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/runs/{run_id}/retry-failed", response_model=RunRecord)
    def retry_failed(run_id: str) -> RunRecord:
        return ctx.runner.retry_failed_items(run_id)

    @app.post("/runs/{run_id}/cancel", response_model=RunRecord)
    def cancel_run(run_id: str) -> RunRecord:
        return ctx.runner.cancel_run(run_id)

    @app.post("/runs/{run_id}/pause", response_model=RunRecord)
    def pause_run(run_id: str) -> RunRecord:
        ctx.audit_service.record(actor="api", action="run.pause", target=run_id)
        return ctx.runner.pause_run(run_id)

    @app.post("/runs/{run_id}/resume", response_model=RunRecord)
    def resume_run(run_id: str) -> RunRecord:
        ctx.audit_service.record(actor="api", action="run.resume", target=run_id)
        return ctx.runner.resume_run(run_id)

    @app.get("/runs/{run_id}", response_model=RunRecord)
    def get_run(run_id: str) -> RunRecord:
        return ctx.runner.get_run(run_id)
