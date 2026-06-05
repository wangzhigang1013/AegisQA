from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Query

from aegisqa.api.app import (
    RepairTaskActionRequest,
    RepairTaskAssignRequest,
    RepairTaskReopenRequest,
    RepairTaskResolveRequest,
    RepairTaskStartRequest,
    _build_parameter_governance,
    _get_record,
    _now,
    _save_record,
)
from aegisqa.api.routes.context import RouteContext
from aegisqa.api.routes.tasks import (
    _append_repair_task_action,
    _build_repair_task_tree,
    _create_repair_tasks_from_diagnostics,
    _paginate_records,
    _repair_action_compare_prompt_skill_versions,
    _repair_action_create_followup_tasks,
    _repair_action_create_prompt_skill_candidate,
    _repair_action_create_workflow_draft_from_version_diff,
    _repair_action_evaluate_ci_gate,
    _repair_action_fix_dataset_fields,
    _repair_action_generate_remediation_plan,
    _repair_action_link_target,
    _repair_action_plan_workflow_parameter_changes,
    _repair_action_retest_and_compare,
    _repair_action_seed_annotation_queue,
    _repair_task_is_overdue,
    _transition_repair_task,
)
from aegisqa.core.errors import AegisQAError
from aegisqa.reports.aggregator import aggregate_run_report, build_report_segments
from aegisqa.reports.diagnostics import build_task_diagnostics
from aegisqa.security.access import require_permission


REPAIR_TASK_WRITE_PERMISSION = "badcase:correct"


def register_repair_task_routes(app: FastAPI, ctx: RouteContext) -> None:
    """注册修复任务与动作闭环路由。"""

    @app.get("/repair-tasks")
    def list_repair_tasks(
        source_task_id: str | None = Query(default=None),
        status: str | None = Query(default=None),
        page: int | None = Query(default=None, ge=1),
        page_size: int = Query(default=20, ge=1, le=100),
    ) -> list[dict[str, Any]] | dict[str, Any]:
        records = _paginate_repair_tasks(ctx, source_task_id=source_task_id, status=status)
        if page is not None:
            return _paginate_records(records, page=page, page_size=page_size)
        return records

    @app.get("/repair-tasks/{repair_task_id}/tree")
    def get_repair_task_tree(repair_task_id: str) -> dict[str, Any]:
        record = _get_record(ctx.store, "repair_tasks", repair_task_id)
        return _build_repair_task_tree(ctx, record)

    @app.post("/repair-tasks/{repair_task_id}/start")
    def start_repair_task(repair_task_id: str, request: RepairTaskStartRequest) -> dict[str, Any]:
        _require_repair_task_write(ctx, role=request.role, actor=request.actor, action="repair_task.start", target=repair_task_id)
        return _transition_repair_task(
            ctx,
            repair_task_id,
            allowed_statuses={"open"},
            updates={
                "status": "in_progress",
                "owner": request.owner,
                "started_at": _now(),
                "updated_at": _now(),
            },
            audit_action="repair_task.start",
            actor=request.actor,
            role=request.role,
        )

    @app.post("/repair-tasks/{repair_task_id}/assign")
    def assign_repair_task(repair_task_id: str, request: RepairTaskAssignRequest) -> dict[str, Any]:
        _require_repair_task_write(ctx, role=request.role, actor=request.actor, action="repair_task.assign", target=repair_task_id)
        record = _get_record(ctx.store, "repair_tasks", repair_task_id)
        if record.get("status") == "resolved":
            raise AegisQAError(
                "REPAIR_TASK_ASSIGN_RESOLVED",
                "已完成的修复任务不能重新指派，请先重开任务。",
                status_code=409,
                details={"repair_task_id": repair_task_id, "status": record.get("status")},
            )
        record.update(
            {
                "owner": request.owner,
                "due_at": request.due_at,
                "assigned_at": _now(),
                "overdue": _repair_task_is_overdue(request.due_at, str(record.get("status") or "open")),
                "updated_at": _now(),
            }
        )
        _save_record(ctx.store, "repair_tasks", "repair_task_id", record)
        ctx.audit_service.record(
            actor=request.actor,
            role=request.role,
            action="repair_task.assign",
            target=repair_task_id,
            detail={"role": request.role, "owner": request.owner, "due_at": request.due_at, "overdue": record.get("overdue")},
        )
        return record

    @app.post("/repair-tasks/{repair_task_id}/resolve")
    def resolve_repair_task(repair_task_id: str, request: RepairTaskResolveRequest) -> dict[str, Any]:
        _require_repair_task_write(ctx, role=request.role, actor=request.actor, action="repair_task.resolve", target=repair_task_id)
        return _transition_repair_task(
            ctx,
            repair_task_id,
            allowed_statuses={"open", "in_progress"},
            updates={
                "status": "resolved",
                "resolution_note": request.resolution_note,
                "overdue": False,
                "resolved_at": _now(),
                "updated_at": _now(),
            },
            audit_action="repair_task.resolve",
            actor=request.actor,
            role=request.role,
        )

    @app.post("/repair-tasks/{repair_task_id}/reopen")
    def reopen_repair_task(repair_task_id: str, request: RepairTaskReopenRequest) -> dict[str, Any]:
        _require_repair_task_write(ctx, role=request.role, actor=request.actor, action="repair_task.reopen", target=repair_task_id)
        return _transition_repair_task(
            ctx,
            repair_task_id,
            allowed_statuses={"resolved"},
            updates={
                "status": "open",
                "reopen_reason": request.reason,
                "reopened_at": _now(),
                "updated_at": _now(),
            },
            audit_action="repair_task.reopen",
            actor=request.actor,
            role=request.role,
        )

    @app.post("/repair-tasks/{repair_task_id}/actions")
    def run_repair_task_action(repair_task_id: str, request: RepairTaskActionRequest) -> dict[str, Any]:
        action = request.action
        _require_repair_task_write(ctx, role=request.role, actor=request.actor, action=f"repair_task.action.{action}", target=repair_task_id)
        record = _get_record(ctx.store, "repair_tasks", repair_task_id)
        if action == "seed_annotation_queue":
            result = _repair_action_seed_annotation_queue(ctx, record, request)
        elif action == "evaluate_ci_gate":
            result = _repair_action_evaluate_ci_gate(ctx, record)
        elif action == "retest_and_compare":
            result = _repair_action_retest_and_compare(ctx, record, actor=request.actor, role=request.role)
        elif action == "generate_remediation_plan":
            result = _repair_action_generate_remediation_plan(ctx, record)
        elif action == "create_followup_repair_tasks":
            result = _repair_action_create_followup_tasks(ctx, record)
        elif action == "fix_dataset_fields":
            result = _repair_action_fix_dataset_fields(ctx, record)
        elif action == "plan_workflow_parameter_changes":
            result = _repair_action_plan_workflow_parameter_changes(ctx, record)
        elif action == "compare_prompt_skill_versions":
            result = _repair_action_compare_prompt_skill_versions(ctx, record)
        elif action == "create_prompt_skill_candidate":
            result = _repair_action_create_prompt_skill_candidate(ctx, record)
        elif action == "create_workflow_draft_from_version_diff":
            result = _repair_action_create_workflow_draft_from_version_diff(ctx, record, actor=request.actor, role=request.role)
        elif action in {"open_trace_flow", "open_parameter_governance", "open_dataset_lineage"}:
            result = _repair_action_link_target(record, action)
        else:
            raise AegisQAError(
                "REPAIR_TASK_ACTION_UNSUPPORTED",
                "当前修复任务动作暂不支持。",
                status_code=400,
                details={
                    "action": action,
                    "supported_actions": [
                        "seed_annotation_queue",
                        "evaluate_ci_gate",
                        "retest_and_compare",
                        "generate_remediation_plan",
                        "create_followup_repair_tasks",
                        "fix_dataset_fields",
                        "plan_workflow_parameter_changes",
                        "compare_prompt_skill_versions",
                        "create_prompt_skill_candidate",
                        "create_workflow_draft_from_version_diff",
                        "open_trace_flow",
                        "open_parameter_governance",
                        "open_dataset_lineage",
                    ],
                },
            )
        updated_record = _append_repair_task_action(ctx, record, action, result, actor=request.actor, role=request.role)
        return {"action": action, "result": result, "repair_task": updated_record}

    @app.post("/tasks/{task_id}/repair-tasks/from-diagnostics")
    def create_repair_tasks_from_diagnostics(task_id: str, role: str = "Evaluator", actor: str = "api") -> dict[str, Any]:
        _require_repair_task_write(ctx, role=role, actor=actor, action="repair_task.create_from_diagnostics", target=task_id)
        task = _get_record(ctx.store, "tasks", task_id)
        run = ctx.runner.get_run(task["run_id"])
        report = aggregate_run_report(run)
        segments = build_report_segments(run)
        parameter_governance = _build_parameter_governance(task, run)
        diagnostics = build_task_diagnostics(task, run, report, segments, parameter_governance)
        result = _create_repair_tasks_from_diagnostics(ctx, task, diagnostics)
        ctx.audit_service.record(
            actor=actor,
            role=role,
            action="repair_task.create_from_diagnostics",
            target=task_id,
            detail={"role": role, "created_count": result["created_count"], "reused_count": result["reused_count"]},
        )
        return result


def _require_repair_task_write(ctx: RouteContext, *, role: str, actor: str, action: str, target: str) -> None:
    require_permission(
        ctx.access_control,
        ctx.audit_service,
        role=role,
        permission=REPAIR_TASK_WRITE_PERMISSION,
        action=action,
        target=target,
        actor=actor,
    )


def _paginate_repair_tasks(ctx: RouteContext, *, source_task_id: str | None, status: str | None) -> list[dict[str, Any]]:
    records = _list_repair_task_records(ctx)
    if source_task_id:
        records = [record for record in records if record.get("source_task_id") == source_task_id]
    if status:
        records = [record for record in records if record.get("status") == status]
    return sorted(records, key=lambda item: str(item.get("created_at", "")), reverse=True)


def _list_repair_task_records(ctx: RouteContext) -> list[dict[str, Any]]:
    from aegisqa.api.app import _list_records

    return _list_records(ctx.store, "repair_tasks")
