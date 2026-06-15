"""
疑问回答质量评测 Skill

对算法识别的客户疑问进行质量评测，判断 Q 提取、回答判断、认可度等 5 个维度是否正确。
"""

from __future__ import annotations

import json
import re
import urllib.request
import urllib.error
import socket


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


def _build_prompt_q_extract(task: dict) -> str:
    """构造 Q 提取评测 Prompt"""
    item = task.get("item_data", {})
    context = task.get("context", {})
    ctx_text = _format_context(context)

    return f"""你是试驾质检评审员。评测"Q 提取与改写是否正确"。

判断步骤：
1. 先判断 raw_question 是否确实是客户问题
2. 如果是，判断 questions 是否正确表达客户真实提问意图

宽松业务意图口径：
- 只要 questions 没有把客户问题改成完全不同的问题，就应判为正确
- 允许补全上下文信息、整理口语表达

输入数据：
raw_question: {item.get("raw_question", "")}
questions: {item.get("questions", "")}
ASR上下文:
{ctx_text}

输出 JSON 格式：
{{"reason": "推理过程", "judge": "正确/不正确", "confidence": 0.9}}"""


def _build_prompt_is_answered(task: dict) -> str:
    """构造疑问是否回答评测 Prompt"""
    item = task.get("item_data", {})
    context = task.get("context", {})
    ctx_text = _format_context(context)

    return f"""你是试驾质检评审员。评测"疑问是否回答判断是否正确"。

is_answered: {item.get("is_answered", "")}
questions: {item.get("questions", "")}
expert_reply_original: {item.get("expert_reply_original", "")}
ASR上下文:
{ctx_text}

判断销售是否对客户问题给出回应。
- 已回答 且 is_answered=1 → 正确
- 未回答 且 is_answered=0 → 正确
- 其他情况 → 不正确

输出 JSON 格式：
{{"reason": "推理过程", "judge": "正确/不正确", "confidence": 0.9}}"""


def _build_prompt_acceptance(task: dict) -> str:
    """构造认可度评测 Prompt"""
    item = task.get("item_data", {})
    context = task.get("context", {})
    ctx_text = _format_context(context)

    return f"""你是试驾质检评审员。评测"疑问回答认可度判断是否正确"。

acceptance: {item.get("acceptance", "")}
customer_feedback_raw: {item.get("customer_feedback_raw", "")}
ASR上下文:
{ctx_text}

acceptance 含义: 1=满意, 0=不满意, 2=中立, 3=专家未回复

输出 JSON 格式：
{{"reason": "推理过程", "judge": "正确/不正确", "confidence": 0.9}}"""


def _build_prompt_label(task: dict) -> str:
    """构造 label 标签评测 Prompt"""
    item = task.get("item_data", {})

    return f"""你是试驾质检评审员。评测"label 标签是否正确"。

concerns_tag: {item.get("concerns_tag", "")}
raw_question: {item.get("raw_question", "")}
questions: {item.get("questions", "")}

输出 JSON 格式：
{{"reason": "推理过程", "judge": "正确/不正确", "confidence": 0.9}}"""


def _build_prompt_sales_answer(task: dict) -> str:
    """构造销售回答评测 Prompt"""
    item = task.get("item_data", {})
    context = task.get("context", {})
    ctx_text = _format_context(context)

    return f"""你是试驾质检评审员。评测"销售回答是否正确"。

answer: {item.get("answer", "")}
expert_reply_original: {item.get("expert_reply_original", "")}
kb_correct_answer: {item.get("kb_correct_answer", "")}
ASR上下文:
{ctx_text}

输出 JSON 格式：
{{"reason": "推理过程", "judge": "正确/不正确", "confidence": 0.9}}"""


def _call_llm(prompt: str, config: dict) -> dict:
    """调用 LLM 获取评测结果"""
    provider = str(config.get("llm_provider") or "legacy").strip().lower()
    api_key = str(config.get("model_api_key") or "")
    api_base = str(config.get("model_api_base") or "https://api.deepseek.com")
    model_name = str(config.get("model_name") or "deepseek-v4-flash")
    timeout = int(config.get("timeout_seconds") or 60)

    if not api_key:
        raise RuntimeError("缺少 model_api_key 配置")

    url = f"{api_base.rstrip('/')}/chat/completions"
    if url.endswith("//chat/completions"):
        url = api_base.rstrip("/") + "/chat/completions"

    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        response_data = json.loads(resp.read().decode("utf-8"))

    content = response_data["choices"][0]["message"]["content"]

    # 解析 JSON
    text = content.strip()
    if text.startswith("```"):
        text = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
        text = text.group(1).strip() if text else content

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # 尝试提取 JSON 对象
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            return json.loads(match.group())
        raise


def _make_task(task_id: str, ap_code: str, dimension: str, item_key: str, item_data: dict, context: dict) -> dict:
    """创建评测任务"""
    return {
        "task_id": task_id,
        "ap_code": ap_code,
        "module": "testDriveQualityConcernList",
        "dimension": dimension,
        "item_key": item_key,
        "item_data": item_data,
        "context": context,
        "parent_key": "",
    }


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
        concern_list = record.get("testDriveQualityConcernList") or []
        report = record.get("testDriveQualityInspectionReport") or {}
        task_id = str(report.get("taskId", "")).strip()

        if not concern_list:
            return {
                "output": {"results": [], "task_count": 0, "correct_count": 0, "incorrect_count": 0, "skipped_count": 0, "error": ""},
                "metrics": {},
                "artifacts": {},
                "logs": ["无疑问回答质量数据"],
            }

        # 构建评测任务
        tasks = []
        for idx, concern in enumerate(concern_list):
            if not isinstance(concern, dict):
                continue

            raw_question = str(concern.get("rawQuestion") or "").strip()
            if not raw_question:
                continue

            item_key = str(concern.get("bizCode") or f"concern_{idx}").strip()
            questions = str(concern.get("questions") or "").strip()
            questions = re.sub(r'\s*[（(][^）)]*[）)]\s*$', '', questions).strip()

            expert_reply = str(concern.get("expertReplyOriginal") or "").lstrip("|").strip()
            customer_feedback = str(concern.get("customerFeedbackRaw") or "").lstrip("|").strip()

            q_ctx = _find_context(asr_lines, raw_question)
            reply_ctx = _find_context(asr_lines, expert_reply) if expert_reply else q_ctx
            feedback_ctx = _find_context(asr_lines, customer_feedback) if customer_feedback else q_ctx

            base_item = {
                "raw_question": raw_question,
                "questions": questions,
                "concerns_tag": str(concern.get("concernsTag") or "").strip(),
                "expert_reply_original": expert_reply,
                "customer_feedback_raw": customer_feedback,
                "answer": str(concern.get("answer") or "").strip(),
                "is_answered": concern.get("isAnswered"),
                "acceptance": concern.get("acceptance"),
                "kb_correct_answer": str(concern.get("kbCorrectAnswer") or "").strip(),
            }

            # 5 个维度
            tasks.append(_make_task(task_id, ap_code, "Q提取是否正确", item_key, base_item, q_ctx))
            tasks.append(_make_task(task_id, ap_code, "疑问是否回答判断是否正确", item_key, base_item, reply_ctx))
            tasks.append(_make_task(task_id, ap_code, "疑问回答认可度判断是否正确", item_key, base_item, feedback_ctx))
            tasks.append(_make_task(task_id, ap_code, "label标签是否正确", item_key, base_item, q_ctx))
            tasks.append(_make_task(task_id, ap_code, "销售回答是否正确", item_key, base_item, reply_ctx))

        # 执行评测
        results = []
        correct_count = 0
        incorrect_count = 0
        skipped_count = 0

        # 按 item_key 分组处理漏斗依赖
        from collections import defaultdict
        tasks_by_item = defaultdict(list)
        for task in tasks:
            tasks_by_item[task["item_key"]].append(task)

        for item_key, item_tasks in tasks_by_item.items():
            parent_result = None
            for task in item_tasks:
                dimension = task["dimension"]

                # 漏斗依赖检查
                if dimension == "疑问是否回答判断是否正确" and parent_result and parent_result.get("judge") == "不正确":
                    result = {"judge": "跳过", "confidence": None, "reason": "前置维度不正确", "suggestion": "", "status": "skipped"}
                    skipped_count += 1
                elif dimension == "疑问回答认可度判断是否正确" and parent_result and parent_result.get("judge") == "不正确":
                    result = {"judge": "跳过", "confidence": None, "reason": "前置维度不正确", "suggestion": "", "status": "skipped"}
                    skipped_count += 1
                else:
                    # 构造 Prompt 并调用 LLM
                    if dimension == "Q提取是否正确":
                        prompt = _build_prompt_q_extract(task)
                    elif dimension == "疑问是否回答判断是否正确":
                        prompt = _build_prompt_is_answered(task)
                    elif dimension == "疑问回答认可度判断是否正确":
                        prompt = _build_prompt_acceptance(task)
                    elif dimension == "label标签是否正确":
                        prompt = _build_prompt_label(task)
                    elif dimension == "销售回答是否正确":
                        prompt = _build_prompt_sales_answer(task)
                    else:
                        continue

                    try:
                        llm_output = _call_llm(prompt, config)
                        judge = str(llm_output.get("judge", "无法判断")).strip()
                        if judge not in ("正确", "不正确"):
                            judge = "无法判断"

                        result = {
                            "judge": judge,
                            "confidence": llm_output.get("confidence"),
                            "reason": str(llm_output.get("reason", "")).strip(),
                            "suggestion": str(llm_output.get("suggestion", "")).strip(),
                            "status": "ok",
                        }

                        if judge == "正确":
                            correct_count += 1
                        elif judge == "不正确":
                            incorrect_count += 1

                    except Exception as e:
                        result = {"judge": "错误", "confidence": None, "reason": str(e), "suggestion": "", "status": "error"}

                parent_result = result
                results.append({
                    "task_id": task_id,
                    "item_key": item_key,
                    "dimension": dimension,
                    **result,
                })

        return {
            "output": {
                "results": results,
                "task_count": len(results),
                "correct_count": correct_count,
                "incorrect_count": incorrect_count,
                "skipped_count": skipped_count,
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
