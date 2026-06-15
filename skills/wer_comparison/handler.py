"""
字错率对比 Skill

对比两份 ASR 文本，计算字错率(WER)、内容词WER、字准率和字符召回率。
"""

import re
import difflib


# 全角→半角
_T_FULLHALF = str.maketrans(
    "０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ",
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
)

# 中文数字字符→阿拉伯数字
_T_CN_DIGIT = str.maketrans("零一两二三四五六七八九", "01223456789")

# 语义等价字归一
_T_EQUIV = str.maketrans({
    "它": "他", "她": "他",
    "您": "你",
    "哦": "啊", "嗯": "啊", "噢": "啊", "呀": "啊",
    "嘅": "的", "系": "是",
    "𠮶": "嗰", "噉": "咁", "㗎": "噶", "返": "翻",
})

# 内容词额外等价归一
_T_EQUIV_CONTENT = str.maketrans({
    "得": "的", "地": "的",
    "嘛": "吗",
    "嘞": "啊", "咯": "啊", "喽": "啊", "呗": "啊",
    "诶": "哎", "唉": "哎",
})

# 纯语气词/叹词
_FILLER_CHARS = set("啊哦哎嗯呃哈嘿哟哇喂")


def _normalize(text: str) -> str:
    """
    标准化文本用于 WER 比较：
      1. 全角→半角
      2. 中文数字字符→阿拉伯数字
      3. 语义等价字归一
      4. 转小写
      5. 去除标点，只保留中文、字母、数字
    """
    text = text.strip()
    text = text.translate(_T_FULLHALF)
    text = text.translate(_T_CN_DIGIT)
    text = text.translate(_T_EQUIV)
    text = text.lower()
    text = re.sub(r"[^\w一-鿿]", "", text)
    return text


def _normalize_content(text: str) -> str:
    """
    在 _normalize 基础上进一步去除语气词/助词
    """
    text = _normalize(text)
    text = text.translate(_T_EQUIV_CONTENT)
    text = "".join(c for c in text if c not in _FILLER_CHARS)
    return text


def _calculate_wer(reference: str, hypothesis: str) -> float | None:
    """计算字错率（基于编辑距离）"""
    ref = _normalize(reference)
    hyp = _normalize(hypothesis)
    if not ref:
        return None

    # 使用 SequenceMatcher 计算编辑距离
    matcher = difflib.SequenceMatcher(None, ref, hyp)
    # 计算替换、插入、删除操作数
    opcodes = matcher.get_opcodes()
    errors = 0
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == 'replace':
            errors += max(i2 - i1, j2 - j1)
        elif tag == 'delete':
            errors += i2 - i1
        elif tag == 'insert':
            errors += j2 - j1

    wer = errors / len(ref) * 100
    return round(wer, 2)


def _calculate_content_wer(reference: str, hypothesis: str) -> float | None:
    """计算内容词字错率（去除语气词后）"""
    ref = _normalize_content(reference)
    hyp = _normalize_content(hypothesis)
    if not ref:
        return None

    matcher = difflib.SequenceMatcher(None, ref, hyp)
    opcodes = matcher.get_opcodes()
    errors = 0
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == 'replace':
            errors += max(i2 - i1, j2 - j1)
        elif tag == 'delete':
            errors += i2 - i1
        elif tag == 'insert':
            errors += j2 - j1

    wer = errors / len(ref) * 100
    return round(wer, 2)


def _calculate_coverage(reference: str, hypothesis: str) -> float:
    """计算字符召回率"""
    ref = _normalize(reference)
    hyp = _normalize(hypothesis)
    if not ref:
        return 0.0
    matcher = difflib.SequenceMatcher(None, ref, hyp)
    matching = sum(b.size for b in matcher.get_matching_blocks())
    return round(matching / len(ref) * 100, 2)


def run(inputs: dict, config: dict) -> dict:
    """
    Skill 入口函数

    Args:
        inputs: {"reference": str, "hypothesis": str}
        config: {"enable_content_wer": bool, "normalize_equivalent_chars": bool}

    Returns:
        {
            "output": {"wer": float, "content_wer": float, "accuracy": float, "coverage": float, "details": {...}},
            "metrics": {...},
            "artifacts": {},
            "logs": []
        }
    """
    reference = inputs.get("reference", "")
    hypothesis = inputs.get("hypothesis", "")

    # 计算 WER
    wer = _calculate_wer(reference, hypothesis)

    # 计算内容词 WER
    enable_content_wer = config.get("enable_content_wer", True)
    content_wer = None
    if enable_content_wer:
        content_wer = _calculate_content_wer(reference, hypothesis)

    # 计算字准率
    accuracy = round(100 - wer, 2) if wer is not None else None

    # 计算字符召回率
    coverage = _calculate_coverage(reference, hypothesis)

    # 归一化文本（用于调试）
    ref_normalized = _normalize(reference)
    hyp_normalized = _normalize(hypothesis)

    output = {
        "wer": wer,
        "content_wer": content_wer,
        "accuracy": accuracy,
        "coverage": coverage,
        "details": {
            "reference_normalized": ref_normalized,
            "hypothesis_normalized": hyp_normalized,
        }
    }

    metrics = {
        "wer": wer,
        "accuracy": accuracy,
        "coverage": coverage,
    }

    return {
        "output": output,
        "metrics": metrics,
        "artifacts": {},
        "logs": []
    }
