"""
体验充分度评测 Skill

评测销售是否充分介绍了产品卖点，采用两阶段流程。
"""

from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path


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


def _load_selling_points(vehicle_name: str, config: dict) -> list[dict]:
    """加载卖点表"""
    # 从配置或默认路径加载
    selling_points_file = str(config.get("selling_points_file") or "")
    if not selling_points_file:
        # 使用包内默认卖点表
        selling_points_file = str(Path(__file__).parent.parent / "data" / "selling_points.json")

    if not Path(selling_points_file).exists():
        return []

    with open(selling_points_file, "r", encoding="utf-8") as f:
        return json.load(f)


def _normalize_text(text: str) -> str:
    """归一化文本用于匹配"""
    return re.sub(r"[^0-9a-zA-Z一-鿿]", "", str(text or "")).lower()


def _collect_evidence_for_point(asr_lines: list[str], point: dict, max_hits: int = 2) -> list[dict]:
    """为二级卖点收集 ASR 中的证据"""
    evidence_list = []
    tokens = [str(point.get("sub_key") or "").strip()]
    tokens.extend([str(f).strip() for f in (point.get("fuzzy") or []) if str(f).strip()])

    tokens = [t for t in tokens if len(t) >= 2]
    if not tokens:
        return evidence_list

    for line in asr_lines:
        sentence = str(line or "").strip()
        if not sentence:
            continue

        sentence_norm = _normalize_text(sentence)
        matched = False
        for token in tokens:
            token_norm = _normalize_text(token)
            if token_norm and token_norm in sentence_norm:
                matched = True
                break

        if matched:
            ctx = _find_context(asr_lines, sentence)
            evidence_list.append({
                "sentence": sentence,
                "asr_window": _format_context(ctx),
            })
            if len(evidence_list) >= max_hits:
                break

    return evidence_list


def _build_prompt_stage1(task: dict) -> str:
    """构造一阶段「提及是否准确」评测 Prompt"""
    item = task.get("item_data", {})
    context = task.get("context", {})
    ctx_text = _format_context(context)

    return f"""你是试驾质检评审员。评测"提及是否准确"。

判断 ASR 中是否真实提及了该二级卖点。

vehicle_name: {item.get("vehicle_name", "")}
primary_key: {item.get("primary_key", "")}
secondary_key: {item.get("secondary_key", "")}
fuzzy: {json.dumps(item.get("secondary_fuzzy", []), ensure_ascii=False)}
evidence: {item.get("value", "")}
ASR上下文:
{ctx_text}

判断标准：
- ASR 中有明确提及该卖点或其近义词 → 正确
- ASR 中没有提及或仅模糊提及 → 不正确

输出 JSON 格式：
{{"reason": "推理过程", "judge": "正确/不正确", "confidence": 0.9, "matched_secondary_key": "匹配到的二级卖点", "matched_sentence_id": "S0001"}}"""


def _build_prompt_stage2(task: dict) -> str:
    """构造二阶段「卖点错误是否判断准确」评测 Prompt"""
    item = task.get("item_data", {})
    context = task.get("context", {})
    ctx_text = _format_context(context)

    return f"""你是试驾质检评审员。评测"卖点错误是否判断准确"。

判断算法对卖点表述准确性的判断是否正确。

primary_key: {item.get("primary_key", "")}
target_secondary_key: {item.get("target_secondary_key", "")}
error_reason: {item.get("error_reason", "")}
recommend_desc: {item.get("recommend_desc", "")}
evidence: {item.get("value", "")}
ASR上下文:
{ctx_text}

判断标准：
- 算法判断正确，且确实存在错误 → 正确
- 算法判断正确，但实际表述正确 → 不正确
- 算法判断错误，且确实存在错误 → 不正确

输出 JSON 格式：
{{"reason": "推理过程", "judge": "正确/不正确", "confidence": 0.9}}"""


def _call_llm(prompt: str, config: dict) -> dict:
    """调用 LLM 获取评测结果"""
    api_key = str(config.get("model_api_key") or "")
    api_base = str(config.get("model_api_base") or "https://api.deepseek.com")
    model_name = str(config.get("model_name") or "deepseek-v4-flash")
    timeout = int(config.get("timeout_seconds") or 180)

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
    vehicle_name = str(inputs.get("vehicle_name") or "").strip()
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
        experience = record.get("testDriveQualityExperience") or {}
        report = record.get("testDriveQualityInspectionReport") or {}
        task_id = str(report.get("taskId", "")).strip()

        # 提取车型
        if not vehicle_name:
            concern_list = record.get("testDriveQualityConcernList") or []
            for concern in concern_list:
                if isinstance(concern, dict):
                    vn = str(concern.get("vehicleName") or "").strip()
                    if vn:
                        vehicle_name = vn
                        break

        # 加载卖点表
        selling_points = _load_selling_points(vehicle_name, config)
        if not selling_points:
            return {
                "output": {"results": [], "task_count": 0, "error": f"未找到车型 {vehicle_name} 的卖点表"},
                "metrics": {},
                "artifacts": {},
                "logs": [f"未找到车型 {vehicle_name} 的卖点表"],
            }

        # 解析算法数据
        selling_point_detail = _safe_json_loads(experience.get("sellingPointDetail", "[]"), [])
        error_refer_detail = _safe_json_loads(experience.get("errorReferDetail", "[]"), [])

        results = []
        correct_count = 0
        incorrect_count = 0
        stage1_count = 0
        stage2_count = 0

        # 一阶段：为每个卖点生成「提及是否准确」任务
        for primary_entry in selling_points:
            primary_key = str(primary_entry.get("primary_key") or "").strip()
            if not primary_key:
                continue

            for secondary_point in primary_entry.get("secondary_points") or []:
                secondary_key = str(secondary_point.get("sub_key") or "").strip()
                if not secondary_key:
                    continue

                # 收集 ASR 证据
                evidence_list = _collect_evidence_for_point(asr_lines, secondary_point)

                item_key = f"sp_{primary_key}_{secondary_key}"
                ctx = _find_context(asr_lines, evidence_list[0]["sentence"]) if evidence_list else {"current_line": "", "context_lines": asr_lines[:15], "current_index": -1}

                item_data = {
                    "vehicle_name": vehicle_name,
                    "primary_key": primary_key,
                    "secondary_key": secondary_key,
                    "secondary_fuzzy": secondary_point.get("fuzzy", []),
                    "value": "\n".join(e.get("sentence", "") for e in evidence_list),
                    "evidence_list": evidence_list,
                }

                # 调用 LLM 评测
                task = {"task_id": task_id, "item_data": item_data, "context": ctx}
                try:
                    llm_output = _call_llm(_build_prompt_stage1(task), config)
                    judge = str(llm_output.get("judge", "无法判断")).strip()
                    if judge not in ("正确", "不正确"):
                        judge = "无法判断"

                    result = {
                        "judge": judge,
                        "confidence": llm_output.get("confidence"),
                        "reason": str(llm_output.get("reason", "")).strip(),
                        "matched_secondary_key": str(llm_output.get("matched_secondary_key", "")).strip(),
                        "status": "ok",
                    }
                    if judge == "正确":
                        correct_count += 1
                    elif judge == "不正确":
                        incorrect_count += 1

                except Exception as e:
                    result = {"judge": "错误", "confidence": None, "reason": str(e), "matched_secondary_key": "", "status": "error"}

                stage1_count += 1
                results.append({"task_id": task_id, "item_key": item_key, "dimension": "提及是否准确", **result})

        # 二阶段：为 errorReferDetail 生成「卖点错误是否判断准确」任务
        for er_idx, er in enumerate(error_refer_detail):
            if not isinstance(er, dict):
                continue

            key = str(er.get("key") or "").strip()
            error_reason = str(er.get("value") or "").strip()
            recommend_desc = str(er.get("recommendDesc") or "").strip()

            if not key:
                continue

            # 查找对应的一级卖点
            primary_entry = None
            for sp in selling_points:
                if sp.get("primary_key") == key:
                    primary_entry = sp
                    break

            if not primary_entry:
                continue

            for secondary_point in primary_entry.get("secondary_points") or []:
                secondary_key = str(secondary_point.get("sub_key") or "").strip()
                if not secondary_key:
                    continue

                evidence_list = _collect_evidence_for_point(asr_lines, secondary_point)
                ctx = _find_context(asr_lines, evidence_list[0]["sentence"]) if evidence_list else {"current_line": "", "context_lines": asr_lines[:15], "current_index": -1}

                item_key = f"er_{key}_{secondary_key}_{er_idx}"
                item_data = {
                    "vehicle_name": vehicle_name,
                    "primary_key": key,
                    "target_secondary_key": secondary_key,
                    "error_reason": error_reason,
                    "recommend_desc": recommend_desc,
                    "value": "\n".join(e.get("sentence", "") for e in evidence_list),
                    "evidence_list": evidence_list,
                }

                task = {"task_id": task_id, "item_data": item_data, "context": ctx}
                try:
                    llm_output = _call_llm(_build_prompt_stage2(task), config)
                    judge = str(llm_output.get("judge", "无法判断")).strip()
                    if judge not in ("正确", "不正确"):
                        judge = "无法判断"

                    result = {
                        "judge": judge,
                        "confidence": llm_output.get("confidence"),
                        "reason": str(llm_output.get("reason", "")).strip(),
                        "status": "ok",
                    }
                    if judge == "正确":
                        correct_count += 1
                    elif judge == "不正确":
                        incorrect_count += 1

                except Exception as e:
                    result = {"judge": "错误", "confidence": None, "reason": str(e), "status": "error"}

                stage2_count += 1
                results.append({"task_id": task_id, "item_key": item_key, "dimension": "卖点错误是否判断准确", **result})

        return {
            "output": {
                "results": results,
                "task_count": len(results),
                "stage1_count": stage1_count,
                "stage2_count": stage2_count,
                "correct_count": correct_count,
                "incorrect_count": incorrect_count,
                "error": "",
            },
            "metrics": {"task_count": len(results), "stage1": stage1_count, "stage2": stage2_count, "correct": correct_count, "incorrect": incorrect_count},
            "artifacts": {},
            "logs": [f"评测完成: {len(results)} 个任务 (一阶段 {stage1_count}, 二阶段 {stage2_count}), {correct_count} 正确, {incorrect_count} 不正确"],
        }

    except Exception as e:
        return {
            "output": {"results": [], "task_count": 0, "error": str(e)},
            "metrics": {"error": 1},
            "artifacts": {},
            "logs": [f"评测失败: {e}"],
        }
