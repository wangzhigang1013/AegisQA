"""任务报告构建器。

从 api/app.py 提取的任务报告、质量决策、预算状态等构建逻辑。
"""

from __future__ import annotations

import json
import re
from math import ceil
from typing import Any
from uuid import uuid4

from aegisqa.core.time import now_beijing_str
from aegisqa.engine.runner import RunRecord
from aegisqa.judge.profiles import StoredJudgeAudit
from aegisqa.reports.aggregator import RunReport, aggregate_run_report


def _now() -> str:
    return now_beijing_str()


def build_task_report_summary(task: dict[str, Any], run: RunRecord) -> dict[str, Any]:
    return {
        "task_id": task["task_id"],
        "task_name": task["name"],
        "run_id": run.run_id,
        "status": task["status"],
        "dataset_name": task.get("dataset_name"),
        "workflow_name": task.get("workflow_name"),
        "sample_count": run.total_items,
        "current_attempt": task.get("current_attempt", 1),
        "created_at": task.get("created_at"),
        "updated_at": task.get("updated_at"),
    }


def build_task_report_version_snapshot(task: dict[str, Any], run: RunRecord) -> dict[str, Any]:
    return {
        "dataset": {
            "dataset_id": task["dataset_id"],
            "version": task["dataset_version"],
            "version_id": task.get("dataset_version_id") or f"{task['dataset_id']}:v{task['dataset_version']}",
            "name": task.get("dataset_name"),
        },
        "workflow": {
            "workflow_id": task["workflow_id"],
            "version_id": task["workflow_version_id"],
            "name": task.get("workflow_name"),
            "step_count": len(run.workflow.steps),
        },
        "execution_config": task.get("execution_config", {}),
    }


def build_step_distribution(run: RunRecord) -> list[dict[str, Any]]:
    by_step: dict[str, dict[str, Any]] = {}
    for item in run.items:
        for step in item.steps:
            bucket = by_step.setdefault(
                step.step_id,
                {
                    "step_id": step.step_id,
                    "skill_ref": step.skill_ref,
                    "total_calls": 0,
                    "succeeded": 0,
                    "failed": 0,
                    "cache_hits": 0,
                    "total_latency_ms": 0.0,
                },
            )
            bucket["total_calls"] += 1
            if step.status == "succeeded":
                bucket["succeeded"] += 1
            if step.status == "failed":
                bucket["failed"] += 1
            if step.cache_hit:
                bucket["cache_hits"] += 1
            bucket["total_latency_ms"] += step.latency_ms

    result = []
    for bucket in by_step.values():
        total_calls = bucket["total_calls"] or 1
        result.append(
            {
                **bucket,
                "average_latency_ms": bucket["total_latency_ms"] / total_calls,
            }
        )
    return sorted(result, key=lambda item: item["step_id"])


def build_judge_score_distribution(run: RunRecord) -> list[dict[str, Any]]:
    buckets = {"0-0.6": 0, "0.6-0.8": 0, "0.8-1.0": 0}
    for item in run.items:
        score = item.metrics.get("judge_score")
        if not isinstance(score, (int, float)):
            continue
        if score < 0.6:
            buckets["0-0.6"] += 1
        elif score < 0.8:
            buckets["0.6-0.8"] += 1
        else:
            buckets["0.8-1.0"] += 1
    return [{"bucket": bucket, "count": count} for bucket, count in buckets.items()]


def build_parameter_governance(task: dict[str, Any], run: RunRecord) -> dict[str, Any]:
    parameter_sources_by_step: dict[str, dict[str, Any]] = {}
    for item in run.items:
        for step in item.steps:
            if step.parameter_trace:
                parameter_sources_by_step.setdefault(step.step_id, step.parameter_trace)

    prompt_skill_versions = [
        {
            "step_id": step.step_id,
            "skill_ref": step.skill_ref,
            "prompt_version": step.config.get("prompt_version") or step.config.get("prompt") or "inline-config",
            "model": step.config.get("model"),
            "model_params": {key: step.config.get(key) for key in ("temperature", "threshold", "top_p") if key in step.config},
            "cacheable": step.cacheable,
        }
        for step in run.workflow.steps
    ]
    return {
        "task_id": task.get("task_id"),
        "run_id": run.run_id,
        "workflow_version_id": run.workflow.version_id,
        "execution_config": task.get("execution_config", {}),
        "prompt_skill_versions": prompt_skill_versions,
        "parameter_sources": [
            {
                "step_id": step.step_id,
                "skill_ref": step.skill_ref,
                "parameters": parameter_sources_by_step.get(step.step_id, {}),
            }
            for step in run.workflow.steps
        ],
        "secret_policy": {
            "redacted": True,
            "message": "Secret 参数只保留 secret_ref 与脱敏预览，不在报告或 Trace 中展示明文。",
        },
    }


def build_quality_decision(task: dict[str, Any], run: RunRecord, report: RunReport, segments: list[Any]) -> dict[str, Any]:
    weak_segments = [segment for segment in segments if segment.sample_count > 0 and segment.pass_rate < 0.8]
    badcase_count = len(report.badcases)
    status = "passed"
    top_risks: list[dict[str, Any]] = []
    next_actions: list[dict[str, str]] = []

    if report.pass_rate < 0.6 or report.error_rate > 0.05:
        status = "blocked"
    elif report.pass_rate < 0.8 or badcase_count > 0 or weak_segments:
        status = "warning"

    if report.pass_rate < 0.8:
        top_risks.append({"type": "low_pass_rate", "severity": "critical" if report.pass_rate < 0.6 else "warning", "message": f"任务通过率为 {round(report.pass_rate * 100)}%。"})
        next_actions.append({"action": "create_ci_gate", "label": "为当前任务生成通过率门禁"})
    if badcase_count:
        top_risks.append({"type": "badcase_budget", "severity": "warning", "message": f"当前任务产生 {badcase_count} 条 Badcase。"})
        next_actions.append({"action": "add_to_annotation_queue", "label": "将 Badcase 加入人工审核队列"})
    if weak_segments:
        weakest = sorted(weak_segments, key=lambda item: item.pass_rate)[0]
        top_risks.append(
            {
                "type": "weak_segment",
                "severity": "warning",
                "message": f"{weakest.segment_key}={weakest.segment_value} 分组通过率为 {round(weakest.pass_rate * 100)}%。",
                "segment_key": weakest.segment_key,
                "segment_value": weakest.segment_value,
            }
        )
        next_actions.append({"action": "create_golden_candidates", "label": "把低通过率分组沉淀为 Golden 候选"})
    if not next_actions:
        next_actions.append({"action": "snapshot_experiment", "label": "生成 Experiment 快照作为新的 baseline"})

    return {
        "status": status,
        "task_id": task.get("task_id"),
        "run_id": run.run_id,
        "risk_summary": {
            "pass_rate": report.pass_rate,
            "error_rate": report.error_rate,
            "badcase_count": badcase_count,
            "weak_segment_count": len(weak_segments),
        },
        "top_risks": top_risks,
        "next_actions": next_actions,
    }


def build_budget_status(task: dict[str, Any], report: RunReport) -> dict[str, Any]:
    execution_config = task.get("execution_config", {})
    budget = execution_config.get("cost_budget") if isinstance(execution_config, dict) else None
    cost_used = estimate_report_cost(report)
    cost_source = str(report.metrics.get("cost_source") or "provider_usage.missing")
    prompt_tokens = metric_number(report.metrics.get("prompt_tokens"))
    completion_tokens = metric_number(report.metrics.get("completion_tokens"))
    total_tokens = metric_number(report.metrics.get("total_tokens"))
    cost_currency = report.metrics.get("cost_currency")
    basis_label = budget_cost_basis_label(cost_source)
    if not isinstance(budget, (int, float)) or budget <= 0:
        return {
            "status": "not_set",
            "cost_budget": None,
            "cost_used": cost_used,
            "budget_remaining": None,
            "usage_ratio": None,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "cost_source": cost_source,
            "cost_currency": cost_currency,
            "message": f"{basis_label}：当前任务未设置成本预算。",
        }

    budget_value = float(budget)
    usage_ratio = cost_used / budget_value if budget_value else 0.0
    if cost_used > budget_value:
        status = "exceeded"
        message = f"{basis_label}已超过任务预算，建议降低样本量、并发或模型单价后重新执行。"
    elif usage_ratio >= 0.8:
        status = "warning"
        message = f"{basis_label}已接近任务预算，建议在正式批量执行前复核成本门禁。"
    else:
        status = "ok"
        message = f"{basis_label}仍在任务预算内。"
    return {
        "status": status,
        "cost_budget": budget_value,
        "cost_used": cost_used,
        "budget_remaining": max(0.0, budget_value - cost_used),
        "usage_ratio": usage_ratio,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "cost_source": cost_source,
        "cost_currency": cost_currency,
        "message": message,
    }


def build_score_analytics(
    tasks: list[dict[str, Any]],
    runner: Any,
    *,
    page: int | None = None,
    page_size: int = 20,
) -> dict[str, Any]:
    trend: list[dict[str, Any]] = []
    skipped_count = 0
    for task in sorted(tasks, key=lambda item: str(item.get("created_at", ""))):
        try:
            run = runner.get_run(str(task["run_id"]))
            report = aggregate_run_report(run)
        except Exception:
            skipped_count += 1
            continue
        budget_status = build_budget_status(task, report)
        trend.append(
            {
                "task_id": task.get("task_id"),
                "task_name": task.get("name"),
                "dataset_id": task.get("dataset_id"),
                "dataset_name": task.get("dataset_name"),
                "workflow_id": task.get("workflow_id"),
                "workflow_name": task.get("workflow_name"),
                "workflow_version_id": task.get("workflow_version_id"),
                "status": task.get("status"),
                "pass_rate": report.pass_rate,
                "error_rate": report.error_rate,
                "badcase_count": len(report.badcases),
                "p95_latency_ms": report.p95_latency_ms,
                "average_latency_ms": report.average_latency_ms,
                "cost_used": budget_status["cost_used"],
                "created_at": task.get("created_at"),
                "updated_at": task.get("updated_at"),
            }
        )

    regressions = detect_score_regressions(trend)
    task_count = len(trend)
    average_pass_rate = sum(float(item["pass_rate"]) for item in trend) / task_count if task_count else 0.0
    visible_trend = list(reversed(trend))
    payload: dict[str, Any] = {
        "summary": {
            "task_count": task_count,
            "skipped_count": skipped_count,
            "average_pass_rate": average_pass_rate,
            "latest_pass_rate": trend[-1]["pass_rate"] if trend else 0.0,
            "badcase_count": sum(int(item["badcase_count"]) for item in trend),
            "regression_count": len(regressions),
        },
        "trend": visible_trend,
        "regressions": regressions,
    }
    if page is not None:
        total_items = len(visible_trend)
        safe_page = max(page, 1)
        safe_page_size = min(max(page_size, 1), 100)
        start = (safe_page - 1) * safe_page_size
        payload["trend"] = visible_trend[start : start + safe_page_size]
        payload["pagination"] = {
            "page": safe_page,
            "page_size": safe_page_size,
            "total_items": total_items,
            "total_pages": ceil(total_items / safe_page_size) if total_items else 0,
        }
    return payload


def build_judge_audit_trends(audits: list[StoredJudgeAudit]) -> dict[str, Any]:
    grouped: dict[str, list[StoredJudgeAudit]] = {}
    for audit in sorted(audits, key=lambda item: item.created_at):
        grouped.setdefault(audit.judge_profile_id, []).append(audit)

    profiles: list[dict[str, Any]] = []
    low_consistency: list[dict[str, Any]] = []
    for profile_id, items in grouped.items():
        series = [
            {
                "audit_id": audit.audit_id,
                "dataset_version_id": audit.dataset_version_id,
                "accuracy": audit.accuracy,
                "precision": audit.precision,
                "recall": audit.recall,
                "f1": audit.f1,
                "cohen_kappa": audit.cohen_kappa,
                "misclassified_count": len(audit.misclassified_items),
                "created_at": audit.created_at,
            }
            for audit in items
        ]
        if not series:
            continue
        latest = series[-1]
        profile = {
            "profile_id": profile_id,
            "audit_count": len(series),
            "latest_accuracy": latest["accuracy"],
            "latest_kappa": latest["cohen_kappa"],
            "series": series,
        }
        profiles.append(profile)
        kappa = latest["cohen_kappa"]
        accuracy = latest["accuracy"]
        if (kappa is not None and kappa < 0.6) or (accuracy is not None and accuracy < 0.8):
            low_consistency.append(
                {
                    "profile_id": profile_id,
                    "accuracy": accuracy,
                    "cohen_kappa": kappa,
                    "message": "该 Judge Profile 最近一次审计一致性偏低，建议复核 rubric、阈值和错判样本。",
                }
            )

    return {
        "summary": {
            "audit_count": len(audits),
            "profile_count": len(grouped),
            "low_consistency_count": len(low_consistency),
        },
        "profiles": sorted(profiles, key=lambda item: str(item["profile_id"])),
        "low_consistency_profiles": low_consistency,
    }


def build_experiment_snapshot(run: RunRecord, *, name: str, baseline_run: RunRecord | None, tags: list[str]) -> dict[str, Any]:
    report = aggregate_run_report(run)
    baseline_report = aggregate_run_report(baseline_run) if baseline_run else None
    prompt_skill_versions = [
        {
            "step_id": step.step_id,
            "skill_ref": step.skill_ref,
            "prompt_version": step.config.get("prompt_version") or step.config.get("prompt") or "inline-config",
            "model": step.config.get("model"),
            "model_params": {key: step.config.get(key) for key in ("temperature", "threshold", "top_p") if key in step.config},
        }
        for step in run.workflow.steps
    ]
    metrics = report.metrics | {
        "pass_rate": report.pass_rate,
        "error_rate": report.error_rate,
        "badcase_count": len(report.badcases),
        "total_items": report.total_items,
        "completed_items": report.completed_items,
        "failed_items": report.failed_items,
        "average_latency_ms": report.average_latency_ms,
        "p95_latency_ms": report.p95_latency_ms,
        "cost": float(report.metrics.get("cost", 0) or 0),
    }
    baseline_metrics = None
    diff = None
    if baseline_report:
        baseline_metrics = baseline_report.metrics | {
            "pass_rate": baseline_report.pass_rate,
            "error_rate": baseline_report.error_rate,
            "badcase_count": len(baseline_report.badcases),
            "total_items": baseline_report.total_items,
            "completed_items": baseline_report.completed_items,
            "failed_items": baseline_report.failed_items,
            "average_latency_ms": baseline_report.average_latency_ms,
            "p95_latency_ms": baseline_report.p95_latency_ms,
            "cost": float(baseline_report.metrics.get("cost", 0) or 0),
        }
        diff = {
            key: numeric_delta(metrics.get(key), baseline_metrics.get(key))
            for key in sorted(set(metrics) | set(baseline_metrics))
            if is_number(metrics.get(key)) and is_number(baseline_metrics.get(key))
        }
    return {
        "experiment_id": f"exp-{uuid4().hex[:12]}",
        "name": name,
        "run_id": run.run_id,
        "baseline_run_id": baseline_run.run_id if baseline_run else None,
        "dataset_id": run.dataset_id,
        "dataset_version": run.dataset_version,
        "dataset_version_id": run.snapshot.get("dataset_version"),
        "workflow_id": run.workflow.workflow_id,
        "workflow_name": run.workflow.name,
        "workflow_version_id": run.workflow.version_id,
        "status": "snapshotted",
        "tags": tags,
        "snapshot": {
            "workflow_version": run.workflow.version_id,
            "workflow_hash": run.snapshot.get("workflow_hash"),
            "dataset_version": run.snapshot.get("dataset_version"),
            "skill_versions": run.snapshot.get("skill_versions", []),
            "prompt_skill_versions": prompt_skill_versions,
            "runtime": run.snapshot.get("runtime", {}),
        },
        "metrics": metrics,
        "baseline_metrics": baseline_metrics,
        "diff": diff,
        "failure_distribution": badcase_reason_distribution(report),
        "created_at": _now(),
    }


def build_trace_tree(run: RunRecord, *, page: int = 1, page_size: int = 50) -> dict[str, Any]:
    total_items = len(run.items)
    safe_page = max(page, 1)
    safe_page_size = min(max(page_size, 1), 100)
    start = (safe_page - 1) * safe_page_size
    page_items = run.items[start : start + safe_page_size]
    return {
        "run_id": run.run_id,
        "status": run.status,
        "workflow_version": run.workflow.version_id,
        "dataset_version": run.snapshot.get("dataset_version"),
        "pagination": {
            "page": safe_page,
            "page_size": safe_page_size,
            "total_items": total_items,
            "total_pages": ceil(total_items / safe_page_size) if total_items else 0,
        },
        "items": [
            {
                "item_id": item.item_id,
                "row_id": item.row_id,
                "status": item.status,
                "metrics": item.metrics,
                "error": item.error,
                "children": [
                    {
                        "step_id": step.step_id,
                        "skill_ref": step.skill_ref,
                        "status": step.status,
                        "latency_ms": step.latency_ms,
                        "cache_hit": step.cache_hit,
                        "rate_limit_wait_ms": step.rate_limit_wait_ms,
                        "input": step.input_snapshot,
                        "output": step.output_snapshot,
                        "metrics": step.metrics,
                        "error": step.error,
                    }
                    for step in item.steps
                ],
            }
            for item in page_items
        ],
    }


def build_annotation_task(run_id: str, item: dict[str, Any], *, assignee: str | None, source_task: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "task_id": f"anno-{uuid4().hex[:12]}",
        "run_id": run_id,
        "source_task_id": source_task.get("task_id") if source_task else None,
        "source_task_name": source_task.get("name") if source_task else None,
        "item_id": item["item_id"],
        "row_id": item["row_id"],
        "status": "assigned" if assignee else "pending",
        "assignee": assignee,
        "priority": "high" if item.get("status") == "failed" else "normal",
        "reason": item.get("error", {}).get("message") if item.get("error") else "低分或失败样本需要人工复核",
        "payload": {
            "metrics": item.get("metrics", {}),
            "context_snapshot": item.get("context_snapshot", {}),
            "steps": item.get("steps", []),
        },
        "review": None,
        "created_at": _now(),
        "updated_at": _now(),
    }


# ── 辅助函数 ──────────────────────────────────────────────────

def badcase_reason_distribution(report: Any) -> dict[str, int]:
    distribution: dict[str, int] = {}
    for badcase in report.badcases:
        distribution[badcase.reason] = distribution.get(badcase.reason, 0) + 1
    for error_type, count in report.error_distribution.items():
        distribution[error_type] = distribution.get(error_type, 0) + count
    return distribution


def estimate_report_cost(report: RunReport) -> float:
    cost = report.metrics.get("cost")
    if isinstance(cost, (int, float)):
        return float(cost)
    return 0.0


def metric_number(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value) if float(value).is_integer() else float(value)
    return None


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def numeric_delta(current: Any, baseline: Any) -> float:
    return float(current) - float(baseline)


def budget_cost_basis_label(cost_source: str) -> str:
    if cost_source.startswith("provider_usage.") and cost_source not in {"provider_usage.tokens_unpriced", "provider_usage.missing"}:
        return "模型网关 usage 成本"
    if cost_source == "provider_usage.tokens_unpriced":
        return "模型网关 token usage 未返回价格"
    return "模型网关未返回成本"


def detect_score_regressions(trend: list[dict[str, Any]]) -> list[dict[str, Any]]:
    regressions: list[dict[str, Any]] = []
    previous_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for item in trend:
        key = (str(item.get("dataset_id")), str(item.get("workflow_id")))
        previous = previous_by_key.get(key)
        if previous:
            delta = float(item["pass_rate"]) - float(previous["pass_rate"])
            if delta <= -0.05:
                regressions.append(
                    {
                        "task_id": item.get("task_id"),
                        "task_name": item.get("task_name"),
                        "baseline_task_id": previous.get("task_id"),
                        "dataset_id": item.get("dataset_id"),
                        "workflow_id": item.get("workflow_id"),
                        "pass_rate_delta": delta,
                        "message": "当前任务相对上一批同 Dataset/Workflow 任务通过率下降超过 5 个百分点。",
                    }
                )
        previous_by_key[key] = item
    return regressions
