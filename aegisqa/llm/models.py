from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class PromptAsset(BaseModel):
    name: str
    path: str
    prompt_hash: str
    template: str
    input_variables: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    model_policy: dict[str, Any] = Field(default_factory=dict)
    retry_policy: dict[str, Any] = Field(default_factory=dict)


class ModelAlias(BaseModel):
    alias: str
    provider: str
    model: str
    enabled: bool = True
    allowed_skill_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class TokenUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class LLMProviderResponse(BaseModel):
    raw_response: str
    token_usage: TokenUsage = Field(default_factory=TokenUsage)


class LLMCallRun(BaseModel):
    prompt_name: str
    prompt_hash: str
    model_alias: str
    provider: str
    model: str
    rendered_prompt: str
    raw_response: str
    parsed_output: dict[str, Any] | None = None
    schema_validation: dict[str, Any] = Field(default_factory=dict)
    token_usage: TokenUsage = Field(default_factory=TokenUsage)
    duration_ms: float
    status: Literal["succeeded", "failed"]
    error_code: str | None = None
    trigger_reason: str


PromptCallTrace = LLMCallRun
