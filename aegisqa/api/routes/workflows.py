from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException

from aegisqa.api.app import (
    WorkflowCopyRequest,
    WorkflowDraftCreateRequest,
    WorkflowDraftUpdateRequest,
    WorkflowGraphDryRunRequest,
    WorkflowParameterPreviewRequest,
    WorkflowGraphPublishRequest,
    WorkflowGraphValidateRequest,
    _get_workflow_draft,
    _list_workflow_drafts,
    _now,
    _save_workflow_draft,
)
from aegisqa.api.routes.context import RouteContext
from aegisqa.core.errors import AegisQAError
from aegisqa.engine.runner import RunRecord
from aegisqa.security.access import require_permission
from aegisqa.skills.parameters import SkillParameterResolver
from aegisqa.workflows.graph import WorkflowGraph, WorkflowGraphValidationResult
from aegisqa.workflows.models import WorkflowDraft, WorkflowVersion
from aegisqa.workflows.templates import WorkflowTemplate


WORKFLOW_WRITE_PERMISSION = "workflow:publish"


def register_workflow_routes(app: FastAPI, ctx: RouteContext) -> None:
    @app.get("/workflow-templates", response_model=list[WorkflowTemplate])
    def list_workflow_templates() -> list[WorkflowTemplate]:
        return ctx.template_service.list_templates()

    @app.get("/workflows", response_model=list[WorkflowVersion])
    def list_workflows() -> list[WorkflowVersion]:
        return ctx.workflow_service.list_versions()

    @app.get("/workflow-drafts")
    def list_workflow_drafts(status: str | None = None) -> list[dict[str, Any]]:
        return _list_workflow_drafts(ctx.store, status=status)

    @app.post("/workflow-drafts")
    def create_workflow_draft(request: WorkflowDraftCreateRequest) -> dict[str, Any]:
        _require_workflow_write(ctx, role=request.role, actor=request.actor, action="workflow_draft.create", target=request.name)
        graph = _graph_with_name(request.graph, request.name)
        draft = {
            "draft_id": f"draft-{uuid4().hex[:12]}",
            "name": request.name,
            "status": "draft",
            "graph": graph.model_dump(mode="json"),
            "created_at": _now(),
            "updated_at": _now(),
        }
        _save_workflow_draft(ctx.store, draft)
        ctx.audit_service.record(actor=request.actor, role=request.role, action="workflow_draft.create", target=draft["draft_id"], detail={"role": request.role})
        return draft

    @app.get("/workflow-drafts/{draft_id}")
    def get_workflow_draft(draft_id: str) -> dict[str, Any]:
        return _get_workflow_draft(ctx.store, draft_id)

    @app.put("/workflow-drafts/{draft_id}")
    def update_workflow_draft(draft_id: str, request: WorkflowDraftUpdateRequest) -> dict[str, Any]:
        _require_workflow_write(ctx, role=request.role, actor=request.actor, action="workflow_draft.update", target=draft_id)
        draft = _get_workflow_draft(ctx.store, draft_id)
        graph = request.graph or WorkflowGraph(**draft["graph"])
        next_name = request.name if request.name is not None else graph.name
        draft["name"] = next_name
        graph = _graph_with_name(graph, next_name)
        if request.graph is not None:
            draft["graph"] = graph.model_dump(mode="json")
        elif request.name is not None:
            draft["graph"] = graph.model_dump(mode="json")
        draft["updated_at"] = _now()
        _save_workflow_draft(ctx.store, draft)
        ctx.audit_service.record(actor=request.actor, role=request.role, action="workflow_draft.update", target=draft_id, detail={"role": request.role})
        return draft

    @app.delete("/workflow-drafts/{draft_id}")
    def delete_workflow_draft(draft_id: str, role: str = "Evaluator", actor: str = "api") -> dict[str, Any]:
        _require_workflow_write(ctx, role=role, actor=actor, action="workflow_draft.delete", target=draft_id)
        draft = _get_workflow_draft(ctx.store, draft_id)
        draft["status"] = "deleted"
        draft["updated_at"] = _now()
        _save_workflow_draft(ctx.store, draft)
        ctx.audit_service.record(actor=actor, role=role, action="workflow_draft.delete", target=draft_id, detail={"role": role})
        return draft

    @app.post("/workflow-drafts/{draft_id}/publish", response_model=WorkflowVersion)
    def publish_workflow_draft(draft_id: str, role: str = "Evaluator", actor: str = "api") -> WorkflowVersion:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=role,
            permission=WORKFLOW_WRITE_PERMISSION,
            action="workflow.publish",
            target=draft_id,
            actor=actor,
        )
        draft = _get_workflow_draft(ctx.store, draft_id)
        graph = WorkflowGraph(**draft["graph"])
        graph.name = draft["name"]
        validation = ctx.graph_service.validate(graph)
        if not validation.ok:
            raise HTTPException(status_code=400, detail={"message": "Workflow Graph 校验失败", "errors": [error.model_dump(mode="json") for error in validation.errors]})
        version = ctx.workflow_service.publish(ctx.graph_service.to_workflow_draft(graph))
        ctx.workflows[version.version_id] = version
        draft["status"] = "published"
        draft["graph"] = graph.model_dump(mode="json")
        draft["published_version_id"] = version.version_id
        draft["updated_at"] = _now()
        _save_workflow_draft(ctx.store, draft)
        ctx.audit_service.record(actor=actor, role=role, action="workflow_draft.publish", target=draft_id, detail={"role": role, "version_id": version.version_id})
        return version

    @app.post("/workflow-graphs/validate", response_model=WorkflowGraphValidationResult)
    def validate_workflow_graph(request: WorkflowGraphValidateRequest) -> WorkflowGraphValidationResult:
        return ctx.graph_service.validate(request.graph, sample_row=request.sample_row)

    @app.post("/workflow-graphs/publish", response_model=WorkflowVersion)
    def publish_workflow_graph(request: WorkflowGraphPublishRequest) -> WorkflowVersion:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            permission=WORKFLOW_WRITE_PERMISSION,
            action="workflow.publish",
            target=request.graph.name,
            actor=request.actor,
        )
        validation = ctx.graph_service.validate(request.graph)
        if not validation.ok:
            raise HTTPException(status_code=400, detail={"message": "Workflow Graph 校验失败", "errors": [error.model_dump(mode="json") for error in validation.errors]})
        version = ctx.workflow_service.publish(ctx.graph_service.to_workflow_draft(request.graph))
        ctx.workflows[version.version_id] = version
        ctx.audit_service.record(actor=request.actor, role=request.role, action="workflow_graph.publish", target=version.version_id, detail={"role": request.role, "graph_name": request.graph.name})
        return version

    @app.post("/workflow-graphs/dry-run", response_model=RunRecord)
    def dry_run_workflow_graph(request: WorkflowGraphDryRunRequest) -> RunRecord:
        validation = ctx.graph_service.validate(request.graph)
        if not validation.ok:
            raise HTTPException(status_code=400, detail={"message": "Workflow Graph 校验失败", "errors": [error.model_dump(mode="json") for error in validation.errors]})
        workflow = ctx.graph_service.to_workflow_draft(request.graph).publish()
        return ctx.runner.dry_run(workflow, request.dataset_id, request.dataset_version, sample_size=request.sample_size)

    @app.post("/workflow-graphs/parameter-preview")
    def preview_workflow_parameters(request: WorkflowParameterPreviewRequest) -> dict[str, Any]:
        workflow = ctx.graph_service.to_workflow_draft(request.graph).publish()
        runtime_context = {"row": request.sample_row, "context": {}, "metrics": {}, "artifacts": {}, "errors": [], "steps": {}}
        nodes: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        for step in workflow.steps:
            skill = ctx.registry.get(step.skill_ref)
            try:
                resolved = SkillParameterResolver(skill.manifest.config_schema).resolve(
                    workflow_config=step.config,
                    task_override=request.task_overrides.get(step.step_id, {}),
                    runtime_context=runtime_context,
                    secret_values={},
                )
            except Exception as exc:  # noqa: BLE001 - 参数预览要把每个节点的错误收敛成前端可修复信息。
                errors.append({"step_id": step.step_id, "skill_ref": step.skill_ref, "message": str(exc), "type": type(exc).__name__})
                continue
            nodes.append(
                {
                    "node_id": step.step_id,
                    "skill_ref": step.skill_ref,
                    "resolved_config": resolved.config,
                    "parameter_trace": resolved.trace,
                }
            )
        if errors:
            raise AegisQAError("PARAMETER_PREVIEW_FAILED", "Workflow 参数预览失败，请检查表达式路径和参数类型。", status_code=400, details={"errors": errors})
        return {"workflow_name": workflow.name, "nodes": nodes}

    @app.post("/workflows/publish", response_model=WorkflowVersion)
    def publish_workflow(draft: WorkflowDraft, role: str = "Evaluator", actor: str = "api") -> WorkflowVersion:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=role,
            permission=WORKFLOW_WRITE_PERMISSION,
            action="workflow.publish",
            target=draft.name,
            actor=actor,
        )
        version = ctx.workflow_service.publish(draft)
        ctx.workflows[version.version_id] = version
        ctx.audit_service.record(actor=actor, role=role, action="workflow.publish", target=version.version_id, detail={"role": role, "workflow_name": draft.name})
        return version

    @app.post("/workflows/{version_id:path}/copy")
    def copy_workflow(version_id: str, request: WorkflowCopyRequest) -> dict[str, Any]:
        _require_workflow_write(ctx, role=request.role, actor=request.actor, action="workflow.copy", target=version_id)
        draft = ctx.workflow_service.copy_workflow(version_id, name=request.name)
        ctx.audit_service.record(actor=request.actor, role=request.role, action="workflow.copy", target=version_id, detail={"role": request.role, "new_name": draft.name})
        return draft.model_dump(mode="json")

    @app.post("/workflows/{version_id:path}/archive", response_model=WorkflowVersion)
    def archive_workflow(version_id: str, role: str = "Evaluator", actor: str = "api") -> WorkflowVersion:
        _require_workflow_write(ctx, role=role, actor=actor, action="workflow.archive", target=version_id)
        archived = ctx.workflow_service.archive(version_id)
        ctx.audit_service.record(actor=actor, role=role, action="workflow.archive", target=version_id, detail={"role": role})
        return archived


def _require_workflow_write(ctx: RouteContext, *, role: str, actor: str, action: str, target: str) -> None:
    require_permission(
        ctx.access_control,
        ctx.audit_service,
        role=role,
        permission=WORKFLOW_WRITE_PERMISSION,
        action=action,
        target=target,
        actor=actor,
    )


def _graph_with_name(graph: WorkflowGraph, name: str) -> WorkflowGraph:
    """让草稿展示名称和 graph.name 保持一致。

    前端画布、Workflow 市场和发布版本分别读取不同字段；如果二者不同步，
    用户填写的名称会在刷新、发布或创建任务时退回旧默认值。
    """

    synced = graph.model_copy(deep=True)
    synced.name = name
    return synced
