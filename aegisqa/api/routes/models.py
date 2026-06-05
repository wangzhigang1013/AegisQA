from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field

from aegisqa.api.routes.context import RouteContext
from aegisqa.core.errors import AegisQAError
from aegisqa.models.gateway import (
    delete_model_gateway_connection_from_store,
    list_model_gateway_connections_from_store,
    ModelGateway,
    ModelGatewayConnectionConfig,
    ModelGatewayConfig,
    get_model_gateway_runtime_config,
    public_model_gateway_connection_config,
    public_model_gateway_config,
    resolve_model_gateway_api_key,
    save_model_gateway_config_to_store,
    save_model_gateway_connection_to_store,
    SUPPORTED_MODEL_PROVIDERS,
)
from aegisqa.security.access import require_permission


MODEL_GATEWAY_CONFIGURE_PERMISSION = "model:configure"


class ModelGatewayProbeRequest(BaseModel):
    prompt: str
    model_connection_id: str | None = None
    model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = Field(default=None, ge=1)
    api_key: str | None = None
    secret_ref: str | None = None
    role: str = "Admin"
    actor: str = "api"


class ModelGatewayConfigRequest(BaseModel):
    provider: str = "mock"
    base_url: str | None = None
    secret_ref: str | None = None
    # 兼容旧前端字段：接收但不持久化，只允许测试接口使用临时密钥。
    api_key: str | None = None
    default_model: str = "mock-eval-model"
    timeout_seconds: int = Field(default=60, ge=1, le=600)
    clear_api_key: bool = False
    role: str = "Admin"
    actor: str = "api"


class ModelGatewayConnectionRequest(BaseModel):
    connection_id: str | None = None
    name: str | None = None
    provider: str = "mock"
    base_url: str | None = None
    secret_ref: str | None = None
    # 兼容测试连接表单：接收但不持久化。
    api_key: str | None = None
    default_model: str = "mock-eval-model"
    timeout_seconds: int = Field(default=60, ge=1, le=600)
    enabled: bool = True
    clear_api_key: bool = False
    role: str = "Admin"
    actor: str = "api"


def register_model_routes(app: FastAPI, ctx: RouteContext) -> None:
    @app.get("/model-gateway/config")
    def get_model_gateway_config() -> dict[str, Any]:
        config = ModelGatewayConfig.from_env()
        source = "store" if get_model_gateway_runtime_config() else "env"
        return public_model_gateway_config(config, source=source)

    @app.put("/model-gateway/config")
    def update_model_gateway_config(request: ModelGatewayConfigRequest) -> dict[str, Any]:
        _require_model_gateway_configure(
            ctx,
            role=request.role,
            actor=request.actor,
            action="model_gateway.config_update",
            target=request.provider,
        )
        provider = request.provider.strip().lower()
        if provider not in SUPPORTED_MODEL_PROVIDERS:
            raise AegisQAError(
                "MODEL_PROVIDER_UNSUPPORTED",
                f"不支持的模型 Provider：{request.provider}",
                status_code=400,
                details={"supported": sorted(SUPPORTED_MODEL_PROVIDERS)},
            )
        current = ModelGatewayConfig.from_env()
        if request.clear_api_key:
            secret_ref = None
        elif "secret_ref" in request.model_fields_set:
            secret_ref = request.secret_ref
        else:
            secret_ref = current.secret_ref
        config = ModelGatewayConfig(
            provider=provider,
            base_url=request.base_url,
            secret_ref=secret_ref,
            default_model=request.default_model,
            timeout_seconds=request.timeout_seconds,
        )
        persisted_config = save_model_gateway_config_to_store(ctx.store, config)
        ctx.audit_service.record(
            actor=request.actor,
            role=request.role,
            action="model_gateway.config_update",
            target=persisted_config.provider,
            detail={
                "role": request.role,
                "provider": persisted_config.provider,
                "base_url_configured": bool(persisted_config.base_url),
                "api_key_configured": bool(resolve_model_gateway_api_key(persisted_config)),
                "secret_ref_configured": bool(persisted_config.secret_ref),
                "default_model": persisted_config.default_model,
                "timeout_seconds": persisted_config.timeout_seconds,
            },
        )
        return public_model_gateway_config(persisted_config, source="store")

    @app.get("/model-gateway/status")
    def model_gateway_status() -> dict[str, Any]:
        status = ModelGateway.from_env().status()
        return {
            **status,
            "skill_ref": "model.chat@0.1.0",
            "message": "业务 Skill 不需要重复实现模型调用，可在 Workflow 中复用统一模型调用节点。",
        }

    @app.get("/model-gateway/connections")
    def list_model_gateway_connections() -> list[dict[str, Any]]:
        return [public_model_gateway_connection_config(connection) for connection in list_model_gateway_connections_from_store(ctx.store)]

    @app.post("/model-gateway/connections")
    def create_model_gateway_connection(request: ModelGatewayConnectionRequest) -> dict[str, Any]:
        _require_model_gateway_configure(
            ctx,
            role=request.role,
            actor=request.actor,
            action="model_gateway.connection.upsert",
            target=request.connection_id or "missing_connection_id",
        )
        if not request.connection_id:
            raise AegisQAError(
                "MODEL_CONNECTION_ID_REQUIRED",
                "模型连接必须提供 connection_id。",
                status_code=400,
                details={"field": "connection_id"},
            )
        connection = _build_model_gateway_connection(request, connection_id=request.connection_id)
        saved = save_model_gateway_connection_to_store(ctx.store, connection)
        ctx.audit_service.record(
            actor=request.actor,
            role=request.role,
            action="model_gateway.connection.upsert",
            target=saved.connection_id,
            detail={"role": request.role, "provider": saved.provider, "default_model": saved.default_model, "secret_ref_configured": bool(saved.secret_ref)},
        )
        return public_model_gateway_connection_config(saved)

    @app.put("/model-gateway/connections/{connection_id}")
    def update_model_gateway_connection(connection_id: str, request: ModelGatewayConnectionRequest) -> dict[str, Any]:
        _require_model_gateway_configure(
            ctx,
            role=request.role,
            actor=request.actor,
            action="model_gateway.connection.upsert",
            target=connection_id,
        )
        existing = {item.connection_id: item for item in list_model_gateway_connections_from_store(ctx.store)}
        current = existing.get(connection_id)
        if not current:
            raise AegisQAError(
                "MODEL_CONNECTION_NOT_FOUND",
                "模型连接别名不存在。",
                status_code=404,
                details={"connection_id": connection_id},
            )
        merged = current.model_dump(mode="json")
        for field in {"name", "provider", "base_url", "default_model", "timeout_seconds", "enabled"}:
            if field in request.model_fields_set:
                merged[field] = getattr(request, field)
        if request.clear_api_key:
            merged["secret_ref"] = None
        elif "secret_ref" in request.model_fields_set:
            merged["secret_ref"] = request.secret_ref
        saved = save_model_gateway_connection_to_store(ctx.store, _build_model_gateway_connection(ModelGatewayConnectionRequest(**merged), connection_id=connection_id))
        ctx.audit_service.record(
            actor=request.actor,
            role=request.role,
            action="model_gateway.connection.upsert",
            target=saved.connection_id,
            detail={"role": request.role, "provider": saved.provider, "default_model": saved.default_model, "secret_ref_configured": bool(saved.secret_ref)},
        )
        return public_model_gateway_connection_config(saved)

    @app.delete("/model-gateway/connections/{connection_id}")
    def delete_model_gateway_connection(connection_id: str, role: str = "Admin", actor: str = "api") -> dict[str, Any]:
        _require_model_gateway_configure(
            ctx,
            role=role,
            actor=actor,
            action="model_gateway.connection.delete",
            target=connection_id,
        )
        deleted = delete_model_gateway_connection_from_store(ctx.store, connection_id)
        if not deleted:
            raise AegisQAError(
                "MODEL_CONNECTION_NOT_FOUND",
                "模型连接别名不存在。",
                status_code=404,
                details={"connection_id": connection_id},
            )
        ctx.audit_service.record(actor=actor, role=role, action="model_gateway.connection.delete", target=connection_id, detail={"role": role})
        return {"deleted": True, "connection_id": connection_id}

    @app.post("/model-gateway/test")
    def test_model_gateway(request: ModelGatewayProbeRequest) -> dict[str, Any]:
        # 连接测试可能真实调用外部模型并消耗额度，也可能使用临时密钥；必须先过治理权限。
        _require_model_gateway_configure(
            ctx,
            role=request.role,
            actor=request.actor,
            action="model_gateway.test",
            target=request.model_connection_id or request.model or "default",
        )
        base_config = ModelGateway.from_env(connection_id=request.model_connection_id).config
        probe_config = base_config.model_copy(
            update={
                "api_key": request.api_key or base_config.api_key,
                "secret_ref": request.secret_ref if "secret_ref" in request.model_fields_set else base_config.secret_ref,
            }
        )
        response = ModelGateway(probe_config).generate(
            prompt=request.prompt,
            model=request.model,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
        )
        ctx.audit_service.record(
            actor=request.actor,
            role=request.role,
            action="model_gateway.test",
            target=response.model,
            detail={"role": request.role, "provider": response.provider, "latency_ms": response.latency_ms},
        )
        return {"ok": True, "response": response.model_dump(mode="json")}


def _require_model_gateway_configure(ctx: RouteContext, *, role: str, actor: str, action: str, target: str) -> None:
    require_permission(
        ctx.access_control,
        ctx.audit_service,
        role=role,
        permission=MODEL_GATEWAY_CONFIGURE_PERMISSION,
        action=action,
        target=target,
        actor=actor,
    )


def _build_model_gateway_connection(request: ModelGatewayConnectionRequest, *, connection_id: str) -> ModelGatewayConnectionConfig:
    provider = request.provider.strip().lower()
    if provider not in SUPPORTED_MODEL_PROVIDERS:
        raise AegisQAError(
            "MODEL_PROVIDER_UNSUPPORTED",
            f"不支持的模型 Provider：{request.provider}",
            status_code=400,
            details={"supported": sorted(SUPPORTED_MODEL_PROVIDERS)},
        )
    return ModelGatewayConnectionConfig(
        connection_id=connection_id,
        name=request.name,
        provider=provider,
        base_url=request.base_url,
        secret_ref=None if request.clear_api_key else request.secret_ref,
        default_model=request.default_model,
        timeout_seconds=request.timeout_seconds,
        enabled=request.enabled,
    )
