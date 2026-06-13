"""自定义评测指标模块。

支持业务自定义的评分维度、指标权重和综合评分。
"""

from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


class MetricDefinition(BaseModel):
    """指标定义。"""
    name: str
    display_name: str
    description: str = ""
    type: str = "continuous"  # continuous / categorical / binary
    min_value: float = 0.0
    max_value: float = 1.0
    weight: float = 1.0
    higher_is_better: bool = True
    thresholds: dict[str, float] = Field(default_factory=dict)  # {"good": 0.8, "acceptable": 0.6}


class MetricAggregation(BaseModel):
    """指标聚合结果。"""
    name: str
    display_name: str
    type: str
    count: int
    mean: float
    std: float = 0.0
    min_value: float = 0.0
    max_value: float = 0.0
    p25: float = 0.0
    p50: float = 0.0
    p75: float = 0.0
    distribution: dict[str, int] = Field(default_factory=dict)  # categorical 类型的分布
    weighted_score: float = 0.0


class CustomMetricsReport(BaseModel):
    """自定义指标报告。"""
    metrics: list[MetricAggregation]
    composite_score: float = 0.0
    composite_score_breakdown: dict[str, float] = Field(default_factory=dict)


def aggregate_custom_metrics(
    items: list[dict[str, Any]],
    metric_definitions: list[MetricDefinition],
) -> CustomMetricsReport:
    """聚合自定义指标。

    Args:
        items: 项目的 metrics 列表。
        metric_definitions: 指标定义列表。

    Returns:
        自定义指标报告。
    """
    aggregations: list[MetricAggregation] = []
    weighted_scores: dict[str, float] = {}

    for metric_def in metric_definitions:
        values = []
        distribution: dict[str, int] = {}

        for item_metrics in items:
            value = item_metrics.get(metric_def.name)
            if value is None:
                continue

            if metric_def.type == "continuous":
                try:
                    float_val = float(value)
                    values.append(float_val)
                except (TypeError, ValueError):
                    continue
            elif metric_def.type == "categorical":
                str_val = str(value)
                distribution[str_val] = distribution.get(str_val, 0) + 1
            elif metric_def.type == "binary":
                bool_val = bool(value)
                key = "pass" if bool_val else "fail"
                distribution[key] = distribution.get(key, 0) + 1

        if metric_def.type in ("categorical", "binary"):
            total = sum(distribution.values())
            mean_val = distribution.get("pass", 0) / total if total > 0 else 0.0
            aggregations.append(MetricAggregation(
                name=metric_def.name,
                display_name=metric_def.display_name,
                type=metric_def.type,
                count=total,
                mean=mean_val,
                distribution=distribution,
                weighted_score=mean_val * metric_def.weight,
            ))
            weighted_scores[metric_def.name] = mean_val * metric_def.weight
        elif values:
            import statistics
            sorted_vals = sorted(values)
            n = len(sorted_vals)
            mean_val = statistics.mean(values)
            std_val = statistics.stdev(values) if n > 1 else 0.0

            aggregations.append(MetricAggregation(
                name=metric_def.name,
                display_name=metric_def.display_name,
                type=metric_def.type,
                count=n,
                mean=mean_val,
                std=std_val,
                min_value=min(values),
                max_value=max(values),
                p25=sorted_vals[n // 4] if n > 0 else 0.0,
                p50=sorted_vals[n // 2] if n > 0 else 0.0,
                p75=sorted_vals[3 * n // 4] if n > 0 else 0.0,
                weighted_score=mean_val * metric_def.weight,
            ))
            weighted_scores[metric_def.name] = mean_val * metric_def.weight

    # 计算综合评分
    total_weight = sum(d.weight for d in metric_definitions if d.name in weighted_scores)
    composite_score = sum(weighted_scores.values()) / total_weight if total_weight > 0 else 0.0

    return CustomMetricsReport(
        metrics=aggregations,
        composite_score=composite_score,
        composite_score_breakdown=weighted_scores,
    )


# 预置指标定义
PRESET_METRICS = {
    "rag": [
        MetricDefinition(
            name="faithfulness",
            display_name="忠实度",
            description="回答是否忠实于上下文",
            type="continuous",
            weight=1.0,
            thresholds={"good": 0.8, "acceptable": 0.6},
        ),
        MetricDefinition(
            name="relevance",
            display_name="相关性",
            description="回答是否与问题相关",
            type="continuous",
            weight=1.0,
            thresholds={"good": 0.8, "acceptable": 0.6},
        ),
        MetricDefinition(
            name="context_recall",
            display_name="上下文召回",
            description="检索的上下文是否包含答案",
            type="continuous",
            weight=0.8,
            thresholds={"good": 0.7, "acceptable": 0.5},
        ),
    ],
    "agent": [
        MetricDefinition(
            name="tool_use_accuracy",
            display_name="工具使用准确率",
            description="是否正确选择了工具",
            type="binary",
            weight=1.0,
        ),
        MetricDefinition(
            name="planning_efficiency",
            display_name="规划效率",
            description="完成任务的步骤数",
            type="continuous",
            min_value=0,
            max_value=100,
            weight=0.5,
            higher_is_better=False,
        ),
        MetricDefinition(
            name="reflection_quality",
            display_name="反思质量",
            description="自我反思的深度和准确性",
            type="continuous",
            weight=0.8,
        ),
    ],
    "safety": [
        MetricDefinition(
            name="prompt_injection_resistance",
            display_name="注入防御",
            description="是否抵抗了 prompt injection",
            type="binary",
            weight=1.0,
        ),
        MetricDefinition(
            name="pii_leakage",
            display_name="PII 泄露",
            description="是否泄露了个人信息",
            type="binary",
            weight=1.0,
        ),
        MetricDefinition(
            name="harmful_content",
            display_name="有害内容",
            description="是否生成了有害内容",
            type="binary",
            weight=1.0,
        ),
    ],
}
