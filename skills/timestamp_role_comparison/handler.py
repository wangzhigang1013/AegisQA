"""
角色识别正确率评估 Skill

基于时间戳 IoU 对齐，评估 ASR 角色识别正确率。
"""

import re


# 角色归一化：销售X / 客户X → 销售 / 客户；其他X → None
_ROLE_NORM_RE = re.compile(r"^(销售|客户|其他)\d*$")


def _norm_role(label: str) -> str | None:
    """'销售1' → '销售'，'客户2' → '客户'，'其他1' → None"""
    m = _ROLE_NORM_RE.match(label.strip())
    if not m:
        return None
    role = m.group(1)
    return role if role != "其他" else None


def _calc_iou(a: dict, b: dict) -> float:
    """计算两个时间段的 IoU（交并比）"""
    inter = max(0, min(a["end"], b["end"]) - max(a["start"], b["start"]))
    union = max(a["end"], b["end"]) - min(a["start"], b["start"])
    return inter / union if union > 0 else 0.0


def _best_iou_match(seg: dict, candidates: list[dict]) -> tuple[dict | None, float]:
    """在 candidates 中找与 seg IoU 最高的话段"""
    best, best_iou = None, 0.0
    for c in candidates:
        iou = _calc_iou(seg, c)
        if iou > best_iou:
            best, best_iou = c, iou
    return best, best_iou


def _evaluate_iou(ref_segs: list[dict], hyp_segs: list[dict],
                  iou_threshold: float = 0.5) -> dict:
    """
    对单条对话做话段级角色评估

    Returns:
        {
            "correct": 匹配且角色一致的话段数,
            "wrong": 匹配但角色不一致的话段数,
            "unmatched": IoU 低于阈值，无法对齐的话段数,
            "skipped": HYP 或 REF 话段为「其他」，跳过统计,
            "iou_values": 所有有效匹配的 IoU 列表,
            "wrong_cases": 错误案例列表
        }
    """
    correct, wrong, unmatched, skipped = 0, 0, 0, 0
    iou_values = []
    wrong_cases = []

    for h in hyp_segs:
        # HYP 为「其他」，跳过
        if h["role"] is None:
            skipped += 1
            continue

        ref_match, iou = _best_iou_match(h, ref_segs)

        if iou < iou_threshold or ref_match is None:
            unmatched += 1
            continue

        # REF 匹配段为「其他」，跳过
        if ref_match["role"] is None:
            skipped += 1
            continue

        iou_values.append(iou)

        if h["role"] == ref_match["role"]:
            correct += 1
        else:
            wrong += 1
            wrong_cases.append({
                "hyp_start": h["start"],
                "hyp_end": h["end"],
                "hyp_role": h["role_raw"],
                "hyp_text": h["text"][:30],
                "ref_start": ref_match["start"],
                "ref_end": ref_match["end"],
                "ref_role": ref_match["role_raw"],
                "ref_text": ref_match["text"][:30],
                "iou": round(iou, 3),
            })

    return {
        "correct": correct,
        "wrong": wrong,
        "unmatched": unmatched,
        "skipped": skipped,
        "iou_values": iou_values,
        "wrong_cases": wrong_cases,
    }


def run(inputs: dict, config: dict) -> dict:
    """
    Skill 入口函数

    Args:
        inputs: {
            "reference_segments": [{"start": int, "end": int, "role": str, "text": str}, ...],
            "hypothesis_segments": [{"start": int, "end": int, "role": str, "text": str}, ...]
        }
        config: {"iou_threshold": float, "min_duration": int, "normalize_roles": bool}

    Returns:
        {
            "output": {...},
            "metrics": {...},
            "artifacts": {},
            "logs": []
        }
    """
    reference_segments = inputs.get("reference_segments", [])
    hypothesis_segments = inputs.get("hypothesis_segments", [])

    iou_threshold = config.get("iou_threshold", 0.5)
    min_duration = config.get("min_duration", 0)
    normalize_roles = config.get("normalize_roles", True)

    # 处理话段
    def process_segments(segments):
        processed = []
        for seg in segments:
            duration = seg["end"] - seg["start"]
            if duration < min_duration:
                continue
            role_raw = seg["role"]
            role = _norm_role(role_raw) if normalize_roles else role_raw
            processed.append({
                "start": seg["start"],
                "end": seg["end"],
                "role_raw": role_raw,
                "role": role,
                "text": seg["text"],
            })
        return processed

    ref_segs = process_segments(reference_segments)
    hyp_segs = process_segments(hypothesis_segments)

    # 评估
    ev = _evaluate_iou(ref_segs, hyp_segs, iou_threshold)

    # 计算指标
    matched = ev["correct"] + ev["wrong"]
    total_hyp = ev["correct"] + ev["wrong"] + ev["unmatched"] + ev["skipped"]
    role_accuracy = round(ev["correct"] / matched * 100, 2) if matched > 0 else 0
    avg_iou = round(sum(ev["iou_values"]) / len(ev["iou_values"]), 3) if ev["iou_values"] else 0

    output = {
        "role_accuracy": role_accuracy,
        "total_segments": total_hyp,
        "matched_segments": matched,
        "correct_segments": ev["correct"],
        "wrong_segments": ev["wrong"],
        "unmatched_segments": ev["unmatched"],
        "skipped_segments": ev["skipped"],
        "avg_iou": avg_iou,
        "wrong_cases": ev["wrong_cases"][:10],  # 限制返回前10个错误案例
    }

    metrics = {
        "role_accuracy": role_accuracy,
        "matched_rate": round(matched / (matched + ev["unmatched"]) * 100, 2) if (matched + ev["unmatched"]) > 0 else 0,
        "avg_iou": avg_iou,
    }

    return {
        "output": output,
        "metrics": metrics,
        "artifacts": {},
        "logs": []
    }
