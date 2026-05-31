from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException

from aegisqa.api.app import (
    CIGateRuleRequest,
    RepairTaskActionRequest,
    RepairTaskReopenRequest,
    RepairTaskResolveRequest,
    RepairTaskStartRequest,
    _build_annotation_task,
    RunCreateRequest,
    TaskCreateRequest,
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
    _task_attempts,
)
from aegisqa.api.routes.context import RouteContext
from aegisqa.core.errors import AegisQAError
from aegisqa.engine.runner import RunRecord, RunRequest
from aegisqa.reports.aggregator import aggregate_run_report, build_report_recommendations, build_report_segments
from aegisqa.reports.diagnostics import build_task_diagnostics
from aegisqa.reports.trace_flow import build_task_trace_flow


def register_task_routes(app: FastAPI, ctx: RouteContext) -> None:
    @app.get("/tasks")
    def list_tasks() -> list[dict[str, Any]]:
        return _list_records(ctx.store, "tasks")

    @app.post("/tasks")
    def create_task(request: TaskCreateRequest) -> dict[str, Any]:
        workflow = ctx.workflow_service.get(request.workflow_version_id)
        dataset = ctx.dataset_service.get_version(request.dataset_id, request.dataset_version)
        preflight_result = request.preflight_result or _build_task_preflight(
            ctx,
            TaskPreflightRequest(
                dataset_id=request.dataset_id,
                dataset_version=request.dataset_version,
                workflow_version_id=request.workflow_version_id,
                evaluation_goal=request.evaluation_goal,
                quality_gate=request.quality_gate,
                cost_budget=request.cost_budget,
                sample_repeat_times=request.sample_repeat_times,
                skill_overrides=request.skill_overrides,
            ),
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
                    "quality_gate": request.quality_gate,
                    "skill_overrides": request.skill_overrides,
                },
            )
        )
        execution_config = {
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
        ctx.audit_service.record(actor="api", action="task.create", target=task["task_id"], detail={"run_id": run.run_id})
        return task

    @app.post("/tasks/preflight")
    def task_preflight(request: TaskPreflightRequest) -> dict[str, Any]:
        return _build_task_preflight(ctx, request)

    @app.get("/repair-tasks")
    def list_repair_tasks(source_task_id: str | None = None) -> list[dict[str, Any]]:
        records = _list_records(ctx.store, "repair_tasks")
        if source_task_id:
            records = [record for record in records if record.get("source_task_id") == source_task_id]
        return sorted(records, key=lambda item: str(item.get("created_at", "")), reverse=True)

    @app.post("/repair-tasks/{repair_task_id}/start")
    def start_repair_task(repair_task_id: str, request: RepairTaskStartRequest) -> dict[str, Any]:
        record = _transition_repair_task(
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
        )
        return record

    @app.post("/repair-tasks/{repair_task_id}/resolve")
    def resolve_repair_task(repair_task_id: str, request: RepairTaskResolveRequest) -> dict[str, Any]:
        record = _transition_repair_task(
            ctx,
            repair_task_id,
            allowed_statuses={"open", "in_progress"},
            updates={
                "status": "resolved",
                "resolution_note": request.resolution_note,
                "resolved_at": _now(),
                "updated_at": _now(),
            },
            audit_action="repair_task.resolve",
        )
        return record

    @app.post("/repair-tasks/{repair_task_id}/reopen")
    def reopen_repair_task(repair_task_id: str, request: RepairTaskReopenRequest) -> dict[str, Any]:
        record = _transition_repair_task(
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
        )
        return record

    @app.post("/repair-tasks/{repair_task_id}/actions")
    def run_repair_task_action(repair_task_id: str, request: RepairTaskActionRequest) -> dict[str, Any]:
        record = _get_record(ctx.store, "repair_tasks", repair_task_id)
        action = request.action
        if action == "seed_annotation_queue":
            result = _repair_action_seed_annotation_queue(ctx, record, request)
        elif action == "evaluate_ci_gate":
            result = _repair_action_evaluate_ci_gate(ctx, record)
        elif action in {"open_trace_flow", "open_parameter_governance", "open_dataset_lineage"}:
            result = _repair_action_link_target(record, action)
        else:
            raise AegisQAError(
                "REPAIR_TASK_ACTION_UNSUPPORTED",
                "当前修复任务动作暂不支持。",
                status_code=400,
                details={"action": action, "supported_actions": ["seed_annotation_queue", "evaluate_ci_gate", "open_trace_flow", "open_parameter_governance", "open_dataset_lineage"]},
            )
        updated_record = _append_repair_task_action(ctx, record, action, result)
        return {"action": action, "result": result, "repair_task": updated_record}

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
        parameter_governance = _build_parameter_governance(task, run)
        diagnostics = build_task_diagnostics(task, run, report, segments, parameter_governance)
        return {
            "task": task,
            "task_summary": _build_task_report_summary(task, run),
            "version_snapshot": _build_task_report_version_snapshot(task, run),
            "step_distribution": _build_step_distribution(run),
            "judge_score_distribution": _build_judge_score_distribution(run),
            "segments": [segment.model_dump(mode="json") for segment in segments],
            "recommendations": [recommendation.model_dump(mode="json") for recommendation in build_report_recommendations(segments)],
            "quality_decision": _build_quality_decision(task, run, report, segments),
            "parameter_governance": parameter_governance,
            "budget_status": _build_budget_status(task, report),
            "diagnostics": diagnostics,
            "report": report.model_dump(mode="json"),
            "badcases": [badcase.model_dump(mode="json") for badcase in report.badcases],
            "export_links": {
                "json": f"/runs/{task['run_id']}/report/export?file_format=json",
                "csv": f"/runs/{task['run_id']}/report/export?file_format=csv",
                "html": f"/runs/{task['run_id']}/report/export?file_format=html",
            },
        }

    @app.get("/tasks/{task_id}/diagnostics")
    def get_task_diagnostics(task_id: str) -> dict[str, Any]:
        task = _get_record(ctx.store, "tasks", task_id)
        run = ctx.runner.get_run(task["run_id"])
        report = aggregate_run_report(run)
        segments = build_report_segments(run)
        parameter_governance = _build_parameter_governance(task, run)
        return build_task_diagnostics(task, run, report, segments, parameter_governance)

    @app.post("/tasks/{task_id}/repair-tasks/from-diagnostics")
    def create_repair_tasks_from_diagnostics(task_id: str) -> dict[str, Any]:
        task = _get_record(ctx.store, "tasks", task_id)
        run = ctx.runner.get_run(task["run_id"])
        report = aggregate_run_report(run)
        segments = build_report_segments(run)
        parameter_governance = _build_parameter_governance(task, run)
        diagnostics = build_task_diagnostics(task, run, report, segments, parameter_governance)
        return _create_repair_tasks_from_diagnostics(ctx, task, diagnostics)

    @app.get("/tasks/{task_id}/parameter-governance")
    def get_task_parameter_governance(task_id: str) -> dict[str, Any]:
        task = _get_record(ctx.store, "tasks", task_id)
        run = ctx.runner.get_run(task["run_id"])
        return _build_parameter_governance(task, run)

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
        "evaluation_goal": request.evaluation_goal,
        "quality_gate": request.quality_gate,
        "checks": checks,
        "created_at": _now(),
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
            if not isinstance(source, str) or not source.startswith("row."):
                continue
            field = source.removeprefix("row.").split(".")[0]
            if field:
                fields.add(field)
    return fields


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


def _transition_repair_task(
    ctx: RouteContext,
    repair_task_id: str,
    *,
    allowed_statuses: set[str],
    updates: dict[str, Any],
    audit_action: str,
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
    ctx.audit_service.record(actor="api", action=audit_action, target=repair_task_id, detail={"status": record.get("status")})
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


def _repair_action_link_target(repair_task: dict[str, Any], action: str) -> dict[str, Any]:
    task_id = str(repair_task.get("source_task_id"))
    link_map = {
        "open_trace_flow": f"/tasks/{task_id}/trace",
        "open_parameter_governance": f"/reports?task_id={task_id}&panel=parameter-governance",
        "open_dataset_lineage": f"/datasets?source_task_id={task_id}",
    }
    return {"status": "linked", "url": link_map[action], "source_task_id": task_id}


def _append_repair_task_action(ctx: RouteContext, repair_task: dict[str, Any], action: str, result: dict[str, Any]) -> dict[str, Any]:
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
    repair_task["last_action_result"] = {"action": action, "result": result, "created_at": action_time}
    repair_task["updated_at"] = action_time
    _save_record(ctx.store, "repair_tasks", "repair_task_id", repair_task)
    ctx.audit_service.record(actor="api", action=f"repair_task.action.{action}", target=repair_task["repair_task_id"], detail={"status": result.get("status")})
    return repair_task


def _repair_action_summary(action: str, result: dict[str, Any]) -> str:
    if action == "seed_annotation_queue":
        return f"已创建 {result.get('created_count', 0)} 个审核样本。"
    if action == "evaluate_ci_gate":
        return f"CI Gate 复测结果：{result.get('status', 'unknown')}。"
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
    }
    return f"[{severity}] {titles.get(cause_type, '复核诊断根因')}"
