from __future__ import annotations

from typing import Any

from fastapi import FastAPI

from aegisqa.api.app import TaskExecutionTemplateCreateRequest, TaskPreflightRequest, _get_record, _save_record
from aegisqa.api.routes.context import RouteContext
from aegisqa.api.routes.tasks import (
    _build_task_execution_template,
    _build_task_preflight,
    _list_task_execution_templates,
    _save_task_preflight,
)
from aegisqa.security.access import require_permission


def register_task_preflight_routes(app: FastAPI, ctx: RouteContext) -> None:
    """注册任务预检和执行模板路由。"""

    @app.get("/task-preflights/{preflight_id}")
    def get_task_preflight(preflight_id: str) -> dict[str, Any]:
        return _get_record(ctx.store, "task_preflights", preflight_id)

    @app.get("/task-execution-templates")
    def list_task_execution_templates() -> list[dict[str, Any]]:
        return _list_task_execution_templates(ctx)

    @app.post("/task-execution-templates")
    def create_task_execution_template(request: TaskExecutionTemplateCreateRequest) -> dict[str, Any]:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            actor=request.actor,
            permission="run:create",
            action="task_execution_template.create",
            target=request.name,
            detail={"evaluation_goal": request.evaluation_goal},
        )
        template = _build_task_execution_template(request)
        _save_record(ctx.store, "task_execution_templates", "template_id", template)
        ctx.audit_service.record(
            actor=request.actor,
            role=request.role,
            action="task_execution_template.create",
            target=template["template_id"],
            detail={"name": template["name"], "evaluation_goal": template.get("evaluation_goal"), "role": request.role},
        )
        return template

    @app.post("/tasks/preflight")
    def task_preflight(request: TaskPreflightRequest) -> dict[str, Any]:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            actor=request.actor,
            permission="run:create",
            action="task.preflight",
            target=request.workflow_version_id,
            detail={"dataset_id": request.dataset_id, "dataset_version": request.dataset_version},
        )
        preflight = _build_task_preflight(ctx, request)
        return _save_task_preflight(ctx, preflight, actor=request.actor, role=request.role)
