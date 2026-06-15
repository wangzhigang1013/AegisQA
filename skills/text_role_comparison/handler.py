"""
文本角色对比 Skill

基于文本内容相似度对齐，评估 ASR 角色识别正确率。
不依赖时间戳，适用于没有时间戳信息的场景。
"""

import re
import difflib


# 角色归一化：销售X / 客户X → 销售 / 客户；其他X → None
_ROLE_NORM_RE = re.compile(r"^(销售|客户|其他)\d*$")


def _norm_role(label: str) -> str | None:
    """'销售1' → '销售'，'客户2' → '客户'，'其他1' → None"""
    m = _ROLE_NORM_RE.match(label.strip())
    if not m:
        return None
    role = m.group(1)
    return role if role != "其他" else None


def _normalize_text(text: str) -> str:
    """
    归一化文本用于相似度比较：
      1. 去除标点符号
      2. 去除多余空格
      3. 转小写
    """
    text = text.strip()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", " ", text)
    text = text.lower()
    return text


def _calculate_similarity(text1: str, text2: str) -> float:
    """计算两个文本的相似度（0-1）"""
    if not text1 or not text2:
        return 0.0
    return difflib.SequenceMatcher(None, text1, text2).ratio()


def _best_text_match(seg: dict, candidates: list[dict],
                     normalize_text: bool = True) -> tuple[dict | None, float]:
    """在 candidates 中找与 seg 文本相似度最高的话段"""
    best, best_sim = None, 0.0
    hyp_text = _normalize_text(seg["text"]) if normalize_text else seg["text"]

    for i, c in enumerate(candidates):
        ref_text = _normalize_text(c["text"]) if normalize_text else c["text"]
        sim = _calculate_similarity(hyp_text, ref_text)
        if sim > best_sim:
            best, best_sim = {"index": i, **c}, sim

    return best, best_sim


def _evaluate_text(ref_segs: list[dict], hyp_segs: list[dict],
                   similarity_threshold: float = 0.6,
                   normalize_text: bool = True) -> dict:
    """
    基于文本相似度做话段级角色评估

    Returns:
        {
            "correct": 匹配且角色一致的话段数,
            "wrong": 匹配但角色不一致的话段数,
            "unmatched": 相似度低于阈值，无法对齐的话段数,
            "skipped": HYP 或 REF 话段为「其他」，跳过统计,
            "similarity_values": 所有有效匹配的相似度列表,
            "wrong_cases": 错误案例列表
        }
    """
    correct, wrong, unmatched, skipped = 0, 0, 0, 0
    similarity_values = []
    wrong_cases = []
    used_refs = set()  # 记录已匹配的 REF 索引，避免重复匹配

    for h_idx, h in enumerate(hyp_segs):
        # HYP 为「其他」，跳过
        if h["role"] is None:
            skipped += 1
            continue

        # 过滤掉已使用的 REF
        available_refs = [r for i, r in enumerate(ref_segs) if i not in used_refs]

        if not available_refs:
            unmatched += 1
            continue

        ref_match, sim = _best_text_match(h, available_refs, normalize_text)

        if sim < similarity_threshold or ref_match is None:
            unmatched += 1
            continue

        # REF 匹配段为「其他」，跳过
        if ref_match["role"] is None:
            skipped += 1
            continue

        # 标记该 REF 已被使用
        used_refs.add(ref_match["index"])

        similarity_values.append(sim)

        if h["role"] == ref_match["role"]:
            correct += 1
        else:
            wrong += 1
            wrong_cases.append({
                "hyp_index": h_idx,
                "hyp_role": h["role_raw"],
                "hyp_text": h["text"][:50],
                "ref_index": ref_match["index"],
                "ref_role": ref_match["role_raw"],
                "ref_text": ref_match["text"][:50],
                "similarity": round(sim, 3),
            })

    return {
        "correct": correct,
        "wrong": wrong,
        "unmatched": unmatched,
        "skipped": skipped,
        "similarity_values": similarity_values,
        "wrong_cases": wrong_cases,
    }


def run(inputs: dict, config: dict) -> dict:
    """
    Skill 入口函数

    Args:
        inputs: {
            "reference_segments": [{"role": str, "text": str}, ...],
            "hypothesis_segments": [{"role": str, "text": str}, ...]
        }
        config: {"similarity_threshold": float, "normalize_roles": bool, "normalize_text": bool}

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

    similarity_threshold = config.get("similarity_threshold", 0.6)
    normalize_roles = config.get("normalize_roles", True)
    normalize_text = config.get("normalize_text", True)

    # 处理话段
    def process_segments(segments):
        processed = []
        for seg in segments:
            role_raw = seg["role"]
            role = _norm_role(role_raw) if normalize_roles else role_raw
            processed.append({
                "role_raw": role_raw,
                "role": role,
                "text": seg["text"],
            })
        return processed

    ref_segs = process_segments(reference_segments)
    hyp_segs = process_segments(hypothesis_segments)

    # 评估
    ev = _evaluate_text(ref_segs, hyp_segs, similarity_threshold, normalize_text)

    # 计算指标
    matched = ev["correct"] + ev["wrong"]
    total_hyp = ev["correct"] + ev["wrong"] + ev["unmatched"] + ev["skipped"]
    role_accuracy = round(ev["correct"] / matched * 100, 2) if matched > 0 else 0
    avg_similarity = round(sum(ev["similarity_values"]) / len(ev["similarity_values"]), 3) if ev["similarity_values"] else 0

    output = {
        "role_accuracy": role_accuracy,
        "total_segments": total_hyp,
        "matched_segments": matched,
        "correct_segments": ev["correct"],
        "wrong_segments": ev["wrong"],
        "unmatched_segments": ev["unmatched"],
        "skipped_segments": ev["skipped"],
        "avg_similarity": avg_similarity,
        "wrong_cases": ev["wrong_cases"][:10],  # 限制返回前10个错误案例
    }

    metrics = {
        "role_accuracy": role_accuracy,
        "matched_rate": round(matched / (matched + ev["unmatched"]) * 100, 2) if (matched + ev["unmatched"]) > 0 else 0,
        "avg_similarity": avg_similarity,
    }

    return {
        "output": output,
        "metrics": metrics,
        "artifacts": {},
        "logs": []
    }
