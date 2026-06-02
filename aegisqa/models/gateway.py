"""统一模型网关。

平台里的业务 Skill 不应该各自实现一套模型 API 调用、鉴权、超时和返回解析。
本模块把模型调用收敛到一个可测试的网关：默认 mock 离线可跑，生产环境可通过
OpenAI-compatible Chat Completions 协议接入真实模型服务。
"""

from __future__ import annotations

import json
import math
import os
from time import perf_counter
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import BaseModel, Field

from aegisqa.core.errors import AegisQAError


MODEL_PROVIDER_ENV = "AEGISQA_MODEL_PROVIDER"
MODEL_BASE_URL_ENV = "AEGISQA_MODEL_BASE_URL"
MODEL_API_KEY_ENV = "AEGISQA_MODEL_API_KEY"
MODEL_DEFAULT_ENV = "AEGISQA_MODEL_DEFAULT_MODEL"
MODEL_TIMEOUT_ENV = "AEGISQA_MODEL_TIMEOUT_SECONDS"
DEFAULT_MODEL_TIMEOUT_SECONDS = 60
MAX_MODEL_TIMEOUT_SECONDS = 600


class ModelGatewayConfig(BaseModel):
    """模型网关运行配置。"""

    provider: str = "mock"
    base_url: str | None = None
    api_key: str | None = None
    default_model: str = "mock-eval-model"
    timeout_seconds: int = DEFAULT_MODEL_TIMEOUT_SECONDS

    @classmethod
    def from_env(cls) -> "ModelGatewayConfig":
        return cls(
            provider=os.getenv(MODEL_PROVIDER_ENV, "mock"),
            base_url=os.getenv(MODEL_BASE_URL_ENV) or None,
            api_key=os.getenv(MODEL_API_KEY_ENV) or None,
            default_model=os.getenv(MODEL_DEFAULT_ENV, "mock-eval-model"),
            timeout_seconds=_resolve_timeout(os.getenv(MODEL_TIMEOUT_ENV)),
        )


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

    def __init__(self, config: ModelGatewayConfig | None = None) -> None:
        self.config = config or ModelGatewayConfig.from_env()

    @classmethod
    def from_env(cls) -> "ModelGateway":
        return cls(ModelGatewayConfig.from_env())

    def status(self) -> dict[str, Any]:
        provider = self.config.provider.lower()
        uses_external_endpoint = provider not in {"mock", "demo", "offline", ""}
        return {
            "provider": provider or "mock",
            "ready": True if not uses_external_endpoint else bool(self.config.base_url),
            "mode": "offline_mock" if not uses_external_endpoint else "openai_compatible",
            "default_model": self.config.default_model,
            "base_url_configured": bool(self.config.base_url),
            "api_key_configured": bool(self.config.api_key),
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
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
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
                details={"status_code": exc.code, "body": body[:1000]},
            ) from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise AegisQAError(
                "MODEL_GATEWAY_NETWORK_ERROR",
                "模型网关请求网络失败或超时。",
                status_code=502,
                details={"error": str(exc), "timeout_seconds": self.config.timeout_seconds},
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


def _messages_to_prompt(messages: list[dict[str, Any]] | None) -> str:
    if not messages:
        return ""
    parts: list[str] = []
    for message in messages:
        role = str(message.get("role") or "user")
        content = str(message.get("content") or "")
        parts.append(f"{role}: {content}")
    return "\n".join(parts)


def _resolve_timeout(raw_value: str | None) -> int:
    if raw_value in (None, ""):
        return DEFAULT_MODEL_TIMEOUT_SECONDS
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        return DEFAULT_MODEL_TIMEOUT_SECONDS
    return max(1, min(parsed, MAX_MODEL_TIMEOUT_SECONDS))
