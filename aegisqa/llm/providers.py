from __future__ import annotations

from abc import ABC, abstractmethod

from aegisqa.llm.models import LLMProviderResponse, ModelAlias, TokenUsage


class BaseLLMProvider(ABC):
    @abstractmethod
    def call(self, *, model_alias: ModelAlias, rendered_prompt: str) -> LLMProviderResponse:
        """Call a model provider and return raw text plus provider token usage."""


class TestLLMProvider(BaseLLMProvider):
    """Deterministic provider for tests and local demos.

    It does not read secrets and does not call external services.
    """

    __test__ = False

    def __init__(self, response: str = '{"result": "pass"}') -> None:
        self.response = response

    def call(self, *, model_alias: ModelAlias, rendered_prompt: str) -> LLMProviderResponse:
        prompt_tokens = max(1, len(rendered_prompt.split()))
        completion_tokens = max(1, len(self.response.split()))
        return LLMProviderResponse(
            raw_response=self.response,
            token_usage=TokenUsage(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=prompt_tokens + completion_tokens,
            ),
        )
