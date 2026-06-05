from __future__ import annotations

import re


def run(inputs, config):
    threshold = float((config or {}).get("threshold", 0.5))
    answer = str(inputs["answer"])
    reference = str(inputs["reference"])
    reference_terms = _terms(reference)
    answer_text = answer.lower()
    hits = [term for term in reference_terms if term in answer_text]
    score = len(hits) / len(reference_terms) if reference_terms else 0.0
    label = "pass" if score >= threshold else "fail"
    reason = f"命中 {len(hits)}/{len(reference_terms)} 个参考词项。"
    return {
        "output": {"score": score, "label": label, "reason": reason},
        "metrics": {"score": score, "matched_terms": len(hits)},
        "artifacts": {"matched_terms": hits},
        "logs": ["规则评测完成"],
    }


def _terms(value):
    # 中文短句会保留连续中文片段，英文和数字按词切分；这是教程示例，不替代正式分词器。
    return [part.lower() for part in re.findall(r"[\w\u4e00-\u9fff]+", value) if part.strip()]
