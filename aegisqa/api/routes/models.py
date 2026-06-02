from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field

from aegisqa.api.routes.context import RouteContext
from aegisqa.models.gateway import ModelGateway


class ModelGatewayProbeRequest(BaseModel):
    prompt: str
    model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = Field(default=None, ge=1)


def register_model_routes(app: FastAPI, ctx: RouteContext) -> None:
    @app.get("/model-gateway/status")
    def model_gateway_status() -> dict[str, Any]:
        status = ModelGateway.from_env().status()
        return {
            **status,
            "skill_ref": "model.chat@0.1.0",
            "message": "业务 Skill 不需要重复实现模型调用，可在 Workflow 中复用统一模型调用节点。",
        }

    @app.post("/model-gateway/test")
    def test_model_gateway(request: ModelGatewayProbeRequest) -> dict[str, Any]:
        response = ModelGateway.from_env().generate(
            prompt=request.prompt,
            model=request.model,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
        )
        ctx.audit_service.record(
            actor="api",
            action="model_gateway.test",
            target=response.model,
            detail={"provider": response.provider, "latency_ms": response.latency_ms},
        )
        return {"ok": True, "response": response.model_dump(mode="json")}
