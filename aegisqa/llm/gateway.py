from __future__ import annotations

import json
from time import perf_counter
from typing import Any

from aegisqa.core.errors import AegisQAError
from aegisqa.core.mapper import TypeMismatchError, validate_json_schema
from aegisqa.llm.models import LLMCallRun, ModelAlias, PromptAsset
from aegisqa.llm.providers import BaseLLMProvider


class LLMGateway:
    """Permissioned prompt runtime boundary.

    The gateway owns prompt rendering, alias selection, provider dispatch,
    JSON parsing, output schema validation, and token budget enforcement.
    Skills provide prompt names and variables; they do not receive API keys.
    """

    def __init__(
        self,
        *,
        prompt_assets: dict[str, PromptAsset],
        model_aliases: dict[str, ModelAlias],
        providers: dict[str, BaseLLMProvider],
    ) -> None:
        self.prompt_assets = prompt_assets
        self.model_aliases = model_aliases
        self.providers = providers

    def call(
        self,
        prompt_name: str,
        variables: dict[str, Any],
        *,
        trigger_reason: str,
        model_alias: str | None = None,
        permissions: dict[str, Any] | None = None,
    ) -> LLMCallRun:
        permissions = permissions or {}
        prompt = self._get_prompt(prompt_name)
        self._check_prompt_allowed(prompt_name, permissions)
        self._validate_variables(prompt, variables)
        alias_name = model_alias or str(prompt.model_policy.get("default_alias") or "")
        if not alias_name:
            allowed_aliases = prompt.model_policy.get("allowed_aliases") or []
            alias_name = str(allowed_aliases[0]) if allowed_aliases else ""
        alias = self._resolve_alias(alias_name, prompt, permissions)
        provider = self.providers.get(alias.provider)
        if provider is None:
            raise AegisQAError("MODEL_PROVIDER_UNAVAILABLE", "模型 provider 未配置。", details={"provider": alias.provider})
        rendered_prompt = _render_prompt(prompt.template, variables)
        started = perf_counter()
        response = provider.call(model_alias=alias, rendered_prompt=rendered_prompt)
        duration_ms = (perf_counter() - started) * 1000
        max_tokens = int(permissions.get("max_tokens_per_run") or 0)
        if max_tokens and response.token_usage.total_tokens > max_tokens:
            raise AegisQAError(
                "TOKEN_BUDGET_EXCEEDED",
                "LLM 调用超过 token 预算。",
                details={"total_tokens": response.token_usage.total_tokens, "max_tokens_per_run": max_tokens},
            )
        try:
            parsed = json.loads(response.raw_response)
        except json.JSONDecodeError as exc:
            raise AegisQAError(
                "JSON_PARSE_ERROR",
                "LLM 返回内容不是合法 JSON。",
                details={"prompt_name": prompt_name, "raw_response": response.raw_response},
            ) from exc
        try:
            validated = validate_json_schema(parsed, prompt.output_schema)
        except TypeMismatchError as exc:
            raise AegisQAError(
                "OUTPUT_SCHEMA_INVALID",
                "LLM 输出不符合 prompt output_schema。",
                details={"prompt_name": prompt_name, "schema_error": str(exc), "raw_response": response.raw_response},
            ) from exc
        return LLMCallRun(
            prompt_name=prompt.name,
            prompt_hash=prompt.prompt_hash,
            model_alias=alias.alias,
            provider=alias.provider,
            model=alias.model,
            rendered_prompt=rendered_prompt,
            raw_response=response.raw_response,
            parsed_output=validated if isinstance(validated, dict) else parsed,
            schema_validation={"ok": True},
            token_usage=response.token_usage,
            duration_ms=duration_ms,
            status="succeeded",
            trigger_reason=trigger_reason,
        )

    def _get_prompt(self, prompt_name: str) -> PromptAsset:
        prompt = self.prompt_assets.get(prompt_name)
        if prompt is None:
            raise AegisQAError("PROMPT_NOT_REGISTERED", "Prompt 未注册。", details={"prompt_name": prompt_name})
        return prompt

    @staticmethod
    def _check_prompt_allowed(prompt_name: str, permissions: dict[str, Any]) -> None:
        allowed = permissions.get("allowed_prompt_names")
        if isinstance(allowed, list) and prompt_name not in allowed:
            raise AegisQAError("LLM_PERMISSION_DENIED", "Skill 无权调用该 prompt。", details={"prompt_name": prompt_name})

    @staticmethod
    def _validate_variables(prompt: PromptAsset, variables: dict[str, Any]) -> None:
        for name, schema in prompt.input_variables.items():
            if name not in variables:
                raise AegisQAError("PROMPT_VARIABLE_MISSING", "Prompt 变量缺失。", details={"prompt_name": prompt.name, "variable": name})
            if isinstance(schema, dict):
                try:
                    validate_json_schema(variables[name], schema, name)
                except TypeMismatchError as exc:
                    raise AegisQAError(
                        "PROMPT_VARIABLE_INVALID",
                        "Prompt 变量类型不符合声明。",
                        details={"prompt_name": prompt.name, "variable": name, "schema_error": str(exc)},
                    ) from exc

    def _resolve_alias(self, alias_name: str, prompt: PromptAsset, permissions: dict[str, Any]) -> ModelAlias:
        prompt_aliases = prompt.model_policy.get("allowed_aliases")
        permission_aliases = permissions.get("allowed_model_aliases")
        if isinstance(prompt_aliases, list) and alias_name not in prompt_aliases:
            raise AegisQAError("MODEL_ALIAS_NOT_ALLOWED", "Prompt 不允许使用该 model alias。", details={"model_alias": alias_name})
        if isinstance(permission_aliases, list) and alias_name not in permission_aliases:
            raise AegisQAError("MODEL_ALIAS_NOT_ALLOWED", "Skill 不允许使用该 model alias。", details={"model_alias": alias_name})
        alias = self.model_aliases.get(alias_name)
        if alias is None or not alias.enabled:
            raise AegisQAError("MODEL_ALIAS_NOT_ALLOWED", "Model alias 不存在或未启用。", details={"model_alias": alias_name})
        return alias


def _render_prompt(template: str, variables: dict[str, Any]) -> str:
    rendered = template
    for key, value in variables.items():
        rendered = rendered.replace("{{ " + key + " }}", str(value))
        rendered = rendered.replace("{{" + key + "}}", str(value))
    return rendered
