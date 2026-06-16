"""统一模型网关。

平台里的业务 Skill 不应该各自实现一套模型 API 调用、鉴权、超时和返回解析。
本模块把模型调用收敛到一个可测试的网关：默认 mock 离线可跑，生产环境可通过
OpenAI-compatible Chat Completions 协议接入真实模型服务。
"""

from __future__ import annotations

import json
import math
import os
import threading
import time
from pathlib import Path
from time import perf_counter
from typing import Any, Generator
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
ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_MODEL_TIMEOUT_SECONDS = 60
MAX_MODEL_TIMEOUT_SECONDS = 600
MODEL_GATEWAY_SETTINGS_PARTS = ["settings", "model_gateway.json"]
MODEL_GATEWAY_CONNECTIONS_PARTS = ["settings", "model_gateway_connections.json"]
SUPPORTED_MODEL_PROVIDERS = {"mock", "demo", "offline", "openai", "openai_compatible", "compatible", "anthropic", "claude"}
DEFAULT_OR_EMPTY_MODEL_NAMES = {"", "mock-eval-model"}
_runtime_config: ModelGatewayConfig | None = None
_runtime_connections: dict[str, ModelGatewayConnectionConfig] = {}
_api_key_rotation_index: int = 0
_config_last_loaded: float = 0  # 配置最后加载时间戳
_config_store_ref: Any = None  # store 引用，用于跨进程同步


class ModelGatewayConfig(BaseModel):
    """模型网关运行配置。"""

    provider: str = "mock"
    base_url: str | None = None
    secret_ref: str | None = None
    # `api_key` 只允许作为运行期临时值存在，持久化时必须剔除。
    api_key: str | None = None
    # 多 API Key 支持（轮询使用）
    api_keys: list[str] = Field(default_factory=list)
    default_model: str = "mock-eval-model"
    # Fallback 模型链
    fallback_models: list[str] = Field(default_factory=list)
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
        mode = "offline_mock"
        if uses_external_endpoint:
            mode = "anthropic" if provider in {"anthropic", "claude"} else "openai_compatible"
        return {
            "provider": provider or "mock",
            "ready": True if not uses_external_endpoint else bool(self.config.base_url),
            "mode": mode,
            "default_model": self.config.default_model,
            "base_url_configured": bool(self.config.base_url),
            "api_key_configured": bool(api_key),
            "timeout_seconds": self.config.timeout_seconds,
        }

    _MAX_SAME_MODEL_RETRIES = 2  # 同模型最多重试 2 次 (共 3 次尝试)
    _MAX_RATE_LIMIT_RETRIES = 3  # 429 最多重试 3 次

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
        """生成文本，支持 Fallback 链 + 同模型重试 + 429 限流重试。"""
        selected_model = model or self.config.default_model
        models_to_try = [selected_model] + self.config.fallback_models
        last_error = None

        for try_model in models_to_try:
            # 同模型重试循环
            for attempt in range(self._MAX_SAME_MODEL_RETRIES + 1):
                try:
                    return self._generate_with_provider(
                        prompt=prompt, messages=messages, model=try_model,
                        temperature=temperature, max_tokens=max_tokens,
                        response_format=response_format,
                    )
                except AegisQAError as exc:
                    last_error = exc
                    status_code = exc.details.get("status_code", 0)

                    # 429 限流: 在当前模型内重试，不计入 fallback
                    if status_code == 429:
                        retry_after = exc.details.get("retry_after")
                        wait = min(int(retry_after) if retry_after else 2 ** attempt, 30)
                        time.sleep(wait)
                        # 429 重试不消耗 attempt 次数，继续循环
                        continue

                    # 4xx (非429): 直接失败，不重试不 fallback
                    if isinstance(status_code, int) and 400 <= status_code < 500:
                        raise

                    # 5xx/网络错误: 如果还有重试次数，继续
                    if attempt < self._MAX_SAME_MODEL_RETRIES:
                        time.sleep(2 ** attempt)  # 1s, 2s
                        continue

                    # 重试用尽，break 到下一个模型
                    break

        # 所有模型都失败
        raise last_error or AegisQAError(
            "MODEL_GATEWAY_ALL_FAILED",
            "所有模型都调用失败。",
            status_code=502,
        )

    def _generate_with_provider(
        self,
        *,
        prompt: str | None = None,
        messages: list[dict[str, Any]] | None = None,
        model: str = "mock-eval-model",
        temperature: float | None = None,
        max_tokens: int | None = None,
        response_format: dict[str, Any] | None = None,
    ) -> ModelResponse:
        """使用当前 provider 生成文本。"""
        provider = self.config.provider.lower()
        # 轮询 API Key
        if self.config.api_keys:
            self._rotate_api_key()
        if provider in {"mock", "demo", "offline", ""}:
            return self._mock_generate(prompt=prompt, messages=messages, model=model)
        if provider in {"openai", "openai_compatible", "compatible"}:
            return self._openai_compatible_generate(
                prompt=prompt, messages=messages, model=model,
                temperature=temperature, max_tokens=max_tokens,
                response_format=response_format,
            )
        if provider in {"anthropic", "claude"}:
            return self._anthropic_generate(
                prompt=prompt, messages=messages, model=model,
                temperature=temperature, max_tokens=max_tokens,
            )
        raise AegisQAError(
            "MODEL_PROVIDER_UNSUPPORTED",
            f"不支持的模型 Provider：{self.config.provider}",
            status_code=400,
            details={"provider": self.config.provider, "supported": ["mock", "openai_compatible", "anthropic"]},
        )

    _key_lock = threading.Lock()

    def _rotate_api_key(self) -> None:
        """轮询 API Key（round-robin），线程安全。"""
        if not self.config.api_keys:
            return
        keys = self.config.api_keys
        with self._key_lock:
            global _api_key_rotation_index
            _api_key_rotation_index = (_api_key_rotation_index + 1) % len(keys)
            self.config.api_key = keys[_api_key_rotation_index]

    def generate_stream(
        self,
        *,
        prompt: str | None = None,
        messages: list[dict[str, Any]] | None = None,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> Generator[str, None, None]:
        """流式生成文本。

        Yields:
            逐 token 的文本片段。
        """
        provider = self.config.provider.lower()
        selected_model = model or self.config.default_model
        if provider in {"mock", "demo", "offline", ""}:
            yield from self._mock_generate_stream(prompt=prompt, messages=messages, model=selected_model)
            return
        if provider in {"openai", "openai_compatible", "compatible"}:
            yield from self._openai_compatible_generate_stream(
                prompt=prompt,
                messages=messages,
                model=selected_model,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            return
        if provider in {"anthropic", "claude"}:
            yield from self._anthropic_generate_stream(
                prompt=prompt,
                messages=messages,
                model=selected_model,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            return
        # 不支持 streaming 的 provider 回退到非流式
        response = self.generate(
            prompt=prompt, messages=messages, model=model,
            temperature=temperature, max_tokens=max_tokens,
        )
        yield response.text

    def _mock_generate_stream(self, *, prompt: str | None, messages: list[dict[str, Any]] | None, model: str) -> Generator[str, None, None]:
        """Mock 流式生成。"""
        text_prompt = prompt or _messages_to_prompt(messages)
        full_text = f"模型回答：{text_prompt}。这是 AegisQA 统一模型网关的离线示例输出。"
        # 模拟逐字输出
        for char in full_text:
            yield char

    def _openai_compatible_generate_stream(
        self,
        *,
        prompt: str | None,
        messages: list[dict[str, Any]] | None,
        model: str,
        temperature: float | None,
        max_tokens: int | None,
    ) -> Generator[str, None, None]:
        """OpenAI-compatible 流式生成。"""
        if not self.config.base_url:
            raise AegisQAError(
                "MODEL_GATEWAY_NOT_CONFIGURED",
                "模型网关未配置 base_url。",
                status_code=400,
            )

        endpoint = self._chat_completions_endpoint()
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages or [{"role": "user", "content": prompt or ""}],
            "stream": True,
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
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
            with urlopen(request, timeout=self.config.timeout_seconds) as response:  # noqa: S310
                chunk_timeout = 30  # 每个 chunk 最长 30s
                response.fp.raw._sock.settimeout(chunk_timeout) if hasattr(response, 'fp') and hasattr(response.fp, 'raw') else None
                for line in response:
                    line = line.decode("utf-8").strip()
                    if not line or line == "data: [DONE]":
                        continue
                    if line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                            choices = data.get("choices", [])
                            if choices:
                                delta = choices[0].get("delta", {})
                                content = delta.get("content")
                                if content:
                                    yield content
                        except json.JSONDecodeError:
                            continue
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            raise AegisQAError(
                "MODEL_GATEWAY_STREAM_ERROR",
                f"流式请求失败：{exc}",
                status_code=502,
                details={"error": str(exc)},
            ) from exc

    def _anthropic_generate_stream(
        self,
        *,
        prompt: str | None,
        messages: list[dict[str, Any]] | None,
        model: str,
        temperature: float | None,
        max_tokens: int | None,
    ) -> Generator[str, None, None]:
        """Anthropic 流式生成。"""
        if not self.config.base_url:
            raise AegisQAError(
                "MODEL_GATEWAY_NOT_CONFIGURED",
                "模型网关未配置 base_url。",
                status_code=400,
            )

        anthropic_messages, system_prompt = _convert_to_anthropic_messages(messages, prompt)

        payload: dict[str, Any] = {
            "model": model,
            "messages": anthropic_messages,
            "max_tokens": max_tokens or 4096,
            "stream": True,
        }
        if system_prompt:
            payload["system"] = system_prompt
        if temperature is not None:
            payload["temperature"] = temperature

        api_key = resolve_model_gateway_api_key(self.config)
        headers = {
            "Content-Type": "application/json",
            "anthropic-version": ANTHROPIC_VERSION,
            "Accept": "text/event-stream",
        }
        if api_key:
            headers["x-api-key"] = api_key

        base_url = (self.config.base_url or "").rstrip("/")
        if base_url.endswith("/messages"):
            endpoint = base_url
        elif base_url.endswith("/v1"):
            endpoint = f"{base_url}/messages"
        else:
            endpoint = f"{base_url}/v1/messages"

        request = Request(
            endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )

        try:
            with urlopen(request, timeout=self.config.timeout_seconds) as response:  # noqa: S310
                for line in response:
                    line = line.decode("utf-8").strip()
                    if not line:
                        continue
                    if line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                            event_type = data.get("type")
                            if event_type == "content_block_delta":
                                delta = data.get("delta", {})
                                text = delta.get("text")
                                if text:
                                    yield text
                        except json.JSONDecodeError:
                            continue
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            raise AegisQAError(
                "MODEL_GATEWAY_STREAM_ERROR",
                f"Anthropic 流式请求失败：{exc}",
                status_code=502,
                details={"error": str(exc)},
            ) from exc

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
                raw_body = response.read().decode("utf-8")
                data = json.loads(raw_body)
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            # 429 限流: 提取 Retry-After header
            retry_after = exc.headers.get("Retry-After") if hasattr(exc, "headers") else None
            raise AegisQAError(
                "MODEL_GATEWAY_HTTP_ERROR",
                f"模型网关请求失败：HTTP {exc.code}",
                status_code=exc.code if exc.code >= 400 else 502,
                details={"status_code": exc.code, "body": str(redact_secrets(body))[:1000], "retry_after": retry_after},
            ) from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise AegisQAError(
                "MODEL_GATEWAY_NETWORK_ERROR",
                "模型网关请求网络失败或超时。",
                status_code=502,
                details={"error": str(redact_secrets(str(exc))), "timeout_seconds": self.config.timeout_seconds},
            ) from exc
        except json.JSONDecodeError as exc:
            raise AegisQAError(
                "MODEL_GATEWAY_INVALID_RESPONSE",
                f"模型返回了非 JSON 响应：{str(exc)[:200]}",
                status_code=502,
                details={"raw_body": raw_body[:500] if 'raw_body' in dir() else ""},
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

    def _anthropic_generate(
        self,
        *,
        prompt: str | None,
        messages: list[dict[str, Any]] | None,
        model: str,
        temperature: float | None,
        max_tokens: int | None,
    ) -> ModelResponse:
        """调用 Anthropic Claude API。

        Anthropic API 格式与 OpenAI 不同：
        - 端点：/v1/messages
        - 认证：x-api-key 头
        - 消息格式：system 独立字段，messages 只含 user/assistant
        - 响应：content[].text，usage.input_tokens/output_tokens
        """
        if not self.config.base_url:
            raise AegisQAError(
                "MODEL_GATEWAY_NOT_CONFIGURED",
                "模型网关未配置 base_url，请设置 AEGISQA_MODEL_BASE_URL。",
                status_code=400,
                details={"required_env": MODEL_BASE_URL_ENV},
            )
        started = perf_counter()

        # 构建消息体
        anthropic_messages, system_prompt = _convert_to_anthropic_messages(messages, prompt)

        # 构建请求 payload
        payload: dict[str, Any] = {
            "model": model,
            "messages": anthropic_messages,
            "max_tokens": max_tokens or 4096,
        }
        if system_prompt:
            payload["system"] = system_prompt
        if temperature is not None:
            payload["temperature"] = temperature

        # 构建请求头
        api_key = resolve_model_gateway_api_key(self.config)
        headers = {
            "Content-Type": "application/json",
            "anthropic-version": ANTHROPIC_VERSION,
        }
        if api_key:
            headers["x-api-key"] = api_key

        # 构建端点 URL
        base_url = (self.config.base_url or "").rstrip("/")
        if base_url.endswith("/messages"):
            endpoint = base_url
        elif base_url.endswith("/v1"):
            endpoint = f"{base_url}/messages"
        else:
            endpoint = f"{base_url}/v1/messages"

        request = Request(
            endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.config.timeout_seconds) as response:  # noqa: S310
                raw_body = response.read().decode("utf-8")
                data = json.loads(raw_body)
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            retry_after = exc.headers.get("Retry-After") if hasattr(exc, "headers") else None
            raise AegisQAError(
                "MODEL_GATEWAY_HTTP_ERROR",
                f"Anthropic API 请求失败：HTTP {exc.code}",
                status_code=exc.code if exc.code >= 400 else 502,
                details={"status_code": exc.code, "body": body[:1000], "retry_after": retry_after},
            ) from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise AegisQAError(
                "MODEL_GATEWAY_NETWORK_ERROR",
                "Anthropic API 请求网络失败或超时。",
                status_code=502,
                details={"error": str(exc), "timeout_seconds": self.config.timeout_seconds},
            ) from exc
        except json.JSONDecodeError as exc:
            raise AegisQAError(
                "MODEL_GATEWAY_INVALID_RESPONSE",
                f"Anthropic 返回了非 JSON 响应：{str(exc)[:200]}",
                status_code=502,
                details={"raw_body": raw_body[:500] if 'raw_body' in dir() else ""},
            ) from exc

        # 解析响应
        content_blocks = data.get("content") or []
        text = "".join(block.get("text", "") for block in content_blocks if block.get("type") == "text")

        # 解析 usage（Anthropic 格式：input_tokens / output_tokens）
        raw_usage = data.get("usage") or {}
        usage = {
            "prompt_tokens": raw_usage.get("input_tokens", 0),
            "completion_tokens": raw_usage.get("output_tokens", 0),
            "total_tokens": (raw_usage.get("input_tokens", 0) or 0) + (raw_usage.get("output_tokens", 0) or 0),
        }

        return ModelResponse(
            text=text,
            provider="anthropic",
            model=str(data.get("model") or model),
            usage=usage,
            latency_ms=(perf_counter() - started) * 1000,
            raw={"id": data.get("id"), "stop_reason": data.get("stop_reason")},
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


def set_model_gateway_runtime_config(config: ModelGatewayConfig | None, store: Any = None) -> None:
    """设置当前进程内的模型网关配置。

    Workflow、Agent Skill 和内置模型 Skill 都通过 `ModelGateway.from_env()` 获取配置。
    前端保存配置后需要立刻影响这些调用，因此这里用进程级覆盖配置作为运行期入口；
    持久化仍由 store 承担，避免只改环境变量导致重启丢失。
    """

    global _runtime_config, _config_last_loaded, _config_store_ref
    import time
    _runtime_config = config.model_copy(deep=True) if config else None
    _config_last_loaded = time.time()
    if store is not None:
        _config_store_ref = store


def get_model_gateway_runtime_config() -> ModelGatewayConfig | None:
    """返回运行期配置副本，避免调用方误改全局对象。

    支持跨进程配置同步：如果 store 中的配置时间戳比当前内存中的新，则自动重新加载。
    """
    global _runtime_config, _config_last_loaded

    # 如果有 store 引用，检查是否需要重新加载
    if _config_store_ref is not None:
        import time
        try:
            # 检查 store 中的配置时间戳
            store_timestamp = _config_store_ref.read_json(
                ["settings", "model_gateway_timestamp.json"], default=None
            )
            if store_timestamp and store_timestamp.get("updated_at", 0) > _config_last_loaded:
                # 重新加载配置
                load_model_gateway_config_from_store(_config_store_ref)
        except Exception:
            pass  # 忽略加载错误，使用当前配置

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
        set_model_gateway_runtime_config(None, store=store)
        return None
    migrated_payload = _migrate_legacy_model_provider_payload(payload)
    sanitized_payload = _persisted_model_gateway_payload(ModelGatewayConfig(**migrated_payload))
    if payload != sanitized_payload:
        store.write_json(MODEL_GATEWAY_SETTINGS_PARTS, sanitized_payload)
    config = ModelGatewayConfig(**sanitized_payload)
    set_model_gateway_runtime_config(config, store=store)
    return config


def save_model_gateway_config_to_store(store: Any, config: ModelGatewayConfig) -> ModelGatewayConfig:
    """保存模型网关配置，并立即让当前进程生效。"""

    import time
    payload = _persisted_model_gateway_payload(config)
    store.write_json(MODEL_GATEWAY_SETTINGS_PARTS, payload)
    # 存储时间戳用于跨进程同步
    store.write_json(
        ["settings", "model_gateway_timestamp.json"],
        {"updated_at": time.time()},
    )
    runtime_config = ModelGatewayConfig(**payload)
    set_model_gateway_runtime_config(runtime_config, store=store)
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


def _convert_to_anthropic_messages(
    messages: list[dict[str, Any]] | None,
    prompt: str | None,
) -> tuple[list[dict[str, Any]], str | None]:
    """将通用消息格式转换为 Anthropic API 格式。

    Anthropic 要求：
    - system 作为独立字段（不在 messages 中）
    - messages 只能包含 user 和 assistant 角色
    - 消息必须以 user 角色开始

    返回：(anthropic_messages, system_prompt)
    """
    if not messages:
        if prompt:
            return [{"role": "user", "content": prompt}], None
        return [{"role": "user", "content": ""}], None

    system_parts: list[str] = []
    anthropic_messages: list[dict[str, Any]] = []

    for msg in messages:
        role = str(msg.get("role") or "user")
        content = str(msg.get("content") or "")

        if role == "system":
            system_parts.append(content)
        elif role in {"user", "assistant"}:
            anthropic_messages.append({"role": role, "content": content})
        else:
            # 未知角色当作 user
            anthropic_messages.append({"role": "user", "content": content})

    # 确保消息以 user 开始
    if anthropic_messages and anthropic_messages[0]["role"] != "user":
        anthropic_messages.insert(0, {"role": "user", "content": prompt or ""})

    # 确保消息不为空
    if not anthropic_messages:
        anthropic_messages = [{"role": "user", "content": prompt or ""}]

    system_prompt = "\n\n".join(system_parts) if system_parts else None
    return anthropic_messages, system_prompt


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
