"""任务报告根因诊断。

这一层把报告指标、分层分析、Step Trace、数据字段和参数来源合并成
“可行动”的诊断结果。它不替代人工复盘，而是帮助用户先判断应该优先查
数据质量、Workflow 映射、Skill/Judge 质量还是参数配置。
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from aegisqa.engine.runner import RunRecord
from aegisqa.reports.aggregator import RunReport


def build_task_diagnostics(
    task: dict[str, Any],
    run: RunRecord,
    report: RunReport,
    segments: list[Any],
    parameter_governance: dict[str, Any],
) -> dict[str, Any]:
    """构建任务级根因诊断。

    诊断结果只使用已经落在 Run/Report 里的证据，不调用外部模型。这样本地测试
    可复现，也能避免把诊断本身变成一个新的黑盒 Judge。
    """

    step_health = _build_step_health(run)
    data_quality = _build_data_quality(run)
    parameter_risks = _build_parameter_risks(parameter_governance)
    weak_segments = _build_weak_segments(segments)
    root_causes = _build_root_causes(report, weak_segments, data_quality, step_health, parameter_risks)
    primary_cause = _primary_cause(root_causes)
    evidence_count = sum(len(item["evidence"]) for item in root_causes)

    return {
        "task_id": task.get("task_id"),
        "run_id": run.run_id,
        "summary": {
            "status": "healthy" if not root_causes else "needs_attention",
            "primary_cause": primary_cause,
            "confidence": _primary_confidence(root_causes),
            "evidence_count": evidence_count,
        },
        "root_causes": root_causes,
        "weak_segments": weak_segments,
        "step_health": step_health,
        "data_quality": data_quality,
        "parameter_risks": parameter_risks,
    }


def _build_step_health(run: RunRecord) -> list[dict[str, Any]]:
    by_step: dict[str, dict[str, Any]] = {}
    for item in run.items:
        for step in item.steps:
            bucket = by_step.setdefault(
                step.step_id,
                {
                    "step_id": step.step_id,
                    "skill_ref": step.skill_ref,
                    "total_calls": 0,
                    "failed_calls": 0,
                    "cache_hits": 0,
                    "total_latency_ms": 0.0,
                    "signals": [],
                },
            )
            bucket["total_calls"] += 1
            bucket["failed_calls"] += 1 if step.status == "failed" else 0
            bucket["cache_hits"] += 1 if step.cache_hit else 0
            bucket["total_latency_ms"] += step.latency_ms
            if step.error:
                error_type = str(step.error.get("type") or "Unknown")
                bucket["signals"].append(f"{error_type}: {step.error.get('message', '')}".strip())

    result: list[dict[str, Any]] = []
    for bucket in by_step.values():
        total_calls = max(1, int(bucket["total_calls"]))
        failed_calls = int(bucket["failed_calls"])
        average_latency_ms = float(bucket["total_latency_ms"]) / total_calls
        cache_hit_rate = int(bucket["cache_hits"]) / total_calls
        status = "failed" if failed_calls else "slow" if average_latency_ms > 1000 else "healthy"
        result.append(
            {
                **bucket,
                "average_latency_ms": average_latency_ms,
                "cache_hit_rate": cache_hit_rate,
                "status": status,
                "signals": sorted(set(bucket["signals"]))[:5],
            }
        )
    return sorted(result, key=lambda item: item["step_id"])


def _build_data_quality(run: RunRecord) -> dict[str, Any]:
    rows = [_row_payload(item) for item in run.items]
    expected_fields = sorted(_expected_row_fields(run) | {key for row in rows for key in row})
    field_coverage = []
    for field in expected_fields:
        present_count = sum(1 for row in rows if row.get(field) not in (None, ""))
        missing_count = len(rows) - present_count
        field_coverage.append(
            {
                "field": field,
                "present_count": present_count,
                "missing_count": missing_count,
                "coverage": present_count / len(rows) if rows else 0.0,
                "required_by_workflow": field in _expected_row_fields(run),
            }
        )

    row_hashes = [item.row_hash for item in run.items]
    duplicate_row_count = sum(count - 1 for count in Counter(row_hashes).values() if count > 1)
    missing_required_fields = [
        item["field"]
        for item in field_coverage
        if item["required_by_workflow"] and item["missing_count"] > 0
    ]
    warnings = []
    if missing_required_fields:
        warnings.append(f"Workflow 需要字段 {', '.join(missing_required_fields)}，但部分样本缺失。")
    if duplicate_row_count:
        warnings.append(f"检测到 {duplicate_row_count} 条重复样本，可能影响通过率和 Badcase 分布。")
    return {
        "row_count": len(rows),
        "duplicate_row_count": duplicate_row_count,
        "field_coverage": field_coverage,
        "warnings": warnings,
    }


def _build_parameter_risks(parameter_governance: dict[str, Any]) -> dict[str, Any]:
    sources: Counter[str] = Counter()
    redacted_count = 0
    expression_count = 0
    secret_ref_count = 0
    for step in parameter_governance.get("parameter_sources", []):
        parameters = step.get("parameters", {}) if isinstance(step, dict) else {}
        if not isinstance(parameters, dict):
            continue
        for trace in parameters.values():
            if not isinstance(trace, dict):
                continue
            source = str(trace.get("source") or "unknown")
            sources[source] += 1
            redacted_count += 1 if trace.get("redacted") else 0
            expression_count += 1 if trace.get("expression_path") else 0
            secret_ref_count += 1 if trace.get("secret_ref") else 0
    return {
        "override_count": sources.get("task_override", 0),
        "expression_count": expression_count,
        "secret_ref_count": secret_ref_count,
        "redacted_count": redacted_count,
        "sources": dict(sorted(sources.items())),
        "warnings": _parameter_warnings(sources, expression_count, secret_ref_count),
    }


def _build_weak_segments(segments: list[Any]) -> list[dict[str, Any]]:
    weak = []
    for segment in segments:
        sample_count = int(getattr(segment, "sample_count", 0))
        pass_rate = float(getattr(segment, "pass_rate", 0.0))
        if sample_count <= 0 or pass_rate >= 0.8:
            continue
        weak.append(
            {
                "segment_key": getattr(segment, "segment_key", ""),
                "segment_value": getattr(segment, "segment_value", ""),
                "sample_count": sample_count,
                "badcase_count": int(getattr(segment, "badcase_count", 0)),
                "pass_rate": pass_rate,
                "severity": "critical" if pass_rate < 0.6 else "warning",
            }
        )
    return sorted(weak, key=lambda item: (item["pass_rate"], -item["badcase_count"], item["segment_key"]))


def _build_root_causes(
    report: RunReport,
    weak_segments: list[dict[str, Any]],
    data_quality: dict[str, Any],
    step_health: list[dict[str, Any]],
    parameter_risks: dict[str, Any],
) -> list[dict[str, Any]]:
    root_causes: list[dict[str, Any]] = []

    failed_steps = [step for step in step_health if step["failed_calls"] > 0]
    if failed_steps or report.error_distribution:
        affected = sum(int(step["failed_calls"]) for step in failed_steps) or report.failed_items
        root_causes.append(
            _cause(
                "runtime_error",
                "critical",
                0.95,
                affected,
                [f"{step['step_id']} 失败 {step['failed_calls']} 次" for step in failed_steps] + [f"{key}: {value}" for key, value in report.error_distribution.items()],
                "优先检查失败 Step 的 input_mapping、schema、依赖和异常日志，再决定是否重试失败项。",
                ["open_trace_flow", "retry_failed_items"],
            )
        )

    if data_quality["warnings"]:
        root_causes.append(
            _cause(
                "data_quality",
                "critical",
                0.9,
                max(data_quality["duplicate_row_count"], sum(item["missing_count"] for item in data_quality["field_coverage"] if item["required_by_workflow"])),
                data_quality["warnings"],
                "优先修复缺失字段、重复样本或字段类型，再重新创建 Dataset Version。",
                ["open_dataset_lineage", "fix_dataset_fields"],
            )
        )

    if weak_segments:
        weakest = weak_segments[0]
        root_causes.append(
            _cause(
                "weak_segment",
                weakest["severity"],
                0.82,
                weakest["badcase_count"],
                [f"{weakest['segment_key']}={weakest['segment_value']} 通过率 {round(weakest['pass_rate'] * 100)}%，Badcase {weakest['badcase_count']} 条。"],
                "对低通过率分层抽样复核，确认是数据分布、Prompt、模型版本还是 Judge 阈值造成退化。",
                ["seed_annotation_queue", "create_segment_ci_gate"],
            )
        )

    judged_badcases = [badcase for badcase in report.badcases if str(badcase.reason).startswith("judge_label")]
    if judged_badcases:
        reason_counts = Counter(badcase.reason for badcase in judged_badcases)
        root_causes.append(
            _cause(
                "judge_or_answer_quality",
                "warning",
                0.72,
                len(judged_badcases),
                [f"{reason}: {count} 条" for reason, count in reason_counts.items()],
                "查看失败样本的回答、参考答案和 Judge reason，必要时把样本加入 Golden 并重新审计 Judge。",
                ["review_badcases", "audit_judge_profile"],
            )
        )

    if parameter_risks["override_count"] or parameter_risks["expression_count"] or parameter_risks["secret_ref_count"]:
        root_causes.append(
            _cause(
                "parameter_risk",
                "info",
                0.58,
                int(parameter_risks["override_count"] + parameter_risks["expression_count"] + parameter_risks["secret_ref_count"]),
                parameter_risks["warnings"] or ["任务存在参数覆盖或运行时表达式，建议确认是否符合本次评测预期。"],
                "检查任务冻结参数和参数来源，确认 task_override、runtime_expression、secret_ref 是否来自预期配置。",
                ["open_parameter_governance", "plan_workflow_parameter_changes"],
            )
        )

    return sorted(root_causes, key=lambda item: _severity_rank(item["severity"]), reverse=True)


def _cause(cause_type: str, severity: str, confidence: float, affected_items: int, evidence: list[str], recommendation: str, next_actions: list[str]) -> dict[str, Any]:
    return {
        "cause_type": cause_type,
        "severity": severity,
        "confidence": confidence,
        "affected_items": affected_items,
        "evidence": [item for item in evidence if item][:5],
        "recommendation": recommendation,
        "next_actions": next_actions,
    }


def _primary_cause(root_causes: list[dict[str, Any]]) -> str:
    if not root_causes:
        return "healthy"
    priority = {"runtime_error": 5, "data_quality": 4, "weak_segment": 3, "judge_or_answer_quality": 2, "parameter_risk": 1}
    return max(root_causes, key=lambda item: (priority.get(item["cause_type"], 0), item["confidence"]))["cause_type"]


def _primary_confidence(root_causes: list[dict[str, Any]]) -> float:
    if not root_causes:
        return 1.0
    return float(max(item["confidence"] for item in root_causes))


def _severity_rank(severity: str) -> int:
    return {"critical": 3, "warning": 2, "info": 1}.get(severity, 0)


def _row_payload(item: Any) -> dict[str, Any]:
    row = item.context_snapshot.get("row", {}) if isinstance(item.context_snapshot, dict) else {}
    return row if isinstance(row, dict) else {}


def _expected_row_fields(run: RunRecord) -> set[str]:
    fields: set[str] = set()
    for step in run.workflow.steps:
        for source in step.input_mapping.values():
            if isinstance(source, str) and source.startswith("row."):
                field = source.removeprefix("row.").split(".")[0]
                if field:
                    fields.add(field)
    return fields


def _parameter_warnings(sources: Counter[str], expression_count: int, secret_ref_count: int) -> list[str]:
    warnings = []
    if sources.get("task_override", 0):
        warnings.append(f"检测到 {sources['task_override']} 个任务级参数覆盖，评测结果需要与默认配置区分归档。")
    if expression_count:
        warnings.append(f"检测到 {expression_count} 个运行时表达式参数，请确认表达式路径在样本中稳定存在。")
    if secret_ref_count:
        warnings.append(f"检测到 {secret_ref_count} 个 secret_ref 参数，报告只保留脱敏引用。")
    return warnings
