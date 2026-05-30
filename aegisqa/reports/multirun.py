"""Sample Multi-Run 聚合。"""

from __future__ import annotations

from collections import Counter, defaultdict
from statistics import variance
from typing import Any


def aggregate_repeat_items(items: list[dict[str, Any]]) -> dict[str, Any]:
    """按 row_id 聚合同一样本的多次运行结果。"""

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        grouped[str(item["row_id"])].append(item)

    rows: dict[str, dict[str, Any]] = {}
    unstable: list[str] = []
    for row_id, repeats in grouped.items():
        labels = [repeat.get("label") for repeat in repeats]
        scores = [float(repeat.get("score", 0.0)) for repeat in repeats]
        label_counts = Counter(labels)
        majority_label = label_counts.most_common(1)[0][0]
        pass_probability = label_counts.get("pass", 0) / len(repeats)
        score_variance = variance(scores) if len(scores) > 1 else 0.0
        is_unstable = len(label_counts) > 1 or score_variance > 0.05
        if is_unstable:
            unstable.append(row_id)
        rows[row_id] = {
            "repeat_count": len(repeats),
            "majority_vote_label": majority_label,
            "pass_probability": pass_probability,
            "score_variance": score_variance,
            "label_counts": dict(label_counts),
            "unstable": is_unstable,
        }

    return {"rows": rows, "unstable_row_ids": sorted(unstable)}

