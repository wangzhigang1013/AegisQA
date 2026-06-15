"""
认可度评测 Skill

对算法识别的用户情感进行评测，判断情感分类、关注点和观点是否正确。
"""

from __future__ import annotations

import json
import re
import urllib.request


def _split_lines(asr_text: str) -> list[str]:
    """将 ASR 原文按 | 分隔符切分为单句列表"""
    if not asr_text or not asr_text.strip():
        return []
    parts = re.split(r"\||\n", asr_text)
    return [p.strip() for p in parts if p.strip()]


def _find_context(lines: list[str], search_text: str, window: int = 7) -> dict:
    """在 ASR 句子列表中定位目标文本，返回上下文窗口"""
    if not lines or not search_text:
        return {"current_line": "", "context_lines": lines[:min(15, len(lines))], "current_index": -1}

    search_text = search_text.strip()
    for i, line in enumerate(lines):
        if search_text in line:
            start = max(0, i - window)
            end = min(len(lines), i + window + 1)
            return {"current_line": lines[i], "context_lines": lines[start:end], "current_index": i}

    return {"current_line": "", "context_lines": lines[:min(15, len(lines))], "current_index": -1}


def _format_context(context: dict) -> str:
    """格式化上下文为可读字符串"""
    lines = context.get("context_lines", [])
    current = context.get("current_line", "")
    result = []
    for line in lines:
        if current and line == current:
            result.append(f"【{line}】")
        else:
            result.append(line)
    return "\n".join(result)


def _safe_json_loads(raw, default=None):
    """安全解析 JSON 字符串"""
    if raw is None:
        return default if default is not None else []
    if isinstance(raw, (list, dict)):
        return raw
    try:
        return json.loads(str(raw))
    except (json.JSONDecodeError, TypeError):
        return default if default is not None else []


def _build_prompt_emotion(task: dict) -> str:
    """构造情感评测 Prompt"""
    item = task.get("item_data", {})
    context = task.get("context", {})
    ctx_text = _format_context(context)

    return f"""你是试驾质检评审员。评测"客户情感是否正确"。

emotion_type: {item.get("emotion_type", "")}
original_text: {item.get("original_text", "")}
point: {item.get("concern_point", "")}
ASR上下文:
{ctx_text}

判断情感分类是否正确：
- positive: 满意/正向情感
- negative: 不满意/负向情感
- concern: 中立关注

输出 JSON 格式：
{{"reason": "推理过程", "judge": "正确/不正确", "confidence": 0.9}}"""


def _build_prompt_viewpoint(task: dict) -> str:
    """构造关注点评测 Prompt"""
    item = task.get("item_data", {})
    context = task.get("context", {})
    ctx_text = _format_context(context)

    return f"""你是试驾质检评审员。评测"关注点是否正确"。

concern_point: {item.get("concern_point", "")}
original_text: {item.get("original_text", "")}
ASR上下文:
{ctx_text}

判断关注点标签是否准确反映了客户的真实关注。

输出 JSON 格式：
{{"reason": "推理过程", "judge": "正确/不正确", "confidence": 0.9}}"""


def _build_prompt_opinion(task: dict) -> str:
    """构造观点评测 Prompt"""
    item = task.get("item_data", {})
    context = task.get("context", {})
    ctx_text = _format_context(context)

    return f"""你是试驾质检评审员。评测"观点是否正确"。

opinion_point: {item.get("opinion_point", "")}
re_write: {item.get("re_write", "")}
original_text: {item.get("original_text", "")}
ASR上下文:
{ctx_text}

判断观点总结是否准确。

输出 JSON 格式：
{{"reason": "推理过程", "judge": "正确/不正确", "confidence": 0.9}}"""


def _call_llm(prompt: str, config: dict) -> dict:
    """调用 LLM 获取评测结果"""
    api_key = str(config.get("model_api_key") or "")
    api_base = str(config.get("model_api_base") or "https://api.deepseek.com")
    model_name = str(config.get("model_name") or "deepseek-v4-flash")
    timeout = int(config.get("timeout_seconds") or 60)

    if not api_key:
        raise RuntimeError("缺少 model_api_key 配置")

    url = f"{api_base.rstrip('/')}/chat/completions"
    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        response_data = json.loads(resp.read().decode("utf-8"))

    content = response_data["choices"][0]["message"]["content"]
    text = content.strip()
    if text.startswith("```"):
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
        text = match.group(1).strip() if match else content

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            return json.loads(match.group())
        raise


def run(inputs, config):
    """Skill 入口函数"""
    record = inputs.get("record", {})
    ap_code = str(inputs.get("ap_code", "")).strip()
    asr_text = str(inputs.get("asr_text", "")).strip()
    config = config or {}

    if not record or not ap_code or not asr_text:
        return {
            "output": {"results": [], "task_count": 0, "error": "缺少必要参数"},
            "metrics": {},
            "artifacts": {},
            "logs": ["错误: 缺少必要参数"],
        }

    try:
        asr_lines = _split_lines(asr_text)
        emotion_data = record.get("testDriveQualityEmotion") or {}
        report = record.get("testDriveQualityInspectionReport") or {}
        task_id = str(report.get("taskId", "")).strip()

        # 解析三类情感数据
        positive_list = _safe_json_loads(emotion_data.get("positive", "[]"), [])
        negative_list = _safe_json_loads(emotion_data.get("negative", "[]"), [])
        concern_list = _safe_json_loads(emotion_data.get("concern", "[]"), [])

        if not positive_list and not negative_list and not concern_list:
            return {
                "output": {"results": [], "task_count": 0, "correct_count": 0, "incorrect_count": 0, "error": ""},
                "metrics": {},
                "artifacts": {},
                "logs": ["无认可度数据"],
            }

        results = []
        correct_count = 0
        incorrect_count = 0

        # 处理 positive 和 negative
        for emotion_type, item_list in [("positive", positive_list), ("negative", negative_list)]:
            for idx, emo_item in enumerate(item_list):
                if not isinstance(emo_item, dict):
                    continue

                original_text = str(emo_item.get("originalText") or "").strip()
                point = str(emo_item.get("point") or "").strip()
                re_write = str(emo_item.get("reWrite") or "").strip()

                if not original_text and not point:
                    continue

                ctx = _find_context(asr_lines, original_text or point)
                item_key = f"{emotion_type}_{idx}"

                item_data = {
                    "emotion_type": emotion_type,
                    "original_text": original_text,
                    "concern_point": point,
                    "opinion_point": point,
                    "re_write": re_write,
                }

                # 1. 情感是否正确
                task = {"task_id": task_id, "item_data": item_data, "context": ctx}
                try:
                    llm_output = _call_llm(_build_prompt_emotion(task), config)
                    judge = str(llm_output.get("judge", "无法判断")).strip()
                    if judge not in ("正确", "不正确"):
                        judge = "无法判断"
                    result = {"judge": judge, "confidence": llm_output.get("confidence"), "reason": str(llm_output.get("reason", "")).strip(), "status": "ok"}
                    if judge == "正确":
                        correct_count += 1
                    elif judge == "不正确":
                        incorrect_count += 1
                except Exception as e:
                    result = {"judge": "错误", "confidence": None, "reason": str(e), "status": "error"}

                results.append({"task_id": task_id, "item_key": item_key, "dimension": "客户情感是否正确", **result})

                # 2. 关注点是否正确
                try:
                    llm_output = _call_llm(_build_prompt_viewpoint(task), config)
                    judge = str(llm_output.get("judge", "无法判断")).strip()
                    if judge not in ("正确", "不正确"):
                        judge = "无法判断"
                    result = {"judge": judge, "confidence": llm_output.get("confidence"), "reason": str(llm_output.get("reason", "")).strip(), "status": "ok"}
                    if judge == "正确":
                        correct_count += 1
                    elif judge == "不正确":
                        incorrect_count += 1
                except Exception as e:
                    result = {"judge": "错误", "confidence": None, "reason": str(e), "status": "error"}

                results.append({"task_id": task_id, "item_key": item_key, "dimension": "关注点是否正确", **result})

                # 3. 观点是否正确（如果有 re_write）
                if re_write:
                    try:
                        llm_output = _call_llm(_build_prompt_opinion(task), config)
                        judge = str(llm_output.get("judge", "无法判断")).strip()
                        if judge not in ("正确", "不正确"):
                            judge = "无法判断"
                        result = {"judge": judge, "confidence": llm_output.get("confidence"), "reason": str(llm_output.get("reason", "")).strip(), "status": "ok"}
                        if judge == "正确":
                            correct_count += 1
                        elif judge == "不正确":
                            incorrect_count += 1
                    except Exception as e:
                        result = {"judge": "错误", "confidence": None, "reason": str(e), "status": "error"}

                    results.append({"task_id": task_id, "item_key": item_key, "dimension": "观点是否正确", **result})

        # 处理 concern
        global_idx = len(positive_list) + len(negative_list)
        for concern_block in concern_list:
            if not isinstance(concern_block, dict):
                continue

            interests = concern_block.get("interests") or {}
            if isinstance(interests, dict):
                for interest_name, interest_data in interests.items():
                    if not isinstance(interest_data, dict):
                        continue

                    questions_list = interest_data.get("questions", [])
                    representative_q = questions_list[0] if questions_list else interest_name
                    ctx = _find_context(asr_lines, representative_q)

                    item_key = f"concern_interest_{global_idx}"
                    global_idx += 1

                    item_data = {
                        "emotion_type": "concern",
                        "original_text": representative_q,
                        "concern_point": interest_name,
                        "opinion_point": "",
                        "re_write": "",
                    }

                    # 情感是否正确
                    task = {"task_id": task_id, "item_data": item_data, "context": ctx}
                    try:
                        llm_output = _call_llm(_build_prompt_emotion(task), config)
                        judge = str(llm_output.get("judge", "无法判断")).strip()
                        if judge not in ("正确", "不正确"):
                            judge = "无法判断"
                        result = {"judge": judge, "confidence": llm_output.get("confidence"), "reason": str(llm_output.get("reason", "")).strip(), "status": "ok"}
                        if judge == "正确":
                            correct_count += 1
                        elif judge == "不正确":
                            incorrect_count += 1
                    except Exception as e:
                        result = {"judge": "错误", "confidence": None, "reason": str(e), "status": "error"}

                    results.append({"task_id": task_id, "item_key": item_key, "dimension": "客户情感是否正确", **result})

                    # 关注点是否正确
                    try:
                        llm_output = _call_llm(_build_prompt_viewpoint(task), config)
                        judge = str(llm_output.get("judge", "无法判断")).strip()
                        if judge not in ("正确", "不正确"):
                            judge = "无法判断"
                        result = {"judge": judge, "confidence": llm_output.get("confidence"), "reason": str(llm_output.get("reason", "")).strip(), "status": "ok"}
                        if judge == "正确":
                            correct_count += 1
                        elif judge == "不正确":
                            incorrect_count += 1
                    except Exception as e:
                        result = {"judge": "错误", "confidence": None, "reason": str(e), "status": "error"}

                    results.append({"task_id": task_id, "item_key": item_key, "dimension": "关注点是否正确", **result})

        return {
            "output": {
                "results": results,
                "task_count": len(results),
                "correct_count": correct_count,
                "incorrect_count": incorrect_count,
                "error": "",
            },
            "metrics": {"task_count": len(results), "correct": correct_count, "incorrect": incorrect_count},
            "artifacts": {},
            "logs": [f"评测完成: {len(results)} 个任务, {correct_count} 正确, {incorrect_count} 不正确"],
        }

    except Exception as e:
        return {
            "output": {"results": [], "task_count": 0, "error": str(e)},
            "metrics": {"error": 1},
            "artifacts": {},
            "logs": [f"评测失败: {e}"],
        }
