"""实验、质量门禁与人工审核队列路由。"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
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


class PromptSkillCandidateBulkReviewRequest(BaseModel):
    candidate_ids: list[str]
    decision: str
    reviewer: str = "api"
    note: str = ""


class PromptSkillCandidateBulkRetestRequest(BaseModel):
    candidate_ids: list[str] | None = None
    max_count: int = 10
    actor: str = "api"


class PromptSkillCandidateBulkAssignRequest(BaseModel):
    candidate_ids: list[str]
    owner: str
    due_at: str | None = None
    actor: str = "api"
    max_open_per_owner: int | None = None


class PromptSkillCandidateEscalateRequest(BaseModel):
    actor: str = "api"
    now: str | None = None


class WorkflowPromotionReviewRequest(BaseModel):
    requester: str = "api"
    note: str = ""


class WorkflowPromotionReviewDecisionRequest(BaseModel):
    reviewer: str = "api"
    note: str = ""


class ExperimentBaselineActionRequest(BaseModel):
    actor: str = "api"
    note: str = ""
    force: bool = False


class BaselineChangeNotificationAckRequest(BaseModel):
    actor: str = "api"
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
        candidates = [_with_candidate_sla_status(candidate, now=_now()) for candidate in _list_records(ctx.store, "prompt_skill_candidates")]
        if source_task_id:
            candidates = [candidate for candidate in candidates if candidate.get("source_task_id") == source_task_id]
        if status:
            candidates = [candidate for candidate in candidates if candidate.get("status") == status]
        if baseline_experiment_id:
            candidates = [candidate for candidate in candidates if candidate.get("baseline_experiment_id") == baseline_experiment_id]
        return sorted(candidates, key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""), reverse=True)

    @app.get("/prompt-skill-candidates/workload")
    def get_prompt_skill_candidate_workload() -> dict[str, Any]:
        return _build_prompt_skill_candidate_workload(ctx, now=_now())

    @app.get("/prompt-skill-candidates/retest-plan")
    def get_prompt_skill_candidate_retest_plan(status: str | None = Query(default=None)) -> dict[str, Any]:
        return _build_prompt_skill_candidate_retest_plan(ctx, status=status, now=_now())

    @app.post("/prompt-skill-candidates/bulk-assign")
    def bulk_assign_prompt_skill_candidates(request: PromptSkillCandidateBulkAssignRequest) -> dict[str, Any]:
        return _bulk_assign_prompt_skill_candidates(ctx, request)

    @app.post("/prompt-skill-candidates/bulk-review")
    def bulk_review_prompt_skill_candidates(request: PromptSkillCandidateBulkReviewRequest) -> dict[str, Any]:
        return _bulk_review_prompt_skill_candidates(ctx, request)

    @app.post("/prompt-skill-candidates/bulk-retest")
    def bulk_retest_prompt_skill_candidates(request: PromptSkillCandidateBulkRetestRequest) -> dict[str, Any]:
        return _bulk_retest_prompt_skill_candidates(ctx, request)

    @app.post("/prompt-skill-candidates/escalate-overdue")
    def escalate_overdue_prompt_skill_candidates(request: PromptSkillCandidateEscalateRequest) -> dict[str, Any]:
        return _escalate_overdue_prompt_skill_candidates(ctx, request)

    @app.get("/workflow-promotion-reviews")
    def list_workflow_promotion_reviews(
        candidate_id: str | None = Query(default=None),
        status: str | None = Query(default=None),
    ) -> list[dict[str, Any]]:
        reviews = _list_records(ctx.store, "workflow_promotion_reviews")
        if candidate_id:
            reviews = [review for review in reviews if review.get("candidate_id") == candidate_id]
        if status:
            reviews = [review for review in reviews if review.get("status") == status]
        return sorted(reviews, key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""), reverse=True)

    @app.get("/experiment-baseline-suggestions")
    def list_experiment_baseline_suggestions(
        candidate_id: str | None = Query(default=None),
        review_id: str | None = Query(default=None),
        status: str | None = Query(default=None),
    ) -> list[dict[str, Any]]:
        suggestions = _list_records(ctx.store, "experiment_baseline_suggestions")
        if candidate_id:
            suggestions = [suggestion for suggestion in suggestions if suggestion.get("candidate_id") == candidate_id]
        if review_id:
            suggestions = [suggestion for suggestion in suggestions if suggestion.get("review_id") == review_id]
        if status:
            suggestions = [suggestion for suggestion in suggestions if suggestion.get("status") == status]
        return sorted(suggestions, key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""), reverse=True)

    @app.get("/experiment-baselines")
    def list_experiment_baselines(
        dataset_id: str | None = Query(default=None),
        workflow_id: str | None = Query(default=None),
    ) -> list[dict[str, Any]]:
        baselines = _list_records(ctx.store, "experiment_baselines")
        if dataset_id:
            baselines = [baseline for baseline in baselines if baseline.get("scope", {}).get("dataset_id") == dataset_id]
        if workflow_id:
            baselines = [baseline for baseline in baselines if baseline.get("scope", {}).get("workflow_id") == workflow_id]
        return sorted(baselines, key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""), reverse=True)

    @app.get("/experiment-baseline-suggestions/{suggestion_id}/impact")
    def get_experiment_baseline_suggestion_impact(suggestion_id: str) -> dict[str, Any]:
        return _build_experiment_baseline_impact(ctx, suggestion_id)

    @app.post("/experiment-baseline-suggestions/{suggestion_id}/apply")
    def apply_experiment_baseline_suggestion(suggestion_id: str, request: ExperimentBaselineActionRequest) -> dict[str, Any]:
        return _apply_experiment_baseline_suggestion(ctx, suggestion_id, request)

    @app.post("/experiment-baseline-suggestions/{suggestion_id}/rollback")
    def rollback_experiment_baseline_suggestion(suggestion_id: str, request: ExperimentBaselineActionRequest) -> dict[str, Any]:
        return _rollback_experiment_baseline_suggestion(ctx, suggestion_id, request)

    @app.get("/baseline-change-notifications")
    def list_baseline_change_notifications(
        suggestion_id: str | None = Query(default=None),
        baseline_id: str | None = Query(default=None),
        workflow_id: str | None = Query(default=None),
        status: str | None = Query(default=None),
    ) -> list[dict[str, Any]]:
        return _list_baseline_change_notifications(ctx, suggestion_id=suggestion_id, baseline_id=baseline_id, workflow_id=workflow_id, status=status)

    @app.post("/baseline-change-notifications/{notification_id}/ack")
    def acknowledge_baseline_change_notification(notification_id: str, request: BaselineChangeNotificationAckRequest) -> dict[str, Any]:
        notification = _get_record(ctx.store, "baseline_change_notifications", notification_id)
        if notification.get("status") != "acknowledged":
            now = _now()
            notification["status"] = "acknowledged"
            notification["acknowledged_by"] = request.actor
            notification["acknowledged_at"] = now
            notification["ack_note"] = request.note
            notification["updated_at"] = now
            _save_record(ctx.store, "baseline_change_notifications", "notification_id", notification)
            ctx.audit_service.record(actor=request.actor, action="baseline_change_notification.ack", target=notification_id, detail={"suggestion_id": notification.get("suggestion_id")})
        return notification

    @app.get("/workflow-release-records")
    def list_workflow_release_records(
        candidate_id: str | None = Query(default=None),
        review_id: str | None = Query(default=None),
        status: str | None = Query(default=None),
    ) -> list[dict[str, Any]]:
        records = _list_records(ctx.store, "workflow_release_records")
        if candidate_id:
            records = [record for record in records if record.get("candidate_id") == candidate_id]
        if review_id:
            records = [record for record in records if record.get("review_id") == review_id]
        if status:
            records = [record for record in records if record.get("status") == status]
        return sorted(records, key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""), reverse=True)

    @app.post("/prompt-skill-candidates/{candidate_id}/review")
    def review_prompt_skill_candidate(candidate_id: str, request: PromptSkillCandidateReviewRequest) -> dict[str, Any]:
        candidate = _get_record(ctx.store, "prompt_skill_candidates", candidate_id)
        candidate = _review_prompt_skill_candidate_record(candidate, decision=request.decision, reviewer=request.reviewer, note=request.note, now=_now())
        _save_record(ctx.store, "prompt_skill_candidates", "candidate_id", candidate)
        ctx.audit_service.record(actor=request.reviewer or "api", action="prompt_skill_candidate.review", target=candidate_id, detail={"decision": candidate.get("status")})
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

        return _execute_prompt_skill_candidate_retest(ctx, candidate, actor="api", history_action="retest")

    @app.post("/prompt-skill-candidates/{candidate_id}/promotion-review")
    def create_workflow_promotion_review(candidate_id: str, request: WorkflowPromotionReviewRequest | None = None) -> dict[str, Any]:
        candidate = _get_record(ctx.store, "prompt_skill_candidates", candidate_id)
        if candidate.get("promotion_review_id"):
            review = _get_record(ctx.store, "workflow_promotion_reviews", str(candidate["promotion_review_id"]))
            return {"status": review["status"], "candidate": candidate, "review": review, "target_url": review.get("target_url")}

        recommendation = candidate.get("promotion_recommendation") if isinstance(candidate.get("promotion_recommendation"), dict) else None
        if not recommendation:
            raise AegisQAError(
                "PROMPT_SKILL_CANDIDATE_PROMOTION_MISSING",
                "候选资产还没有晋升建议，请先完成候选复跑。",
                status_code=400,
                details={"candidate_id": candidate_id},
            )
        if recommendation.get("decision") not in {"promote", "review"}:
            raise AegisQAError(
                "PROMPT_SKILL_CANDIDATE_PROMOTION_NOT_RECOMMENDED",
                "当前候选资产暂不建议晋升，请先继续修复或扩大样本复跑。",
                status_code=400,
                details={"candidate_id": candidate_id, "decision": recommendation.get("decision")},
            )

        request = request or WorkflowPromotionReviewRequest()
        review = _build_workflow_promotion_review(candidate, request)
        candidate["status"] = "promotion_review_pending"
        candidate["promotion_review_id"] = review["review_id"]
        candidate["updated_at"] = review["updated_at"]
        _save_record(ctx.store, "workflow_promotion_reviews", "review_id", review)
        _save_record(ctx.store, "prompt_skill_candidates", "candidate_id", candidate)
        ctx.audit_service.record(
            actor=request.requester or "api",
            action="workflow_promotion_review.create",
            target=review["review_id"],
            detail={"candidate_id": candidate_id, "workflow_version_id": review.get("candidate_workflow_version_id")},
        )
        return {"status": review["status"], "candidate": candidate, "review": review, "target_url": review["target_url"]}

    @app.post("/workflow-promotion-reviews/{review_id}/approve")
    def approve_workflow_promotion_review(review_id: str, request: WorkflowPromotionReviewDecisionRequest) -> dict[str, Any]:
        return _decide_workflow_promotion_review(ctx, review_id, decision="approved", request=request)

    @app.post("/workflow-promotion-reviews/{review_id}/reject")
    def reject_workflow_promotion_review(review_id: str, request: WorkflowPromotionReviewDecisionRequest) -> dict[str, Any]:
        return _decide_workflow_promotion_review(ctx, review_id, decision="rejected", request=request)

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


def _review_prompt_skill_candidate_record(
    candidate: dict[str, Any],
    *,
    decision: str,
    reviewer: str,
    note: str,
    now: str,
) -> dict[str, Any]:
    normalized = decision.strip().lower()
    if normalized not in {"approved", "rejected"}:
        raise AegisQAError(
            "PROMPT_SKILL_CANDIDATE_DECISION_INVALID",
            "候选配置审批结论只能是 approved 或 rejected。",
            status_code=400,
            details={"decision": decision},
        )
    review = {"decision": normalized, "reviewer": reviewer, "note": note, "reviewed_at": now}
    history = candidate.get("review_history") if isinstance(candidate.get("review_history"), list) else []
    history.append(review)
    candidate["status"] = normalized
    candidate["review"] = review
    candidate["review_history"] = history
    candidate["updated_at"] = now
    _append_candidate_action(candidate, action="bulk_review" if candidate.get("_bulk_reviewing") else "review", actor=reviewer, note=note, now=now, extra={"decision": normalized})
    candidate.pop("_bulk_reviewing", None)
    return _with_candidate_sla_status(candidate, now=now)


def _bulk_review_prompt_skill_candidates(ctx: RouteContext, request: PromptSkillCandidateBulkReviewRequest) -> dict[str, Any]:
    if not request.candidate_ids:
        raise AegisQAError("PROMPT_SKILL_CANDIDATE_IDS_REQUIRED", "请至少选择一个候选资产。", status_code=400)
    now = _now()
    reviewed: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for candidate_id in request.candidate_ids:
        try:
            candidate = _get_record(ctx.store, "prompt_skill_candidates", candidate_id)
        except KeyError:
            skipped.append({"candidate_id": candidate_id, "reason": "not_found"})
            continue
        candidate["_bulk_reviewing"] = True
        candidate = _review_prompt_skill_candidate_record(candidate, decision=request.decision, reviewer=request.reviewer, note=request.note, now=now)
        _save_record(ctx.store, "prompt_skill_candidates", "candidate_id", candidate)
        reviewed.append(candidate)
    ctx.audit_service.record(
        actor=request.reviewer or "api",
        action="prompt_skill_candidate.bulk_review",
        target="prompt_skill_candidates",
        detail={"candidate_ids": request.candidate_ids, "decision": request.decision, "reviewed_count": len(reviewed), "skipped_count": len(skipped)},
    )
    return {"reviewed_count": len(reviewed), "skipped_count": len(skipped), "candidates": reviewed, "skipped": skipped}


def _bulk_retest_prompt_skill_candidates(ctx: RouteContext, request: PromptSkillCandidateBulkRetestRequest) -> dict[str, Any]:
    if request.max_count <= 0:
        raise AegisQAError(
            "PROMPT_SKILL_CANDIDATE_RETEST_LIMIT_INVALID",
            "批量复跑数量必须大于 0。",
            status_code=400,
            details={"max_count": request.max_count},
        )
    now = _now()
    plan = _build_prompt_skill_candidate_retest_plan(ctx, status=None, now=now)
    plan_items = {str(item["candidate_id"]): item for item in plan["items"]}
    candidate_ids = request.candidate_ids or [str(item["candidate_id"]) for item in plan["items"]]
    retested: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    max_count = min(request.max_count, 50)

    for candidate_id in candidate_ids:
        try:
            candidate = _get_record(ctx.store, "prompt_skill_candidates", candidate_id)
        except KeyError:
            skipped.append({"candidate_id": candidate_id, "reason": "not_found", "next_action": "missing"})
            continue

        plan_item = plan_items.get(candidate_id) or _prompt_skill_candidate_retest_plan_item(ctx, _with_candidate_sla_status(candidate, now=now), now=now)
        if plan_item["next_action"] != "retest_candidate":
            skipped.append(
                {
                    "candidate_id": candidate_id,
                    "next_action": plan_item["next_action"],
                    "reason": "当前候选还不满足批量复跑条件，请先完成对应下一步。",
                    "target_url": plan_item.get("target_url"),
                }
            )
            continue
        if len(retested) >= max_count:
            skipped.append(
                {
                    "candidate_id": candidate_id,
                    "next_action": "retest_candidate",
                    "reason": "已达到本次批量复跑数量上限。",
                    "target_url": plan_item.get("target_url"),
                }
            )
            continue
        try:
            payload = _execute_prompt_skill_candidate_retest(ctx, candidate, actor=request.actor, history_action="bulk_retest")
        except AegisQAError as exc:
            skipped.append(
                {
                    "candidate_id": candidate_id,
                    "next_action": plan_item["next_action"],
                    "reason": exc.message,
                    "code": exc.code,
                    "details": exc.details,
                    "target_url": plan_item.get("target_url"),
                }
            )
            continue
        retested.append(
            {
                "candidate_id": candidate_id,
                "status": payload["status"],
                "task_id": payload["task"]["task_id"],
                "run_id": payload["task"]["run_id"],
                "candidate_experiment_id": payload["candidate_experiment"].get("experiment_id"),
                "target_url": payload["target_url"],
            }
        )

    ctx.audit_service.record(
        actor=request.actor,
        action="prompt_skill_candidate.bulk_retest",
        target="prompt_skill_candidates",
        detail={"candidate_ids": candidate_ids, "retested_count": len(retested), "skipped_count": len(skipped), "max_count": max_count},
    )
    return {
        "status": "completed",
        "requested_count": len(candidate_ids),
        "retested_count": len(retested),
        "skipped_count": len(skipped),
        "results": retested,
        "skipped": skipped,
        "plan_summary": _build_prompt_skill_candidate_retest_plan(ctx, status=None, now=_now())["summary"],
    }


def _bulk_assign_prompt_skill_candidates(ctx: RouteContext, request: PromptSkillCandidateBulkAssignRequest) -> dict[str, Any]:
    if not request.candidate_ids:
        raise AegisQAError("PROMPT_SKILL_CANDIDATE_IDS_REQUIRED", "请至少选择一个候选资产。", status_code=400)
    owner = request.owner.strip()
    if not owner:
        raise AegisQAError("PROMPT_SKILL_CANDIDATE_OWNER_REQUIRED", "请填写候选资产负责人。", status_code=400)
    if request.max_open_per_owner is not None and request.max_open_per_owner <= 0:
        raise AegisQAError(
            "PROMPT_SKILL_CANDIDATE_OWNER_CAPACITY_INVALID",
            "负责人开放候选容量必须大于 0。",
            status_code=400,
            details={"max_open_per_owner": request.max_open_per_owner},
        )
    now = _now()
    assigned: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    open_count = _prompt_skill_candidate_owner_open_count(ctx, owner, now=now)
    open_before = open_count
    for candidate_id in request.candidate_ids:
        try:
            candidate = _get_record(ctx.store, "prompt_skill_candidates", candidate_id)
        except KeyError:
            skipped.append({"candidate_id": candidate_id, "reason": "not_found"})
            continue
        candidate = _with_candidate_sla_status(candidate, now=now)
        contributes_new_open_item = _candidate_is_open(candidate) and candidate.get("owner") != owner
        if request.max_open_per_owner is not None and contributes_new_open_item and open_count >= request.max_open_per_owner:
            skipped.append(
                {
                    "candidate_id": candidate_id,
                    "reason": "owner_capacity_exceeded",
                    "owner": owner,
                    "open_count": open_count,
                    "max_open_per_owner": request.max_open_per_owner,
                }
            )
            continue
        candidate["owner"] = owner
        candidate["due_at"] = request.due_at
        candidate["assigned_by"] = request.actor
        candidate["assigned_at"] = now
        candidate["updated_at"] = now
        _append_candidate_action(
            candidate,
            action="assign",
            actor=request.actor,
            note=f"指派给 {owner}",
            now=now,
            extra={"owner": owner, "due_at": request.due_at, "max_open_per_owner": request.max_open_per_owner},
        )
        candidate = _with_candidate_sla_status(candidate, now=now)
        _save_record(ctx.store, "prompt_skill_candidates", "candidate_id", candidate)
        assigned.append(candidate)
        if contributes_new_open_item:
            open_count += 1
    ctx.audit_service.record(
        actor=request.actor,
        action="prompt_skill_candidate.bulk_assign",
        target="prompt_skill_candidates",
        detail={
            "candidate_ids": request.candidate_ids,
            "owner": owner,
            "assigned_count": len(assigned),
            "skipped_count": len(skipped),
            "max_open_per_owner": request.max_open_per_owner,
            "open_before": open_before,
            "open_after": open_count,
        },
    )
    return {
        "assigned_count": len(assigned),
        "skipped_count": len(skipped),
        "candidates": assigned,
        "skipped": skipped,
        "capacity": {"owner": owner, "max_open_per_owner": request.max_open_per_owner, "open_before": open_before, "open_after": open_count},
    }


def _escalate_overdue_prompt_skill_candidates(ctx: RouteContext, request: PromptSkillCandidateEscalateRequest) -> dict[str, Any]:
    now = request.now or _now()
    escalated: list[dict[str, Any]] = []
    for candidate in _list_records(ctx.store, "prompt_skill_candidates"):
        candidate = _with_candidate_sla_status(candidate, now=now)
        if not candidate.get("overdue") or candidate.get("escalation_status") == "escalated":
            continue
        candidate["escalation_status"] = "escalated"
        candidate["escalated_by"] = request.actor
        candidate["escalated_at"] = now
        candidate["updated_at"] = now
        _append_candidate_action(candidate, action="escalate_overdue", actor=request.actor, note="候选资产超过 SLA 截止时间，已升级处理。", now=now)
        _save_record(ctx.store, "prompt_skill_candidates", "candidate_id", candidate)
        escalated.append(candidate)
    ctx.audit_service.record(actor=request.actor, action="prompt_skill_candidate.escalate_overdue", target="prompt_skill_candidates", detail={"escalated_count": len(escalated)})
    return {"escalated_count": len(escalated), "candidates": escalated, "workload": _build_prompt_skill_candidate_workload(ctx, now=now)}


def _build_prompt_skill_candidate_workload(ctx: RouteContext, *, now: str) -> dict[str, Any]:
    candidates = [_with_candidate_sla_status(candidate, now=now) for candidate in _list_records(ctx.store, "prompt_skill_candidates")]
    by_owner: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        owner = str(candidate.get("owner") or "未指派")
        bucket = by_owner.setdefault(owner, {"owner": owner, "total": 0, "open_count": 0, "overdue_count": 0, "escalated_count": 0, "status_counts": {}})
        bucket["total"] += 1
        status = str(candidate.get("status") or "unknown")
        bucket["status_counts"][status] = bucket["status_counts"].get(status, 0) + 1
        if _candidate_is_open(candidate):
            bucket["open_count"] += 1
        if candidate.get("overdue"):
            bucket["overdue_count"] += 1
        if candidate.get("escalation_status") == "escalated":
            bucket["escalated_count"] += 1
    owners = sorted(by_owner.values(), key=lambda item: (-int(item["overdue_count"]), -int(item["open_count"]), item["owner"]))
    return {
        "summary": {
            "total_candidates": len(candidates),
            "total_open": sum(1 for candidate in candidates if _candidate_is_open(candidate)),
            "total_overdue": sum(1 for candidate in candidates if candidate.get("overdue")),
            "escalated": sum(1 for candidate in candidates if candidate.get("escalation_status") == "escalated"),
        },
        "owners": owners,
    }


def _prompt_skill_candidate_owner_open_count(ctx: RouteContext, owner: str, *, now: str) -> int:
    """统计负责人当前开放候选数，用于批量指派容量保护。"""

    return sum(
        1
        for candidate in (_with_candidate_sla_status(item, now=now) for item in _list_records(ctx.store, "prompt_skill_candidates"))
        if candidate.get("owner") == owner and _candidate_is_open(candidate)
    )


def _build_prompt_skill_candidate_retest_plan(ctx: RouteContext, *, status: str | None, now: str) -> dict[str, Any]:
    candidates = [_with_candidate_sla_status(candidate, now=now) for candidate in _list_records(ctx.store, "prompt_skill_candidates")]
    if status:
        candidates = [candidate for candidate in candidates if candidate.get("status") == status]
    items = [_prompt_skill_candidate_retest_plan_item(ctx, candidate, now=now) for candidate in candidates]
    items = sorted(items, key=lambda item: (-int(item["priority_score"]), str(item.get("updated_at") or ""), str(item["candidate_id"])))
    for index, item in enumerate(items, start=1):
        item["rank"] = index
    return {
        "summary": {
            "total_candidates": len(items),
            "ready_for_retest": sum(1 for item in items if item["next_action"] == "retest_candidate"),
            "needs_publish": sum(1 for item in items if item["next_action"] == "publish_workflow_draft"),
            "needs_draft": sum(1 for item in items if item["next_action"] == "create_workflow_draft"),
            "already_retested": sum(1 for item in items if item["next_action"] == "review_retest_result"),
            "overdue": sum(1 for item in items if item.get("overdue")),
            "escalated": sum(1 for item in items if item.get("escalation_status") == "escalated"),
        },
        "items": items,
        "generated_at": now,
    }


def _prompt_skill_candidate_retest_plan_item(ctx: RouteContext, candidate: dict[str, Any], *, now: str) -> dict[str, Any]:
    next_action = "create_workflow_draft"
    priority = 30
    reasons = ["需要先生成 Workflow 草稿"]
    target_url = f"/candidate-assets?candidate_id={candidate.get('candidate_id')}"

    if candidate.get("retest_task_id"):
        next_action = "review_retest_result"
        priority = 20
        reasons = ["候选已经复跑，下一步应查看候选报告和晋升建议"]
        target_url = f"/reports?task_id={candidate.get('retest_task_id')}"
    elif candidate.get("workflow_draft_id"):
        draft = _safe_get_workflow_draft(ctx, str(candidate["workflow_draft_id"]))
        if draft and draft.get("published_version_id"):
            next_action = "retest_candidate"
            priority = 80
            reasons = ["候选草稿已发布，可以直接复跑"]
            target_url = f"/candidate-assets?candidate_id={candidate.get('candidate_id')}&action=retest"
        else:
            next_action = "publish_workflow_draft"
            priority = 55
            reasons = ["候选草稿尚未发布，需先进入画布校验并发布"]
            target_url = f"/workflows/designer/{candidate.get('workflow_draft_id')}"

    if candidate.get("overdue"):
        priority += 25
        reasons.append("已逾期")
    if candidate.get("escalation_status") == "escalated":
        priority += 30
        reasons.append("已升级")
    if candidate.get("status") in {"approved", "draft_created"}:
        priority += 10
        reasons.append("已通过候选审批")
    if isinstance(candidate.get("promotion_recommendation"), dict):
        decision = candidate["promotion_recommendation"].get("decision")
        if decision == "promote":
            priority += 15
            reasons.append("晋升建议为 promote")
        elif decision == "review":
            priority += 8
            reasons.append("晋升建议需要人工复核")

    return {
        "candidate_id": candidate.get("candidate_id"),
        "status": candidate.get("status"),
        "owner": candidate.get("owner"),
        "due_at": candidate.get("due_at"),
        "overdue": candidate.get("overdue", False),
        "escalation_status": candidate.get("escalation_status"),
        "workflow_draft_id": candidate.get("workflow_draft_id"),
        "retest_task_id": candidate.get("retest_task_id"),
        "next_action": next_action,
        "priority_score": priority,
        "reasons": reasons,
        "target_url": target_url,
        "updated_at": candidate.get("updated_at") or now,
    }


def _safe_get_workflow_draft(ctx: RouteContext, draft_id: str) -> dict[str, Any] | None:
    try:
        return _get_workflow_draft(ctx.store, draft_id)
    except KeyError:
        return None


def _with_candidate_sla_status(candidate: dict[str, Any], *, now: str) -> dict[str, Any]:
    candidate = dict(candidate)
    candidate["overdue"] = bool(candidate.get("due_at") and _candidate_is_open(candidate) and _iso_before(str(candidate["due_at"]), now))
    return candidate


def _candidate_is_open(candidate: dict[str, Any]) -> bool:
    return candidate.get("status") not in {"rejected", "promoted", "archived"}


def _iso_before(left: str, right: str) -> bool:
    try:
        return datetime.fromisoformat(left) < datetime.fromisoformat(right)
    except ValueError:
        # 时间格式异常时不直接判定逾期，避免坏数据导致列表不可用；后续可在数据治理中提示修复。
        return False


def _append_candidate_action(candidate: dict[str, Any], *, action: str, actor: str, note: str, now: str, extra: dict[str, Any] | None = None) -> None:
    history = candidate.get("action_history") if isinstance(candidate.get("action_history"), list) else []
    payload = {"action": action, "actor": actor, "note": note, "created_at": now}
    if extra:
        payload.update(extra)
    history.append(payload)
    candidate["action_history"] = history


def _execute_prompt_skill_candidate_retest(ctx: RouteContext, candidate: dict[str, Any], *, actor: str, history_action: str) -> dict[str, Any]:
    """执行候选 Workflow 的同数据集复跑，并把结果写回候选资产。

    单条复跑和批量复跑必须共享这一条路径，否则后续指标、Experiment、晋升建议和
    action_history 很容易出现语义漂移。
    """

    candidate_id = str(candidate["candidate_id"])
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
    _append_candidate_action(
        candidate,
        action=history_action,
        actor=actor,
        note="候选 Workflow 已使用来源任务同一 Dataset Version 完成复跑。",
        now=now,
        extra={"task_id": task["task_id"], "run_id": executed_run.run_id, "candidate_experiment_id": candidate_experiment["experiment_id"]},
    )
    _save_record(ctx.store, "prompt_skill_candidates", "candidate_id", candidate)
    ctx.audit_service.record(
        actor=actor,
        action=f"prompt_skill_candidate.{history_action}",
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


def _build_workflow_promotion_review(candidate: dict[str, Any], request: WorkflowPromotionReviewRequest) -> dict[str, Any]:
    scorecard = candidate.get("scorecard") if isinstance(candidate.get("scorecard"), dict) else {}
    candidate_card = scorecard.get("candidate") if isinstance(scorecard.get("candidate"), dict) else {}
    current_card = scorecard.get("current") if isinstance(scorecard.get("current"), dict) else {}
    workflow_version_id = candidate_card.get("workflow_version_id")
    if not workflow_version_id:
        raise AegisQAError(
            "WORKFLOW_PROMOTION_VERSION_MISSING",
            "候选复跑结果缺少候选 Workflow 版本，无法创建晋升审批。",
            status_code=400,
            details={"candidate_id": candidate.get("candidate_id")},
        )
    now = _now()
    review_id = f"promotion-review-{uuid4().hex[:12]}"
    return {
        "review_id": review_id,
        "candidate_id": candidate["candidate_id"],
        "status": "pending_review",
        "source_task_id": candidate.get("source_task_id"),
        "retest_task_id": candidate.get("retest_task_id"),
        "candidate_run_id": candidate.get("candidate_run_id"),
        "candidate_experiment_id": candidate.get("candidate_experiment_id"),
        "candidate_workflow_version_id": workflow_version_id,
        "current_workflow_version_id": current_card.get("workflow_version_id"),
        "baseline_experiment_id": candidate.get("baseline_experiment_id"),
        "promotion_recommendation": candidate.get("promotion_recommendation", {}),
        "scorecard": scorecard,
        "comparisons": candidate.get("comparisons", {}),
        "requester": request.requester,
        "note": request.note,
        "target_url": f"/workflows?workflow_version_id={workflow_version_id}",
        "created_at": now,
        "updated_at": now,
    }


def _decide_workflow_promotion_review(
    ctx: RouteContext,
    review_id: str,
    *,
    decision: str,
    request: WorkflowPromotionReviewDecisionRequest,
) -> dict[str, Any]:
    review = _get_record(ctx.store, "workflow_promotion_reviews", review_id)
    if review.get("status") not in {"pending_review", decision}:
        raise AegisQAError(
            "WORKFLOW_PROMOTION_REVIEW_ALREADY_DECIDED",
            "该 Workflow 晋升审批已经处理，不能重复变更结论。",
            status_code=400,
            details={"review_id": review_id, "status": review.get("status")},
        )
    candidate = _get_record(ctx.store, "prompt_skill_candidates", str(review["candidate_id"]))
    now = _now()
    review["status"] = decision
    review["reviewer"] = request.reviewer
    review["review_note"] = request.note
    review["reviewed_at"] = now
    review["updated_at"] = now
    if decision == "approved":
        candidate["status"] = "promoted"
        candidate["promoted_workflow_version_id"] = review.get("candidate_workflow_version_id")
        candidate["promoted_at"] = now
        release_artifacts = _workflow_promotion_release_artifacts(ctx, review, candidate, now=now)
        baseline_suggestion = release_artifacts.get("baseline_suggestion")
        release_record = release_artifacts.get("release_record")
        if baseline_suggestion:
            review["baseline_suggestion_id"] = baseline_suggestion.get("suggestion_id")
            candidate["baseline_suggestion_id"] = baseline_suggestion.get("suggestion_id")
        if release_record:
            review["release_record_id"] = release_record.get("record_id")
            candidate["release_record_id"] = release_record.get("record_id")
    else:
        release_artifacts = None
        candidate["status"] = "promotion_rejected"
        candidate["promotion_rejected_at"] = now
    candidate["updated_at"] = now
    _save_record(ctx.store, "workflow_promotion_reviews", "review_id", review)
    _save_record(ctx.store, "prompt_skill_candidates", "candidate_id", candidate)
    ctx.audit_service.record(
        actor=request.reviewer or "api",
        action=f"workflow_promotion_review.{decision}",
        target=review_id,
        detail={"candidate_id": candidate.get("candidate_id"), "workflow_version_id": review.get("candidate_workflow_version_id")},
    )
    payload = {"status": decision, "candidate": candidate, "review": review, "target_url": review.get("target_url")}
    if release_artifacts:
        payload["release_artifacts"] = release_artifacts
    return payload


def _workflow_promotion_release_artifacts(
    ctx: RouteContext,
    review: dict[str, Any],
    candidate: dict[str, Any],
    *,
    now: str,
) -> dict[str, Any]:
    existing_baseline = _get_record(ctx.store, "experiment_baseline_suggestions", str(review["baseline_suggestion_id"])) if review.get("baseline_suggestion_id") else None
    existing_release = _get_record(ctx.store, "workflow_release_records", str(review["release_record_id"])) if review.get("release_record_id") else None
    if existing_baseline or existing_release:
        evaluations = [
            _get_record(ctx.store, "ci_gate_evaluations", str(evaluation_id))
            for evaluation_id in existing_release.get("ci_gate_evaluation_ids", [])
        ] if existing_release else []
        return {"baseline_suggestion": existing_baseline, "release_record": existing_release, "ci_gate_evaluations": evaluations}

    baseline_suggestion = _build_experiment_baseline_suggestion(ctx, review, candidate, now=now)
    release_record, evaluations = _build_workflow_release_record(ctx, review, candidate, now=now)
    if baseline_suggestion:
        _save_record(ctx.store, "experiment_baseline_suggestions", "suggestion_id", baseline_suggestion)
    _save_record(ctx.store, "workflow_release_records", "record_id", release_record)
    ctx.audit_service.record(
        actor="api",
        action="workflow_promotion_review.release_artifacts_created",
        target=review["review_id"],
        detail={
            "baseline_suggestion_id": baseline_suggestion.get("suggestion_id") if baseline_suggestion else None,
            "release_record_id": release_record.get("record_id"),
            "ci_gate_evaluation_ids": [item.get("evaluation_id") for item in evaluations],
        },
    )
    return {"baseline_suggestion": baseline_suggestion, "release_record": release_record, "ci_gate_evaluations": evaluations}


def _build_experiment_baseline_suggestion(
    ctx: RouteContext,
    review: dict[str, Any],
    candidate: dict[str, Any],
    *,
    now: str,
) -> dict[str, Any] | None:
    suggested_experiment_id = review.get("candidate_experiment_id") or candidate.get("candidate_experiment_id")
    if not suggested_experiment_id:
        return None
    suggested_experiment = _get_record(ctx.store, "experiments", str(suggested_experiment_id))
    previous_baseline_id = review.get("baseline_experiment_id") or candidate.get("baseline_experiment_id")
    previous_baseline = _get_record(ctx.store, "experiments", str(previous_baseline_id)) if previous_baseline_id else None
    suggestion_id = f"baseline-suggestion-{uuid4().hex[:12]}"
    return {
        "suggestion_id": suggestion_id,
        "candidate_id": candidate["candidate_id"],
        "review_id": review["review_id"],
        "status": "pending_apply",
        "suggested_experiment_id": suggested_experiment["experiment_id"],
        "suggested_run_id": suggested_experiment.get("run_id"),
        "previous_baseline_experiment_id": previous_baseline.get("experiment_id") if previous_baseline else None,
        "previous_baseline_run_id": previous_baseline.get("run_id") if previous_baseline else None,
        "workflow_version_id": review.get("candidate_workflow_version_id"),
        "metrics": suggested_experiment.get("metrics", {}),
        "baseline_metrics": previous_baseline.get("metrics", {}) if previous_baseline else None,
        "reason": "Workflow 晋升审批已通过，建议把候选实验登记为新的 baseline 候选。",
        "target_url": f"/experiments?baseline_suggestion_id={suggestion_id}",
        "created_at": now,
        "updated_at": now,
    }


def _build_workflow_release_record(
    ctx: RouteContext,
    review: dict[str, Any],
    candidate: dict[str, Any],
    *,
    now: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    record_id = f"workflow-release-{uuid4().hex[:12]}"
    ci_gate_configs = [config for config in _list_records(ctx.store, "ci_gate_configs") if config.get("status", "active") in {"active", "enabled"}]
    evaluations: list[dict[str, Any]] = []
    retest_task_id = review.get("retest_task_id") or candidate.get("retest_task_id")
    if ci_gate_configs and retest_task_id:
        task = _get_record(ctx.store, "tasks", str(retest_task_id))
        run = ctx.runner.get_run(str(task["run_id"]))
        metrics = _ci_gate_metrics_from_task(task, run)
        # 晋升审批通过后马上复用现有 CI Gate 配置做一次发布前评估，避免审批和发布门禁脱节。
        for config in ci_gate_configs:
            evaluations.append(
                _record_ci_gate_evaluation(
                    ctx,
                    config=config,
                    metrics=metrics,
                    target={"kind": "task", "id": str(retest_task_id)},
                    source="workflow_promotion_review",
                    review_id=review["review_id"],
                    now=now,
                )
            )
    blocking_failures = sum(int(item.get("blocking_failures", 0)) for item in evaluations)
    if not ci_gate_configs:
        status = "pending_ci_gate_config"
    elif not retest_task_id:
        status = "pending_ci_gate_target"
    elif blocking_failures:
        status = "blocked"
    else:
        status = "ready_to_release"
    return (
        {
            "record_id": record_id,
            "candidate_id": candidate["candidate_id"],
            "review_id": review["review_id"],
            "workflow_version_id": review.get("candidate_workflow_version_id"),
            "candidate_experiment_id": review.get("candidate_experiment_id") or candidate.get("candidate_experiment_id"),
            "source_task_id": review.get("source_task_id") or candidate.get("source_task_id"),
            "retest_task_id": retest_task_id,
            "status": status,
            "ci_gate_config_ids": [item["config_id"] for item in ci_gate_configs],
            "ci_gate_evaluation_ids": [item["evaluation_id"] for item in evaluations],
            "blocking_failures": blocking_failures,
            "target_url": f"/ci-gates?release_record_id={record_id}",
            "created_at": now,
            "updated_at": now,
        },
        evaluations,
    )


def _record_ci_gate_evaluation(
    ctx: RouteContext,
    *,
    config: dict[str, Any],
    metrics: dict[str, float],
    target: dict[str, str],
    source: str,
    review_id: str,
    now: str,
) -> dict[str, Any]:
    gates = [CIGateRuleRequest.model_validate(gate) for gate in config.get("gates", [])]
    results = [_evaluate_gate(metrics, gate) for gate in gates]
    blocking_failures = [item for item in results if item["status"] == "failed" and item["blocking"]]
    evaluation = {
        "evaluation_id": f"gateeval-{uuid4().hex[:12]}",
        "config_id": config.get("config_id"),
        "status": "blocked" if blocking_failures else "passed",
        "blocking_failures": len(blocking_failures),
        "target": target,
        "metrics": metrics,
        "results": results,
        "source": source,
        "review_id": review_id,
        "created_at": now,
    }
    _save_record(ctx.store, "ci_gate_evaluations", "evaluation_id", evaluation)
    return evaluation


def _build_experiment_baseline_impact(ctx: RouteContext, suggestion_id: str) -> dict[str, Any]:
    suggestion = _get_record(ctx.store, "experiment_baseline_suggestions", suggestion_id)
    suggested_experiment = _get_record(ctx.store, "experiments", str(suggestion["suggested_experiment_id"]))
    previous_experiment = (
        _get_record(ctx.store, "experiments", str(suggestion["previous_baseline_experiment_id"]))
        if suggestion.get("previous_baseline_experiment_id")
        else None
    )
    scope = {
        "dataset_id": suggested_experiment.get("dataset_id"),
        "workflow_id": suggested_experiment.get("workflow_id"),
    }
    affected_tasks = [
        _baseline_impact_task_summary(task)
        for task in _list_records(ctx.store, "tasks")
        if _task_matches_baseline_scope(task, scope)
    ]
    ci_gate_configs = [config for config in _list_records(ctx.store, "ci_gate_configs") if config.get("status", "active") in {"active", "enabled"}]
    return {
        "suggestion_id": suggestion_id,
        "status": suggestion.get("status"),
        "scope": scope,
        "suggested_experiment_id": suggested_experiment.get("experiment_id"),
        "previous_baseline_experiment_id": previous_experiment.get("experiment_id") if previous_experiment else None,
        "metric_delta": _experiment_baseline_metric_delta(ctx, suggested_experiment, previous_experiment),
        "summary": {
            "affected_tasks": len(affected_tasks),
            "affected_reports": sum(1 for task in affected_tasks if task.get("run_id")),
            "ci_gate_configs": len(ci_gate_configs),
        },
        "affected_tasks": affected_tasks,
        "recommendations": _baseline_impact_recommendations(suggestion, ci_gate_configs),
        "generated_at": _now(),
    }


def _task_matches_baseline_scope(task: dict[str, Any], scope: dict[str, Any]) -> bool:
    if task.get("dataset_id") != scope.get("dataset_id"):
        return False
    workflow_id = scope.get("workflow_id")
    if not workflow_id:
        return True
    workflow_version_id = str(task.get("workflow_version_id") or "")
    return task.get("workflow_id") == workflow_id or workflow_version_id == workflow_id or workflow_version_id.startswith(f"{workflow_id}:")


def _baseline_impact_task_summary(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "task_id": task.get("task_id"),
        "name": task.get("name"),
        "status": task.get("status"),
        "dataset_id": task.get("dataset_id"),
        "workflow_id": task.get("workflow_id"),
        "workflow_version_id": task.get("workflow_version_id"),
        "run_id": task.get("run_id"),
        "total_items": task.get("total_items", 0),
        "completed_items": task.get("completed_items", 0),
        "failed_items": task.get("failed_items", 0),
        "pass_rate": task.get("pass_rate"),
        "badcase_count": task.get("badcase_count"),
    }


def _experiment_baseline_metric_delta(
    ctx: RouteContext,
    suggested_experiment: dict[str, Any],
    previous_experiment: dict[str, Any] | None,
) -> dict[str, Any]:
    suggested_run = ctx.runner.get_run(str(suggested_experiment["run_id"])) if suggested_experiment.get("run_id") else None
    previous_run = ctx.runner.get_run(str(previous_experiment["run_id"])) if previous_experiment and previous_experiment.get("run_id") else None
    if suggested_run and previous_run:
        comparison = compare_reports(aggregate_run_report(previous_run), aggregate_run_report(suggested_run))
        return {
            "pass_rate_delta": comparison.get("pass_rate_delta"),
            "error_rate_delta": comparison.get("error_rate_delta"),
            "badcase_delta": comparison.get("badcase_delta"),
            "p95_latency_ms_delta": comparison.get("metric_delta", {}).get("p95_latency_ms_delta"),
            "cost_delta": comparison.get("metric_delta", {}).get("cost_delta"),
        }

    metrics = suggested_experiment.get("metrics", {}) if isinstance(suggested_experiment.get("metrics"), dict) else {}
    baseline_metrics = previous_experiment.get("metrics", {}) if previous_experiment and isinstance(previous_experiment.get("metrics"), dict) else {}
    return {
        "pass_rate_delta": _numeric_delta(metrics, baseline_metrics, "pass_rate"),
        "error_rate_delta": _numeric_delta(metrics, baseline_metrics, "error_rate"),
        "badcase_delta": _numeric_delta(metrics, baseline_metrics, "badcase_count"),
        "p95_latency_ms_delta": _numeric_delta(metrics, baseline_metrics, "p95_latency_ms"),
        "cost_delta": _numeric_delta(metrics, baseline_metrics, "cost"),
    }


def _numeric_delta(metrics: dict[str, Any], baseline_metrics: dict[str, Any], key: str) -> float | None:
    left = baseline_metrics.get(key)
    right = metrics.get(key)
    if not isinstance(left, (int, float)) or not isinstance(right, (int, float)):
        return None
    return round(float(right) - float(left), 6)


def _baseline_impact_recommendations(suggestion: dict[str, Any], ci_gate_configs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    recommendations = [
        {
            "action": "apply_baseline",
            "label": "应用或确认当前 baseline",
            "message": "先确认影响任务和指标 delta，再把候选实验登记为当前 baseline。",
        }
    ]
    if suggestion.get("status") == "applied":
        recommendations.append(
            {
                "action": "rollback_baseline",
                "label": "必要时回滚 baseline",
                "message": "如果后续发现候选版本不稳定，回滚前会自动用原 baseline 重新执行 CI Gate。",
            }
        )
    if not ci_gate_configs:
        recommendations.append(
            {
                "action": "create_ci_gate",
                "label": "补充 CI Gate",
                "message": "当前没有 active/enabled 门禁，baseline 变更缺少自动阻断标准。",
            }
        )
    return recommendations


def _build_baseline_rollback_guard(ctx: RouteContext, suggestion: dict[str, Any], *, now: str) -> dict[str, Any]:
    previous_experiment_id = suggestion.get("previous_baseline_experiment_id")
    if not previous_experiment_id:
        return {"status": "pending_rollback_target", "ci_gate_evaluations": [], "blocking_failures": 0}
    previous_experiment = _get_record(ctx.store, "experiments", str(previous_experiment_id))
    previous_run_id = previous_experiment.get("run_id")
    if not previous_run_id:
        return {"status": "pending_rollback_target", "ci_gate_evaluations": [], "blocking_failures": 0}
    ci_gate_configs = [config for config in _list_records(ctx.store, "ci_gate_configs") if config.get("status", "active") in {"active", "enabled"}]
    if not ci_gate_configs:
        return {"status": "pending_ci_gate_config", "ci_gate_evaluations": [], "blocking_failures": 0}

    run = ctx.runner.get_run(str(previous_run_id))
    metrics = _ci_gate_metrics_from_run(run)
    evaluations = [
        _record_ci_gate_evaluation(
            ctx,
            config=config,
            metrics=metrics,
            target={"kind": "run", "id": str(previous_run_id)},
            source="experiment_baseline_rollback",
            review_id=str(suggestion["suggestion_id"]),
            now=now,
        )
        for config in ci_gate_configs
    ]
    blocking_failures = sum(int(item.get("blocking_failures", 0)) for item in evaluations)
    # 回滚也可能把 baseline 带回一个不满足当前质量门禁的旧版本，必须把复测证据和回滚动作绑定。
    return {
        "status": "blocked" if blocking_failures else "passed",
        "ci_gate_evaluations": evaluations,
        "blocking_failures": blocking_failures,
    }


def _apply_experiment_baseline_suggestion(ctx: RouteContext, suggestion_id: str, request: ExperimentBaselineActionRequest) -> dict[str, Any]:
    suggestion = _get_record(ctx.store, "experiment_baseline_suggestions", suggestion_id)
    if suggestion.get("status") not in {"pending_apply", "rolled_back", "applied"}:
        raise AegisQAError(
            "BASELINE_SUGGESTION_STATUS_INVALID",
            "只有待应用、已回滚或已应用的 baseline 建议可以执行应用动作。",
            status_code=400,
            details={"suggestion_id": suggestion_id, "status": suggestion.get("status")},
        )
    suggested_experiment = _get_record(ctx.store, "experiments", str(suggestion["suggested_experiment_id"]))
    baseline = _get_or_create_experiment_baseline(ctx, suggested_experiment, now=_now())
    if suggestion.get("status") == "applied" and baseline.get("current_experiment_id") == suggestion.get("suggested_experiment_id"):
        notifications = _list_baseline_change_notifications(ctx, suggestion_id=suggestion_id, baseline_id=str(baseline["baseline_id"]))
        return {"status": "applied", "suggestion": suggestion, "baseline": baseline, "notifications": notifications}
    now = _now()
    previous_experiment_id = baseline.get("current_experiment_id") or suggestion.get("previous_baseline_experiment_id")
    baseline["current_experiment_id"] = suggestion["suggested_experiment_id"]
    baseline["previous_experiment_id"] = previous_experiment_id
    baseline["status"] = "active"
    baseline.setdefault("history", []).append(
        {
            "action": "apply",
            "suggestion_id": suggestion_id,
            "from_experiment_id": previous_experiment_id,
            "to_experiment_id": suggestion["suggested_experiment_id"],
            "actor": request.actor,
            "note": request.note,
            "created_at": now,
        }
    )
    baseline["updated_at"] = now
    suggestion["status"] = "applied"
    suggestion["applied_by"] = request.actor
    suggestion["apply_note"] = request.note
    suggestion["applied_at"] = now
    suggestion["updated_at"] = now
    _save_record(ctx.store, "experiment_baselines", "baseline_id", baseline)
    _save_record(ctx.store, "experiment_baseline_suggestions", "suggestion_id", suggestion)
    notifications = _create_baseline_change_notification(ctx, baseline, suggestion, action="apply", actor=request.actor, note=request.note, now=now)
    ctx.audit_service.record(actor=request.actor, action="experiment_baseline.apply", target=baseline["baseline_id"], detail={"suggestion_id": suggestion_id, "current_experiment_id": baseline["current_experiment_id"]})
    return {"status": "applied", "suggestion": suggestion, "baseline": baseline, "notifications": notifications}


def _rollback_experiment_baseline_suggestion(ctx: RouteContext, suggestion_id: str, request: ExperimentBaselineActionRequest) -> dict[str, Any]:
    suggestion = _get_record(ctx.store, "experiment_baseline_suggestions", suggestion_id)
    if suggestion.get("status") != "applied":
        raise AegisQAError(
            "BASELINE_SUGGESTION_NOT_APPLIED",
            "只有已应用的 baseline 建议可以回滚。",
            status_code=400,
            details={"suggestion_id": suggestion_id, "status": suggestion.get("status")},
        )
    suggested_experiment = _get_record(ctx.store, "experiments", str(suggestion["suggested_experiment_id"]))
    baseline = _get_or_create_experiment_baseline(ctx, suggested_experiment, now=_now())
    previous_experiment_id = suggestion.get("previous_baseline_experiment_id")
    if not previous_experiment_id:
        raise AegisQAError(
            "BASELINE_ROLLBACK_TARGET_MISSING",
            "该 baseline 建议没有记录原 baseline，无法自动回滚。",
            status_code=400,
            details={"suggestion_id": suggestion_id},
        )
    now = _now()
    rollback_guard = _build_baseline_rollback_guard(ctx, suggestion, now=now)
    if rollback_guard.get("status") == "blocked" and not request.force:
        raise AegisQAError(
            "BASELINE_ROLLBACK_CI_GATE_BLOCKED",
            "回滚目标未通过当前 CI Gate，请先处理阻断项，或明确使用 force 执行人工兜底回滚。",
            status_code=409,
            details={"suggestion_id": suggestion_id, "rollback_guard": rollback_guard},
        )
    baseline["current_experiment_id"] = previous_experiment_id
    baseline["previous_experiment_id"] = suggestion.get("suggested_experiment_id")
    baseline["status"] = "active"
    baseline.setdefault("history", []).append(
        {
            "action": "rollback",
            "suggestion_id": suggestion_id,
            "from_experiment_id": suggestion.get("suggested_experiment_id"),
            "to_experiment_id": previous_experiment_id,
            "actor": request.actor,
            "note": request.note,
            "created_at": now,
        }
    )
    baseline["updated_at"] = now
    suggestion["status"] = "rolled_back"
    suggestion["rolled_back_by"] = request.actor
    suggestion["rollback_note"] = request.note
    suggestion["rolled_back_at"] = now
    suggestion["updated_at"] = now
    _save_record(ctx.store, "experiment_baselines", "baseline_id", baseline)
    _save_record(ctx.store, "experiment_baseline_suggestions", "suggestion_id", suggestion)
    notifications = _create_baseline_change_notification(
        ctx,
        baseline,
        suggestion,
        action="rollback",
        actor=request.actor,
        note=request.note,
        now=now,
        rollback_guard=rollback_guard,
    )
    ctx.audit_service.record(actor=request.actor, action="experiment_baseline.rollback", target=baseline["baseline_id"], detail={"suggestion_id": suggestion_id, "current_experiment_id": baseline["current_experiment_id"], "rollback_guard_status": rollback_guard.get("status")})
    return {"status": "rolled_back", "suggestion": suggestion, "baseline": baseline, "rollback_guard": rollback_guard, "notifications": notifications}


def _list_baseline_change_notifications(
    ctx: RouteContext,
    *,
    suggestion_id: str | None = None,
    baseline_id: str | None = None,
    workflow_id: str | None = None,
    status: str | None = None,
) -> list[dict[str, Any]]:
    notifications = _list_records(ctx.store, "baseline_change_notifications")
    if suggestion_id:
        notifications = [item for item in notifications if item.get("suggestion_id") == suggestion_id]
    if baseline_id:
        notifications = [item for item in notifications if item.get("baseline_id") == baseline_id]
    if workflow_id:
        notifications = [item for item in notifications if item.get("scope", {}).get("workflow_id") == workflow_id]
    if status:
        notifications = [item for item in notifications if item.get("status") == status]
    return sorted(notifications, key=lambda item: str(item.get("created_at") or ""), reverse=True)


def _create_baseline_change_notification(
    ctx: RouteContext,
    baseline: dict[str, Any],
    suggestion: dict[str, Any],
    *,
    action: str,
    actor: str,
    note: str,
    now: str,
    rollback_guard: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    impact = _build_experiment_baseline_impact(ctx, str(suggestion["suggestion_id"]))
    affected_tasks = impact.get("affected_tasks", []) if isinstance(impact.get("affected_tasks"), list) else []
    recipients = _baseline_notification_recipients(ctx, suggestion, affected_tasks, actor=actor)
    from_experiment = baseline.get("previous_experiment_id")
    to_experiment = baseline.get("current_experiment_id")
    summary = {
        "affected_tasks": impact.get("summary", {}).get("affected_tasks", 0),
        "affected_reports": impact.get("summary", {}).get("affected_reports", 0),
        "ci_gate_configs": impact.get("summary", {}).get("ci_gate_configs", 0),
        "metric_delta": impact.get("metric_delta", {}),
    }
    if rollback_guard:
        summary["rollback_guard_status"] = rollback_guard.get("status")
        summary["rollback_blocking_failures"] = rollback_guard.get("blocking_failures", 0)
    notification = {
        "notification_id": f"baseline-notification-{uuid4().hex[:12]}",
        "baseline_id": baseline["baseline_id"],
        "suggestion_id": suggestion["suggestion_id"],
        "action": action,
        "status": "unread",
        "actor": actor,
        "note": note,
        "scope": baseline.get("scope", {}),
        "from_experiment_id": from_experiment,
        "to_experiment_id": to_experiment,
        "recipients": recipients,
        "affected_task_ids": [task.get("task_id") for task in affected_tasks if task.get("task_id")],
        "summary": summary,
        "message": _baseline_change_message(action, from_experiment, to_experiment, summary),
        "created_at": now,
        "updated_at": now,
    }
    _save_record(ctx.store, "baseline_change_notifications", "notification_id", notification)
    ctx.audit_service.record(
        actor=actor,
        action=f"baseline_change_notification.create.{action}",
        target=notification["notification_id"],
        detail={"suggestion_id": suggestion.get("suggestion_id"), "baseline_id": baseline.get("baseline_id"), "recipient_count": len(recipients)},
    )
    return [notification]


def _baseline_notification_recipients(ctx: RouteContext, suggestion: dict[str, Any], affected_tasks: list[Any], *, actor: str) -> list[str]:
    recipients: list[str] = []

    def add(value: Any) -> None:
        if value is None:
            return
        text = str(value).strip()
        if text and text not in recipients:
            recipients.append(text)

    add(actor)
    candidate_id = suggestion.get("candidate_id")
    if candidate_id:
        try:
            candidate = _get_record(ctx.store, "prompt_skill_candidates", str(candidate_id))
            add(candidate.get("owner"))
            add(candidate.get("assigned_by"))
            add(candidate.get("escalated_by"))
            review = candidate.get("review") if isinstance(candidate.get("review"), dict) else {}
            add(review.get("reviewer"))
        except KeyError:
            pass
    for task in affected_tasks:
        if isinstance(task, dict):
            add(task.get("owner"))
            add(task.get("created_by"))
    return recipients


def _baseline_change_message(action: str, from_experiment: Any, to_experiment: Any, summary: dict[str, Any]) -> str:
    affected = summary.get("affected_tasks", 0)
    if action == "rollback":
        guard_status = summary.get("rollback_guard_status", "unknown")
        return f"Baseline 已从 {from_experiment or '-'} 回滚到 {to_experiment or '-'}，回滚门禁状态 {guard_status}，影响 {affected} 个任务。"
    return f"Baseline 已从 {from_experiment or '-'} 切换到 {to_experiment or '-'}，影响 {affected} 个任务，请复核任务报告与 CI Gate。"


def _get_or_create_experiment_baseline(ctx: RouteContext, experiment: dict[str, Any], *, now: str) -> dict[str, Any]:
    scope = {"dataset_id": experiment.get("dataset_id"), "workflow_id": experiment.get("workflow_id")}
    for baseline in _list_records(ctx.store, "experiment_baselines"):
        if baseline.get("scope") == scope:
            return baseline
    # Baseline 以 Dataset + Workflow 为作用域，避免把不同数据集或不同流程的实验互相覆盖。
    return {
        "baseline_id": f"baseline-{uuid4().hex[:12]}",
        "scope": scope,
        "current_experiment_id": None,
        "previous_experiment_id": None,
        "status": "active",
        "history": [],
        "created_at": now,
        "updated_at": now,
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
