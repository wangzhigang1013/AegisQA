from __future__ import annotations

import csv
import io
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from html import escape
from math import ceil
from typing import Any, Iterable, Iterator
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from aegisqa.api.experience import build_report_experience, enrich_task_detail
from aegisqa.api.app import (
    CIGateRuleRequest,
    RepairTaskActionRequest,
    RepairTaskAssignRequest,
    RepairTaskReopenRequest,
    RepairTaskResolveRequest,
    RepairTaskStartRequest,
    ReportExportApprovalRequest,
    ReportExportRequestCreate,
    ReportExportRevokeRequest,
    _build_annotation_task,
    RunCreateRequest,
    TaskCreateRequest,
    TaskExecutionTemplateCreateRequest,
    TaskPreflightRequest,
    _build_attempt_record,
    _build_budget_status,
    _build_judge_score_distribution,
    _build_parameter_governance,
    _build_step_distribution,
    _build_task_record,
    _build_task_report_summary,
    _build_task_report_version_snapshot,
    _ci_gate_metrics_from_task,
    _build_trace_tree,
    _build_quality_decision,
    _ensure_task_action_allowed,
    _ensure_task_can_create_attempt,
    _get_record,
    _evaluate_gate,
    _list_records,
    _needs_annotation,
    _now,
    _refresh_task_from_run,
    _save_record,
    _save_workflow_draft,
    _task_attempts,
    json_dumps,
)
from aegisqa.api.routes.context import RouteContext
from aegisqa.core.errors import AegisQAError
from aegisqa.core.mapper import MappingPathError, TypeMismatchError, collect_mapping_row_fields, resolve_input_mapping, set_by_path
from aegisqa.core.security import redact_secrets
from aegisqa.engine.runner import RunRecord, RunRequest
from aegisqa.reports.aggregator import aggregate_run_report, build_report_recommendations, build_report_segments, compare_reports
from aegisqa.reports.diagnostics import build_task_diagnostics
from aegisqa.reports.trace_flow import build_task_trace_flow
from aegisqa.security.access import require_permission
from aegisqa.skills.parameters import SkillParameterResolver
from aegisqa.workflows.validation import config_issue_from_exception, validate_workflow_step_contracts


REPORT_EXPORT_FORMATS = {"json", "csv", "html", "offline_zip"}
TASK_RESULT_EXPORT_FORMATS = {"json", "jsonl", "csv"}
TASK_RESULT_EXPORT_MEDIA_TYPES = {
    "csv": "text/csv; charset=utf-8",
    "jsonl": "application/x-ndjson; charset=utf-8",
    "json": "application/json; charset=utf-8",
}


class StepReplayRequest(BaseModel):
    input_mode: str = Field(default="original", pattern="^(original|override)$")
    override_input: dict[str, Any] = Field(default_factory=dict)
    override_config: dict[str, Any] = Field(default_factory=dict)
    disable_cache: bool = True
    mock_llm_calls: bool = True
    role: str = "Evaluator"
    actor: str = "api"


class StepPromptDebugRequest(BaseModel):
    variables: dict[str, Any] = Field(default_factory=dict)
    mock_llm_calls: bool = True
    role: str = "Evaluator"
    actor: str = "api"


def register_task_routes(app: FastAPI, ctx: RouteContext) -> None:
    @app.get("/tasks")
    def list_tasks(
        status: str | None = Query(default=None),
        dataset_id: str | None = Query(default=None),
        workflow_id: str | None = Query(default=None),
        q: str | None = Query(default=None),
        page: int | None = Query(default=None, ge=1),
        page_size: int = Query(default=20, ge=1, le=100),
    ) -> list[dict[str, Any]] | dict[str, Any]:
        tasks = _list_records(ctx.store, "tasks")
        if status:
            tasks = [task for task in tasks if task.get("status") == status]
        if dataset_id:
            tasks = [task for task in tasks if task.get("dataset_id") == dataset_id]
        if workflow_id:
            tasks = [task for task in tasks if task.get("workflow_id") == workflow_id]
        if q:
            keyword = q.strip().lower()
            tasks = [
                task
                for task in tasks
                if keyword in str(task.get("name", "")).lower()
                or keyword in str(task.get("dataset_name", "")).lower()
                or keyword in str(task.get("workflow_name", "")).lower()
            ]
        if page is None:
            # 旧前端和部分测试仍依赖数组响应；只有显式分页时才切换为分页对象。
            return tasks
        return _paginate_records(tasks, page=page, page_size=page_size)

    @app.get("/tasks/{task_id}")
    def get_task(task_id: str) -> dict[str, Any]:
        return enrich_task_detail(ctx, _get_record(ctx.store, "tasks", task_id))

    @app.get("/tasks/{task_id}/diagnostics")
    def get_task_diagnostics(task_id: str) -> dict[str, Any]:
        task = _get_record(ctx.store, "tasks", task_id)
        run = ctx.runner.get_run(task["run_id"])
        report = aggregate_run_report(run)
        segments = build_report_segments(run)
        parameter_governance = _build_parameter_governance(task, run)
        return build_task_diagnostics(task, run, report, segments, parameter_governance)

    @app.get("/tasks/{task_id}/parameter-governance")
    def get_task_parameter_governance(task_id: str) -> dict[str, Any]:
        task = _get_record(ctx.store, "tasks", task_id)
        run = ctx.runner.get_run(task["run_id"])
        return _build_parameter_governance(task, run)

    @app.get("/tasks/{task_id}/trace-tree")
    def get_task_trace_tree(
        task_id: str,
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=100),
    ) -> dict[str, Any]:
        task = _get_record(ctx.store, "tasks", task_id)
        return _build_trace_tree(ctx.runner.get_run(task["run_id"]), page=page, page_size=page_size)

    @app.get("/tasks/{task_id}/trace-flow")
    def get_task_trace_flow(
        task_id: str,
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=100),
    ) -> dict[str, Any]:
        task = _get_record(ctx.store, "tasks", task_id)
        return build_task_trace_flow(task, ctx.runner.get_run(task["run_id"]), page=page, page_size=page_size)

    @app.post("/runs/{run_id}/items/{item_id}/steps/{step_id}/replay")
    def replay_run_item_step(run_id: str, item_id: str, step_id: str, request: StepReplayRequest | None = None) -> dict[str, Any]:
        request = request or StepReplayRequest()
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            permission="run:create",
            action="step.replay",
            target=f"{run_id}/{item_id}/{step_id}",
            actor=request.actor,
        )
        task, run, item, step = _locate_task_run_item_step(ctx, run_id, item_id, step_id)
        resolved_input = request.override_input if request.input_mode == "override" else step.input_snapshot
        resolved_config = {**step.config_snapshot, **request.override_config}
        payload = _step_debug_payload(task, run, item, step)
        payload.update(
            {
                "mode": "replay",
                "input_mode": request.input_mode,
                "resolved_input": resolved_input,
                "resolved_config": redact_secrets(resolved_config),
                "cache": {"disabled": request.disable_cache, "original_cache_key": step.cache_key, "original_cache_hit": step.cache_hit},
                "mock_llm_calls": request.mock_llm_calls,
            }
        )
        if request.mock_llm_calls:
            payload.update(
                {
                    "status": "skipped",
                    "error_code": "MOCK_LLM_CALLS_ENABLED",
                    "message": "Replay 已解析原始输入和历史输出；mock_llm_calls=true 时不会重新执行 Skill 或调用外部模型。",
                    "raw_output": step.output_snapshot,
                    "validated_output": step.output_snapshot if step.status == "succeeded" else {},
                }
            )
            ctx.audit_service.record(actor=request.actor, role=request.role, action="step.replay.skipped", target=f"{run_id}/{item_id}/{step_id}", detail={"mock_llm_calls": True})
            return payload
        try:
            skill = ctx.registry.get(step.skill_ref)
            result, latency_ms = skill.execute(resolved_input, resolved_config)
            payload.update(
                {
                    "status": "succeeded",
                    "raw_output": result.output,
                    "validated_output": result.output,
                    "metrics": result.metrics,
                    "logs": result.logs,
                    "latency_ms": latency_ms,
                }
            )
            ctx.audit_service.record(actor=request.actor, role=request.role, action="step.replay", target=f"{run_id}/{item_id}/{step_id}", detail={"mock_llm_calls": False, "status": "succeeded"})
            return payload
        except Exception as exc:  # noqa: BLE001 - Replay 是调试接口，必须把任意运行时异常结构化返回。
            payload.update(
                {
                    "status": "failed",
                    "raw_output": {},
                    "validated_output": {},
                    "error": {"type": type(exc).__name__, "message": str(exc)},
                }
            )
            ctx.audit_service.record(actor=request.actor, role=request.role, action="step.replay.failed", target=f"{run_id}/{item_id}/{step_id}", detail={"error": str(exc)})
            return payload

    @app.post("/runs/{run_id}/items/{item_id}/steps/{step_id}/prompt-debug")
    def debug_run_item_step_prompt(run_id: str, item_id: str, step_id: str, request: StepPromptDebugRequest | None = None) -> dict[str, Any]:
        request = request or StepPromptDebugRequest()
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            permission="run:create",
            action="step.prompt_debug",
            target=f"{run_id}/{item_id}/{step_id}",
            actor=request.actor,
        )
        task, run, item, step = _locate_task_run_item_step(ctx, run_id, item_id, step_id)
        payload = _step_debug_payload(task, run, item, step)
        prompt_calls = _prompt_calls_from_step(step)
        rendered_prompt = _rendered_prompt_from_step(step, request.variables)
        payload.update(
            {
                "mode": "prompt_debug",
                "status": "skipped" if request.mock_llm_calls else "unavailable",
                "rendered_prompt": rendered_prompt,
                "prompt_calls": prompt_calls,
                "schema_validation": {"status": "skipped", "reason": "当前 Step 轨迹没有独立 Prompt output schema。"},
                "token_usage": _token_usage_from_step(step),
                "mock_llm_calls": request.mock_llm_calls,
                "raw_response": prompt_calls[0].get("raw_response") if prompt_calls else None,
                "parsed_output": prompt_calls[0].get("parsed_output") if prompt_calls else None,
                "message": "Prompt Debug 已返回历史 prompt trace；当前接口不会隐式调用外部模型。",
            }
        )
        ctx.audit_service.record(actor=request.actor, role=request.role, action="step.prompt_debug", target=f"{run_id}/{item_id}/{step_id}", detail={"prompt_call_count": len(prompt_calls)})
        return payload

    @app.get("/runs/{run_id}/items/{item_id}/steps/{step_id}/repro-bundle")
    def get_run_item_step_repro_bundle(run_id: str, item_id: str, step_id: str) -> dict[str, Any]:
        task, run, item, step = _locate_task_run_item_step(ctx, run_id, item_id, step_id)
        skill_manifest = ctx.registry.get_manifest(step.skill_ref).model_dump(mode="json")
        bundle = _step_debug_payload(task, run, item, step)
        bundle.update(
            {
                "bundle_type": "step_repro_bundle",
                "schema_version": "aegisqa.step_repro_bundle.v1",
                "workflow": run.workflow.model_dump(mode="json"),
                "skill_manifest": skill_manifest,
                "resolved_input": step.input_snapshot,
                "raw_output": step.output_snapshot,
                "validated_output": step.output_snapshot if step.status == "succeeded" else {},
                "schema_errors": [] if step.status == "succeeded" else ([step.error] if step.error else []),
                "prompt_calls": _prompt_calls_from_step(step),
                "error": step.error,
                "llm_calls": _prompt_calls_from_step(step),
                "replay_endpoint": f"/runs/{run_id}/items/{item_id}/steps/{step_id}/replay",
                "prompt_debug_endpoint": f"/runs/{run_id}/items/{item_id}/steps/{step_id}/prompt-debug",
            }
        )
        return bundle

    @app.post("/runs", response_model=RunRecord)
    def create_run(request: RunCreateRequest) -> RunRecord:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            permission="run:create",
            action="run.create",
            target=f"{request.dataset_id}:v{request.dataset_version}",
            actor=request.actor,
        )
        run = ctx.runner.create_run(
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
        ctx.audit_service.record(
            actor=request.actor,
            role=request.role,
            action="run.create",
            target=run.run_id,
            result="success",
            detail={"dataset_id": request.dataset_id, "dataset_version": request.dataset_version, "workflow_version_id": request.workflow.version_id, "role": request.role},
        )
        return run

    @app.get("/runs")
    def list_runs(
        status: str | None = Query(default=None),
        dataset_id: str | None = Query(default=None),
        workflow_version_id: str | None = Query(default=None),
        page: int | None = Query(default=None, ge=1),
        page_size: int = Query(default=20, ge=1, le=100),
    ) -> list[RunRecord] | dict[str, Any]:
        if page is None:
            # 旧接口保持完整 RunRecord[]，兼容仍依赖 item 明细的测试和外部脚本。
            return ctx.runner.list_runs()
        summaries = ctx.runner.list_run_summaries()
        if status:
            summaries = [run for run in summaries if run.get("status") == status]
        if dataset_id:
            summaries = [run for run in summaries if run.get("dataset_id") == dataset_id]
        if workflow_version_id:
            summaries = [run for run in summaries if run.get("workflow_version_id") == workflow_version_id]
        return _paginate_records(summaries, page=page, page_size=page_size)

    @app.post("/runs/{run_id}/execute", response_model=RunRecord)
    def execute_run(run_id: str, role: str = Query(default="Evaluator"), actor: str = Query(default="api")) -> RunRecord:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=role,
            permission="run:control",
            action="run.execute",
            target=run_id,
            actor=actor,
        )
        try:
            run = ctx.runner.execute_run(run_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        ctx.audit_service.record(actor=actor, role=role, action="run.execute", target=run_id, result="success", detail={"status": run.status, "role": role})
        return run

    @app.post("/runs/{run_id}/retry-failed", response_model=RunRecord)
    def retry_failed(run_id: str, role: str = Query(default="Evaluator"), actor: str = Query(default="api")) -> RunRecord:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=role,
            permission="run:control",
            action="run.retry_failed",
            target=run_id,
            actor=actor,
        )
        run = ctx.runner.retry_failed_items(run_id)
        ctx.audit_service.record(actor=actor, role=role, action="run.retry_failed", target=run_id, result="success", detail={"status": run.status, "role": role})
        return run

    @app.post("/runs/{run_id}/cancel", response_model=RunRecord)
    def cancel_run(run_id: str, role: str = Query(default="Evaluator"), actor: str = Query(default="api")) -> RunRecord:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=role,
            permission="run:control",
            action="run.cancel",
            target=run_id,
            actor=actor,
        )
        run = ctx.runner.cancel_run(run_id)
        ctx.audit_service.record(actor=actor, role=role, action="run.cancel", target=run_id, result="success", detail={"status": run.status, "role": role})
        return run

    @app.post("/runs/{run_id}/pause", response_model=RunRecord)
    def pause_run(run_id: str, role: str = Query(default="Evaluator"), actor: str = Query(default="api")) -> RunRecord:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=role,
            permission="run:control",
            action="run.pause",
            target=run_id,
            actor=actor,
        )
        run = ctx.runner.pause_run(run_id)
        ctx.audit_service.record(actor=actor, role=role, action="run.pause", target=run_id, result="success", detail={"status": run.status, "role": role})
        return run

    @app.post("/runs/{run_id}/resume", response_model=RunRecord)
    def resume_run(run_id: str, role: str = Query(default="Evaluator"), actor: str = Query(default="api")) -> RunRecord:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=role,
            permission="run:control",
            action="run.resume",
            target=run_id,
            actor=actor,
        )
        run = ctx.runner.resume_run(run_id)
        ctx.audit_service.record(actor=actor, role=role, action="run.resume", target=run_id, result="success", detail={"status": run.status, "role": role})
        return run

    @app.get("/runs/{run_id}", response_model=RunRecord)
    def get_run(run_id: str) -> RunRecord:
        return ctx.runner.get_run(run_id)


def _build_task_preflight(ctx: RouteContext, request: TaskPreflightRequest) -> dict[str, Any]:
    """生成任务创建前预检结果。

    预检只做确定性检查：数据字段、Skill 治理状态、质量门槛和预算配置。
    这样用户在真正创建 Run 之前，就能知道这批数据能否被当前 Workflow 稳定消费。
    """

    dataset = ctx.dataset_service.get_version(request.dataset_id, request.dataset_version)
    workflow = ctx.workflow_service.get(request.workflow_version_id)
    required_fields = _collect_required_row_fields(workflow)
    dataset_fields = set(dataset.field_schema)
    missing_fields = sorted(required_fields - dataset_fields)
    checks = [
        _preflight_check(
            "dataset_non_empty",
            "数据集非空",
            "passed" if dataset.row_count > 0 else "blocked",
            f"当前数据集包含 {dataset.row_count} 条样本。",
            {"row_count": dataset.row_count},
            "请上传至少一条有效样本后再创建任务。",
        ),
        _preflight_check(
            "field_mapping",
            "Workflow 字段映射",
            "blocked" if missing_fields else "passed",
            "Workflow 需要的 row 字段均存在。" if not missing_fields else f"数据集缺少字段：{', '.join(missing_fields)}。",
            {
                "required_fields": sorted(required_fields),
                "dataset_fields": sorted(dataset_fields),
                "missing_fields": missing_fields,
            },
            "请修正数据集字段，或在 Workflow 画布中调整 input_mapping。",
        ),
        _workflow_schema_mapping_check(ctx, workflow),
        _workflow_input_expression_check(ctx, workflow, dataset.preview, dataset_fields),
        _workflow_skill_config_check(ctx, workflow, request, dataset.preview),
        _golden_coverage_check(request.evaluation_goal, dataset.model_dump(mode="json")),
        _skill_approval_check(ctx, workflow),
        _quality_gate_check(request.quality_gate),
        _cost_budget_check(request.cost_budget),
    ]
    status = _preflight_status(checks)
    return {
        "status": status,
        "summary": _preflight_summary(status, checks),
        "dataset_id": dataset.dataset_id,
        "dataset_version": dataset.version,
        "workflow_version_id": workflow.version_id,
        "execution_template_id": request.execution_template_id,
        "evaluation_goal": request.evaluation_goal,
        "quality_gate": request.quality_gate,
        "sample_repeat_times": request.sample_repeat_times,
        "cost_budget": request.cost_budget,
        "skill_overrides": request.skill_overrides,
        "checks": checks,
        "created_at": _now(),
    }


def _create_report_export_request(ctx: RouteContext, task_id: str, request: ReportExportRequestCreate) -> dict[str, Any]:
    _ensure_report_export_format(request.file_format)
    task = _get_record(ctx.store, "tasks", task_id)
    now = _now()
    expires_at = _normalise_report_export_expires_at(request.expires_at)
    record = {
        "request_id": f"rex-{uuid4().hex[:12]}",
        "task_id": task_id,
        "task_name": task.get("name"),
        "run_id": task.get("run_id"),
        "file_format": request.file_format,
        "requester_role": request.requester_role,
        "requester_actor": request.actor,
        "requested_permission": "report:export",
        "reason": request.reason,
        "status": "pending",
        "expires_at": expires_at,
        "created_at": now,
        "updated_at": now,
    }
    _save_record(ctx.store, "report_export_requests", "request_id", record)
    ctx.audit_service.record(
        actor=request.actor,
        role=request.requester_role,
        action="task.report.export.request",
        target=task_id,
        detail={
            "role": request.requester_role,
            "request_id": record["request_id"],
            "file_format": request.file_format,
            "reason": request.reason,
            "expires_at": expires_at,
        },
    )
    return record


def _approve_report_export_request(ctx: RouteContext, request_id: str, request: ReportExportApprovalRequest) -> dict[str, Any]:
    if not ctx.access_control.can(request.approver_role, "report:export:approve"):
        _record_report_export_approval_forbidden(ctx, request_id, action="task.report.export.approve", role=request.approver_role, actor=request.actor)
        raise AegisQAError(
            "REPORT_EXPORT_APPROVAL_FORBIDDEN",
            "当前角色没有审批报告导出的权限。",
            status_code=403,
            details={"role": request.approver_role, "required_permission": "report:export:approve"},
        )
    record = _get_record(ctx.store, "report_export_requests", request_id)
    record = _refresh_report_export_request_status(ctx, record)
    if record.get("status") == "expired":
        raise AegisQAError(
            "REPORT_EXPORT_APPROVAL_EXPIRED",
            "报告导出审批已过期，不能继续批准。",
            status_code=409,
            details={"request_id": request_id, "expires_at": record.get("expires_at")},
        )
    if record.get("status") != "pending":
        raise AegisQAError(
            "REPORT_EXPORT_APPROVAL_INVALID",
            "只有待审批的报告导出申请可以被审批。",
            status_code=409,
            details={"request_id": request_id, "status": record.get("status")},
        )
    now = _now()
    record.update(
        {
            "status": "approved",
            "approved_by": request.approver_role,
            "approved_by_actor": request.actor,
            "approval_note": request.note,
            "approved_at": now,
            "updated_at": now,
        }
    )
    _save_record(ctx.store, "report_export_requests", "request_id", record)
    ctx.audit_service.record(
        actor=request.actor,
        role=request.approver_role,
        action="task.report.export.approve",
        target=str(record.get("task_id")),
        detail={
            "role": request.approver_role,
            "request_id": request_id,
            "file_format": record.get("file_format"),
            "requester_role": record.get("requester_role"),
            "requester_actor": record.get("requester_actor"),
            "expires_at": record.get("expires_at"),
        },
    )
    return record


def _reject_report_export_request(ctx: RouteContext, request_id: str, request: ReportExportApprovalRequest) -> dict[str, Any]:
    if not ctx.access_control.can(request.approver_role, "report:export:approve"):
        _record_report_export_approval_forbidden(ctx, request_id, action="task.report.export.reject", role=request.approver_role, actor=request.actor)
        raise AegisQAError(
            "REPORT_EXPORT_APPROVAL_FORBIDDEN",
            "当前角色没有审批报告导出的权限。",
            status_code=403,
            details={"role": request.approver_role, "required_permission": "report:export:approve"},
        )
    record = _refresh_report_export_request_status(ctx, _get_record(ctx.store, "report_export_requests", request_id))
    if record.get("status") == "expired":
        raise AegisQAError(
            "REPORT_EXPORT_APPROVAL_EXPIRED",
            "报告导出审批已过期，不能继续拒绝。",
            status_code=409,
            details={"request_id": request_id, "expires_at": record.get("expires_at")},
        )
    if record.get("status") != "pending":
        raise AegisQAError(
            "REPORT_EXPORT_APPROVAL_INVALID",
            "只有待审批的报告导出申请可以被拒绝。",
            status_code=409,
            details={"request_id": request_id, "status": record.get("status")},
        )
    now = _now()
    record.update(
        {
            "status": "rejected",
            "rejected_by": request.approver_role,
            "rejected_by_actor": request.actor,
            "rejection_note": request.note,
            "rejected_at": now,
            "updated_at": now,
        }
    )
    _save_record(ctx.store, "report_export_requests", "request_id", record)
    ctx.audit_service.record(
        actor=request.actor,
        role=request.approver_role,
        action="task.report.export.reject",
        target=str(record.get("task_id")),
        detail={
            "role": request.approver_role,
            "request_id": request_id,
            "file_format": record.get("file_format"),
            "requester_role": record.get("requester_role"),
            "requester_actor": record.get("requester_actor"),
            "note": request.note,
        },
    )
    return record


def _revoke_report_export_request(ctx: RouteContext, request_id: str, request: ReportExportRevokeRequest) -> dict[str, Any]:
    record = _refresh_report_export_request_status(ctx, _get_record(ctx.store, "report_export_requests", request_id))
    if record.get("requester_role") != request.requester_role:
        raise AegisQAError(
            "REPORT_EXPORT_REVOKE_FORBIDDEN",
            "只有原申请角色可以撤销报告导出申请。",
            status_code=403,
            details={"request_id": request_id, "requester_role": request.requester_role},
        )
    if record.get("status") not in {"pending", "approved"}:
        raise AegisQAError(
            "REPORT_EXPORT_APPROVAL_INVALID",
            "只有待审批或已批准的报告导出申请可以撤销。",
            status_code=409,
            details={"request_id": request_id, "status": record.get("status")},
        )
    now = _now()
    record.update(
        {
            "status": "revoked",
            "revoked_by": request.requester_role,
            "revoked_by_actor": request.actor,
            "revoke_reason": request.reason,
            "revoked_at": now,
            "updated_at": now,
        }
    )
    _save_record(ctx.store, "report_export_requests", "request_id", record)
    ctx.audit_service.record(
        actor=request.actor,
        role=request.requester_role,
        action="task.report.export.revoke",
        target=str(record.get("task_id")),
        detail={"role": request.requester_role, "request_id": request_id, "file_format": record.get("file_format"), "reason": request.reason},
    )
    return record


def _ensure_report_export_approval(
    ctx: RouteContext,
    task_id: str,
    file_format: str,
    role: str,
    approval_request_id: str | None,
    actor: str = "api",
) -> dict[str, Any]:
    if not approval_request_id:
        _record_report_export_denied(ctx, task_id, file_format, role, approval_request_id, actor=actor)
        raise HTTPException(
            status_code=403,
            detail={
                "code": "REPORT_EXPORT_FORBIDDEN",
                "message": "当前角色没有导出报告权限",
                "details": {"role": role, "required_permission": "report:export"},
            },
        )
    try:
        record = _get_record(ctx.store, "report_export_requests", approval_request_id)
    except KeyError as exc:
        _record_report_export_denied(ctx, task_id, file_format, role, approval_request_id, actor=actor)
        raise AegisQAError(
            "REPORT_EXPORT_APPROVAL_INVALID",
            "报告导出审批不存在或无法用于本次导出。",
            status_code=403,
            details={"approval_request_id": approval_request_id},
        ) from exc
    record = _refresh_report_export_request_status(ctx, record)
    if record.get("status") == "expired":
        _record_report_export_denied(ctx, task_id, file_format, role, approval_request_id, actor=actor)
        raise AegisQAError(
            "REPORT_EXPORT_APPROVAL_EXPIRED",
            "报告导出审批已过期，不能继续用于导出。",
            status_code=403,
            details={"approval_request_id": approval_request_id, "expires_at": record.get("expires_at")},
        )
    mismatch = {
        "task_id": record.get("task_id") != task_id,
        "file_format": record.get("file_format") != file_format,
        "requester_role": record.get("requester_role") != role,
        "status": record.get("status") != "approved",
    }
    failed_fields = [field for field, failed in mismatch.items() if failed]
    if failed_fields:
        _record_report_export_denied(ctx, task_id, file_format, role, approval_request_id, actor=actor)
        raise AegisQAError(
            "REPORT_EXPORT_APPROVAL_INVALID",
            "报告导出审批与当前导出请求不匹配，或尚未审批通过。",
            status_code=403,
            details={"approval_request_id": approval_request_id, "failed_fields": failed_fields},
        )
    return record


def _normalise_report_export_expires_at(expires_at: str | None) -> str:
    if not expires_at:
        return (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
    parsed = _parse_report_export_datetime(expires_at)
    if parsed is None:
        raise AegisQAError(
            "REPORT_EXPORT_EXPIRY_INVALID",
            "expires_at 必须是合法 ISO 时间。",
            details={"expires_at": expires_at},
        )
    return parsed.isoformat()


def _refresh_report_export_request_status(ctx: RouteContext, record: dict[str, Any]) -> dict[str, Any]:
    if record.get("status") not in {"pending", "approved"}:
        return record
    expires_at = _parse_report_export_datetime(record.get("expires_at"))
    if expires_at is None or expires_at > datetime.now(timezone.utc):
        return record
    # 过期状态在读取、审批或导出时即时刷新，避免长期待处理申请被误用。
    record.update({"status": "expired", "expired_at": _now(), "updated_at": _now()})
    _save_record(ctx.store, "report_export_requests", "request_id", record)
    ctx.audit_service.record(
        actor="system",
        action="task.report.export.expire",
        target=str(record.get("task_id")),
        detail={"request_id": record.get("request_id"), "file_format": record.get("file_format"), "expires_at": record.get("expires_at")},
    )
    return record


def _parse_report_export_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _record_report_export_denied(ctx: RouteContext, task_id: str, file_format: str, role: str, approval_request_id: str | None, *, actor: str = "api") -> None:
    ctx.audit_service.record(
        actor=actor,
        role=role,
        action="task.report.export.denied",
        target=task_id,
        detail={
            "role": role,
            "file_format": file_format,
            "required_permission": "report:export",
            "approval_request_id": approval_request_id,
        },
    )


def _record_report_export_approval_forbidden(ctx: RouteContext, request_id: str, *, action: str, role: str, actor: str) -> None:
    trace_id = f"trace_{uuid4().hex[:12]}"
    ctx.audit_service.record(
        actor=actor,
        role=role,
        action=action,
        target=request_id,
        result="forbidden",
        trace_id=trace_id,
        detail={"role": role, "required_permission": "report:export:approve", "request_id": request_id, "trace_id": trace_id},
    )


def _ensure_report_export_format(file_format: str) -> None:
    if file_format not in REPORT_EXPORT_FORMATS:
        raise AegisQAError(
            "REPORT_EXPORT_FORMAT_UNSUPPORTED",
            "file_format 仅支持 json/csv/html。",
            details={"file_format": file_format, "supported": sorted(REPORT_EXPORT_FORMATS)},
        )


def _build_task_report_payload(
    ctx: RouteContext,
    task_id: str,
    *,
    badcase_page: int = 1,
    badcase_page_size: int = 20,
    step_page: int = 1,
    step_page_size: int = 20,
    step_query: str | None = None,
    segment_page: int = 1,
    segment_page_size: int = 20,
    segment_query: str | None = None,
    root_cause_page: int = 1,
    root_cause_page_size: int = 20,
    root_cause_query: str | None = None,
    diagnostic_step_page: int = 1,
    diagnostic_step_page_size: int = 20,
    include_all_badcases: bool = False,
) -> dict[str, Any]:
    task = _get_record(ctx.store, "tasks", task_id)
    run = ctx.runner.get_run(task["run_id"])
    report = aggregate_run_report(run)
    segments = build_report_segments(run)
    parameter_governance = _build_parameter_governance(task, run)
    diagnostics = build_task_diagnostics(task, run, report, segments, parameter_governance)
    include_all_details = include_all_badcases
    all_badcases = [badcase.model_dump(mode="json") for badcase in report.badcases]
    page_badcases, badcase_pagination = _paginate_badcases(
        all_badcases,
        page=badcase_page,
        page_size=badcase_page_size,
        include_all=include_all_badcases,
    )
    step_distribution = _filter_report_detail_rows(_build_step_distribution(run), step_query)
    page_step_distribution, step_distribution_pagination = _paginate_report_detail_rows(
        step_distribution,
        page=step_page,
        page_size=step_page_size,
        include_all=include_all_details,
    )
    segment_rows = _filter_report_detail_rows([segment.model_dump(mode="json") for segment in segments], segment_query)
    page_segments, segments_pagination = _paginate_report_detail_rows(
        segment_rows,
        page=segment_page,
        page_size=segment_page_size,
        include_all=include_all_details,
    )
    diagnostics_payload = deepcopy(diagnostics)
    root_causes = _filter_report_detail_rows(list(diagnostics_payload.get("root_causes") or []), root_cause_query)
    page_root_causes, root_causes_pagination = _paginate_report_detail_rows(
        root_causes,
        page=root_cause_page,
        page_size=root_cause_page_size,
        include_all=include_all_details,
    )
    step_health = _filter_report_detail_rows(list(diagnostics_payload.get("step_health") or []), step_query)
    page_step_health, step_health_pagination = _paginate_report_detail_rows(
        step_health,
        page=diagnostic_step_page,
        page_size=diagnostic_step_page_size,
        include_all=include_all_details,
    )
    weak_segments = _filter_report_detail_rows(list(diagnostics_payload.get("weak_segments") or []), segment_query)
    page_weak_segments, weak_segments_pagination = _paginate_report_detail_rows(
        weak_segments,
        page=segment_page,
        page_size=segment_page_size,
        include_all=include_all_details,
    )
    diagnostics_payload["root_causes"] = page_root_causes
    diagnostics_payload["step_health"] = page_step_health
    diagnostics_payload["weak_segments"] = page_weak_segments
    report_payload = report.model_dump(mode="json")
    # 页面报告只需要当前页坏例明细；聚合指标仍来自完整 RunReport。
    # 导出报告会显式 include_all_badcases=True，确保离线报告不被分页截断。
    report_payload["badcases"] = page_badcases
    quality_decision = _build_quality_decision(task, run, report, segments)
    budget_status = _build_budget_status(task, report)
    report_experience = build_report_experience(task, report, diagnostics_payload, quality_decision, budget_status)
    return {
        "task": task,
        "task_summary": _build_task_report_summary(task, run),
        "version_snapshot": _build_task_report_version_snapshot(task, run),
        "preflight_evidence": task.get("preflight_result"),
        "step_distribution": page_step_distribution,
        "step_distribution_pagination": step_distribution_pagination,
        "judge_score_distribution": _build_judge_score_distribution(run),
        "segments": page_segments,
        "segments_pagination": segments_pagination,
        "recommendations": [recommendation.model_dump(mode="json") for recommendation in build_report_recommendations(segments)],
        "quality_decision": quality_decision,
        "parameter_governance": parameter_governance,
        "budget_status": budget_status,
        "release_context": _build_task_release_context(ctx, task),
        "diagnostics": diagnostics_payload,
        "diagnostics_pagination": {
            "root_causes": root_causes_pagination,
            "step_health": step_health_pagination,
            "weak_segments": weak_segments_pagination,
        },
        "report": report_payload,
        "badcases": page_badcases,
        "badcase_pagination": badcase_pagination,
        "export_links": {
            "json": f"/tasks/{task['task_id']}/report/export?file_format=json",
            "csv": f"/tasks/{task['task_id']}/report/export?file_format=csv",
            "html": f"/tasks/{task['task_id']}/report/export?file_format=html",
            "offline_package": f"/tasks/{task['task_id']}/report/offline-package",
        },
        **report_experience,
    }


def _build_task_release_context(ctx: RouteContext, task: dict[str, Any]) -> dict[str, Any]:
    baselines = [
        baseline
        for baseline in _list_records(ctx.store, "experiment_baselines")
        if _baseline_matches_task(baseline, task)
    ]
    release_records = [
        record
        for record in _list_records(ctx.store, "workflow_release_records")
        if _release_record_matches_task(record, task)
    ]
    return {
        "baselines": sorted(baselines, key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""), reverse=True)[:5],
        "release_records": sorted(release_records, key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""), reverse=True)[:5],
    }


def _baseline_matches_task(baseline: dict[str, Any], task: dict[str, Any]) -> bool:
    scope = baseline.get("scope") if isinstance(baseline.get("scope"), dict) else {}
    if scope.get("dataset_id") != task.get("dataset_id"):
        return False
    workflow_id = scope.get("workflow_id")
    if not workflow_id:
        return True
    return _task_workflow_matches_scope(task, str(workflow_id))


def _release_record_matches_task(record: dict[str, Any], task: dict[str, Any]) -> bool:
    task_id = str(task.get("task_id"))
    if record.get("source_task_id") == task_id or record.get("retest_task_id") == task_id:
        return True
    workflow_version_id = str(record.get("workflow_version_id") or "")
    return bool(workflow_version_id and workflow_version_id == str(task.get("workflow_version_id") or ""))


def _task_workflow_matches_scope(task: dict[str, Any], workflow_scope: str) -> bool:
    workflow_version_id = str(task.get("workflow_version_id") or "")
    return task.get("workflow_id") == workflow_scope or workflow_version_id == workflow_scope or workflow_version_id.startswith(f"{workflow_scope}:")


def _paginate_badcases(
    badcases: list[dict[str, Any]],
    *,
    page: int,
    page_size: int,
    include_all: bool,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    total_items = len(badcases)
    if include_all:
        return badcases, {
            "page": 1,
            "page_size": total_items,
            "total_items": total_items,
            "total_pages": 1 if total_items else 0,
        }
    safe_page = max(page, 1)
    safe_page_size = min(max(page_size, 1), 100)
    start = (safe_page - 1) * safe_page_size
    return badcases[start : start + safe_page_size], {
        "page": safe_page,
        "page_size": safe_page_size,
        "total_items": total_items,
        "total_pages": ceil(total_items / safe_page_size) if total_items else 0,
    }


def _paginate_report_detail_rows(
    rows: list[dict[str, Any]],
    *,
    page: int,
    page_size: int,
    include_all: bool,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    total_items = len(rows)
    if include_all:
        return rows, {
            "page": 1,
            "page_size": total_items,
            "total_items": total_items,
            "total_pages": 1 if total_items else 0,
        }
    safe_page = max(page, 1)
    safe_page_size = min(max(page_size, 1), 100)
    start = (safe_page - 1) * safe_page_size
    return rows[start : start + safe_page_size], {
        "page": safe_page,
        "page_size": safe_page_size,
        "total_items": total_items,
        "total_pages": ceil(total_items / safe_page_size) if total_items else 0,
    }


def _filter_report_detail_rows(rows: list[dict[str, Any]], query: str | None) -> list[dict[str, Any]]:
    keyword = str(query or "").strip().lower()
    if not keyword:
        return rows
    return [row for row in rows if _report_detail_row_matches(row, keyword)]


def _report_detail_row_matches(value: Any, keyword: str) -> bool:
    if value is None:
        return False
    if isinstance(value, dict):
        return any(_report_detail_row_matches(item, keyword) for item in value.values())
    if isinstance(value, list):
        return any(_report_detail_row_matches(item, keyword) for item in value)
    return keyword in str(value).lower()


def _paginate_records(records: list[dict[str, Any]], *, page: int, page_size: int) -> dict[str, Any]:
    total_items = len(records)
    safe_page = max(page, 1)
    safe_page_size = min(max(page_size, 1), 100)
    start = (safe_page - 1) * safe_page_size
    return {
        "items": records[start : start + safe_page_size],
        "pagination": {
            "page": safe_page,
            "page_size": safe_page_size,
            "total_items": total_items,
            "total_pages": ceil(total_items / safe_page_size) if total_items else 0,
        },
    }


def _ensure_task_result_export_format(file_format: str) -> None:
    if file_format not in TASK_RESULT_EXPORT_FORMATS:
        raise HTTPException(status_code=400, detail={"message": "file_format 仅支持 json/jsonl/csv"})


def _build_task_result_export_rows(run: RunRecord, *, include_steps: bool) -> list[dict[str, Any]]:
    return list(_iter_task_result_export_rows(run, include_steps=include_steps))


def _iter_task_result_export_rows(run: RunRecord, *, include_steps: bool) -> Iterator[dict[str, Any]]:
    for item in run.items:
        context_snapshot = item.context_snapshot or {}
        row: dict[str, Any] = {
            "run_id": run.run_id,
            "item_id": item.item_id,
            "row_id": item.row_id,
            "row_index": item.row_index,
            "repeat_index": item.repeat_index,
            "status": item.status,
            "retry_count": item.retry_count,
            "started_at": item.started_at or "",
            "finished_at": item.finished_at or "",
        }
        _flatten_value("row", context_snapshot.get("row", {}), row)
        _flatten_value("context", context_snapshot.get("context", {}), row)
        _flatten_value("metrics", item.metrics or context_snapshot.get("metrics", {}), row)
        _flatten_value("error", item.error or {}, row)
        for step in item.steps:
            # `node.<step_id>.*` 是给业务用户看的标准节点输出命名空间；
            # `step.<step_id>.*` 是排查执行细节时才展开的 Trace 级信息。
            _flatten_value(f"node.{step.step_id}", step.output_snapshot, row)
            if include_steps:
                row[f"step.{step.step_id}.status"] = step.status
                row[f"step.{step.step_id}.skill_ref"] = step.skill_ref
                row[f"step.{step.step_id}.latency_ms"] = step.latency_ms
                row[f"step.{step.step_id}.cache_hit"] = step.cache_hit
                _flatten_value(f"step.{step.step_id}.input", step.input_snapshot, row)
                _flatten_value(f"step.{step.step_id}.output", step.output_snapshot, row)
                _flatten_value(f"step.{step.step_id}.metrics", step.metrics, row)
                _flatten_value(f"step.{step.step_id}.error", step.error or {}, row)
        yield row


def _task_result_export_shape(run: RunRecord, *, include_steps: bool) -> tuple[int, list[str]]:
    base_columns = _task_result_export_base_columns()
    seen = set(base_columns)
    dynamic_columns: set[str] = set()
    row_count = 0
    for row in _iter_task_result_export_rows(run, include_steps=include_steps):
        row_count += 1
        dynamic_columns.update(key for key in row if key not in seen)
    return row_count, base_columns + sorted(dynamic_columns)


def _iter_task_result_export_content(
    run: RunRecord,
    *,
    file_format: str,
    include_steps: bool,
    columns: list[str],
) -> Iterable[str]:
    if file_format == "csv":
        yield _task_result_export_csv_line(columns)
        for row in _iter_task_result_export_rows(run, include_steps=include_steps):
            yield _task_result_export_csv_line(columns, row)
        return
    if file_format == "jsonl":
        for row in _iter_task_result_export_rows(run, include_steps=include_steps):
            yield json_dumps(row) + "\n"
        return
    yield "["
    first = True
    for row in _iter_task_result_export_rows(run, include_steps=include_steps):
        if not first:
            yield ","
        yield json_dumps(row)
        first = False
    yield "]"


def _task_result_export_csv_line(columns: list[str], row: dict[str, Any] | None = None) -> str:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns, lineterminator="\n")
    if row is None:
        writer.writeheader()
    else:
        writer.writerow({column: _csv_scalar(row.get(column)) for column in columns})
    return output.getvalue()


def _build_task_result_export_csv(rows: list[dict[str, Any]]) -> str:
    columns = _task_result_export_columns(rows)
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({column: _csv_scalar(row.get(column)) for column in columns})
    return output.getvalue().strip()


def _task_result_export_columns(rows: list[dict[str, Any]]) -> list[str]:
    base_columns = _task_result_export_base_columns()
    seen = set(base_columns)
    dynamic_columns = sorted({key for row in rows for key in row if key not in seen})
    return base_columns + dynamic_columns


def _task_result_export_base_columns() -> list[str]:
    return [
        "run_id",
        "item_id",
        "row_id",
        "row_index",
        "repeat_index",
        "status",
        "retry_count",
        "started_at",
        "finished_at",
    ]


def _flatten_value(prefix: str, value: Any, target: dict[str, Any]) -> None:
    if value in (None, ""):
        return
    if isinstance(value, dict):
        for key in sorted(value):
            child_prefix = f"{prefix}.{key}" if prefix else str(key)
            _flatten_value(child_prefix, value[key], target)
        return
    target[prefix] = value


def _csv_scalar(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return _csv_formula_safe_text(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return _csv_formula_safe_text(json_dumps(value))


def _csv_formula_safe_text(value: str) -> str:
    """阻止 CSV 被 Excel/WPS 打开时把用户文本当公式执行。

    csv.writer 只会处理逗号、引号和换行，不会阻止 `=HYPERLINK(...)`、
    `+SUM(...)` 这类内容被表格软件解释。这里保留原始文本，只在危险前缀前
    增加单引号；同时检查左侧空白后的首字符，覆盖 ` \t@cmd` 这类绕过。
    """

    stripped = value.lstrip()
    if stripped[:1] in {"=", "+", "-", "@"}:
        return f"'{value}"
    return value


def _build_task_report_export_csv(payload: dict[str, Any]) -> str:
    task = payload["task"]
    report = payload.get("report") or {}
    preflight = payload.get("preflight_evidence") or {}
    quality_decision = payload.get("quality_decision") or {}
    output = io.StringIO(newline="")
    writer = csv.writer(output)

    def write_row(values: list[Any]) -> None:
        writer.writerow([_csv_scalar(value) for value in values])

    write_row(["section", "field", "value", "details"])
    write_row(["metric", "task_id", task.get("task_id"), ""])
    write_row(["metric", "run_id", task.get("run_id"), ""])
    write_row(["metric", "pass_rate", report.get("pass_rate"), ""])
    write_row(["metric", "badcase_count", len(payload.get("badcases") or []), ""])
    write_row(["preflight", "preflight_id", preflight.get("preflight_id") or "", preflight.get("summary") or ""])
    write_row(["preflight", "preflight_status", preflight.get("status") or "", ""])
    for check in preflight.get("checks") or []:
        write_row(["preflight_check", check.get("check_id"), check.get("status"), check.get("message")])
    write_row([
        "quality_decision",
        "status",
        quality_decision.get("status") or quality_decision.get("decision") or "",
        quality_decision.get("summary") or quality_decision.get("reason") or "",
    ])
    segments = payload.get("segments") or []
    if segments:
        for segment in segments:
            segment_name = f"{segment.get('segment_key', 'segment')}={segment.get('segment_value', '')}"
            details = f"sample_count={segment.get('sample_count', 0)};badcase_count={segment.get('badcase_count', 0)}"
            write_row(["segment", segment_name, segment.get("pass_rate"), details])
    else:
        write_row(["segment", "all", report.get("pass_rate"), "sample_count=all"])
    for badcase in payload.get("badcases") or []:
        write_row(["badcase", badcase.get("item_id") or badcase.get("badcase_id"), badcase.get("status"), badcase.get("reason")])
    return output.getvalue().strip()


def _build_task_report_export_html(payload: dict[str, Any]) -> str:
    task = payload["task"]
    # HTML 导出可能被浏览器直接打开，所有动态内容都必须转义，避免报告名称或 JSON 内容注入脚本。
    task_name = escape(str(task.get("name") or task.get("task_id") or "任务报告"))
    sections = [
        f"<h1>{task_name}</h1>",
        _html_json_section("任务摘要", payload.get("task_summary") or {}),
        _html_json_section("质量决策", payload.get("quality_decision") or {}),
        _html_json_section("Preflight 检查", payload.get("preflight_evidence") or {}),
        _html_json_section("分层分析", payload.get("segments") or []),
        _html_json_section("Badcase 明细", payload.get("badcases") or []),
        _html_json_section("Report", payload.get("report") or {}),
    ]
    return "<html><body>" + "".join(sections) + "</body></html>"


def _html_json_section(title: str, content: Any) -> str:
    return f"<h2>{escape(title)}</h2><pre>{escape(json_dumps(content))}</pre>"


def _save_task_preflight(ctx: RouteContext, preflight: dict[str, Any], *, actor: str = "api", role: str = "Evaluator") -> dict[str, Any]:
    record = {
        **deepcopy(preflight),
        "preflight_id": f"preflight-{uuid4().hex[:12]}",
        "created_at": preflight.get("created_at") or _now(),
    }
    _save_record(ctx.store, "task_preflights", "preflight_id", record)
    ctx.audit_service.record(
        actor=actor,
        role=role,
        action="task.preflight",
        target=record["preflight_id"],
        detail={"status": record.get("status"), "workflow_version_id": record.get("workflow_version_id"), "role": role},
    )
    return record


def _ensure_preflight_matches_task_request(preflight_result: dict[str, Any], request: TaskCreateRequest) -> None:
    """阻止 API 调用者复用旧 Preflight 创建新参数任务。"""

    quality_gate = preflight_result.get("quality_gate") if isinstance(preflight_result.get("quality_gate"), dict) else {}
    request_quality_gate = request.quality_gate or {}
    mismatches: list[dict[str, Any]] = []

    def add_mismatch(field: str, expected: Any, actual: Any, *, numeric: bool = False) -> None:
        expected_signature = _number_signature(expected) if numeric else _text_signature(expected)
        actual_signature = _number_signature(actual) if numeric else _text_signature(actual)
        if expected_signature != actual_signature:
            mismatches.append({"field": field, "expected": expected, "actual": actual})

    add_mismatch("dataset_id", request.dataset_id, preflight_result.get("dataset_id"))
    add_mismatch("dataset_version", request.dataset_version, preflight_result.get("dataset_version"), numeric=True)
    add_mismatch("workflow_version_id", request.workflow_version_id, preflight_result.get("workflow_version_id"))
    add_mismatch("execution_template_id", request.execution_template_id, preflight_result.get("execution_template_id"))
    add_mismatch("evaluation_goal", request.evaluation_goal, preflight_result.get("evaluation_goal"))
    add_mismatch("quality_gate.pass_rate", request_quality_gate.get("pass_rate"), quality_gate.get("pass_rate"), numeric=True)
    add_mismatch("quality_gate.max_badcase_count", request_quality_gate.get("max_badcase_count"), quality_gate.get("max_badcase_count"), numeric=True)
    add_mismatch("sample_repeat_times", request.sample_repeat_times, preflight_result.get("sample_repeat_times"), numeric=True)
    add_mismatch("cost_budget", request.cost_budget, preflight_result.get("cost_budget"), numeric=True)
    if (request.skill_overrides or {}) != (preflight_result.get("skill_overrides") or {}):
        mismatches.append({"field": "skill_overrides", "expected": request.skill_overrides or {}, "actual": preflight_result.get("skill_overrides") or {}})

    if mismatches:
        raise AegisQAError(
            "TASK_PREFLIGHT_STALE",
            "Preflight 结果已过期，请基于当前 Dataset、Workflow 和执行参数重新运行预检。",
            status_code=409,
            details={"mismatches": mismatches, "preflight_result": preflight_result},
        )


def _text_signature(value: Any) -> str:
    return "" if value is None or value == "" else str(value)


def _number_signature(value: Any) -> str:
    if value is None or value == "":
        return ""
    try:
        number_value = float(value)
    except (TypeError, ValueError):
        return str(value)
    return str(number_value)


def _list_task_execution_templates(ctx: RouteContext) -> list[dict[str, Any]]:
    templates = {template["template_id"]: template for template in _default_task_execution_templates()}
    for template in _list_records(ctx.store, "task_execution_templates"):
        templates[str(template["template_id"])] = template
    return sorted(templates.values(), key=lambda item: (str(item.get("source") or "custom"), str(item.get("name") or "")))


def _build_task_execution_template(request: TaskExecutionTemplateCreateRequest) -> dict[str, Any]:
    now = _now()
    return {
        "template_id": f"tasktpl-{uuid4().hex[:12]}",
        "name": request.name,
        "description": request.description,
        "evaluation_goal": request.evaluation_goal,
        "quality_gate": deepcopy(request.quality_gate),
        "execution_config": _normalize_execution_template_config(request.execution_config),
        "tags": list(request.tags),
        "source": "custom",
        "created_at": now,
        "updated_at": now,
    }


def _default_task_execution_templates() -> list[dict[str, Any]]:
    """内置模板提供可解释的起步策略；用户自定义模板单独落库并覆盖同名 ID。"""

    return [
        {
            "template_id": "release_gate_safe",
            "name": "上线门禁稳健模板",
            "description": "适合正式发布前评测：低并发、明确通过率和 Badcase 门槛。",
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
            "execution_config": _normalize_execution_template_config(
                {"chunk_size": 100, "concurrency": 1, "sample_repeat_times": 1, "retry": {"max_retries": 1, "backoff_seconds": 0}, "cost_budget": 20}
            ),
            "tags": ["release", "safe"],
            "source": "builtin",
            "created_at": "builtin",
            "updated_at": "builtin",
        },
        {
            "template_id": "prompt_experiment_fast",
            "name": "Prompt 实验快速模板",
            "description": "适合早期 Prompt 对比：允许少量 Badcase，成本预算更保守。",
            "evaluation_goal": "prompt_experiment",
            "quality_gate": {"pass_rate": 0.8, "max_badcase_count": 20},
            "execution_config": _normalize_execution_template_config(
                {"chunk_size": 50, "concurrency": 2, "sample_repeat_times": 1, "retry": {"max_retries": 0, "backoff_seconds": 0}, "cost_budget": 10}
            ),
            "tags": ["prompt", "fast"],
            "source": "builtin",
            "created_at": "builtin",
            "updated_at": "builtin",
        },
        {
            "template_id": "stability_repeat",
            "name": "稳定性重复采样模板",
            "description": "适合检测非确定性输出：重复采样 3 次并保留重试。",
            "evaluation_goal": "regression",
            "quality_gate": {"pass_rate": 0.85, "max_badcase_count": 5},
            "execution_config": _normalize_execution_template_config(
                {"chunk_size": 50, "concurrency": 1, "sample_repeat_times": 3, "retry": {"max_retries": 2, "backoff_seconds": 3}, "cost_budget": 30}
            ),
            "tags": ["stability", "repeat"],
            "source": "builtin",
            "created_at": "builtin",
            "updated_at": "builtin",
        },
    ]


def _normalize_execution_template_config(config: dict[str, Any]) -> dict[str, Any]:
    retry = config.get("retry") if isinstance(config.get("retry"), dict) else {}
    return {
        "chunk_size": config.get("chunk_size", 100),
        "concurrency": config.get("concurrency", 1),
        "sample_repeat_times": config.get("sample_repeat_times", 1),
        "retry": {
            "max_retries": retry.get("max_retries", config.get("max_retries", 1)),
            "backoff_seconds": retry.get("backoff_seconds", config.get("retry_backoff_seconds", 0)),
        },
        "cost_budget": config.get("cost_budget"),
        "skill_overrides": deepcopy(config.get("skill_overrides") or {}),
    }


def _preflight_check(
    check_id: str,
    title: str,
    status: str,
    message: str,
    details: dict[str, Any] | None = None,
    recommendation: str = "",
) -> dict[str, Any]:
    return {
        "check_id": check_id,
        "title": title,
        "status": status,
        "message": message,
        "details": details or {},
        "recommendation": recommendation,
    }


def _collect_required_row_fields(workflow: Any) -> set[str]:
    fields: set[str] = set()
    for step in workflow.steps:
        for source in step.input_mapping.values():
            fields.update(collect_mapping_row_fields(source))
    return fields


def _workflow_schema_mapping_check(ctx: RouteContext, workflow: Any) -> dict[str, Any]:
    issues = validate_workflow_step_contracts(ctx.registry, list(workflow.steps), include_skill_availability=False)
    mapping_issues = [
        issue
        for issue in issues
        if issue.get("code") in {"REQUIRED_INPUT_MAPPING_MISSING", "INPUT_MAPPING_PATH_EMPTY", "OUTPUT_MAPPING_PATH_EMPTY", "INPUT_MAPPING_EXPRESSION_INVALID"}
    ]
    return _preflight_check(
        "workflow_schema_mapping",
        "Skill 入参映射",
        "blocked" if mapping_issues else "passed",
        "Workflow 的 Skill 必填入参和输出写入路径均完整。" if not mapping_issues else "Workflow 存在未配置、为空或语法不安全的 Skill 字段映射。",
        {"issues": mapping_issues},
        "请在 Workflow 画布中选中对应节点，补齐字段映射或输出写入路径后重新发布。",
    )


def _workflow_input_expression_check(
    ctx: RouteContext,
    workflow: Any,
    preview_rows: list[dict[str, Any]],
    dataset_fields: set[str],
) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    seen_issue_keys: set[tuple[str, str, str, str]] = set()
    has_blocking_issue = False
    rows_to_check = preview_rows or [{}]
    for row_index, sample_row in enumerate(rows_to_check):
        runtime_context: dict[str, Any] = {"row": sample_row, "context": {}, "metrics": {}, "artifacts": {}, "errors": [], "steps": {}}
        for step in workflow.steps:
            try:
                skill = ctx.registry.get(step.skill_ref)
            except KeyError:
                continue
            for field, expression in (step.input_mapping or {}).items():
                if not isinstance(expression, str) or not expression.strip():
                    continue
                try:
                    resolve_input_mapping({str(field): expression}, runtime_context, _single_input_schema(skill.manifest.input_schema, str(field)))
                except MappingPathError as exc:
                    missing_path = _missing_path_from_error(str(exc))
                    severity = _input_expression_issue_severity(missing_path, dataset_fields)
                    has_blocking_issue = has_blocking_issue or severity == "blocked"
                    _append_unique_input_expression_issue(
                        issues,
                        seen_issue_keys,
                        {
                            "code": "INPUT_MAPPING_EXPRESSION_PATH_MISSING" if _missing_path_from_error(str(exc)) else "INPUT_MAPPING_EXPRESSION_INVALID",
                            "step_id": step.step_id,
                            "skill_ref": step.skill_ref,
                            "field_path": str(field),
                            "expression": expression,
                            "message": str(exc),
                            "missing_path": missing_path,
                            "severity": severity,
                        },
                        row_index,
                    )
                except TypeMismatchError as exc:
                    has_blocking_issue = True
                    _append_unique_input_expression_issue(
                        issues,
                        seen_issue_keys,
                        {
                            "code": "INPUT_MAPPING_EXPRESSION_TYPE_MISMATCH",
                            "step_id": step.step_id,
                            "skill_ref": step.skill_ref,
                            "field_path": str(field),
                            "expression": expression,
                            "message": str(exc),
                            "expected_type": exc.expected_type,
                            "actual_type": exc.actual_type,
                        },
                        row_index,
                    )
            output = {field: _placeholder_for_schema(schema) for field, schema in _schema_properties(skill.manifest.output_schema).items()}
            runtime_context[step.step_id] = deepcopy(output)
            runtime_context["steps"][step.step_id] = {"input": {}, "output": output}
            for output_field, target_path in (step.output_mapping or {}).items():
                if output_field in output and isinstance(target_path, str) and target_path.strip():
                    try:
                        set_by_path(runtime_context, target_path, output[output_field])
                    except MappingPathError:
                        # 输出路径结构问题由 schema mapping check 报告；这里专注 input 表达式。
                        continue
    return _preflight_check(
        "workflow_input_expressions",
        "输入表达式",
        "blocked" if has_blocking_issue else "warning" if issues else "passed",
        "Workflow 输入表达式可被当前数据样本解析。" if not issues else "Workflow 输入表达式在当前数据样本上存在缺失路径或类型问题。",
        {"issues": issues},
        "请在 Workflow 画布中修正对应节点 input_mapping，或使用 `??` 为可缺失字段设置默认值。",
    )


def _single_input_schema(input_schema: dict[str, Any], field: str) -> dict[str, Any]:
    properties = _schema_properties(input_schema)
    required = input_schema.get("required", [])
    field_schema = properties.get(field, {})
    return {
        "type": "object",
        "properties": {field: field_schema if isinstance(field_schema, dict) else {}},
        "required": [field] if isinstance(required, list) and field in required else [],
    }


def _schema_properties(schema: dict[str, Any]) -> dict[str, Any]:
    properties = schema.get("properties", {})
    return properties if isinstance(properties, dict) else {}


def _missing_path_from_error(message: str) -> str | None:
    prefix = "路径不存在："
    if prefix not in message:
        return None
    return message.split(prefix, 1)[1].strip() or None


def _input_expression_issue_severity(missing_path: str | None, dataset_fields: set[str]) -> str:
    """区分字段整体缺失和行级缺值。

    字段整体不存在已经会被 `field_mapping` 阻断；字段存在但某些样本缺值时，
    任务仍应允许执行，让报告诊断把问题归因到数据质量。
    """

    if missing_path and missing_path.startswith("row."):
        field = missing_path.split(".", 1)[1]
        return "warning" if field in dataset_fields else "blocked"
    return "blocked"


def _append_unique_input_expression_issue(issues: list[dict[str, Any]], seen_issue_keys: set[tuple[str, str, str, str]], issue: dict[str, Any], row_index: int) -> None:
    key = (
        str(issue.get("code") or ""),
        str(issue.get("step_id") or ""),
        str(issue.get("field_path") or ""),
        str(issue.get("message") or ""),
    )
    if key in seen_issue_keys:
        return
    seen_issue_keys.add(key)
    issue["row_index"] = row_index
    if issue.get("missing_path") is None:
        issue.pop("missing_path", None)
    issues.append(issue)


def _placeholder_for_schema(schema: dict[str, Any]) -> Any:
    expected = schema.get("type")
    if isinstance(expected, list):
        expected = expected[0] if expected else None
    if schema.get("enum"):
        enum_values = schema["enum"]
        if isinstance(enum_values, list) and enum_values:
            return enum_values[0]
    if expected == "string":
        return "__schema_string__"
    if expected == "number":
        return 1.0
    if expected == "integer":
        return 1
    if expected == "boolean":
        return True
    if expected == "array":
        return []
    if expected == "object":
        return {}
    return None


def _workflow_skill_config_check(ctx: RouteContext, workflow: Any, request: TaskPreflightRequest, preview_rows: list[dict[str, Any]]) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    seen_issue_keys: set[tuple[str, str, str, str]] = set()
    rows_to_check = preview_rows or [{}]
    task_overrides = request.skill_overrides or {}
    for step in workflow.steps:
        try:
            skill = ctx.registry.get(step.skill_ref)
        except KeyError:
            # Skill 缺失由 skill_approval 检查给出更明确的治理建议，这里避免重复噪音。
            continue
        for row_index, sample_row in enumerate(rows_to_check):
            runtime_context = {"row": sample_row, "context": {}, "metrics": {}, "artifacts": {}, "errors": [], "steps": {}}
            try:
                SkillParameterResolver(skill.manifest.config_schema).resolve(
                    workflow_config=step.config,
                    task_override=task_overrides.get(step.step_id, {}),
                    runtime_context=runtime_context,
                    secret_values={},
                )
            except (TypeMismatchError, MappingPathError) as exc:
                issue = config_issue_from_exception(step.step_id, step.skill_ref, exc)
                _append_unique_skill_config_issue(issues, seen_issue_keys, issue, row_index)
            except Exception as exc:  # noqa: BLE001 - 预检必须把异常转成结构化问题，不能让用户只看到 500。
                issue = config_issue_from_exception(step.step_id, step.skill_ref, exc)
                _append_unique_skill_config_issue(issues, seen_issue_keys, issue, row_index)
    return _preflight_check(
        "skill_config",
        "Skill 参数配置",
        "blocked" if issues else "passed",
        "Workflow 与任务级参数覆盖均满足 Skill config_schema。" if not issues else "Workflow 或任务级参数覆盖不满足 Skill config_schema。",
        {"issues": issues},
        "请在 Workflow 画布参数表单或任务执行参数中修正类型、必填项、表达式路径和 Secret 引用。",
    )


def _append_unique_skill_config_issue(issues: list[dict[str, Any]], seen_issue_keys: set[tuple[str, str, str, str]], issue: dict[str, Any], row_index: int) -> None:
    key = (
        str(issue.get("code") or ""),
        str(issue.get("step_id") or ""),
        str(issue.get("field_path") or issue.get("missing_fields") or ""),
        str(issue.get("message") or ""),
    )
    if key in seen_issue_keys:
        return
    seen_issue_keys.add(key)
    issue["row_index"] = row_index
    issues.append(issue)


def _golden_coverage_check(evaluation_goal: str | None, dataset: dict[str, Any]) -> dict[str, Any]:
    gate_goals = {"release_gate", "regression", "judge_audit"}
    if evaluation_goal not in gate_goals:
        return _preflight_check(
            "golden_coverage",
            "Golden 覆盖",
            "passed",
            "当前评测目的不强制要求 Golden Dataset。",
            {"evaluation_goal": evaluation_goal},
        )
    if dataset.get("golden") and dataset.get("label_field"):
        return _preflight_check(
            "golden_coverage",
            "Golden 覆盖",
            "passed",
            f"当前数据集已标记 Golden，标签字段为 {dataset.get('label_field')}。",
            {"golden": True, "label_field": dataset.get("label_field")},
        )
    return _preflight_check(
        "golden_coverage",
        "Golden 覆盖",
        "warning",
        "上线门禁、回归评测或 Judge 审计建议绑定 Golden Dataset 和标签字段。",
        {"golden": dataset.get("golden"), "label_field": dataset.get("label_field")},
        "请在数据集页补充 Golden 标记与人工标签字段，避免报告只能给弱结论。",
    )


def _skill_approval_check(ctx: RouteContext, workflow: Any) -> dict[str, Any]:
    blocked_skills: list[dict[str, str]] = []
    for step in workflow.steps:
        try:
            if ctx.registry.can_reference_new_workflow(step.skill_ref):
                continue
            manifest = ctx.registry.get_manifest(step.skill_ref)
            blocked_skills.append({"step_id": step.step_id, "skill_ref": step.skill_ref, "status": manifest.status})
        except KeyError:
            blocked_skills.append({"step_id": step.step_id, "skill_ref": step.skill_ref, "status": "missing"})
    return _preflight_check(
        "skill_approval",
        "Skill 可用性",
        "blocked" if blocked_skills else "passed",
        "Workflow 引用的 Skill 均已审批并启用。" if not blocked_skills else "Workflow 引用了未启用、未审批或不存在的 Skill。",
        {"blocked_skills": blocked_skills},
        "请在 Skill 市场完成合约测试和审批，或替换为已启用版本。",
    )


def _quality_gate_check(quality_gate: dict[str, Any]) -> dict[str, Any]:
    pass_rate = quality_gate.get("pass_rate", quality_gate.get("pass_rate_threshold")) if isinstance(quality_gate, dict) else None
    if isinstance(pass_rate, (int, float)) and 0 <= float(pass_rate) <= 1:
        return _preflight_check(
            "quality_gate",
            "质量门槛",
            "passed",
            f"已设置通过率门槛 {round(float(pass_rate) * 100)}%。",
            {"quality_gate": quality_gate},
        )
    return _preflight_check(
        "quality_gate",
        "质量门槛",
        "warning",
        "当前任务没有设置明确通过率门槛。",
        {"quality_gate": quality_gate},
        "建议为正式任务设置 pass_rate 和 max_badcase_count，报告才能直接判断能否发布。",
    )


def _cost_budget_check(cost_budget: float | None) -> dict[str, Any]:
    if isinstance(cost_budget, (int, float)) and cost_budget > 0:
        return _preflight_check(
            "cost_budget",
            "成本预算",
            "passed",
            f"已设置成本预算 {float(cost_budget):.2f}。",
            {"cost_budget": float(cost_budget)},
        )
    return _preflight_check(
        "cost_budget",
        "成本预算",
        "warning",
        "当前任务没有设置成本预算。",
        {"cost_budget": cost_budget},
        "建议给批量评测设置成本预算，避免大样本或高并发导致不可控消耗。",
    )


def _preflight_status(checks: list[dict[str, Any]]) -> str:
    statuses = {check.get("status") for check in checks}
    if "blocked" in statuses:
        return "blocked"
    if "warning" in statuses:
        return "warning"
    return "passed"


def _preflight_summary(status: str, checks: list[dict[str, Any]]) -> str:
    blocked = [check for check in checks if check.get("status") == "blocked"]
    warnings = [check for check in checks if check.get("status") == "warning"]
    if status == "blocked":
        return f"预检阻断：{len(blocked)} 项必须修复，{len(warnings)} 项建议优化。"
    if status == "warning":
        return f"预检可继续，但有 {len(warnings)} 项建议优化。"
    return "预检通过，可以创建并执行任务。"


def _create_repair_tasks_from_diagnostics(ctx: RouteContext, task: dict[str, Any], diagnostics: dict[str, Any]) -> dict[str, Any]:
    existing = _list_records(ctx.store, "repair_tasks")
    created: list[dict[str, Any]] = []
    reused: list[dict[str, Any]] = []
    for cause in diagnostics.get("root_causes", []):
        if not isinstance(cause, dict):
            continue
        cause_type = str(cause.get("cause_type") or "unknown")
        key = (task.get("task_id"), cause_type)
        duplicate = next((record for record in existing if (record.get("source_task_id"), record.get("cause_type")) == key), None)
        if duplicate:
            reused.append(duplicate)
            continue
        record = _build_repair_task_record(task, cause)
        _save_record(ctx.store, "repair_tasks", "repair_task_id", record)
        created.append(record)
    return {
        "source_task_id": task.get("task_id"),
        "created_count": len(created),
        "reused_count": len(reused),
        "repair_tasks": created + reused,
        "diagnostics_summary": diagnostics.get("summary", {}),
    }


def _build_repair_task_tree(ctx: RouteContext, repair_task: dict[str, Any]) -> dict[str, Any]:
    """返回父修复任务、子任务和聚合进度，支撑前端一次看清修复闭环。

    子任务可能被用户直接打开。为了避免用户只看到孤立节点，这里会先回溯到父任务，
    再围绕父任务计算整体进度和仍然阻塞的下一步动作。
    """

    root = repair_task
    parent_id = repair_task.get("parent_repair_task_id")
    if parent_id:
        root = _get_record(ctx.store, "repair_tasks", str(parent_id))
    records = _list_records(ctx.store, "repair_tasks")
    root_id = str(root["repair_task_id"])
    children = [record for record in records if str(record.get("parent_repair_task_id") or "") == root_id]
    children = sorted(children, key=lambda item: str(item.get("created_at", "")))
    return {
        "repair_task": root,
        "selected_repair_task_id": repair_task.get("repair_task_id"),
        "children": children,
        "summary": _build_repair_task_tree_summary(root, children, str(repair_task.get("repair_task_id"))),
    }


def _build_repair_task_tree_summary(root: dict[str, Any], children: list[dict[str, Any]], selected_repair_task_id: str) -> dict[str, Any]:
    total_children = len(children)
    resolved_children = sum(1 for item in children if item.get("status") == "resolved")
    in_progress_children = sum(1 for item in children if item.get("status") == "in_progress")
    open_children = sum(1 for item in children if item.get("status") == "open")
    overdue_task_ids = [str(item["repair_task_id"]) for item in children if _repair_task_is_overdue(item.get("due_at"), str(item.get("status") or "open"))]
    if total_children:
        completion_rate = resolved_children / total_children
        overall_status = "resolved" if resolved_children == total_children else "in_progress" if in_progress_children else "open"
    else:
        root_status = str(root.get("status") or "open")
        completion_rate = 1.0 if root_status == "resolved" else 0.0
        overall_status = root_status
    blocking_children = [str(item["repair_task_id"]) for item in children if item.get("status") != "resolved"]
    next_actions = [_repair_task_next_action(item) for item in children if item.get("status") != "resolved"]
    return {
        "total_children": total_children,
        "open_children": open_children,
        "in_progress_children": in_progress_children,
        "resolved_children": resolved_children,
        "completion_rate": round(completion_rate, 4),
        "overall_status": overall_status,
        "blocking_children": blocking_children,
        "overdue_children": len(overdue_task_ids),
        "overdue_task_ids": overdue_task_ids,
        "next_actions": next_actions,
        "selected_repair_task_id": selected_repair_task_id,
    }


def _repair_task_next_action(record: dict[str, Any]) -> dict[str, Any]:
    """把待处理子任务压缩为前端可直接渲染的下一步动作。"""

    fallback_action = None
    next_actions = record.get("next_actions") or []
    if isinstance(next_actions, list) and next_actions:
        fallback_action = next_actions[0]
    return {
        "repair_task_id": record.get("repair_task_id"),
        "title": record.get("title"),
        "status": record.get("status"),
        "recommended_action": record.get("recommended_action") or fallback_action,
        "target_url": record.get("target_url"),
        "owner": record.get("owner"),
        "due_at": record.get("due_at"),
        "overdue": _repair_task_is_overdue(record.get("due_at"), str(record.get("status") or "open")),
    }


def _repair_task_is_overdue(due_at: Any, status: str) -> bool:
    if status == "resolved" or not due_at:
        return False
    try:
        normalized = str(due_at).replace("Z", "+00:00")
        due_time = datetime.fromisoformat(normalized)
        if due_time.tzinfo is None:
            due_time = due_time.replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    return due_time < datetime.now(timezone.utc)


def _transition_repair_task(
    ctx: RouteContext,
    repair_task_id: str,
    *,
    allowed_statuses: set[str],
    updates: dict[str, Any],
    audit_action: str,
    actor: str = "api",
    role: str | None = None,
) -> dict[str, Any]:
    """更新修复任务状态，并在非法状态时返回稳定错误。

    Repair Task 是从诊断根因沉淀出的工作项，状态变更必须可追踪且不能跳跃，
    否则后续很难解释某个问题是否真的被处理过。
    """

    record = _get_record(ctx.store, "repair_tasks", repair_task_id)
    current_status = str(record.get("status") or "open")
    if current_status not in allowed_statuses:
        raise AegisQAError(
            "REPAIR_TASK_INVALID_TRANSITION",
            "当前修复任务状态不允许执行该操作。",
            status_code=409,
            details={
                "repair_task_id": repair_task_id,
                "current_status": current_status,
                "allowed_statuses": sorted(allowed_statuses),
            },
        )
    record.update(updates)
    _save_record(ctx.store, "repair_tasks", "repair_task_id", record)
    detail = {"status": record.get("status")}
    if role:
        detail["role"] = role
    ctx.audit_service.record(actor=actor, role=role, action=audit_action, target=repair_task_id, detail=detail)
    return record


def _repair_action_seed_annotation_queue(ctx: RouteContext, repair_task: dict[str, Any], request: RepairTaskActionRequest) -> dict[str, Any]:
    """从修复任务直接创建人工审核样本，避免报告、工单和审核队列三处割裂。"""

    task = _get_record(ctx.store, "tasks", str(repair_task.get("source_task_id")))
    run = ctx.runner.get_run(str(repair_task.get("source_run_id") or task["run_id"]))
    existing = {item.get("item_id") for item in _list_records(ctx.store, "annotation_tasks") if item.get("run_id") == run.run_id}
    created: list[dict[str, Any]] = []
    limit = max(1, request.limit)
    for item in run.items:
        if len(created) >= limit:
            break
        item_payload = item.model_dump(mode="json")
        if item.item_id in existing or not _needs_annotation(item_payload, strategy="failed_or_low_score"):
            continue
        annotation_task = _build_annotation_task(run.run_id, item_payload, assignee=request.assignee, source_task=task)
        _save_record(ctx.store, "annotation_tasks", "task_id", annotation_task)
        created.append(annotation_task)
    return {
        "status": "created" if created else "reused",
        "run_id": run.run_id,
        "source_task_id": task["task_id"],
        "created_count": len(created),
        "annotation_task_ids": [item["task_id"] for item in created],
    }


def _repair_action_evaluate_ci_gate(ctx: RouteContext, repair_task: dict[str, Any]) -> dict[str, Any]:
    task = _get_record(ctx.store, "tasks", str(repair_task.get("source_task_id")))
    run = ctx.runner.get_run(str(repair_task.get("source_run_id") or task["run_id"]))
    quality_gate = task.get("quality_gate") or task.get("execution_config", {}).get("quality_gate") or {}
    gates: list[CIGateRuleRequest] = []
    if "pass_rate" in quality_gate:
        gates.append(CIGateRuleRequest(gate_id="repair_pass_rate", metric="pass_rate", operator=">=", threshold=float(quality_gate["pass_rate"]), blocking=True))
    if "max_badcase_count" in quality_gate:
        gates.append(CIGateRuleRequest(gate_id="repair_badcase_count", metric="badcase_count", operator="<=", threshold=float(quality_gate["max_badcase_count"]), blocking=True))
    if not gates:
        raise AegisQAError(
            "REPAIR_TASK_GATE_REQUIRED",
            "来源任务没有质量门槛，无法执行 CI Gate 复测。",
            status_code=400,
            details={"source_task_id": task["task_id"]},
        )

    metrics = _ci_gate_metrics_from_task(task, run)
    results = [_evaluate_gate(metrics, gate) for gate in gates]
    blocking_failures = [item for item in results if item["status"] == "failed" and item["blocking"]]
    evaluation = {
        "evaluation_id": f"gateeval-{uuid4().hex[:12]}",
        "config_id": None,
        "status": "blocked" if blocking_failures else "passed",
        "blocking_failures": len(blocking_failures),
        "target": {"kind": "task", "id": task["task_id"]},
        "metrics": metrics,
        "results": results,
        "source_repair_task_id": repair_task["repair_task_id"],
        "created_at": _now(),
    }
    _save_record(ctx.store, "ci_gate_evaluations", "evaluation_id", evaluation)
    return evaluation


def _repair_action_retest_and_compare(ctx: RouteContext, repair_task: dict[str, Any], *, actor: str = "api", role: str | None = "Evaluator") -> dict[str, Any]:
    """从修复任务发起一次复跑，并把复跑前后指标差异写成可解释结果。"""

    task = _get_record(ctx.store, "tasks", str(repair_task.get("source_task_id")))
    _ensure_task_can_create_attempt(task)
    previous_run = ctx.runner.get_run(str(repair_task.get("source_run_id") or task["run_id"]))
    previous_report = aggregate_run_report(previous_run)
    workflow = ctx.workflow_service.get(task["workflow_version_id"])
    execution_config = task.get("execution_config", {})
    new_run = ctx.runner.create_run(
        RunRequest(
            workflow=workflow,
            dataset_id=task["dataset_id"],
            dataset_version=task["dataset_version"],
            chunk_size=execution_config.get("chunk_size"),
            concurrency=execution_config.get("concurrency"),
            sample_repeat_times=execution_config.get("sample_repeat_times"),
            task_config_snapshot={
                "evaluation_goal": task.get("evaluation_goal"),
                "quality_gate": task.get("quality_gate", {}),
                "skill_overrides": execution_config.get("skill_overrides", {}),
                "source_repair_task_id": repair_task["repair_task_id"],
            },
        )
    )
    attempts = _task_attempts(task)
    attempt_index = len(attempts) + 1
    task.update(
        {
            "run_id": new_run.run_id,
            "status": new_run.status,
            "total_items": new_run.total_items,
            "completed_items": 0,
            "failed_items": 0,
            "pass_rate": 0.0,
            "badcase_count": 0,
            "current_attempt": attempt_index,
            "attempts": attempts + [_build_attempt_record(new_run, attempt_index)],
            "updated_at": _now(),
        }
    )
    _save_record(ctx.store, "tasks", "task_id", task)
    ctx.audit_service.record(
        actor=actor,
        role=role,
        action="task.attempt.create_from_repair",
        target=task["task_id"],
        detail={"role": role, "run_id": new_run.run_id, "attempt": attempt_index, "repair_task_id": repair_task["repair_task_id"]},
    )

    executed_run = ctx.runner.execute_run(new_run.run_id)
    task = _refresh_task_from_run(ctx.store, task, executed_run)
    new_report = aggregate_run_report(executed_run)
    comparison = compare_reports(previous_report, new_report)
    comparison["badcase_count_delta"] = comparison.get("badcase_delta", 0)
    comparison_status = _repair_retest_status(comparison)
    return {
        "status": executed_run.status,
        "source_task_id": task["task_id"],
        "previous_run_id": previous_run.run_id,
        "new_run_id": executed_run.run_id,
        "current_attempt": task.get("current_attempt", attempt_index),
        "comparison_status": comparison_status,
        "comparison": comparison,
    }


def _repair_retest_status(comparison: dict[str, Any]) -> str:
    pass_rate_delta = float(comparison.get("pass_rate_delta") or 0)
    error_rate_delta = float(comparison.get("error_rate_delta") or 0)
    badcase_delta = int(comparison.get("badcase_delta") or comparison.get("badcase_count_delta") or 0)
    if pass_rate_delta > 0 or error_rate_delta < 0 or badcase_delta < 0:
        if pass_rate_delta < 0 or error_rate_delta > 0 or badcase_delta > 0:
            return "mixed"
        return "improved"
    if pass_rate_delta < 0 or error_rate_delta > 0 or badcase_delta > 0:
        return "regressed"
    return "unchanged"


def _repair_action_generate_remediation_plan(ctx: RouteContext, repair_task: dict[str, Any]) -> dict[str, Any]:
    """把复跑、诊断和参数治理证据整理成下一步修复清单。"""

    task = _get_record(ctx.store, "tasks", str(repair_task.get("source_task_id")))
    run_id = _repair_latest_run_id(repair_task, task)
    run = ctx.runner.get_run(run_id)
    report = aggregate_run_report(run)
    segments = build_report_segments(run)
    parameter_governance = _build_parameter_governance(task, run)
    diagnostics = build_task_diagnostics(task, run, report, segments, parameter_governance)
    comparison_status = _repair_last_comparison_status(repair_task)
    recommendations = _build_repair_remediation_recommendations(task, repair_task, diagnostics, comparison_status)
    return {
        "status": "completed",
        "source_task_id": task["task_id"],
        "run_id": run.run_id,
        "comparison_status": comparison_status,
        "diagnostics_summary": diagnostics.get("summary", {}),
        "recommendations": recommendations,
    }


def _repair_action_create_followup_tasks(ctx: RouteContext, repair_task: dict[str, Any]) -> dict[str, Any]:
    """把修复建议拆成可分派的二级 Repair Task。

    建议本身只是一次分析结果，拆成子任务后才具备负责人、状态流转和复跑证据。
    `retest_and_compare` 不拆成子任务，因为它是父任务上的验证动作，重复拆分会制造噪音。
    """

    recommendations = _repair_recommendations_from_last_result(ctx, repair_task)
    repair_task["remediation_plan"] = {"recommendations": recommendations, "updated_at": _now()}
    existing = _list_records(ctx.store, "repair_tasks")
    created: list[dict[str, Any]] = []
    reused: list[dict[str, Any]] = []
    for recommendation in recommendations:
        if not isinstance(recommendation, dict):
            continue
        if str(recommendation.get("action") or "") == "retest_and_compare":
            continue
        title = str(recommendation.get("title") or "").strip()
        action = str(recommendation.get("action") or "").strip()
        if not title or not action:
            continue
        duplicate = _find_existing_followup_task(existing, repair_task, title, action)
        if duplicate:
            reused.append(duplicate)
            continue
        record = _build_followup_repair_task_record(repair_task, recommendation)
        _save_record(ctx.store, "repair_tasks", "repair_task_id", record)
        existing.append(record)
        created.append(record)
    return {
        "status": "completed",
        "source_task_id": repair_task.get("source_task_id"),
        "parent_repair_task_id": repair_task.get("repair_task_id"),
        "created_count": len(created),
        "reused_count": len(reused),
        "repair_tasks": created + reused,
        "skipped_actions": ["retest_and_compare"],
    }


def _repair_action_fix_dataset_fields(ctx: RouteContext, repair_task: dict[str, Any]) -> dict[str, Any]:
    """生成数据字段修复计划。

    数据字段问题不能由系统静默改写样本内容：缺失字段可能需要业务标注、字段映射
    或重新导入数据。这里返回可执行计划和证据，让用户在数据集页创建新版本或修正
    字段类型，避免把诊断推断误当成真实数据。
    """

    task = _get_record(ctx.store, "tasks", str(repair_task.get("source_task_id")))
    run_id = _repair_latest_run_id(repair_task, task)
    run = ctx.runner.get_run(run_id)
    report = aggregate_run_report(run)
    segments = build_report_segments(run)
    parameter_governance = _build_parameter_governance(task, run)
    diagnostics = build_task_diagnostics(task, run, report, segments, parameter_governance)
    data_quality = diagnostics.get("data_quality", {})
    dataset = ctx.dataset_service.get_version(str(task["dataset_id"]), int(task["dataset_version"]))
    field_actions = _build_dataset_field_fix_actions(data_quality)
    missing_required_fields = [
        item["field"]
        for item in field_actions
        if item.get("required_by_workflow") and item.get("missing_count", 0) > 0
    ]
    return {
        "status": "planned",
        "source_task_id": task["task_id"],
        "run_id": run.run_id,
        "dataset": {
            "dataset_id": dataset.dataset_id,
            "version": dataset.version,
            "version_id": dataset.version_id,
            "name": dataset.name,
            "row_count": dataset.row_count,
            "field_schema": dataset.field_schema,
        },
        "target_url": f"/datasets?dataset_id={dataset.dataset_id}&version={dataset.version}",
        "missing_required_fields": missing_required_fields,
        "duplicate_row_count": int(data_quality.get("duplicate_row_count") or 0),
        "warnings": data_quality.get("warnings", []),
        "field_actions": field_actions,
        "next_steps": [
            "在数据集页查看 Lineage 和字段预览。",
            "为缺失的 Workflow 必需字段补充列，或在 Workflow 画布调整 input_mapping。",
            "重新上传为新的 Dataset Version 后创建新 Task 或从修复任务触发复跑对比。",
        ],
    }


def _build_dataset_field_fix_actions(data_quality: dict[str, Any]) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    for item in data_quality.get("field_coverage", []):
        if not isinstance(item, dict):
            continue
        missing_count = int(item.get("missing_count") or 0)
        required = bool(item.get("required_by_workflow"))
        if not required and missing_count <= 0:
            continue
        field = str(item.get("field") or "")
        if not field:
            continue
        action = "add_or_map_field" if required and missing_count > 0 else "inspect_optional_field"
        recommendation = (
            "这是 Workflow 必需字段，请补充该列，或在 Workflow 画布把输入映射到已有等价字段。"
            if action == "add_or_map_field"
            else "该字段存在缺失值，建议确认是否影响分层分析或人工审核。"
        )
        actions.append(
            {
                "field": field,
                "action": action,
                "required_by_workflow": required,
                "present_count": int(item.get("present_count") or 0),
                "missing_count": missing_count,
                "coverage": float(item.get("coverage") or 0),
                "recommendation": recommendation,
            }
        )
    return sorted(actions, key=lambda value: (not bool(value["required_by_workflow"]), str(value["field"])))


def _repair_action_plan_workflow_parameter_changes(ctx: RouteContext, repair_task: dict[str, Any]) -> dict[str, Any]:
    """生成 Workflow 参数 diff 与回滚计划。

    参数风险通常来自 task_override、运行时表达式或 secret_ref。这里不直接修改 Workflow
    或任务覆盖，因为参数改动会影响后续评测可复现性；API 只返回“当前执行证据 vs
    Workflow 默认配置”的差异和建议补丁，交给用户确认后再发布新 Workflow 版本或重建任务。
    """

    task = _get_record(ctx.store, "tasks", str(repair_task.get("source_task_id")))
    run_id = _repair_latest_run_id(repair_task, task)
    run = ctx.runner.get_run(run_id)
    governance = _build_parameter_governance(task, run)
    parameter_diffs = _build_workflow_parameter_diffs(task, run, governance)
    rollback_plan = {
        "skill_overrides_remove": [
            {"step_id": item["step_id"], "parameter": item["parameter"]}
            for item in parameter_diffs
            if item.get("source") == "task_override"
        ],
        "runtime_expression_review": [
            {"step_id": item["step_id"], "parameter": item["parameter"], "expression_path": item.get("expression_path")}
            for item in parameter_diffs
            if item.get("source") == "runtime_expression"
        ],
        "secret_ref_review": [
            {"step_id": item["step_id"], "parameter": item["parameter"], "secret_ref": item.get("secret_ref")}
            for item in parameter_diffs
            if item.get("source") == "secret_ref"
        ],
    }
    return {
        "status": "planned",
        "source_task_id": task["task_id"],
        "run_id": run.run_id,
        "workflow": {
            "workflow_id": run.workflow.workflow_id,
            "version_id": run.workflow.version_id,
            "name": run.workflow.name,
            "snapshot_hash": run.workflow.snapshot_hash,
        },
        "target_url": f"/reports?task_id={task['task_id']}&panel=parameter-governance",
        "parameter_diffs": parameter_diffs,
        "rollback_plan": rollback_plan,
        "next_steps": [
            "先在参数治理页确认 task_override、runtime_expression 和 secret_ref 是否符合本次评测目标。",
            "如果任务覆盖只是临时实验，移除对应 skill_overrides 后重建任务或触发复跑对比。",
            "如果覆盖值是新基线，把确认后的配置发布为新的 Workflow 版本，再用同一 Dataset 重新创建 Task。",
        ],
    }


def _build_workflow_parameter_diffs(task: dict[str, Any], run: RunRecord, governance: dict[str, Any]) -> list[dict[str, Any]]:
    execution_config = task.get("execution_config", {})
    task_overrides = execution_config.get("skill_overrides", {}) if isinstance(execution_config, dict) else {}
    if not isinstance(task_overrides, dict):
        task_overrides = {}
    sources_by_step = {
        str(item.get("step_id")): item.get("parameters", {})
        for item in governance.get("parameter_sources", [])
        if isinstance(item, dict)
    }
    diffs: list[dict[str, Any]] = []
    for step in run.workflow.steps:
        step_sources = sources_by_step.get(step.step_id, {})
        if not isinstance(step_sources, dict):
            continue
        step_overrides = task_overrides.get(step.step_id, {})
        if not isinstance(step_overrides, dict):
            step_overrides = {}
        for parameter, trace in sorted(step_sources.items()):
            if not isinstance(trace, dict):
                continue
            source = str(trace.get("source") or "unknown")
            if source not in {"task_override", "runtime_expression", "secret_ref"}:
                continue
            workflow_value = step.config.get(parameter)
            override_value = step_overrides.get(parameter)
            diffs.append(
                {
                    "step_id": step.step_id,
                    "skill_ref": step.skill_ref,
                    "parameter": parameter,
                    "source": source,
                    "workflow_value_preview": redact_secrets(workflow_value),
                    "task_override_value_preview": redact_secrets(override_value) if parameter in step_overrides else None,
                    "current_value_preview": trace.get("value_preview"),
                    "expression_path": trace.get("expression_path"),
                    "secret_ref": trace.get("secret_ref"),
                    "recommended_action": _workflow_parameter_recommended_action(source),
                    "recommendation": _workflow_parameter_recommendation(source),
                }
            )
    return diffs


def _workflow_parameter_recommended_action(source: str) -> str:
    if source == "task_override":
        return "remove_task_override_or_promote_to_workflow"
    if source == "runtime_expression":
        return "stabilize_expression_or_freeze_value"
    if source == "secret_ref":
        return "verify_secret_scope_and_rotation"
    return "review_parameter_source"


def _workflow_parameter_recommendation(source: str) -> str:
    if source == "task_override":
        return "任务覆盖了 Workflow 默认值，请移除覆盖或将确认后的值发布到新 Workflow 版本。"
    if source == "runtime_expression":
        return "运行时表达式依赖样本路径，请确认该路径在所有样本中稳定存在，必要时冻结为 Workflow 配置。"
    if source == "secret_ref":
        return "Secret 参数已脱敏，请确认引用范围、轮换策略和本次评测使用的环境一致。"
    return "请确认该参数来源是否符合本次评测目标。"


def _repair_action_compare_prompt_skill_versions(ctx: RouteContext, repair_task: dict[str, Any]) -> dict[str, Any]:
    """生成 Prompt/Skill 版本对比计划。

    版本回滚或晋升会改变后续评测基线，不能在修复任务里直接执行。这里把当前 Run
    与同数据集的 Experiment baseline 做差异比较，帮助用户判断是 Prompt、Skill、模型
    还是参数版本造成退化，再决定是否创建候选配置或发布新的 Workflow 版本。
    """

    task = _get_record(ctx.store, "tasks", str(repair_task.get("source_task_id")))
    run_id = _repair_latest_run_id(repair_task, task)
    run = ctx.runner.get_run(run_id)
    current_versions = _build_prompt_skill_version_inventory(ctx, run)
    baseline_candidates = _build_prompt_skill_baseline_candidates(ctx, task, run, current_versions)
    return {
        "status": "planned",
        "source_task_id": task["task_id"],
        "run_id": run.run_id,
        "current_versions": current_versions,
        "baseline_candidates": baseline_candidates,
        "candidate_actions": [
            {
                "action": "create_prompt_skill_candidate",
                "label": "沉淀 Prompt/Skill 候选配置",
                "target_url": f"/experiments?dataset_id={run.dataset_id}&workflow_id={run.workflow.workflow_id}",
            },
            {
                "action": "create_workflow_draft_from_version_diff",
                "label": "从版本差异创建 Workflow 草稿",
                "target_url": f"/workflows?source_task_id={task['task_id']}",
            },
        ],
        "next_steps": [
            "先对比当前 Run 与 baseline 的 prompt_version、skill_ref、model 和模型参数差异。",
            "如果 baseline 指标更好，优先把差异配置沉淀为 Prompt/Skill 候选，再用同一 Dataset 复跑。",
            "如果当前版本更好，把当前配置发布为新的 Workflow 版本，并把 Experiment 设为新 baseline。",
        ],
    }


def _build_prompt_skill_version_inventory(ctx: RouteContext, run: RunRecord) -> list[dict[str, Any]]:
    inventory: list[dict[str, Any]] = []
    for step in run.workflow.steps:
        try:
            skill_version = ctx.registry.get(step.skill_ref).manifest.version
        except Exception:  # noqa: BLE001 - 历史 Run 可能引用已经下线的 Skill，版本清单仍要返回可解释占位。
            skill_version = "unknown"
        inventory.append(
            {
                "step_id": step.step_id,
                "skill_ref": step.skill_ref,
                "skill_version": skill_version,
                "prompt_version": step.config.get("prompt_version") or step.config.get("prompt") or "inline-config",
                "model": step.config.get("model"),
                "model_params": {key: step.config.get(key) for key in ("temperature", "threshold", "top_p") if key in step.config},
                "cacheable": step.cacheable,
            }
        )
    return inventory


def _build_prompt_skill_baseline_candidates(
    ctx: RouteContext,
    task: dict[str, Any],
    run: RunRecord,
    current_versions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for experiment in _list_records(ctx.store, "experiments"):
        if experiment.get("run_id") == run.run_id:
            continue
        if experiment.get("dataset_id") != run.dataset_id:
            continue
        snapshot = experiment.get("snapshot") if isinstance(experiment.get("snapshot"), dict) else {}
        baseline_versions = snapshot.get("prompt_skill_versions", []) if isinstance(snapshot, dict) else []
        if not isinstance(baseline_versions, list):
            continue
        version_diffs = _diff_prompt_skill_versions(current_versions, [item for item in baseline_versions if isinstance(item, dict)])
        if not version_diffs:
            continue
        metrics = experiment.get("metrics") if isinstance(experiment.get("metrics"), dict) else {}
        candidates.append(
            {
                "experiment_id": experiment.get("experiment_id"),
                "name": experiment.get("name"),
                "run_id": experiment.get("run_id"),
                "workflow_version_id": experiment.get("workflow_version_id") or snapshot.get("workflow_version"),
                "metrics": {
                    "pass_rate": metrics.get("pass_rate"),
                    "badcase_count": metrics.get("badcase_count"),
                    "p95_latency_ms": metrics.get("p95_latency_ms"),
                },
                "version_diffs": version_diffs,
                "target_url": f"/experiments?baseline_run_id={experiment.get('run_id')}&task_id={task['task_id']}",
            }
        )
    return sorted(candidates, key=lambda item: str(item.get("experiment_id") or ""))[:5]


def _diff_prompt_skill_versions(current_versions: list[dict[str, Any]], baseline_versions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    current_by_step = {str(item.get("step_id")): item for item in current_versions}
    baseline_by_step = {str(item.get("step_id")): item for item in baseline_versions}
    diffs: list[dict[str, Any]] = []
    for step_id in sorted(set(current_by_step) & set(baseline_by_step)):
        current = current_by_step[step_id]
        baseline = baseline_by_step[step_id]
        for field in ("skill_ref", "skill_version", "prompt_version", "model", "model_params"):
            if field not in current or field not in baseline:
                continue
            current_value = current.get(field)
            baseline_value = baseline.get(field)
            if current_value == baseline_value:
                continue
            diffs.append(
                {
                    "step_id": step_id,
                    "field": field,
                    "baseline_value": baseline_value,
                    "current_value": current_value,
                    "recommended_action": _prompt_skill_version_recommended_action(field),
                }
            )
    return diffs


def _prompt_skill_version_recommended_action(field: str) -> str:
    if field == "prompt_version":
        return "compare_or_rollback_prompt_version"
    if field in {"skill_ref", "skill_version"}:
        return "verify_skill_version_compatibility"
    return "compare_model_or_parameter_version"


def _repair_action_create_prompt_skill_candidate(ctx: RouteContext, repair_task: dict[str, Any]) -> dict[str, Any]:
    """把版本对比结果沉淀为候选配置资产。

    这里不直接改 Prompt 或 Skill 注册表，因为候选配置还需要人工确认和复跑验证。
    先把 baseline、当前版本和 diff 固化成可追踪资产，后续可在实验中心或候选池里审批晋升。
    """

    plan = _repair_prompt_skill_compare_plan(ctx, repair_task)
    candidates: list[dict[str, Any]] = []
    existing = {
        (item.get("source_repair_task_id"), item.get("baseline_experiment_id")): item
        for item in _list_records(ctx.store, "prompt_skill_candidates")
        if item.get("source_repair_task_id") == repair_task.get("repair_task_id")
    }
    for baseline in plan.get("baseline_candidates", []):
        if not isinstance(baseline, dict) or not baseline.get("version_diffs"):
            continue
        key = (repair_task.get("repair_task_id"), baseline.get("experiment_id"))
        candidate = existing.get(key)
        if candidate is None:
            candidate = {
                "candidate_id": f"prompt-skill-candidate-{uuid4().hex[:12]}",
                "kind": "prompt_skill_version_diff",
                "status": "candidate",
                "source_repair_task_id": repair_task.get("repair_task_id"),
                "source_task_id": plan.get("source_task_id"),
                "source_run_id": plan.get("run_id"),
                "baseline_experiment_id": baseline.get("experiment_id"),
                "baseline_run_id": baseline.get("run_id"),
                "baseline_metrics": baseline.get("metrics", {}),
                "current_versions": plan.get("current_versions", []),
                "version_diffs": baseline.get("version_diffs", []),
                "recommended_actions": [
                    diff.get("recommended_action")
                    for diff in baseline.get("version_diffs", [])
                    if isinstance(diff, dict) and diff.get("recommended_action")
                ],
                "created_at": _now(),
                "updated_at": _now(),
            }
        else:
            candidate["status"] = "candidate"
            candidate["current_versions"] = plan.get("current_versions", [])
            candidate["version_diffs"] = baseline.get("version_diffs", [])
            candidate["updated_at"] = _now()
        _save_record(ctx.store, "prompt_skill_candidates", "candidate_id", candidate)
        candidates.append(candidate)
    if not candidates:
        raise AegisQAError("PROMPT_SKILL_CANDIDATE_EMPTY", "没有可沉淀的 Prompt/Skill 版本差异候选。", status_code=400)
    return {
        "status": "created",
        "created_count": len(candidates),
        "candidates": candidates,
        "target_url": f"/experiments?source_task_id={plan.get('source_task_id')}&panel=prompt-skill-candidates",
    }


def _repair_action_create_workflow_draft_from_version_diff(
    ctx: RouteContext,
    repair_task: dict[str, Any],
    *,
    actor: str = "api",
    role: str | None = "Evaluator",
) -> dict[str, Any]:
    """从版本差异生成可编辑 Workflow 草稿。

    草稿默认把 baseline 的 Prompt/模型/Skill 引用值应用到当前图上，但不发布。
    这样用户可以在画布中检查映射和参数，再通过正常发布流程进入新的可复现版本。
    """

    plan = _repair_prompt_skill_compare_plan(ctx, repair_task)
    baseline = _first_prompt_skill_baseline(plan)
    task = _get_record(ctx.store, "tasks", str(plan.get("source_task_id") or repair_task.get("source_task_id")))
    run = ctx.runner.get_run(str(plan.get("run_id") or _repair_latest_run_id(repair_task, task)))
    graph = _workflow_graph_snapshot(run.workflow)
    graph["name"] = f"{run.workflow.name}_version_diff_candidate"
    _apply_version_diffs_to_graph(graph, [item for item in baseline.get("version_diffs", []) if isinstance(item, dict)])
    now = _now()
    draft = {
        "draft_id": f"draft-{uuid4().hex[:12]}",
        "name": graph["name"],
        "status": "draft",
        "graph": graph,
        "source_repair_task_id": repair_task.get("repair_task_id"),
        "source_task_id": task.get("task_id"),
        "baseline_experiment_id": baseline.get("experiment_id"),
        "version_diffs": baseline.get("version_diffs", []),
        "created_at": now,
        "updated_at": now,
    }
    _save_workflow_draft(ctx.store, draft)
    ctx.audit_service.record(
        actor=actor,
        role=role,
        action="workflow_draft.create_from_version_diff",
        target=draft["draft_id"],
        detail={"role": role, "repair_task_id": repair_task.get("repair_task_id")},
    )
    return {
        "status": "created",
        "draft": draft,
        "target_url": f"/workflows/designer/{draft['draft_id']}",
        "next_steps": [
            "在 Workflow 画布检查 baseline 版本值是否符合本次回滚或候选实验目标。",
            "保存并发布草稿后，用同一 Dataset 创建新 Task 复跑对比。",
        ],
    }


def _repair_prompt_skill_compare_plan(ctx: RouteContext, repair_task: dict[str, Any]) -> dict[str, Any]:
    plan = repair_task.get("version_compare_plan")
    if isinstance(plan, dict) and isinstance(plan.get("baseline_candidates"), list):
        return plan
    last_action = repair_task.get("last_action_result") or {}
    result = last_action.get("result") if isinstance(last_action, dict) and last_action.get("action") == "compare_prompt_skill_versions" else None
    if isinstance(result, dict) and isinstance(result.get("baseline_candidates"), list):
        return result
    return _repair_action_compare_prompt_skill_versions(ctx, repair_task)


def _first_prompt_skill_baseline(plan: dict[str, Any]) -> dict[str, Any]:
    for candidate in plan.get("baseline_candidates", []):
        if isinstance(candidate, dict) and candidate.get("version_diffs"):
            return candidate
    raise AegisQAError("PROMPT_SKILL_BASELINE_MISSING", "没有可用于创建 Workflow 草稿的 Prompt/Skill baseline。", status_code=400)


def _workflow_graph_snapshot(workflow: Any) -> dict[str, Any]:
    if isinstance(workflow.graph, dict):
        return deepcopy(workflow.graph)
    nodes = [
        {
            "node_id": step.step_id,
            "node_type": "skill",
            "label": step.step_id,
            "skill_ref": step.skill_ref,
            "input_mapping": step.input_mapping,
            "output_mapping": step.output_mapping,
            "config": deepcopy(step.config),
            "cacheable": step.cacheable,
        }
        for step in workflow.steps
    ]
    edges = [{"source": workflow.steps[index].step_id, "target": workflow.steps[index + 1].step_id} for index in range(len(workflow.steps) - 1)]
    return {"name": workflow.name, "nodes": nodes, "edges": edges, "runtime": workflow.runtime.model_dump(mode="json")}


def _apply_version_diffs_to_graph(graph: dict[str, Any], version_diffs: list[dict[str, Any]]) -> None:
    nodes = graph.get("nodes", [])
    if not isinstance(nodes, list):
        return
    nodes_by_id = {node.get("node_id"): node for node in nodes if isinstance(node, dict)}
    for diff in version_diffs:
        node = nodes_by_id.get(diff.get("step_id"))
        if not isinstance(node, dict):
            continue
        config = node.setdefault("config", {})
        if not isinstance(config, dict):
            config = {}
            node["config"] = config
        field = diff.get("field")
        baseline_value = deepcopy(diff.get("baseline_value"))
        if field == "skill_ref":
            node["skill_ref"] = baseline_value
        elif field in {"prompt_version", "model"}:
            config[str(field)] = baseline_value
        elif field == "model_params" and isinstance(baseline_value, dict):
            config.update(baseline_value)
        elif field == "skill_version":
            metadata = node.setdefault("metadata", {})
            if isinstance(metadata, dict):
                metadata["baseline_skill_version"] = baseline_value


def _repair_recommendations_from_last_result(ctx: RouteContext, repair_task: dict[str, Any]) -> list[dict[str, Any]]:
    last_action = repair_task.get("last_action_result") or {}
    if isinstance(last_action, dict) and last_action.get("action") == "generate_remediation_plan":
        result = last_action.get("result") or {}
        if isinstance(result, dict) and isinstance(result.get("recommendations"), list):
            return [item for item in result["recommendations"] if isinstance(item, dict)]
    remediation_plan = repair_task.get("remediation_plan") or {}
    if isinstance(remediation_plan, dict) and isinstance(remediation_plan.get("recommendations"), list):
        return [item for item in remediation_plan["recommendations"] if isinstance(item, dict)]
    generated = _repair_action_generate_remediation_plan(ctx, repair_task)
    recommendations = generated.get("recommendations") or []
    return [item for item in recommendations if isinstance(item, dict)]


def _find_existing_followup_task(existing: list[dict[str, Any]], repair_task: dict[str, Any], title: str, action: str) -> dict[str, Any] | None:
    parent_id = repair_task.get("repair_task_id")
    source_task_id = repair_task.get("source_task_id")
    for record in existing:
        if record.get("parent_repair_task_id") != parent_id:
            continue
        if record.get("source_task_id") != source_task_id:
            continue
        if record.get("title") == title and record.get("recommended_action") == action:
            return record
    return None


def _build_followup_repair_task_record(repair_task: dict[str, Any], recommendation: dict[str, Any]) -> dict[str, Any]:
    now = _now()
    area = str(recommendation.get("area") or "remediation")
    priority = str(recommendation.get("priority") or repair_task.get("severity") or "info")
    return {
        "repair_task_id": f"repair-{uuid4().hex[:12]}",
        "parent_repair_task_id": repair_task.get("repair_task_id"),
        "source_task_id": repair_task.get("source_task_id"),
        "source_run_id": repair_task.get("source_run_id"),
        "cause_type": area,
        "severity": priority,
        "title": str(recommendation.get("title") or "后续修复任务"),
        "status": "open",
        "affected_items": int(repair_task.get("affected_items") or 0),
        "evidence": recommendation.get("evidence", []),
        "recommendation": str(recommendation.get("reason") or ""),
        "next_actions": [str(recommendation.get("action"))] if recommendation.get("action") else [],
        "recommended_action": recommendation.get("action"),
        "target_url": recommendation.get("target_url"),
        "remediation_area": area,
        "action_history": [],
        "owner": None,
        "created_at": now,
        "updated_at": now,
    }


def _repair_latest_run_id(repair_task: dict[str, Any], task: dict[str, Any]) -> str:
    last_action = repair_task.get("last_action_result") or {}
    if isinstance(last_action, dict):
        result = last_action.get("result") or {}
        if isinstance(result, dict) and result.get("new_run_id"):
            return str(result["new_run_id"])
    return str(task.get("run_id") or repair_task.get("source_run_id"))


def _repair_last_comparison_status(repair_task: dict[str, Any]) -> str | None:
    last_action = repair_task.get("last_action_result") or {}
    if not isinstance(last_action, dict):
        return None
    result = last_action.get("result") or {}
    if not isinstance(result, dict):
        return None
    status = result.get("comparison_status")
    return str(status) if status else None


def _build_repair_remediation_recommendations(
    task: dict[str, Any],
    repair_task: dict[str, Any],
    diagnostics: dict[str, Any],
    comparison_status: str | None,
) -> list[dict[str, Any]]:
    recommendations: list[dict[str, Any]] = []
    task_id = str(task["task_id"])
    cause_type = str(repair_task.get("cause_type") or diagnostics.get("summary", {}).get("primary_cause") or "unknown")

    if comparison_status in {"unchanged", "regressed", "mixed"}:
        recommendations.append(
            _remediation_item(
                "workflow_parameters",
                "确认修复是否进入当前 Attempt",
                f"最近复跑状态为 {comparison_status}，需要先确认 Prompt、模型参数、task_override 和 secret_ref 是否被新 Attempt 使用。",
                f"/reports?task_id={task_id}&panel=parameter-governance",
                "plan_workflow_parameter_changes",
                "high" if comparison_status == "regressed" else "medium",
                [f"comparison_status={comparison_status}"],
            )
        )
        recommendations.append(
            _remediation_item(
                "prompt_skill_versions",
                "对比 Prompt/Skill 版本与 baseline",
                "最近复跑没有明确改善时，需要确认 Prompt、Skill、模型和模型参数版本是否偏离历史高质量 baseline。",
                f"/experiments?task_id={task_id}",
                "compare_prompt_skill_versions",
                "high" if comparison_status == "regressed" else "medium",
                [f"comparison_status={comparison_status}"],
            )
        )

    if cause_type == "data_quality" or diagnostics.get("data_quality", {}).get("warnings"):
        recommendations.append(
            _remediation_item(
                "dataset",
                "修复 Dataset 字段和样本质量",
                "数据诊断发现字段缺失、重复样本或字段覆盖不足，先处理数据版本再复跑。",
                f"/datasets?dataset_id={task.get('dataset_id')}&version={task.get('dataset_version')}",
                "fix_dataset_fields",
                "high",
                diagnostics.get("data_quality", {}).get("warnings", []),
            )
        )

    if cause_type == "weak_segment" or diagnostics.get("weak_segments"):
        weakest = (diagnostics.get("weak_segments") or [{}])[0]
        segment_label = f"{weakest.get('segment_key')}={weakest.get('segment_value')}" if weakest else "低通过率分层"
        recommendations.append(
            _remediation_item(
                "annotation",
                "低通过率分层修复建议",
                f"{segment_label} 仍需要抽样复核，优先进入 Annotation Queue 并沉淀 Golden 候选。",
                f"/annotation-queue?source_task_id={task_id}",
                "seed_annotation_queue",
                "high",
                [f"{segment_label} pass_rate={weakest.get('pass_rate')}"] if weakest else [],
            )
        )
        recommendations.append(
            _remediation_item(
                "prompt_skill_versions",
                "对比低通过率分层的 Prompt/Skill 版本",
                "低通过率分层可能来自 Prompt、Skill 或模型配置变更，先与同数据集 baseline 做版本差异对比，再决定回滚或晋升。",
                f"/experiments?task_id={task_id}&segment={segment_label}",
                "compare_prompt_skill_versions",
                "medium",
                [f"{segment_label} pass_rate={weakest.get('pass_rate')}"] if weakest else [],
            )
        )

    parameter_risks = diagnostics.get("parameter_risks", {})
    if cause_type == "parameter_risk" or parameter_risks.get("override_count") or parameter_risks.get("expression_count") or not recommendations:
        recommendations.append(
            _remediation_item(
                "workflow_parameters",
                "审查 Workflow 参数来源",
                "检查 schema_default、workflow_config、task_override、runtime_expression、secret_ref 的优先级是否符合本次评测目标。",
                f"/reports?task_id={task_id}&panel=parameter-governance",
                "plan_workflow_parameter_changes",
                "medium",
                parameter_risks.get("warnings", []),
            )
        )

    recommendations.append(
        _remediation_item(
            "retest",
            "完成修复后再次复跑对比",
            "完成上面的数据或参数修复后，再从当前修复任务触发复跑，确认通过率、错误率和 Badcase 是否改善。",
            f"/repair-tasks?source_task_id={task_id}",
            "retest_and_compare",
            "medium",
            [],
        )
    )
    return _dedupe_remediation_items(recommendations)


def _remediation_item(area: str, title: str, reason: str, target_url: str, action: str, priority: str, evidence: list[Any]) -> dict[str, Any]:
    return {
        "area": area,
        "title": title,
        "reason": reason,
        "target_url": target_url,
        "action": action,
        "priority": priority,
        "evidence": [str(item) for item in evidence if item],
    }


def _dedupe_remediation_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    result = []
    for item in items:
        key = (str(item.get("area")), str(item.get("title")))
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _locate_task_run_item_step(ctx: RouteContext, run_id: str, item_id: str, step_id: str) -> tuple[dict[str, Any], RunRecord, Any, Any]:
    run = ctx.runner.get_run(run_id)
    item = next((candidate for candidate in run.items if candidate.item_id == item_id), None)
    if item is None:
        raise AegisQAError("RUN_ITEM_NOT_FOUND", "Run Item 不存在。", status_code=404, details={"run_id": run_id, "item_id": item_id})
    step = next((candidate for candidate in item.steps if candidate.step_id == step_id), None)
    if step is None:
        raise AegisQAError("RUN_ITEM_STEP_NOT_FOUND", "Run Item Step 不存在。", status_code=404, details={"run_id": run_id, "item_id": item_id, "step_id": step_id})
    task = next((record for record in _list_records(ctx.store, "tasks") if record.get("run_id") == run_id), None)
    if task is None:
        task = {"task_id": None, "run_id": run_id, "name": None, "status": run.status}
    return task, run, item, step


def _step_debug_payload(task: dict[str, Any], run: RunRecord, item: Any, step: Any) -> dict[str, Any]:
    return {
        "task": {
            "task_id": task.get("task_id"),
            "name": task.get("name"),
            "status": task.get("status"),
        },
        "run": {
            "run_id": run.run_id,
            "status": run.status,
            "workflow_version_id": run.workflow.version_id,
            "dataset_id": run.dataset_id,
            "dataset_version": run.dataset_version,
        },
        "item": {
            "item_id": item.item_id,
            "row_id": item.row_id,
            "row_index": item.row_index,
            "status": item.status,
            "context_snapshot": item.context_snapshot,
            "metrics": item.metrics,
            "error": item.error,
        },
        "step": {
            "step_id": step.step_id,
            "skill_ref": step.skill_ref,
            "status": step.status,
            "input_hash": step.input_hash,
            "output_hash": step.output_hash,
            "cache_key": step.cache_key,
            "cache_hit": step.cache_hit,
            "called_skill": step.called_skill,
            "latency_ms": step.latency_ms,
            "metrics": step.metrics,
            "logs": step.logs,
            "error": step.error,
        },
    }


def _prompt_calls_from_step(step: Any) -> list[dict[str, Any]]:
    metrics = step.metrics if isinstance(step.metrics, dict) else {}
    prompt_calls = metrics.get("prompt_calls")
    if isinstance(prompt_calls, list):
        return [item for item in prompt_calls if isinstance(item, dict)]
    return []


def _rendered_prompt_from_step(step: Any, variables: dict[str, Any]) -> str:
    if isinstance(variables.get("prompt"), str):
        return str(variables["prompt"])
    inputs = step.input_snapshot if isinstance(step.input_snapshot, dict) else {}
    if isinstance(inputs.get("prompt"), str):
        return str(inputs["prompt"])
    if isinstance(inputs.get("messages"), list):
        return json_dumps(inputs["messages"])
    return json_dumps(inputs)


def _token_usage_from_step(step: Any) -> dict[str, Any]:
    metrics = step.metrics if isinstance(step.metrics, dict) else {}
    usage = {
        key: metrics.get(key)
        for key in ("prompt_tokens", "completion_tokens", "total_tokens", "cost", "cost_source", "model_provider", "model_name")
        if key in metrics
    }
    if usage:
        return usage
    prompt_calls = _prompt_calls_from_step(step)
    if prompt_calls and isinstance(prompt_calls[0].get("token_usage"), dict):
        return prompt_calls[0]["token_usage"]
    return {"status": "unavailable", "reason": "当前 Step 没有模型 token usage。"}


def _repair_action_link_target(repair_task: dict[str, Any], action: str) -> dict[str, Any]:
    task_id = str(repair_task.get("source_task_id"))
    link_map = {
        "open_trace_flow": f"/tasks/{task_id}/trace",
        "open_parameter_governance": f"/reports?task_id={task_id}&panel=parameter-governance",
        "open_dataset_lineage": f"/datasets?source_task_id={task_id}",
    }
    return {"status": "linked", "url": link_map[action], "source_task_id": task_id}


def _append_repair_task_action(
    ctx: RouteContext,
    repair_task: dict[str, Any],
    action: str,
    result: dict[str, Any],
    *,
    actor: str = "api",
    role: str | None = None,
) -> dict[str, Any]:
    # action_history 是修复闭环的审计骨架，只保存摘要，完整结果仍由对应业务表承载。
    action_time = _now()
    history = list(repair_task.get("action_history") or [])
    history.append(
        {
            "action": action,
            "status": result.get("status", "completed"),
            "result_summary": _repair_action_summary(action, result),
            "created_at": action_time,
        }
    )
    repair_task["action_history"] = history
    if action == "generate_remediation_plan":
        repair_task["remediation_plan"] = {"recommendations": result.get("recommendations", []), "updated_at": action_time}
    if action == "compare_prompt_skill_versions":
        repair_task["version_compare_plan"] = {**result, "updated_at": action_time}
    repair_task["last_action_result"] = {"action": action, "result": result, "created_at": action_time}
    repair_task["updated_at"] = action_time
    _save_record(ctx.store, "repair_tasks", "repair_task_id", repair_task)
    detail = {"status": result.get("status")}
    if role:
        detail["role"] = role
    ctx.audit_service.record(actor=actor, role=role, action=f"repair_task.action.{action}", target=repair_task["repair_task_id"], detail=detail)
    return repair_task


def _repair_action_summary(action: str, result: dict[str, Any]) -> str:
    if action == "seed_annotation_queue":
        return f"已创建 {result.get('created_count', 0)} 个审核样本。"
    if action == "evaluate_ci_gate":
        return f"CI Gate 复测结果：{result.get('status', 'unknown')}。"
    if action == "retest_and_compare":
        return f"复跑完成，质量状态 {result.get('comparison_status', 'unknown')}。"
    if action == "generate_remediation_plan":
        return f"已生成 {len(result.get('recommendations', []))} 条修复建议。"
    if action == "create_followup_repair_tasks":
        return f"已创建 {result.get('created_count', 0)} 个后续修复任务，复用 {result.get('reused_count', 0)} 个。"
    if action == "fix_dataset_fields":
        return f"已生成 {len(result.get('field_actions', []))} 条字段修复建议。"
    if action == "plan_workflow_parameter_changes":
        return f"已生成 {len(result.get('parameter_diffs', []))} 条参数 diff 和回滚建议。"
    if action == "compare_prompt_skill_versions":
        return f"已生成 {len(result.get('baseline_candidates', []))} 个 Prompt/Skill 版本对比候选。"
    if action == "create_prompt_skill_candidate":
        return f"已沉淀 {result.get('created_count', 0)} 个 Prompt/Skill 候选配置。"
    if action == "create_workflow_draft_from_version_diff":
        draft = result.get("draft") if isinstance(result.get("draft"), dict) else {}
        return f"已创建 Workflow 草稿：{draft.get('draft_id', 'unknown')}。"
    if result.get("url"):
        return f"已打开证据入口：{result['url']}"
    return "动作已记录。"


def _build_repair_task_record(task: dict[str, Any], cause: dict[str, Any]) -> dict[str, Any]:
    cause_type = str(cause.get("cause_type") or "unknown")
    severity = str(cause.get("severity") or "info")
    now = _now()
    return {
        "repair_task_id": f"repair-{uuid4().hex[:12]}",
        "source_task_id": task.get("task_id"),
        "source_run_id": task.get("run_id"),
        "cause_type": cause_type,
        "severity": severity,
        "title": _repair_task_title(cause_type, severity),
        "status": "open",
        "affected_items": int(cause.get("affected_items") or 0),
        "evidence": cause.get("evidence", []),
        "recommendation": cause.get("recommendation", ""),
        "next_actions": cause.get("next_actions", []),
        "action_history": [],
        "owner": None,
        "created_at": now,
        "updated_at": now,
    }


def _repair_task_title(cause_type: str, severity: str) -> str:
    titles = {
        "runtime_error": "修复运行时失败 Step",
        "data_quality": "修复数据字段与样本质量",
        "weak_segment": "复盘低通过率分层",
        "judge_or_answer_quality": "复核 Judge 或回答质量",
        "parameter_risk": "复核任务级参数覆盖",
        "prompt_skill_versions": "复核 Prompt/Skill 版本差异",
    }
    return f"[{severity}] {titles.get(cause_type, '复核诊断根因')}"
