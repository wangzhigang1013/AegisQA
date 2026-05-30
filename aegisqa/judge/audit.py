"""Golden Dataset 上的 Judge Profile 审计。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class JudgeAuditResult(BaseModel):
    judge_profile_id: str
    dataset_version_id: str
    accuracy: float
    precision: float
    recall: float
    f1: float
    cohen_kappa: float
    confusion_matrix: dict[str, dict[str, int]]
    misclassified_items: list[dict[str, Any]] = Field(default_factory=list)


def audit_judge_profile(
    *,
    judge_profile_id: str,
    dataset_version_id: str,
    human_labels: list[str],
    judge_labels: list[str],
    positive_label: str = "pass",
) -> JudgeAuditResult:
    """计算裁判可信度指标。

    PRD 明确要求不能只看 Accuracy，因此这里同时输出 Precision、Recall、F1、
    Cohen's Kappa 和混淆矩阵。
    """

    if len(human_labels) != len(judge_labels):
        raise ValueError("human_labels 与 judge_labels 长度必须一致")

    labels = sorted(set(human_labels) | set(judge_labels))
    confusion = {actual: {predicted: 0 for predicted in labels} for actual in labels}
    misclassified: list[dict[str, Any]] = []
    for index, (actual, predicted) in enumerate(zip(human_labels, judge_labels, strict=True)):
        confusion[actual][predicted] += 1
        if actual != predicted:
            misclassified.append({"index": index, "human_label": actual, "judge_label": predicted})

    total = len(human_labels)
    correct = sum(confusion[label][label] for label in labels)
    tp = confusion.get(positive_label, {}).get(positive_label, 0)
    fp = sum(confusion[actual].get(positive_label, 0) for actual in labels if actual != positive_label)
    fn = sum(confusion.get(positive_label, {}).get(predicted, 0) for predicted in labels if predicted != positive_label)
    accuracy = correct / total if total else 0.0
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    kappa = _cohen_kappa(confusion, labels, total, accuracy)

    return JudgeAuditResult(
        judge_profile_id=judge_profile_id,
        dataset_version_id=dataset_version_id,
        accuracy=accuracy,
        precision=precision,
        recall=recall,
        f1=f1,
        cohen_kappa=kappa,
        confusion_matrix=confusion,
        misclassified_items=misclassified,
    )


def _cohen_kappa(confusion: dict[str, dict[str, int]], labels: list[str], total: int, observed: float) -> float:
    if total == 0:
        return 0.0
    expected = 0.0
    for label in labels:
        actual_total = sum(confusion[label].values())
        predicted_total = sum(confusion[actual][label] for actual in labels)
        expected += (actual_total / total) * (predicted_total / total)
    if expected == 1:
        return 1.0
    return (observed - expected) / (1 - expected)

