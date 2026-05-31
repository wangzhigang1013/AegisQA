"""实验、质量门禁与人工审核队列路由。"""

from __future__ import annotations

from copy import deepcopy
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Query
from pydantic import BaseModel

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
    RedTeamScanRequest,
    _build_annotation_task,
    _build_ci_gate_config,
    _build_experiment_snapshot,
    _build_task_record,
    _build_red_team_scan,
    _build_score_analytics,
    _ci_gate_metrics_from_run,
    _ci_gate_metrics_from_task,
    _evaluate_assertion,
    _evaluate_gate,
    _find_task_by_run_id,
    _get_record,
    _get_workflow_draft,
    _list_records,
    _needs_annotation,
    _now,
    _refresh_task_from_run,
    _save_record,
    _save_workflow_draft,
)
from aegisqa.api.routes.context import RouteContext
from aegisqa.core.errors import AegisQAError
from aegisqa.engine.runner import RunRecord, RunRequest
from aegisqa.reports.aggregator import RunReport, aggregate_run_report, compare_reports


class PromptSkillCandidateReviewRequest(BaseModel):
    decision: str
    reviewer: str = "api"
    note: str = ""


def register_productization_routes(app: FastAPI, ctx: RouteContext) -> None:
    """注册围绕产品化闭环的独立功能接口。"""

    @app.post("/red-team/scans")
    def create_red_team_scan(request: RedTeamScanRequest) -> dict[str, Any]:
        if request.task_id and request.run_id:
            raise AegisQAError(
                "RED_TEAM_TARGET_CONFLICT",
                "一次红队扫描只能选择 Task 或 Run 中的一种目标。",
                status_code=400,
                details={"task_id": request.task_id, "run_id": request.run_id},
            )
        if not request.task_id and not request.run_id:
            raise AegisQAError(
                "RED_TEAM_TARGET_REQUIRED",
                "请先选择要扫描的 Task 或 Run。",
                status_code=400,
                details={"field": "task_id|run_id"},
            )
        task = _get_record(ctx.store, "tasks", request.task_id) if request.task_id else None
        run = ctx.runner.get_run(task["run_id"] if task else str(request.run_id))
        scan = _build_red_team_scan(task, run)
        _save_record(ctx.store, "red_team_scans", "scan_id", scan)
        ctx.audit_service.record(actor="api", action="red_team.scan", target=scan["scan_id"], detail={"target": scan["target"], "risk_count": scan["summary"]["risk_count"]})
        return scan

    @app.get("/score-analytics")
    def get_score_analytics() -> dict[str, Any]:
        return _build_score_analytics(_list_records(ctx.store, "tasks"), ctx.runner)

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

    @app.get("/prompt-skill-candidates")
    def list_prompt_skill_candidates(
        source_task_id: str | None = Query(default=None),
        status: str | None = Query(default=None),
        baseline_experiment_id: str | None = Query(default=None),
    ) -> list[dict[str, Any]]:
        candidates = _list_records(ctx.store, "prompt_skill_candidates")
        if source_task_id:
            candidates = [candidate for candidate in candidates if candidate.get("source_task_id") == source_task_id]
        if status:
            candidates = [candidate for candidate in candidates if candidate.get("status") == status]
        if baseline_experiment_id:
            candidates = [candidate for candidate in candidates if candidate.get("baseline_experiment_id") == baseline_experiment_id]
        return sorted(candidates, key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""), reverse=True)

    @app.post("/prompt-skill-candidates/{candidate_id}/review")
    def review_prompt_skill_candidate(candidate_id: str, request: PromptSkillCandidateReviewRequest) -> dict[str, Any]:
        candidate = _get_record(ctx.store, "prompt_skill_candidates", candidate_id)
        decision = request.decision.strip().lower()
        if decision not in {"approved", "rejected"}:
            raise AegisQAError(
                "PROMPT_SKILL_CANDIDATE_DECISION_INVALID",
                "候选配置审批结论只能是 approved 或 rejected。",
                status_code=400,
                details={"decision": request.decision},
            )
        reviewed_at = _now()
        review = {"decision": decision, "reviewer": request.reviewer, "note": request.note, "reviewed_at": reviewed_at}
        history = candidate.get("review_history") if isinstance(candidate.get("review_history"), list) else []
        history.append(review)
        candidate["status"] = decision
        candidate["review"] = review
        candidate["review_history"] = history
        candidate["updated_at"] = reviewed_at
        _save_record(ctx.store, "prompt_skill_candidates", "candidate_id", candidate)
        ctx.audit_service.record(actor=request.reviewer or "api", action="prompt_skill_candidate.review", target=candidate_id, detail={"decision": decision})
        return candidate

    @app.post("/prompt-skill-candidates/{candidate_id}/workflow-draft")
    def create_workflow_draft_from_prompt_skill_candidate(candidate_id: str) -> dict[str, Any]:
        candidate = _get_record(ctx.store, "prompt_skill_candidates", candidate_id)
        if candidate.get("workflow_draft_id"):
            draft = _get_workflow_draft(ctx.store, str(candidate["workflow_draft_id"]))
            return {"status": "draft_created", "candidate": candidate, "draft": draft, "target_url": f"/workflows/designer/{candidate['workflow_draft_id']}"}
        if candidate.get("status") != "approved":
            raise AegisQAError(
                "PROMPT_SKILL_CANDIDATE_NOT_APPROVED",
                "候选配置必须先审批通过，才能生成 Workflow 草稿。",
                status_code=400,
                details={"candidate_id": candidate_id, "status": candidate.get("status")},
            )
        run = ctx.runner.get_run(str(candidate.get("source_run_id") or candidate.get("baseline_run_id")))
        graph = _candidate_workflow_graph_snapshot(run.workflow)
        graph["name"] = f"{run.workflow.name}_candidate_{candidate_id[-6:]}"
        _apply_candidate_version_diffs(graph, [item for item in candidate.get("version_diffs", []) if isinstance(item, dict)])
        now = _now()
        draft = {
            "draft_id": f"draft-{uuid4().hex[:12]}",
            "name": graph["name"],
            "status": "draft",
            "graph": graph,
            "source_candidate_id": candidate_id,
            "source_repair_task_id": candidate.get("source_repair_task_id"),
            "source_task_id": candidate.get("source_task_id"),
            "baseline_experiment_id": candidate.get("baseline_experiment_id"),
            "version_diffs": candidate.get("version_diffs", []),
            "created_at": now,
            "updated_at": now,
        }
        _save_workflow_draft(ctx.store, draft)
        candidate["status"] = "draft_created"
        candidate["workflow_draft_id"] = draft["draft_id"]
        candidate["draft_created_at"] = now
        candidate["updated_at"] = now
        _save_record(ctx.store, "prompt_skill_candidates", "candidate_id", candidate)
        ctx.audit_service.record(actor="api", action="prompt_skill_candidate.create_workflow_draft", target=candidate_id, detail={"draft_id": draft["draft_id"]})
        return {"status": "draft_created", "candidate": candidate, "draft": draft, "target_url": f"/workflows/designer/{draft['draft_id']}"}

    @app.post("/prompt-skill-candidates/{candidate_id}/retest")
    def retest_prompt_skill_candidate(candidate_id: str) -> dict[str, Any]:
        candidate = _get_record(ctx.store, "prompt_skill_candidates", candidate_id)
        if candidate.get("retest_task_id"):
            return _prompt_skill_candidate_retest_payload(ctx, candidate)

        draft = _prompt_skill_candidate_published_draft(ctx, candidate)
        source_task_id = candidate.get("source_task_id")
        if not source_task_id:
            raise AegisQAError(
                "PROMPT_SKILL_CANDIDATE_SOURCE_TASK_MISSING",
                "候选资产缺少来源 Task，无法复用同一数据集进行候选复跑。",
                status_code=400,
                details={"candidate_id": candidate_id},
            )
        source_task = _get_record(ctx.store, "tasks", str(source_task_id))
        workflow = ctx.workflow_service.get(str(draft["published_version_id"]))
        dataset = ctx.dataset_service.get_version(str(source_task["dataset_id"]), int(source_task["dataset_version"]))
        execution_config = dict(source_task.get("execution_config") or {})
        run = ctx.runner.create_run(
            RunRequest(
                workflow=workflow,
                dataset_id=dataset.dataset_id,
                dataset_version=dataset.version,
                chunk_size=execution_config.get("chunk_size"),
                concurrency=execution_config.get("concurrency"),
                sample_repeat_times=execution_config.get("sample_repeat_times"),
                task_config_snapshot={
                    "evaluation_goal": source_task.get("evaluation_goal"),
                    "quality_gate": source_task.get("quality_gate", {}),
                    "skill_overrides": execution_config.get("skill_overrides", {}),
                    "candidate_id": candidate_id,
                },
            )
        )
        task = _build_task_record(
            f"{source_task.get('name', '候选复跑任务')} - 候选复跑",
            dataset.model_dump(mode="json"),
            workflow,
            run,
            execution_config={**execution_config, "candidate_id": candidate_id, "source_task_id": source_task_id},
            evaluation_goal=source_task.get("evaluation_goal"),
            quality_gate=source_task.get("quality_gate", {}),
            preflight_result=source_task.get("preflight_result"),
        )
        task["source_candidate_id"] = candidate_id
        task["baseline_task_id"] = source_task_id
        _save_record(ctx.store, "tasks", "task_id", task)
        executed_run = ctx.runner.execute_run(run.run_id)
        task = _refresh_task_from_run(ctx.store, task, executed_run)

        baseline_experiment = _prompt_skill_candidate_baseline_experiment(ctx, candidate)
        baseline_run = ctx.runner.get_run(str(baseline_experiment["run_id"])) if baseline_experiment else None
        current_run = ctx.runner.get_run(str(source_task["run_id"]))
        candidate_experiment = _build_experiment_snapshot(
            executed_run,
            name=f"候选复跑 {candidate_id}",
            baseline_run=baseline_run,
            tags=["prompt_skill_candidate", candidate_id],
        )
        _save_record(ctx.store, "experiments", "experiment_id", candidate_experiment)

        scorecard, comparisons = _prompt_skill_candidate_scorecard(
            baseline_experiment=baseline_experiment,
            baseline_run=baseline_run,
            current_task=source_task,
            current_run=current_run,
            candidate_task=task,
            candidate_run=executed_run,
        )
        promotion_recommendation = _prompt_skill_candidate_promotion_recommendation(
            scorecard=scorecard,
            comparisons=comparisons,
            source_task=source_task,
        )
        now = _now()
        candidate["status"] = "retested"
        candidate["retest_task_id"] = task["task_id"]
        candidate["candidate_run_id"] = executed_run.run_id
        candidate["candidate_experiment_id"] = candidate_experiment["experiment_id"]
        candidate["scorecard"] = scorecard
        candidate["comparisons"] = comparisons
        candidate["promotion_recommendation"] = promotion_recommendation
        candidate["retested_at"] = now
        candidate["updated_at"] = now
        _save_record(ctx.store, "prompt_skill_candidates", "candidate_id", candidate)
        ctx.audit_service.record(
            actor="api",
            action="prompt_skill_candidate.retest",
            target=candidate_id,
            detail={"task_id": task["task_id"], "run_id": executed_run.run_id, "candidate_experiment_id": candidate_experiment["experiment_id"]},
        )
        return {
            "status": "retested",
            "candidate": candidate,
            "task": task,
            "candidate_experiment": candidate_experiment,
            "scorecard": scorecard,
            "comparisons": comparisons,
            "promotion_recommendation": promotion_recommendation,
            "target_url": f"/reports?task_id={task['task_id']}",
        }

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


def _candidate_workflow_graph_snapshot(workflow: Any) -> dict[str, Any]:
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


def _apply_candidate_version_diffs(graph: dict[str, Any], version_diffs: list[dict[str, Any]]) -> None:
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


def _prompt_skill_candidate_published_draft(ctx: RouteContext, candidate: dict[str, Any]) -> dict[str, Any]:
    draft_id = candidate.get("workflow_draft_id")
    if not draft_id:
        raise AegisQAError(
            "PROMPT_SKILL_CANDIDATE_DRAFT_MISSING",
            "候选资产还没有生成 Workflow 草稿，请先审批并生成草稿。",
            status_code=400,
            details={"candidate_id": candidate.get("candidate_id")},
        )
    draft = _get_workflow_draft(ctx.store, str(draft_id))
    if draft.get("status") != "published" or not draft.get("published_version_id"):
        raise AegisQAError(
            "PROMPT_SKILL_CANDIDATE_DRAFT_NOT_PUBLISHED",
            "候选 Workflow 草稿需要先发布成版本，才能用同一数据集复跑并对比指标。",
            status_code=400,
            details={"candidate_id": candidate.get("candidate_id"), "draft_id": draft_id, "draft_status": draft.get("status")},
        )
    return draft


def _prompt_skill_candidate_baseline_experiment(ctx: RouteContext, candidate: dict[str, Any]) -> dict[str, Any] | None:
    experiment_id = candidate.get("baseline_experiment_id")
    if not experiment_id:
        return None
    return _get_record(ctx.store, "experiments", str(experiment_id))


def _prompt_skill_candidate_retest_payload(ctx: RouteContext, candidate: dict[str, Any]) -> dict[str, Any]:
    task = _get_record(ctx.store, "tasks", str(candidate["retest_task_id"]))
    candidate_run = ctx.runner.get_run(str(task["run_id"]))
    source_task = _get_record(ctx.store, "tasks", str(candidate["source_task_id"]))
    current_run = ctx.runner.get_run(str(source_task["run_id"]))
    baseline_experiment = _prompt_skill_candidate_baseline_experiment(ctx, candidate)
    baseline_run = ctx.runner.get_run(str(baseline_experiment["run_id"])) if baseline_experiment else None
    candidate_experiment = _get_record(ctx.store, "experiments", str(candidate["candidate_experiment_id"])) if candidate.get("candidate_experiment_id") else {}
    scorecard, comparisons = _prompt_skill_candidate_scorecard(
        baseline_experiment=baseline_experiment,
        baseline_run=baseline_run,
        current_task=source_task,
        current_run=current_run,
        candidate_task=task,
        candidate_run=candidate_run,
    )
    promotion_recommendation = candidate.get("promotion_recommendation") or _prompt_skill_candidate_promotion_recommendation(
        scorecard=scorecard,
        comparisons=comparisons,
        source_task=source_task,
    )
    return {
        "status": "retested",
        "candidate": candidate,
        "task": task,
        "candidate_experiment": candidate_experiment,
        "scorecard": scorecard,
        "comparisons": comparisons,
        "promotion_recommendation": promotion_recommendation,
        "target_url": f"/reports?task_id={task['task_id']}",
    }


def _prompt_skill_candidate_scorecard(
    *,
    baseline_experiment: dict[str, Any] | None,
    baseline_run: RunRecord | None,
    current_task: dict[str, Any],
    current_run: RunRecord,
    candidate_task: dict[str, Any],
    candidate_run: RunRecord,
) -> tuple[dict[str, Any], dict[str, Any]]:
    current_report = aggregate_run_report(current_run)
    candidate_report = aggregate_run_report(candidate_run)
    baseline_report = aggregate_run_report(baseline_run) if baseline_run else None
    scorecard = {
        "baseline": _prompt_skill_candidate_metric_card(
            "baseline",
            baseline_run,
            baseline_report,
            experiment_id=baseline_experiment.get("experiment_id") if baseline_experiment else None,
        ),
        "current": _prompt_skill_candidate_metric_card("current", current_run, current_report, task_id=current_task.get("task_id")),
        "candidate": _prompt_skill_candidate_metric_card("candidate", candidate_run, candidate_report, task_id=candidate_task.get("task_id")),
    }
    comparisons = {
        "current_to_candidate": compare_reports(current_report, candidate_report),
        "baseline_to_candidate": compare_reports(baseline_report, candidate_report) if baseline_report else None,
    }
    return scorecard, comparisons


def _prompt_skill_candidate_metric_card(
    label: str,
    run: RunRecord | None,
    report: RunReport | None,
    *,
    task_id: str | None = None,
    experiment_id: str | None = None,
) -> dict[str, Any]:
    if run is None or report is None:
        return {"label": label, "task_id": task_id, "experiment_id": experiment_id, "status": "missing"}
    return {
        "label": label,
        "task_id": task_id,
        "experiment_id": experiment_id,
        "run_id": run.run_id,
        "workflow_version_id": run.workflow.version_id,
        "dataset_id": run.dataset_id,
        "dataset_version": run.dataset_version,
        "status": run.status,
        "total_items": report.total_items,
        "completed_items": report.completed_items,
        "failed_items": report.failed_items,
        "pass_rate": report.pass_rate,
        "error_rate": report.error_rate,
        "badcase_count": len(report.badcases),
        "p95_latency_ms": report.p95_latency_ms,
    }


def _prompt_skill_candidate_promotion_recommendation(
    *,
    scorecard: dict[str, Any],
    comparisons: dict[str, Any],
    source_task: dict[str, Any],
) -> dict[str, Any]:
    """把候选复跑指标转换为可解释的版本晋升建议。"""

    quality_gate = source_task.get("quality_gate") if isinstance(source_task.get("quality_gate"), dict) else {}
    pass_rate_threshold = _optional_float(quality_gate.get("pass_rate") if isinstance(quality_gate, dict) else None)
    max_badcase_count = _optional_int(quality_gate.get("max_badcase_count") if isinstance(quality_gate, dict) else None)
    candidate = scorecard.get("candidate") if isinstance(scorecard.get("candidate"), dict) else {}
    current_delta = comparisons.get("current_to_candidate") if isinstance(comparisons.get("current_to_candidate"), dict) else {}
    baseline_delta = comparisons.get("baseline_to_candidate") if isinstance(comparisons.get("baseline_to_candidate"), dict) else None

    checks: list[dict[str, Any]] = [
        _promotion_pass_rate_check(candidate, pass_rate_threshold),
        _promotion_badcase_check(candidate, max_badcase_count),
        _promotion_current_delta_check(current_delta),
        _promotion_baseline_delta_check(baseline_delta),
    ]
    blocking_failed = any(check["status"] == "failed" for check in checks)
    has_warning = any(check["status"] == "warning" for check in checks)
    if blocking_failed:
        decision = "hold"
        summary = "暂不建议晋升：候选版本没有同时满足质量门槛和对比改善要求。"
        next_actions = [
            {"action": "open_candidate_report", "label": "查看候选任务报告"},
            {"action": "continue_repair", "label": "继续在修复任务中优化 Prompt/Skill"},
        ]
    elif has_warning:
        decision = "review"
        summary = "建议人工复核：候选版本达到硬性门槛，但改善幅度或 baseline 对比证据还不充分。"
        next_actions = [
            {"action": "inspect_candidate_report", "label": "复核候选任务报告"},
            {"action": "rerun_with_more_samples", "label": "扩大样本后再次复跑"},
        ]
    else:
        decision = "promote"
        summary = "建议晋升：候选版本已达到质量门槛，并且相对当前版本有明确改善。"
        next_actions = [
            {"action": "create_promotion_review", "label": "创建 Workflow 晋升审批"},
            {"action": "snapshot_candidate_as_baseline", "label": "将候选实验设为新 baseline"},
        ]
    return {
        "decision": decision,
        "summary": summary,
        "thresholds": {"pass_rate": pass_rate_threshold, "max_badcase_count": max_badcase_count},
        "checks": checks,
        "next_actions": next_actions,
    }


def _promotion_pass_rate_check(candidate: dict[str, Any], threshold: float | None) -> dict[str, Any]:
    pass_rate = _optional_float(candidate.get("pass_rate"))
    if threshold is None:
        return {"check_id": "pass_rate_gate", "status": "skipped", "message": "来源任务未设置通过率门槛。", "details": {"candidate_pass_rate": pass_rate}}
    if pass_rate is not None and pass_rate >= threshold:
        return {
            "check_id": "pass_rate_gate",
            "status": "passed",
            "message": f"候选通过率 {_format_percent(pass_rate)}，已达到 {_format_percent(threshold)} 门槛。",
            "details": {"candidate_pass_rate": pass_rate, "threshold": threshold},
        }
    return {
        "check_id": "pass_rate_gate",
        "status": "failed",
        "message": f"候选通过率 {_format_percent(pass_rate)}，低于 {_format_percent(threshold)} 门槛。",
        "details": {"candidate_pass_rate": pass_rate, "threshold": threshold},
    }


def _promotion_badcase_check(candidate: dict[str, Any], threshold: int | None) -> dict[str, Any]:
    badcase_count = _optional_int(candidate.get("badcase_count"))
    if threshold is None:
        return {"check_id": "badcase_gate", "status": "skipped", "message": "来源任务未设置 Badcase 数量门槛。", "details": {"candidate_badcase_count": badcase_count}}
    if badcase_count is not None and badcase_count <= threshold:
        return {
            "check_id": "badcase_gate",
            "status": "passed",
            "message": f"候选 Badcase {badcase_count} 条，未超过 {threshold} 条门槛。",
            "details": {"candidate_badcase_count": badcase_count, "threshold": threshold},
        }
    return {
        "check_id": "badcase_gate",
        "status": "failed",
        "message": f"候选 Badcase {badcase_count if badcase_count is not None else '-'} 条，超过 {threshold} 条门槛。",
        "details": {"candidate_badcase_count": badcase_count, "threshold": threshold},
    }


def _promotion_current_delta_check(current_delta: dict[str, Any]) -> dict[str, Any]:
    pass_rate_delta = _optional_float(current_delta.get("pass_rate_delta"))
    badcase_delta = _optional_int(current_delta.get("badcase_delta"))
    details = {"pass_rate_delta": pass_rate_delta, "badcase_delta": badcase_delta}
    if (pass_rate_delta is not None and pass_rate_delta < 0) or (badcase_delta is not None and badcase_delta > 0):
        return {"check_id": "current_improvement", "status": "failed", "message": "候选版本相对当前版本出现退化。", "details": details}
    if (pass_rate_delta is not None and pass_rate_delta > 0) or (badcase_delta is not None and badcase_delta < 0):
        return {
            "check_id": "current_improvement",
            "status": "passed",
            "message": f"相对当前版本通过率变化 {_format_signed_percent(pass_rate_delta)}，Badcase 变化 {badcase_delta if badcase_delta is not None else '-'} 条。",
            "details": details,
        }
    return {"check_id": "current_improvement", "status": "warning", "message": "候选版本相对当前版本没有明显改善。", "details": details}


def _promotion_baseline_delta_check(baseline_delta: dict[str, Any] | None) -> dict[str, Any]:
    if baseline_delta is None:
        return {"check_id": "baseline_regression", "status": "skipped", "message": "候选资产没有 baseline 实验，跳过 baseline 退化检查。", "details": {}}
    pass_rate_delta = _optional_float(baseline_delta.get("pass_rate_delta"))
    badcase_delta = _optional_int(baseline_delta.get("badcase_delta"))
    details = {"pass_rate_delta": pass_rate_delta, "badcase_delta": badcase_delta}
    if (pass_rate_delta is not None and pass_rate_delta < 0) or (badcase_delta is not None and badcase_delta > 0):
        return {"check_id": "baseline_regression", "status": "failed", "message": "候选版本相对 baseline 出现退化。", "details": details}
    return {"check_id": "baseline_regression", "status": "passed", "message": "候选版本未低于 baseline 指标。", "details": details}


def _optional_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _optional_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _format_percent(value: float | None) -> str:
    return "-" if value is None else f"{value * 100:.1f}%"


def _format_signed_percent(value: float | None) -> str:
    if value is None:
        return "-"
    sign = "+" if value >= 0 else ""
    return f"{sign}{value * 100:.1f}%"
