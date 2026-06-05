"""统一模型网关。

平台里的业务 Skill 不应该各自实现一套模型 API 调用、鉴权、超时和返回解析。
本模块把模型调用收敛到一个可测试的网关：默认 mock 离线可跑，生产环境可通过
OpenAI-compatible Chat Completions 协议接入真实模型服务。
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from time import perf_counter
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import BaseModel, Field, field_validator

from aegisqa.core.errors import AegisQAError
from aegisqa.core.security import redact_secrets


MODEL_PROVIDER_ENV = "AEGISQA_MODEL_PROVIDER"
MODEL_BASE_URL_ENV = "AEGISQA_MODEL_BASE_URL"
MODEL_API_KEY_ENV = "AEGISQA_MODEL_API_KEY"
MODEL_API_KEY_REF_ENV = "AEGISQA_MODEL_API_KEY_REF"
MODEL_DEFAULT_ENV = "AEGISQA_MODEL_DEFAULT_MODEL"
MODEL_TIMEOUT_ENV = "AEGISQA_MODEL_TIMEOUT_SECONDS"
MODEL_SECRET_DOTENV_ENV = "AEGISQA_MODEL_SECRET_DOTENV"
DEFAULT_MODEL_TIMEOUT_SECONDS = 60
MAX_MODEL_TIMEOUT_SECONDS = 600
MODEL_GATEWAY_SETTINGS_PARTS = ["settings", "model_gateway.json"]
MODEL_GATEWAY_CONNECTIONS_PARTS = ["settings", "model_gateway_connections.json"]
SUPPORTED_MODEL_PROVIDERS = {"mock", "demo", "offline", "openai", "openai_compatible", "compatible"}
DEFAULT_OR_EMPTY_MODEL_NAMES = {"", "mock-eval-model"}
_runtime_config: ModelGatewayConfig | None = None
_runtime_connections: dict[str, ModelGatewayConnectionConfig] = {}


class ModelGatewayConfig(BaseModel):
    """模型网关运行配置。"""

    provider: str = "mock"
    base_url: str | None = None
    secret_ref: str | None = None
    # `api_key` 只允许作为运行期临时值存在，持久化时必须剔除。
    api_key: str | None = None
    default_model: str = "mock-eval-model"
    timeout_seconds: int = DEFAULT_MODEL_TIMEOUT_SECONDS

    @field_validator("provider")
    @classmethod
    def normalize_provider(cls, value: str) -> str:
        return (value or "mock").strip() or "mock"

    @field_validator("default_model")
    @classmethod
    def normalize_default_model(cls, value: str) -> str:
        return (value or "mock-eval-model").strip() or "mock-eval-model"

    @field_validator("base_url", "secret_ref", "api_key", mode="before")
    @classmethod
    def normalize_optional_string(cls, value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @field_validator("timeout_seconds", mode="before")
    @classmethod
    def normalize_timeout_seconds(cls, value: Any) -> int:
        return _resolve_timeout(None if value in (None, "") else str(value))

    @classmethod
    def from_env(cls) -> "ModelGatewayConfig":
        runtime_config = get_model_gateway_runtime_config()
        if runtime_config:
            return runtime_config
        return cls(
            provider=os.getenv(MODEL_PROVIDER_ENV, "mock"),
            base_url=os.getenv(MODEL_BASE_URL_ENV) or None,
            secret_ref=os.getenv(MODEL_API_KEY_REF_ENV) or None,
            api_key=os.getenv(MODEL_API_KEY_ENV) or None,
            default_model=os.getenv(MODEL_DEFAULT_ENV, "mock-eval-model"),
            timeout_seconds=_resolve_timeout(os.getenv(MODEL_TIMEOUT_ENV)),
        )


class ModelGatewayConnectionConfig(ModelGatewayConfig):
    """带业务别名的模型连接配置。"""

    connection_id: str
    name: str | None = None
    enabled: bool = True

    @field_validator("connection_id")
    @classmethod
    def normalize_connection_id(cls, value: str) -> str:
        text = (value or "").strip()
        if not text:
            raise ValueError("connection_id 不能为空。")
        return text

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None


class ModelResponse(BaseModel):
    """统一模型响应。"""

    text: str
    provider: str
    model: str
    usage: dict[str, Any] = Field(default_factory=dict)
    latency_ms: float = 0.0
    raw: dict[str, Any] = Field(default_factory=dict)


class ModelGateway:
    """统一执行模型调用的入口。"""

    def __init__(self, config: ModelGatewayConfig | None = None, *, connection_id: str | None = None) -> None:
        self.config = config or resolve_model_gateway_config(connection_id)

    @classmethod
    def from_env(cls, connection_id: str | None = None) -> "ModelGateway":
        return cls(resolve_model_gateway_config(connection_id))

    def status(self) -> dict[str, Any]:
        provider = self.config.provider.lower()
        uses_external_endpoint = provider not in {"mock", "demo", "offline", ""}
        api_key = resolve_model_gateway_api_key(self.config)
        return {
            "provider": provider or "mock",
            "ready": True if not uses_external_endpoint else bool(self.config.base_url),
            "mode": "offline_mock" if not uses_external_endpoint else "openai_compatible",
            "default_model": self.config.default_model,
            "base_url_configured": bool(self.config.base_url),
            "api_key_configured": bool(api_key),
            "timeout_seconds": self.config.timeout_seconds,
        }

    def generate(
        self,
        *,
        prompt: str | None = None,
        messages: list[dict[str, Any]] | None = None,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        response_format: dict[str, Any] | None = None,
    ) -> ModelResponse:
        provider = self.config.provider.lower()
        selected_model = model or self.config.default_model
        if provider in {"mock", "demo", "offline", ""}:
            return self._mock_generate(prompt=prompt, messages=messages, model=selected_model)
        if provider in {"openai", "openai_compatible", "compatible"}:
            return self._openai_compatible_generate(
                prompt=prompt,
                messages=messages,
                model=selected_model,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format=response_format,
            )
        raise AegisQAError(
            "MODEL_PROVIDER_UNSUPPORTED",
            f"不支持的模型 Provider：{self.config.provider}",
            status_code=400,
            details={"provider": self.config.provider, "supported": ["mock", "openai_compatible"]},
        )

    def _mock_generate(self, *, prompt: str | None, messages: list[dict[str, Any]] | None, model: str) -> ModelResponse:
        started = perf_counter()
        text_prompt = prompt or _messages_to_prompt(messages)
        text = f"模型回答：{text_prompt}。这是 AegisQA 统一模型网关的离线示例输出。"
        total_tokens = max(1, math.ceil(len(text) / 2))
        return ModelResponse(
            text=text,
            provider="mock",
            model=model,
            usage={"prompt_tokens": max(1, math.ceil(len(text_prompt) / 2)), "completion_tokens": total_tokens, "total_tokens": total_tokens},
            latency_ms=(perf_counter() - started) * 1000,
            raw={"mock": True},
        )

    def _openai_compatible_generate(
        self,
        *,
        prompt: str | None,
        messages: list[dict[str, Any]] | None,
        model: str,
        temperature: float | None,
        max_tokens: int | None,
        response_format: dict[str, Any] | None,
    ) -> ModelResponse:
        if not self.config.base_url:
            raise AegisQAError(
                "MODEL_GATEWAY_NOT_CONFIGURED",
                "模型网关未配置 base_url，请设置 AEGISQA_MODEL_BASE_URL。",
                status_code=400,
                details={"required_env": MODEL_BASE_URL_ENV},
            )
        started = perf_counter()
        endpoint = self._chat_completions_endpoint()
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages or [{"role": "user", "content": prompt or ""}],
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if response_format:
            payload["response_format"] = response_format
        headers = {"Content-Type": "application/json"}
        api_key = resolve_model_gateway_api_key(self.config)
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        request = Request(
            endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.config.timeout_seconds) as response:  # noqa: S310 - endpoint 来自受控部署配置。
                data = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise AegisQAError(
                "MODEL_GATEWAY_HTTP_ERROR",
                f"模型网关请求失败：HTTP {exc.code}",
                status_code=502,
                details={"status_code": exc.code, "body": str(redact_secrets(body))[:1000]},
            ) from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise AegisQAError(
                "MODEL_GATEWAY_NETWORK_ERROR",
                "模型网关请求网络失败或超时。",
                status_code=502,
                details={"error": str(redact_secrets(str(exc))), "timeout_seconds": self.config.timeout_seconds},
            ) from exc
        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        text = str(message.get("content") or choice.get("text") or "")
        return ModelResponse(
            text=text,
            provider=self.config.provider,
            model=str(data.get("model") or model),
            usage=data.get("usage") or {},
            latency_ms=(perf_counter() - started) * 1000,
            raw={"id": data.get("id"), "finish_reason": choice.get("finish_reason")},
        )

    def _chat_completions_endpoint(self) -> str:
        base_url = (self.config.base_url or "").rstrip("/")
        if base_url.endswith("/chat/completions"):
            return base_url
        if base_url.endswith("/v1"):
            return f"{base_url}/chat/completions"
        return f"{base_url}/v1/chat/completions"


def model_response_usage_metrics(response: ModelResponse, *, connection_id: str | None = None) -> dict[str, Any]:
    """把不同模型服务返回的 usage 规整成 Step/Report 可聚合账单指标。"""

    usage = response.usage or {}
    prompt_tokens = _usage_number(usage, "prompt_tokens", "input_tokens")
    completion_tokens = _usage_number(usage, "completion_tokens", "output_tokens", "generated_tokens")
    total_tokens = _usage_number(usage, "total_tokens")
    if total_tokens is None and (prompt_tokens is not None or completion_tokens is not None):
        total_tokens = float(prompt_tokens or 0) + float(completion_tokens or 0)
    cost, cost_source, currency = _usage_cost(usage)
    if cost is None:
        cost = 0.0
        cost_source = "provider_usage.tokens_unpriced" if total_tokens is not None else "provider_usage.missing"
    metrics: dict[str, Any] = {
        "prompt_tokens": _token_metric(prompt_tokens),
        "completion_tokens": _token_metric(completion_tokens),
        "total_tokens": _token_metric(total_tokens),
        "cost": float(cost),
        "model_cost": float(cost),
        "cost_source": cost_source,
        "model_provider": response.provider,
        "model_name": response.model,
        "model_latency_ms": response.latency_ms,
    }
    if currency:
        metrics["cost_currency"] = currency
    if connection_id:
        metrics["model_connection_id"] = connection_id
    return metrics


def set_model_gateway_runtime_config(config: ModelGatewayConfig | None) -> None:
    """设置当前进程内的模型网关配置。

    Workflow、Agent Skill 和内置模型 Skill 都通过 `ModelGateway.from_env()` 获取配置。
    前端保存配置后需要立刻影响这些调用，因此这里用进程级覆盖配置作为运行期入口；
    持久化仍由 store 承担，避免只改环境变量导致重启丢失。
    """

    global _runtime_config
    _runtime_config = config.model_copy(deep=True) if config else None


def get_model_gateway_runtime_config() -> ModelGatewayConfig | None:
    """返回运行期配置副本，避免调用方误改全局对象。"""

    return _runtime_config.model_copy(deep=True) if _runtime_config else None


def resolve_model_gateway_config(connection_id: str | None = None) -> ModelGatewayConfig:
    """解析模型调用应使用的配置。

    不传连接别名时保持旧的 default_model 行为；传入别名时只从运行期连接表中查找，
    避免悄悄回退到默认连接导致任务快照和真实调用不一致。
    """

    if connection_id:
        connection = get_model_gateway_connection_runtime_config(connection_id)
        if not connection:
            raise AegisQAError(
                "MODEL_CONNECTION_NOT_FOUND",
                "模型连接别名不存在或未启用。",
                status_code=404,
                details={"connection_id": connection_id},
            )
        return _connection_to_gateway_config(connection)
    return ModelGatewayConfig.from_env()


def set_model_gateway_runtime_connections(connections: list[ModelGatewayConnectionConfig]) -> None:
    """设置当前进程内的模型连接别名表。"""

    global _runtime_connections
    _runtime_connections = {connection.connection_id: connection.model_copy(deep=True) for connection in connections if connection.enabled}


def get_model_gateway_connection_runtime_config(connection_id: str) -> ModelGatewayConnectionConfig | None:
    """返回运行期模型连接副本。"""

    connection = _runtime_connections.get(connection_id)
    return connection.model_copy(deep=True) if connection else None


def load_model_gateway_config_from_store(store: Any) -> ModelGatewayConfig | None:
    """从本地 store 恢复模型网关配置，并写入当前进程覆盖配置。"""

    load_model_gateway_connections_from_store(store)
    payload = store.read_json(MODEL_GATEWAY_SETTINGS_PARTS, default=None)
    if not payload:
        set_model_gateway_runtime_config(None)
        return None
    migrated_payload = _migrate_legacy_model_provider_payload(payload)
    sanitized_payload = _persisted_model_gateway_payload(ModelGatewayConfig(**migrated_payload))
    if payload != sanitized_payload:
        store.write_json(MODEL_GATEWAY_SETTINGS_PARTS, sanitized_payload)
    config = ModelGatewayConfig(**sanitized_payload)
    set_model_gateway_runtime_config(config)
    return config


def save_model_gateway_config_to_store(store: Any, config: ModelGatewayConfig) -> ModelGatewayConfig:
    """保存模型网关配置，并立即让当前进程生效。"""

    payload = _persisted_model_gateway_payload(config)
    store.write_json(MODEL_GATEWAY_SETTINGS_PARTS, payload)
    runtime_config = ModelGatewayConfig(**payload)
    set_model_gateway_runtime_config(runtime_config)
    return runtime_config


def load_model_gateway_connections_from_store(store: Any) -> list[ModelGatewayConnectionConfig]:
    """从 store 恢复模型连接别名，并写入当前进程覆盖配置。"""

    raw_payload = store.read_json(MODEL_GATEWAY_CONNECTIONS_PARTS, default={"connections": []}) or {"connections": []}
    raw_connections = raw_payload if isinstance(raw_payload, list) else raw_payload.get("connections", [])
    connections = [ModelGatewayConnectionConfig(**_migrate_legacy_model_provider_payload(payload)) for payload in raw_connections if isinstance(payload, dict)]
    sanitized = [_persisted_model_gateway_connection_payload(connection) for connection in connections]
    expected_payload = {"connections": sanitized}
    if raw_payload != expected_payload:
        store.write_json(MODEL_GATEWAY_CONNECTIONS_PARTS, expected_payload)
    set_model_gateway_runtime_connections(connections)
    return [connection.model_copy(deep=True) for connection in connections]


def list_model_gateway_connections_from_store(store: Any) -> list[ModelGatewayConnectionConfig]:
    """列出模型连接别名。"""

    return load_model_gateway_connections_from_store(store)


def save_model_gateway_connection_to_store(store: Any, connection: ModelGatewayConnectionConfig) -> ModelGatewayConnectionConfig:
    """新增或更新模型连接别名，并刷新运行期连接表。"""

    connections = {item.connection_id: item for item in load_model_gateway_connections_from_store(store)}
    connections[connection.connection_id] = ModelGatewayConnectionConfig(**_persisted_model_gateway_connection_payload(connection))
    ordered = sorted(connections.values(), key=lambda item: item.connection_id)
    store.write_json(MODEL_GATEWAY_CONNECTIONS_PARTS, {"connections": [_persisted_model_gateway_connection_payload(item) for item in ordered]})
    set_model_gateway_runtime_connections(ordered)
    return connections[connection.connection_id].model_copy(deep=True)


def delete_model_gateway_connection_from_store(store: Any, connection_id: str) -> bool:
    """删除模型连接别名。"""

    connections = [item for item in load_model_gateway_connections_from_store(store) if item.connection_id != connection_id]
    deleted = len(connections) != len(load_model_gateway_connections_from_store(store))
    store.write_json(MODEL_GATEWAY_CONNECTIONS_PARTS, {"connections": [_persisted_model_gateway_connection_payload(item) for item in connections]})
    set_model_gateway_runtime_connections(connections)
    return deleted


def public_model_gateway_config(config: ModelGatewayConfig | None = None, *, source: str = "runtime") -> dict[str, Any]:
    """返回前端可展示的模型网关配置。

    API Key 只能返回是否已配置和掩码，不能把明文密钥再发回浏览器。
    """

    resolved = config or ModelGatewayConfig.from_env()
    api_key = resolve_model_gateway_api_key(resolved)
    return {
        "provider": resolved.provider,
        "base_url": resolved.base_url,
        "secret_ref": resolved.secret_ref,
        "default_model": resolved.default_model,
        "timeout_seconds": resolved.timeout_seconds,
        "api_key_configured": bool(api_key),
        "api_key_masked": _mask_secret(api_key),
        "source": source,
    }


def public_model_gateway_connection_config(connection: ModelGatewayConnectionConfig) -> dict[str, Any]:
    """返回前端可展示的模型连接配置。"""

    api_key = resolve_model_gateway_api_key(connection)
    return {
        "connection_id": connection.connection_id,
        "name": connection.name,
        "provider": connection.provider,
        "base_url": connection.base_url,
        "secret_ref": connection.secret_ref,
        "default_model": connection.default_model,
        "timeout_seconds": connection.timeout_seconds,
        "enabled": connection.enabled,
        "api_key_configured": bool(api_key),
        "api_key_masked": _mask_secret(api_key),
    }


def resolve_model_gateway_api_key(config: ModelGatewayConfig) -> str | None:
    """解析运行期可用密钥，优先使用临时值，再从 secret_ref 指向的环境中读取。"""

    if config.api_key:
        return config.api_key
    return resolve_model_secret(config.secret_ref)


def resolve_model_secret(secret_ref: str | None) -> str | None:
    """解析本地开发可用的 Secret 引用。

    支持 `env:NAME`、`dotenv:NAME` 和裸变量名。裸变量名会先查环境变量，再查 `.env`。
    """

    if not secret_ref:
        return None
    raw_ref = secret_ref.strip()
    if not raw_ref:
        return None
    source, _, name = raw_ref.partition(":")
    if not name:
        source = "auto"
        name = raw_ref
    name = name.strip()
    if not name:
        return None
    if source in {"env", "auto"}:
        value = os.getenv(name)
        if value:
            return value.strip() or None
    if source in {"dotenv", "auto"}:
        return _read_dotenv_value(name)
    return None


def _mask_secret(secret: str | None) -> str | None:
    if not secret:
        return None
    if len(secret) <= 8:
        return "*" * len(secret)
    return f"{secret[:4]}...{secret[-4:]}"


def _persisted_model_gateway_payload(config: ModelGatewayConfig) -> dict[str, Any]:
    """生成可落盘配置，避免把运行期明文密钥写入本地 store。"""

    return config.model_dump(mode="json", exclude={"api_key"})


def _persisted_model_gateway_connection_payload(config: ModelGatewayConnectionConfig) -> dict[str, Any]:
    """生成可落盘连接配置，避免把运行期明文密钥写入本地 store。"""

    return config.model_dump(mode="json", exclude={"api_key"})


def _migrate_legacy_model_provider_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """兼容早期 UI 把模型名误存到 provider 的本地配置。

    旧版前端曾允许自由填写 Provider，用户可能把 `deepseek-v4-flash`、
    `qwen-plus` 这类模型名写进 provider。加载时如果继续保留该值，
    所有模型调用都会在运行期报 MODEL_PROVIDER_UNSUPPORTED。这里把不支持
    的 provider 迁移为 OpenAI-compatible 协议，并在默认模型为空或仍是
    mock 默认值时，把原 provider 当作真实模型名保留下来。
    """

    copied = dict(payload)
    raw_provider = str(copied.get("provider") or "mock").strip()
    normalized_provider = raw_provider.lower()
    if normalized_provider in SUPPORTED_MODEL_PROVIDERS:
        copied["provider"] = normalized_provider
        return copied
    copied["provider"] = "openai_compatible"
    default_model = str(copied.get("default_model") or "").strip()
    if default_model in DEFAULT_OR_EMPTY_MODEL_NAMES:
        copied["default_model"] = raw_provider
    return copied


def _connection_to_gateway_config(connection: ModelGatewayConnectionConfig) -> ModelGatewayConfig:
    return ModelGatewayConfig(**connection.model_dump(mode="json", exclude={"connection_id", "name", "enabled"}))


def _read_dotenv_value(name: str) -> str | None:
    for path in _dotenv_candidate_paths():
        if not path.exists() or not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            if key.strip() != name:
                continue
            return value.strip().strip('"').strip("'") or None
    return None


def _dotenv_candidate_paths() -> list[Path]:
    explicit_path = os.getenv(MODEL_SECRET_DOTENV_ENV)
    if explicit_path:
        return [Path(explicit_path).expanduser()]
    return [Path.cwd() / ".env"]


def _messages_to_prompt(messages: list[dict[str, Any]] | None) -> str:
    if not messages:
        return ""
    parts: list[str] = []
    for message in messages:
        role = str(message.get("role") or "user")
        content = str(message.get("content") or "")
        parts.append(f"{role}: {content}")
    return "\n".join(parts)


def _usage_number(usage: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        value = usage.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            return float(value)
    return None


def _usage_cost(usage: dict[str, Any]) -> tuple[float | None, str, str | None]:
    cost_fields = ("total_cost", "cost", "total_cost_usd", "cost_usd")
    for key in cost_fields:
        value = usage.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        currency = str(usage.get("currency") or "USD") if key.endswith("_usd") else str(usage.get("currency") or "") or None
        return float(value), f"provider_usage.{key}", currency
    return None, "provider_usage.missing", str(usage.get("currency") or "") or None


def _token_metric(value: float | None) -> int:
    if value is None:
        return 0
    return int(value) if float(value).is_integer() else int(round(value))


def _resolve_timeout(raw_value: str | None) -> int:
    if raw_value in (None, ""):
        return DEFAULT_MODEL_TIMEOUT_SECONDS
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        return DEFAULT_MODEL_TIMEOUT_SECONDS
    return max(1, min(parsed, MAX_MODEL_TIMEOUT_SECONDS))
