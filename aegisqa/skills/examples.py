"""内置示例 Skills。

这些 Skill 用于 MVP 验收和本地演示。真实生产环境中应从可信 Git/包仓库注册
业务 Skill，本文件提供的是可复现、无外部依赖的默认实现。
"""

from __future__ import annotations

import json
import math
import random
import sqlite3
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from aegisqa.models.gateway import ModelGateway
from aegisqa.skills.base import BaseSkill, SkillManifest, SkillResult


class CSVLoaderSkill(BaseSkill):
    manifest = SkillManifest(
        skill_id="source.csv@0.1.0",
        name="CSV Loader",
        version="0.1.0",
        description="CSV Source Skill manifest，用于声明平台支持 CSV 数据入口。",
        tags=["source", "csv"],
        scenarios=["dataset"],
        input_schema={
            "type": "object",
            "required": ["file_uri"],
            "properties": {"file_uri": {"type": "string"}, "delimiter": {"type": "string"}, "encoding": {"type": "string"}},
        },
        output_schema={
            "type": "object",
            "required": ["rows", "schema", "row_count"],
            "properties": {"rows": {"type": "array"}, "schema": {"type": "object"}, "row_count": {"type": "integer"}},
        },
        config_schema={"type": "object", "properties": {}},
        example_input={"file_uri": "memory://sample.csv", "delimiter": ",", "encoding": "utf-8"},
    )

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        return SkillResult(output={"rows": [], "schema": {}, "row_count": 0})


class JSONLLoaderSkill(BaseSkill):
    manifest = SkillManifest(
        skill_id="source.jsonl@0.1.0",
        name="JSONL Loader",
        version="0.1.0",
        description="JSONL Source Skill manifest，用于声明平台支持 JSONL 数据入口。",
        tags=["source", "jsonl"],
        scenarios=["dataset"],
        input_schema={"type": "object", "required": ["file_uri"], "properties": {"file_uri": {"type": "string"}, "encoding": {"type": "string"}}},
        output_schema={
            "type": "object",
            "required": ["rows", "schema", "row_count"],
            "properties": {"rows": {"type": "array"}, "schema": {"type": "object"}, "row_count": {"type": "integer"}},
        },
        config_schema={"type": "object", "properties": {}},
        example_input={"file_uri": "memory://sample.jsonl", "encoding": "utf-8"},
    )

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        return SkillResult(output={"rows": [], "schema": {}, "row_count": 0})


class DBQuerySkill(BaseSkill):
    manifest = SkillManifest(
        skill_id="source.db_query@0.1.0",
        name="DB Query Source",
        version="0.1.0",
        description="数据库查询 Source Skill，内置 sqlite 执行器，生产环境可替换为 MySQL 连接池。",
        tags=["source", "database"],
        scenarios=["dataset"],
        input_schema={
            "type": "object",
            "required": ["connection_id", "sql"],
            "properties": {"connection_id": {"type": "string"}, "sql": {"type": "string"}, "params": {"type": "object"}},
        },
        output_schema={
            "type": "object",
            "required": ["rows", "schema", "row_count"],
            "properties": {"rows": {"type": "array"}, "schema": {"type": "object"}, "row_count": {"type": "integer"}},
        },
        config_schema={"type": "object", "properties": {"connections": {"type": "object"}}},
        permissions=["network", "secret"],
        example_input={"connection_id": "demo", "sql": "select 1", "params": {}},
    )

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        config = config or {}
        connections = config.get("connections", {})
        connection = connections.get(inputs["connection_id"], {"driver": "sqlite", "database": ":memory:"})
        if connection.get("driver") != "sqlite":
            raise ValueError("当前内置 DBQuerySkill 仅支持 sqlite；MySQL 通过生产适配层接入。")

        # MVP 使用 sqlite 做真实 SQL 执行，既能验证 Source Skill 合约，也避免在本地
        # 测试环境强依赖外部 MySQL 服务。生产环境可把 driver 分支替换为 MySQL 连接池。
        with sqlite3.connect(connection.get("database", ":memory:")) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(inputs["sql"], inputs.get("params") or {})
            rows = [dict(row) for row in cursor.fetchall()]
        return SkillResult(output={"rows": rows, "schema": _infer_schema(rows), "row_count": len(rows)})


class APIPullSkill(BaseSkill):
    manifest = SkillManifest(
        skill_id="source.api_pull@0.1.0",
        name="API Pull Source",
        version="0.1.0",
        description="API 拉取 Source Skill，支持 file/http JSON rows，认证通过 Secret 配置注入。",
        tags=["source", "api"],
        scenarios=["dataset"],
        input_schema={
            "type": "object",
            "required": ["endpoint"],
            "properties": {"endpoint": {"type": "string"}, "method": {"type": "string"}, "params": {"type": "object"}, "rows_path": {"type": "string"}},
        },
        output_schema={
            "type": "object",
            "required": ["rows", "schema", "row_count"],
            "properties": {"rows": {"type": "array"}, "schema": {"type": "object"}, "row_count": {"type": "integer"}},
        },
        config_schema={"type": "object", "properties": {"auth_secret": {"type": "string"}}},
        permissions=["network", "secret"],
        example_input={"endpoint": "memory://sample", "method": "GET", "params": {}},
    )

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        endpoint = inputs["endpoint"]
        if endpoint.startswith("memory://"):
            rows: list[dict[str, Any]] = []
        else:
            url = endpoint
            params = inputs.get("params") or {}
            if params:
                separator = "&" if "?" in url else "?"
                url = f"{url}{separator}{urlencode(params)}"
            headers = {}
            if config and config.get("auth_secret"):
                headers["Authorization"] = f"Bearer {config['auth_secret']}"
            request = Request(url, method=inputs.get("method", "GET"), headers=headers)
            with urlopen(request, timeout=10) as response:  # noqa: S310 - Source Skill 明确代表可信外部数据源。
                payload = json.loads(response.read().decode("utf-8"))
            rows = _extract_rows(payload, inputs.get("rows_path", "rows"))
        return SkillResult(output={"rows": rows, "schema": _infer_schema(rows), "row_count": len(rows)})


class OnlineSampleSkill(BaseSkill):
    manifest = SkillManifest(
        skill_id="source.online_sample@0.1.0",
        name="Online Sampling Source",
        version="0.1.0",
        description="线上样本抽样 Source Skill，可从上游 rows 中按策略取样。",
        tags=["source", "sampling"],
        scenarios=["dataset", "online-sampling"],
        input_schema={
            "type": "object",
            "required": ["rows", "sample_size"],
            "properties": {"rows": {"type": "array"}, "sample_size": {"type": "integer"}, "seed": {"type": "integer"}},
        },
        output_schema={
            "type": "object",
            "required": ["rows", "schema", "row_count"],
            "properties": {"rows": {"type": "array"}, "schema": {"type": "object"}, "row_count": {"type": "integer"}},
        },
        config_schema={"type": "object", "properties": {"strategy": {"type": "string"}}},
        example_input={"rows": [{"question": "Q"}], "sample_size": 1},
        example_config={"strategy": "first_n"},
    )

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        rows = list(inputs["rows"])
        size = max(0, min(int(inputs["sample_size"]), len(rows)))
        strategy = (config or {}).get("strategy", "random")
        if strategy == "first_n":
            sampled = rows[:size]
        else:
            rng = random.Random(inputs.get("seed", 0))
            sampled = rng.sample(rows, size)
        return SkillResult(output={"rows": sampled, "schema": _infer_schema(sampled), "row_count": len(sampled)})


class LLMCallSkill(BaseSkill):
    manifest = SkillManifest(
        skill_id="llm.call@0.1.0",
        name="Deterministic LLM Call",
        version="0.1.0",
        description="无外部依赖的确定性 LLM 调用示例，用于回归评测闭环。",
        tags=["llm", "generation"],
        scenarios=["rag", "prompt-regression"],
        cacheable=True,
        config_schema={
            "type": "object",
            "properties": {
                "model": {"type": "string"},
                "temperature": {"type": "number"},
                "api_key": {"type": "string"},
            },
        },
        input_schema={"type": "object", "required": ["prompt"], "properties": {"prompt": {"type": "string"}, "variables": {"type": "object"}}},
        output_schema={
            "type": "object",
            "required": ["answer", "tokens", "latency_ms"],
            "properties": {"answer": {"type": "string"}, "tokens": {"type": "integer"}, "latency_ms": {"type": "number"}},
        },
        permissions=["network:optional", "secret:optional"],
        example_input={"prompt": "什么是 AegisQA?"},
        example_config={"model": "demo-model", "temperature": 0},
    )

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        config = config or {}
        prompt = inputs["prompt"]
        response = ModelGateway.from_env().generate(
            prompt=prompt,
            model=config.get("model"),
            temperature=config.get("temperature"),
        )
        tokens = int(response.usage.get("total_tokens") or max(1, math.ceil(len(response.text) / 2)))
        return SkillResult(
            output={"answer": response.text, "tokens": tokens, "latency_ms": response.latency_ms},
            metrics={"tokens": tokens, "model_provider": response.provider},
            logs=["通过 AegisQA 统一模型网关完成模型调用。"],
        )


class ModelChatSkill(BaseSkill):
    manifest = SkillManifest(
        skill_id="model.chat@0.1.0",
        name="统一模型调用",
        version="0.1.0",
        description="平台内置模型调用节点。业务 Skill 可消费该节点输出，不需要重复实现模型 API 调用流程。",
        tags=["model", "llm", "gateway"],
        scenarios=["generation", "judge", "workflow"],
        cacheable=True,
        config_schema={
            "type": "object",
            "properties": {
                "model": {"type": "string"},
                "temperature": {"type": "number"},
                "max_tokens": {"type": "integer"},
                "response_format": {"type": "object"},
            },
        },
        input_schema={
            "type": "object",
            "required": ["prompt"],
            "properties": {
                "prompt": {"type": "string"},
                "messages": {"type": "array"},
                "variables": {"type": "object"},
            },
        },
        output_schema={
            "type": "object",
            "required": ["text", "model", "provider", "usage"],
            "properties": {
                "text": {"type": "string"},
                "model": {"type": "string"},
                "provider": {"type": "string"},
                "usage": {"type": "object"},
                "latency_ms": {"type": "number"},
            },
        },
        permissions=["network:optional"],
        example_input={"prompt": "用一句话介绍 AegisQA。"},
        example_config={"model": "mock-eval-model", "temperature": 0},
    )

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        config = config or {}
        response = ModelGateway.from_env().generate(
            prompt=inputs.get("prompt"),
            messages=inputs.get("messages"),
            model=config.get("model"),
            temperature=config.get("temperature"),
            max_tokens=config.get("max_tokens"),
            response_format=config.get("response_format") if isinstance(config.get("response_format"), dict) else None,
        )
        output = {
            "text": response.text,
            "model": response.model,
            "provider": response.provider,
            "usage": response.usage,
            "latency_ms": response.latency_ms,
        }
        total_tokens = response.usage.get("total_tokens")
        metrics = {"model_latency_ms": response.latency_ms}
        if isinstance(total_tokens, (int, float)):
            metrics["tokens"] = total_tokens
        return SkillResult(output=output, metrics=metrics, logs=["通过 AegisQA 统一模型网关完成模型调用。"])


class LLMJudgeSkill(BaseSkill):
    manifest = SkillManifest(
        skill_id="llm.judge@0.1.0",
        name="Deterministic LLM Judge",
        version="0.1.0",
        description="确定性裁判示例，输出 score、label 和 reason。",
        tags=["judge", "llm"],
        scenarios=["rag", "meta-evaluation"],
        config_schema={
            "type": "object",
            "properties": {
                "model": {"type": "string"},
                "threshold": {"type": "number"},
                "rubric": {"type": "string"},
            },
        },
        input_schema={
            "type": "object",
            "required": ["question", "answer", "reference"],
            "properties": {
                "question": {"type": "string"},
                "answer": {"type": "string"},
                "reference": {"type": "string"},
            },
        },
        output_schema={
            "type": "object",
            "required": ["score", "label", "reason"],
            "properties": {"score": {"type": "number"}, "label": {"type": "string"}, "reason": {"type": "string"}},
        },
        example_input={"question": "Q", "answer": "AegisQA 是 AI 评测平台", "reference": "AI 评测平台"},
        example_config={"threshold": 0.5, "model": "judge-model"},
    )

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        config = config or {}
        threshold = float(config.get("threshold", 0.6))
        answer = inputs["answer"].lower()
        reference = inputs["reference"].lower()
        reference_terms = [term for term in reference.replace("，", " ").replace(",", " ").split() if term]
        if reference_terms:
            hits = sum(1 for term in reference_terms if term in answer)
            score = hits / len(reference_terms)
        else:
            score = 0.0
        label = "pass" if score >= threshold else "fail"
        reason = "回答命中参考要点" if label == "pass" else "回答未充分命中参考要点"
        return SkillResult(output={"score": score, "label": label, "reason": reason}, metrics={"judge_score": score})


class ASREvalSkill(BaseSkill):
    manifest = SkillManifest(
        skill_id="asr.eval@0.1.0",
        name="ASR Eval",
        version="0.1.0",
        description="ASR 评测示例，输出 CER/WER 和通过标记。",
        tags=["asr", "evaluation"],
        scenarios=["asr"],
        config_schema={"type": "object", "properties": {"threshold": {"type": "number"}}},
        input_schema={
            "type": "object",
            "required": ["audio_url", "reference_text"],
            "properties": {"audio_url": {"type": "string"}, "reference_text": {"type": "string"}, "language": {"type": "string"}},
        },
        output_schema={
            "type": "object",
            "required": ["transcript", "cer", "wer", "pass"],
            "properties": {
                "transcript": {"type": "string"},
                "cer": {"type": "number"},
                "wer": {"type": "number"},
                "pass": {"type": "boolean"},
            },
        },
        example_input={"audio_url": "https://example.com/a.wav", "reference_text": "hello"},
        example_config={"threshold": 0.2},
    )

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        threshold = float((config or {}).get("threshold", 0.2))
        transcript = inputs["reference_text"]
        return SkillResult(output={"transcript": transcript, "cer": 0.0, "wer": 0.0, "pass": 0.0 <= threshold}, metrics={"cer": 0.0, "wer": 0.0})


def _extract_rows(payload: Any, rows_path: str) -> list[dict[str, Any]]:
    """从 API 响应中提取 rows。

    支持响应本身就是 list，或通过 `rows_path` 指定对象路径。这样可以覆盖常见
    API 返回结构：`{"rows": [...]}`、`{"data": {"items": [...]}}` 等。
    """

    if isinstance(payload, list):
        rows = payload
    else:
        current = payload
        for part in rows_path.split("."):
            if isinstance(current, dict):
                current = current.get(part, [])
            else:
                current = []
        rows = current
    if not isinstance(rows, list):
        raise ValueError("API Source 提取结果必须是数组")
    return [row for row in rows if isinstance(row, dict)]


def _infer_schema(rows: list[dict[str, Any]]) -> dict[str, str]:
    values: dict[str, list[Any]] = {}
    for row in rows:
        for key, value in row.items():
            values.setdefault(key, []).append(value)
    return {key: _infer_type(items) for key, items in values.items()}


def _infer_type(values: list[Any]) -> str:
    non_null = [value for value in values if value is not None]
    if not non_null:
        return "text"
    if all(isinstance(value, bool) for value in non_null):
        return "boolean"
    if all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in non_null):
        return "number"
    if all(isinstance(value, (dict, list)) for value in non_null):
        return "json"
    return "text"
