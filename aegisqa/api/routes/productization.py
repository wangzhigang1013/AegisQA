"""实验、质量门禁与人工审核队列路由。"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Query

from aegisqa.api.app import (
    AnnotationAssignRequest,
    AnnotationBulkReviewRequest,
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
    def list_experiments(
        dataset_id: str | None = Query(default=None),
        workflow_id: str | None = Query(default=None),
    ) -> list[dict[str, Any]]:
        experiments = _list_records(ctx.store, "experiments")
        if dataset_id:
            experiments = [experiment for experiment in experiments if experiment.get("dataset_id") == dataset_id]
        if workflow_id:
            experiments = [experiment for experiment in experiments if experiment.get("workflow_id") == workflow_id]
        return experiments

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
        evaluation = {
            "evaluation_id": f"gateeval-{uuid4().hex[:12]}",
            "config_id": request.config_id,
            "status": "blocked" if blocking_failures else "passed",
            "blocking_failures": len(blocking_failures),
            "target": target,
            "metrics": metrics,
            "results": results,
            "created_at": _now(),
        }
        _save_record(ctx.store, "ci_gate_evaluations", "evaluation_id", evaluation)
        ctx.audit_service.record(actor="api", action="ci_gate.evaluate", target=evaluation["evaluation_id"], detail={"status": evaluation["status"], "config_id": request.config_id, "target": target})
        return evaluation

    @app.get("/ci-gates/evaluations")
    def list_ci_gate_evaluations(
        config_id: str | None = Query(default=None),
        task_id: str | None = Query(default=None),
        run_id: str | None = Query(default=None),
    ) -> list[dict[str, Any]]:
        evaluations = _list_records(ctx.store, "ci_gate_evaluations")
        if config_id:
            evaluations = [item for item in evaluations if item.get("config_id") == config_id]
        if task_id:
            evaluations = [item for item in evaluations if item.get("target") == {"kind": "task", "id": task_id}]
        if run_id:
            evaluations = [item for item in evaluations if item.get("target") == {"kind": "run", "id": run_id}]
        return evaluations

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
        task, _ = _review_annotation_task(ctx, task_id, request, reviewer="api")
        ctx.audit_service.record(actor="api", action="annotation_task.review", target=task_id, detail={"add_to_golden": request.add_to_golden})
        return task

    @app.post("/annotation-queue/bulk-review")
    def bulk_review_annotation_tasks(request: AnnotationBulkReviewRequest) -> dict[str, Any]:
        if not request.task_ids:
            raise AegisQAError(
                "ANNOTATION_TASK_IDS_REQUIRED",
                "批量审核至少需要选择一个样本。",
                status_code=400,
                details={"field": "task_ids"},
            )
        reviewed_tasks: list[dict[str, Any]] = []
        candidates: list[dict[str, Any]] = []
        review_request = AnnotationReviewRequest(human_label=request.human_label, note=request.note, add_to_golden=request.add_to_golden)
        for task_id in request.task_ids:
            task, task_candidates = _review_annotation_task(ctx, task_id, review_request, reviewer="api")
            reviewed_tasks.append(task)
            candidates.extend(task_candidates)
        summary = {
            "golden": sum(1 for candidate in candidates if candidate["kind"] == "golden"),
            "assertion": sum(1 for candidate in candidates if candidate["kind"] == "assertion"),
        }
        ctx.audit_service.record(actor="api", action="annotation_task.bulk_review", target="annotation_queue", detail={"reviewed_count": len(reviewed_tasks), "candidate_summary": summary})
        return {"reviewed_count": len(reviewed_tasks), "tasks": reviewed_tasks, "candidate_summary": summary, "candidates": candidates}

    @app.get("/annotation-candidates")
    def list_annotation_candidates(
        source_task_id: str | None = Query(default=None),
        kind: str | None = Query(default=None),
    ) -> list[dict[str, Any]]:
        candidates = _list_records(ctx.store, "annotation_candidates")
        if source_task_id:
            candidates = [candidate for candidate in candidates if candidate.get("source_task_id") == source_task_id]
        if kind:
            candidates = [candidate for candidate in candidates if candidate.get("kind") == kind]
        return candidates


def _review_annotation_task(ctx: RouteContext, task_id: str, request: AnnotationReviewRequest, *, reviewer: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    task = _get_record(ctx.store, "annotation_tasks", task_id)
    reviewed_at = _now()
    review = {
        "human_label": request.human_label,
        "note": request.note,
        "add_to_golden": request.add_to_golden,
        "reviewer": reviewer,
        "reviewed_at": reviewed_at,
    }
    candidates = _create_annotation_candidates(ctx, task, review) if request.add_to_golden else []
    task["status"] = "reviewed"
    task["review"] = review
    task["review_assets"] = [{"candidate_id": candidate["candidate_id"], "kind": candidate["kind"]} for candidate in candidates]
    task["updated_at"] = reviewed_at
    _save_record(ctx.store, "annotation_tasks", "task_id", task)
    return task, candidates


def _create_annotation_candidates(ctx: RouteContext, task: dict[str, Any], review: dict[str, Any]) -> list[dict[str, Any]]:
    existing = {
        candidate.get("kind"): candidate
        for candidate in _list_records(ctx.store, "annotation_candidates")
        if candidate.get("annotation_task_id") == task.get("task_id")
    }
    candidates: list[dict[str, Any]] = []
    for kind in ("golden", "assertion"):
        candidate = existing.get(kind) or _build_annotation_candidate(task, review, kind=kind)
        candidate["human_label"] = review["human_label"]
        candidate["note"] = review["note"]
        candidate["reviewer"] = review["reviewer"]
        candidate["updated_at"] = _now()
        _save_record(ctx.store, "annotation_candidates", "candidate_id", candidate)
        candidates.append(candidate)
    return candidates


def _build_annotation_candidate(task: dict[str, Any], review: dict[str, Any], *, kind: str) -> dict[str, Any]:
    return {
        "candidate_id": f"candidate-{uuid4().hex[:12]}",
        "kind": kind,
        "source": "annotation_queue",
        "annotation_task_id": task["task_id"],
        "source_task_id": task.get("source_task_id"),
        "source_task_name": task.get("source_task_name"),
        "run_id": task.get("run_id"),
        "item_id": task.get("item_id"),
        "row_id": task.get("row_id"),
        "human_label": review["human_label"],
        "note": review["note"],
        "reviewer": review["reviewer"],
        "payload": task.get("payload", {}),
        "status": "candidate",
        "assertion_seed": _build_assertion_seed(task, review) if kind == "assertion" else None,
        "created_at": _now(),
        "updated_at": _now(),
    }


def _build_assertion_seed(task: dict[str, Any], review: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "human_label",
        "field_path": "context_snapshot.context.judge_label",
        "expected": review["human_label"],
        "source_item_id": task.get("item_id"),
    }
