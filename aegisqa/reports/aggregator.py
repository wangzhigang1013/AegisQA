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


def _item_label(item: Any) -> str | None:
    return item.context_snapshot.get("context", {}).get("judge_label")


def _item_score(item: Any) -> float | None:
    score = item.metrics.get("judge_score") or item.context_snapshot.get("metrics", {}).get("judge_score")
    return float(score) if score is not None else None


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
