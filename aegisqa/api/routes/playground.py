"""Prompt Playground API — 在线调试 Prompt 的后端接口。"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field

from aegisqa.api.routes.context import RouteContext
from aegisqa.models.gateway import ModelGateway


class PlaygroundExecuteRequest(BaseModel):
    """Playground 执行请求。"""
    prompt: str
    variables: dict[str, Any] = Field(default_factory=dict)
    model_connection_id: str | None = None
    model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = Field(default=None, ge=1, le=32768)


class PlaygroundJudgeRequest(BaseModel):
    """Playground 评判请求。"""
    output: str
    judge_prompt: str
    model_connection_id: str | None = None
    model: str | None = None


def register_playground_routes(app: FastAPI, ctx: RouteContext) -> None:
    """注册 Playground 相关路由。"""

    @app.post("/playground/execute")
    def playground_execute(request: PlaygroundExecuteRequest) -> dict[str, Any]:
        """执行 Playground Prompt，调用真实模型网关。"""
        # 变量注入
        prompt = request.prompt
        for key, value in request.variables.items():
            placeholder = "{{" + key + "}}"
            prompt = prompt.replace(placeholder, str(value))

        # 调用模型网关
        gateway = ModelGateway.from_env(connection_id=request.model_connection_id)
        response = gateway.generate(
            prompt=prompt,
            model=request.model,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
        )

        return {
            "output": response.text,
            "model": response.model,
            "provider": response.provider,
            "latency_ms": response.latency_ms,
            "usage": response.usage,
            "raw": response.raw,
        }

    @app.post("/playground/judge")
    def playground_judge(request: PlaygroundJudgeRequest) -> dict[str, Any]:
        """使用 LLM-as-Judge 评判输出质量。"""
        judge_prompt = request.judge_prompt.replace("{{output}}", request.output)

        gateway = ModelGateway.from_env(connection_id=request.model_connection_id)
        response = gateway.generate(
            prompt=judge_prompt,
            model=request.model,
            temperature=0,
            max_tokens=1024,
        )

        # 尝试解析 JSON 评判结果
        import json
        try:
            parsed = json.loads(response.text)
        except (json.JSONDecodeError, ValueError):
            parsed = {"raw_output": response.text}

        return {
            "result": parsed,
            "model": response.model,
            "latency_ms": response.latency_ms,
        }
