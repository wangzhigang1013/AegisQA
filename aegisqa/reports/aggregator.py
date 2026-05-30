"""Run 报告聚合。"""

from __future__ import annotations

from statistics import mean
import csv
import json
from html import escape
from typing import Any

from pydantic import BaseModel, Field

from aegisqa.engine.runner import RunRecord


class ReportBadcase(BaseModel):
    item_id: str
    row_id: str
    reason: str
    score: float | None = None
    label: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class RunReport(BaseModel):
    run_id: str
    total_items: int
    completed_items: int
    failed_items: int
    pass_rate: float
    error_rate: float
    average_latency_ms: float
    p95_latency_ms: float
    metrics: dict[str, Any]
    error_distribution: dict[str, int]
    badcases: list[ReportBadcase]


class ReportSegment(BaseModel):
    segment_key: str
    segment_value: str
    sample_count: int
    pass_count: int
    fail_count: int
    badcase_count: int
    pass_rate: float
    average_score: float | None = None


class ReportRecommendation(BaseModel):
    type: str
    title: str
    message: str
    action: str
    severity: str = "info"
    segment_key: str | None = None
    segment_value: str | None = None


def aggregate_run_report(run: RunRecord) -> RunReport:
    """把 Item/Step 明细聚合成 Run 级报告。"""

    total = len(run.items)
    completed = sum(1 for item in run.items if item.status == "succeeded")
    failed = sum(1 for item in run.items if item.status == "failed")
    latencies = [step.latency_ms for item in run.items for step in item.steps if step.status == "succeeded"]
    labels = [_item_label(item) for item in run.items]
    pass_count = sum(1 for label in labels if label == "pass")
    error_distribution: dict[str, int] = {}
    badcases: list[ReportBadcase] = []

    for item in run.items:
        if item.error:
            error_type = item.error.get("type", "Unknown")
            error_distribution[error_type] = error_distribution.get(error_type, 0) + 1
            badcases.append(
                ReportBadcase(
                    item_id=item.item_id,
                    row_id=item.row_id,
                    reason=error_type,
                    payload=item.context_snapshot,
                )
            )
            continue

        label = _item_label(item)
        score = _item_score(item)
        if label == "fail" or (score is not None and score < 0.6):
            badcases.append(
                ReportBadcase(
                    item_id=item.item_id,
                    row_id=item.row_id,
                    reason=f"judge_label={label}",
                    score=score,
                    label=label,
                    payload=item.context_snapshot,
                )
            )

    metrics = _aggregate_numeric_metrics(run)
    metrics.update(
        {
            "count": total,
            "completed": completed,
            "failed": failed,
            "pass_rate": pass_count / completed if completed else 0.0,
            "error_rate": failed / total if total else 0.0,
            "badcase_count": len(badcases),
        }
    )
    return RunReport(
        run_id=run.run_id,
        total_items=total,
        completed_items=completed,
        failed_items=failed,
        pass_rate=metrics["pass_rate"],
        error_rate=metrics["error_rate"],
        average_latency_ms=mean(latencies) if latencies else 0.0,
        p95_latency_ms=_p95(latencies),
        metrics=metrics,
        error_distribution=error_distribution,
        badcases=badcases,
    )


def build_report_segments(run: RunRecord, keys: tuple[str, ...] = ("scene", "expected_label", "model_version", "prompt_version")) -> list[ReportSegment]:
    """按业务维度拆解报告，避免总通过率掩盖局部质量问题。"""

    buckets: dict[tuple[str, str], dict[str, Any]] = {}
    for item in run.items:
        row = item.context_snapshot.get("row", {})
        if not isinstance(row, dict):
            row = {}
        label = _item_label(item)
        score = _item_score(item)
        is_pass = label == "pass"
        is_badcase = _is_badcase_item(item)

        for key in keys:
            value = _segment_value(key, row, item)
            if value is None:
                continue
            bucket = buckets.setdefault(
                (key, value),
                {"segment_key": key, "segment_value": value, "sample_count": 0, "pass_count": 0, "badcase_count": 0, "scores": []},
            )
            bucket["sample_count"] += 1
            if is_pass:
                bucket["pass_count"] += 1
            if is_badcase:
                bucket["badcase_count"] += 1
            if score is not None:
                bucket["scores"].append(score)

    segments: list[ReportSegment] = []
    for bucket in buckets.values():
        sample_count = bucket["sample_count"]
        pass_count = bucket["pass_count"]
        scores = bucket["scores"]
        segments.append(
            ReportSegment(
                segment_key=bucket["segment_key"],
                segment_value=bucket["segment_value"],
                sample_count=sample_count,
                pass_count=pass_count,
                fail_count=sample_count - pass_count,
                badcase_count=bucket["badcase_count"],
                pass_rate=pass_count / sample_count if sample_count else 0.0,
                average_score=mean(scores) if scores else None,
            )
        )
    return sorted(segments, key=lambda item: (item.segment_key, item.pass_rate, item.segment_value))


def build_report_recommendations(segments: list[ReportSegment], pass_rate_threshold: float = 0.8) -> list[ReportRecommendation]:
    weak_segments = [segment for segment in segments if segment.sample_count > 0 and segment.pass_rate < pass_rate_threshold]
    if not weak_segments:
        return []

    target = sorted(weak_segments, key=lambda segment: (segment.pass_rate, -segment.badcase_count, segment.segment_key))[0]
    label = f"{target.segment_key}={target.segment_value}"
    rate_text = f"{round(target.pass_rate * 100)}%"
    return [
        ReportRecommendation(
            type="segment_low_pass_rate",
            title="低通过率分组加入 Annotation",
            message=f"{label} 通过率 {rate_text}，建议抽样进入人工审核，先确认失败原因是否来自数据、Prompt 或 Judge。",
            action="add_to_annotation_queue",
            severity="warning",
            segment_key=target.segment_key,
            segment_value=target.segment_value,
        ),
        ReportRecommendation(
            type="golden_candidate",
            title="生成 Golden 候选",
            message=f"{label} 有 {target.badcase_count} 条 Badcase，建议沉淀为 Golden 候选，后续用于回归评测和 Judge 审计。",
            action="create_golden_candidates",
            severity="info",
            segment_key=target.segment_key,
            segment_value=target.segment_value,
        ),
        ReportRecommendation(
            type="ci_gate_suggestion",
            title="生成 CI Gate 建议",
            message=f"建议为 {label} 设置通过率门禁，防止局部场景退化被总体指标掩盖。",
            action="create_ci_gate",
            severity="critical",
            segment_key=target.segment_key,
            segment_value=target.segment_value,
        ),
    ]


def _item_label(item: Any) -> str | None:
    return item.context_snapshot.get("context", {}).get("judge_label")


def _item_score(item: Any) -> float | None:
    score = item.metrics.get("judge_score") or item.context_snapshot.get("metrics", {}).get("judge_score")
    return float(score) if score is not None else None


def _is_badcase_item(item: Any) -> bool:
    if item.error:
        return True
    label = _item_label(item)
    score = _item_score(item)
    return label == "fail" or (score is not None and score < 0.6)


def _segment_value(key: str, row: dict[str, Any], item: Any) -> str | None:
    if key in row and row[key] not in (None, ""):
        return str(row[key])
    if key == "model_version":
        for step in item.steps:
            model = step.config_snapshot.get("model") if isinstance(step.config_snapshot, dict) else None
            if model not in (None, ""):
                return str(model)
    return None


def _aggregate_numeric_metrics(run: RunRecord) -> dict[str, Any]:
    values: dict[str, list[float]] = {}
    for item in run.items:
        for key, value in item.metrics.items():
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                values.setdefault(key, []).append(float(value))
    return {f"avg_{key}": mean(items) for key, items in values.items() if items}


def _p95(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(round((len(ordered) - 1) * 0.95)))
    return ordered[index]


def compare_reports(before: RunReport, after: RunReport) -> dict[str, Any]:
    """跨 Run 趋势对比。"""

    metric_delta = {}
    keys = set(before.metrics) | set(after.metrics)
    for key in keys:
        left = before.metrics.get(key)
        right = after.metrics.get(key)
        if isinstance(left, (int, float)) and isinstance(right, (int, float)):
            metric_delta[f"{key}_delta"] = _round_delta(right - left)
    return {
        "before_run_id": before.run_id,
        "after_run_id": after.run_id,
        "pass_rate_delta": _round_delta(after.pass_rate - before.pass_rate),
        "error_rate_delta": _round_delta(after.error_rate - before.error_rate),
        "badcase_delta": len(after.badcases) - len(before.badcases),
        "metric_delta": metric_delta,
    }


def export_report_csv(report: RunReport, output_path: Any) -> Any:
    """导出单次 Run 报告核心指标。"""

    with output_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["metric", "value"])
        writer.writerow(["run_id", report.run_id])
        writer.writerow(["total_items", report.total_items])
        writer.writerow(["completed_items", report.completed_items])
        writer.writerow(["failed_items", report.failed_items])
        writer.writerow(["pass_rate", report.pass_rate])
        writer.writerow(["error_rate", report.error_rate])
        writer.writerow(["average_latency_ms", report.average_latency_ms])
        writer.writerow(["p95_latency_ms", report.p95_latency_ms])
        for key, value in sorted(report.metrics.items()):
            writer.writerow([key, value])
    return output_path


def export_report_html(report: RunReport, output_path: Any) -> Any:
    """导出 HTML 报告。

    HTML 是 PRD P1 报告导出的最轻量格式，适合在没有 PDF 渲染依赖的本地环境中
    验证报告可携带核心指标、错误分布和 Badcase 摘要。
    """

    rows = [
        ("run_id", report.run_id),
        ("total_items", report.total_items),
        ("completed_items", report.completed_items),
        ("failed_items", report.failed_items),
        ("pass_rate", report.pass_rate),
        ("error_rate", report.error_rate),
        ("average_latency_ms", report.average_latency_ms),
        ("p95_latency_ms", report.p95_latency_ms),
    ]
    metric_rows = rows + sorted(report.metrics.items())
    html = [
        "<html><head><meta charset=\"utf-8\"><title>AegisQA Run Report</title></head><body>",
        "<h1>AegisQA Run Report</h1>",
        "<h2>核心指标</h2><table><thead><tr><th>metric</th><th>value</th></tr></thead><tbody>",
    ]
    for key, value in metric_rows:
        html.append(f"<tr><td>{escape(str(key))}</td><td>{escape(str(value))}</td></tr>")
    html.append("</tbody></table>")
    html.append("<h2>错误分布</h2><pre>")
    html.append(escape(json.dumps(report.error_distribution, ensure_ascii=False, indent=2)))
    html.append("</pre></body></html>")
    output_path.write_text("\n".join(html), encoding="utf-8")
    return output_path


def _round_delta(value: float) -> float:
    """规整展示型差值，避免二进制浮点尾巴污染趋势报告。"""

    return round(value, 10)
