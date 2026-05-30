"""实验、质量门禁与人工审核队列路由。"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Query

from aegisqa.api.app import (
    AnnotationAssignRequest,
    AnnotationReviewRequest,
    AnnotationSeedRequest,
    AssertionEvaluateRequest,
    CIGateConfigRequest,
    CIGateEvaluateRequest,
    CIGateRuleRequest,
    ExperimentFromRunRequest,
    _build_annotation_task,
    _build_ci_gate_config,
    _build_experiment_snapshot,
    _ci_gate_metrics_from_run,
    _ci_gate_metrics_from_task,
    _evaluate_assertion,
    _evaluate_gate,
    _find_task_by_run_id,
    _get_record,
    _list_records,
    _needs_annotation,
    _now,
    _save_record,
)
from aegisqa.api.routes.context import RouteContext
from aegisqa.core.errors import AegisQAError


def register_productization_routes(app: FastAPI, ctx: RouteContext) -> None:
    """注册围绕产品化闭环的独立功能接口。"""

    @app.post("/experiments/from-run")
    def create_experiment_from_run(request: ExperimentFromRunRequest) -> dict[str, Any]:
        run = ctx.runner.get_run(request.run_id)
        baseline_run = ctx.runner.get_run(request.baseline_run_id) if request.baseline_run_id else None
        experiment = _build_experiment_snapshot(run, name=request.name, baseline_run=baseline_run, tags=request.tags)
        _save_record(ctx.store, "experiments", "experiment_id", experiment)
        ctx.audit_service.record(actor="api", action="experiment.create", target=experiment["experiment_id"], detail={"run_id": run.run_id})
        return experiment

    @app.get("/experiments")
    def list_experiments() -> list[dict[str, Any]]:
        return _list_records(ctx.store, "experiments")

    @app.post("/assertions/evaluate")
    def evaluate_assertions(request: AssertionEvaluateRequest) -> dict[str, Any]:
        results = [_evaluate_assertion(request.payload, assertion) for assertion in request.assertions]
        return {
            "ok": all(item["status"] == "passed" for item in results),
            "summary": {"passed": sum(1 for item in results if item["status"] == "passed"), "failed": sum(1 for item in results if item["status"] == "failed")},
            "results": results,
        }

    @app.post("/ci-gates")
    def create_ci_gate_config(request: CIGateConfigRequest) -> dict[str, Any]:
        if not request.gates:
            raise AegisQAError(
                "CI_GATE_EMPTY",
                "质量门禁至少需要一条规则。",
                status_code=400,
                details={"field": "gates"},
            )
        config = _build_ci_gate_config(request)
        _save_record(ctx.store, "ci_gate_configs", "config_id", config)
        ctx.audit_service.record(actor="api", action="ci_gate.create", target=config["config_id"], detail={"gate_count": len(config["gates"])})
        return config

    @app.get("/ci-gates")
    def list_ci_gate_configs() -> list[dict[str, Any]]:
        return _list_records(ctx.store, "ci_gate_configs")

    @app.post("/ci-gates/evaluate")
    def evaluate_ci_gates(request: CIGateEvaluateRequest) -> dict[str, Any]:
        gates = list(request.gates)
        if request.config_id:
            config = _get_record(ctx.store, "ci_gate_configs", request.config_id)
            if not gates:
                gates = [CIGateRuleRequest.model_validate(gate) for gate in config.get("gates", [])]
        if not gates:
            raise AegisQAError(
                "CI_GATE_RULES_REQUIRED",
                "请先选择或创建质量门禁规则。",
                status_code=400,
                details={"config_id": request.config_id},
            )

        metrics = dict(request.metrics)
        target: dict[str, str] | None = None
        if request.run_id and request.task_id:
            raise AegisQAError(
                "CI_GATE_TARGET_CONFLICT",
                "一次质量门禁评估只能选择 Run 或 Task 中的一种目标。",
                status_code=400,
                details={"run_id": request.run_id, "task_id": request.task_id},
            )
        if request.run_id:
            run = ctx.runner.get_run(request.run_id)
            metrics = _ci_gate_metrics_from_run(run) | metrics
            target = {"kind": "run", "id": request.run_id}
        if request.task_id:
            task = _get_record(ctx.store, "tasks", request.task_id)
            run = ctx.runner.get_run(task["run_id"])
            # Task 是产品入口，Run 是底层执行实例；这里用 Run Report 指标并补充 Task 聚合字段。
            metrics = _ci_gate_metrics_from_task(task, run) | metrics
            target = {"kind": "task", "id": request.task_id}
        results = [_evaluate_gate(metrics, gate) for gate in gates]
        blocking_failures = [item for item in results if item["status"] == "failed" and item["blocking"]]
        return {
            "status": "blocked" if blocking_failures else "passed",
            "blocking_failures": len(blocking_failures),
            "target": target,
            "metrics": metrics,
            "results": results,
        }

    @app.post("/annotation-queue/seed-from-run")
    def seed_annotation_queue(request: AnnotationSeedRequest) -> dict[str, Any]:
        run = ctx.runner.get_run(request.run_id)
        source_task = _find_task_by_run_id(ctx.store, run.run_id)
        created: list[dict[str, Any]] = []
        existing = {task.get("item_id") for task in _list_records(ctx.store, "annotation_tasks") if task.get("run_id") == run.run_id}
        for item in run.items:
            if len(created) >= request.limit:
                break
            if item.item_id in existing or not _needs_annotation(item.model_dump(mode="json"), strategy=request.strategy):
                continue
            task = _build_annotation_task(run.run_id, item.model_dump(mode="json"), assignee=request.assignee, source_task=source_task)
            _save_record(ctx.store, "annotation_tasks", "task_id", task)
            created.append(task)
        ctx.audit_service.record(actor="api", action="annotation_queue.seed", target=run.run_id, detail={"created_count": len(created)})
        return {"run_id": run.run_id, "created_count": len(created), "tasks": created}

    @app.get("/annotation-queue")
    def list_annotation_queue(
        status: str | None = None,
        assignee: str | None = None,
        source_task_id: str | None = Query(default=None),
    ) -> list[dict[str, Any]]:
        tasks = _list_records(ctx.store, "annotation_tasks")
        if status:
            tasks = [task for task in tasks if task.get("status") == status]
        if assignee:
            tasks = [task for task in tasks if task.get("assignee") == assignee]
        if source_task_id:
            tasks = [task for task in tasks if task.get("source_task_id") == source_task_id]
        return tasks

    @app.post("/annotation-queue/{task_id}/assign")
    def assign_annotation_task(task_id: str, request: AnnotationAssignRequest) -> dict[str, Any]:
        task = _get_record(ctx.store, "annotation_tasks", task_id)
        task["assignee"] = request.assignee
        task["status"] = "assigned"
        task["updated_at"] = _now()
        _save_record(ctx.store, "annotation_tasks", "task_id", task)
        ctx.audit_service.record(actor="api", action="annotation_task.assign", target=task_id, detail={"assignee": request.assignee})
        return task

    @app.post("/annotation-queue/{task_id}/review")
    def review_annotation_task(task_id: str, request: AnnotationReviewRequest) -> dict[str, Any]:
        task = _get_record(ctx.store, "annotation_tasks", task_id)
        task["status"] = "reviewed"
        task["review"] = {"human_label": request.human_label, "note": request.note, "add_to_golden": request.add_to_golden, "reviewed_at": _now()}
        task["updated_at"] = _now()
        _save_record(ctx.store, "annotation_tasks", "task_id", task)
        ctx.audit_service.record(actor="api", action="annotation_task.review", target=task_id, detail={"add_to_golden": request.add_to_golden})
        return task
