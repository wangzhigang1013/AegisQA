from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
from aegisqa.core.errors import AegisQAError
from aegisqa.llm.gateway import LLMGateway
from aegisqa.llm.models import ModelAlias, PromptAsset
from aegisqa.llm.providers import TestLLMProvider
from aegisqa.skills.base import SkillManifest
from aegisqa.skills.packages import SubprocessPackageSkill


def test_model_alias_api_persists_aliases_and_writes_audit(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    assert client.get("/model-aliases").json() == []

    created = client.post(
        "/model-aliases",
        json={
            "alias": "test.judge",
            "provider": "test",
            "model": "deterministic-json",
            "allowed_skill_ids": ["example.hybrid_judge_review@0.1.0"],
            "enabled": True,
        },
    ).json()

    assert created["alias"] == "test.judge"
    assert client.get("/model-aliases").json()[0]["provider"] == "test"
    events = client.get("/audit-events", params={"action": "model_alias.upsert"}).json()
    assert events[0]["target"] == "test.judge"


def test_llm_gateway_validates_prompt_variables_permissions_alias_and_output_schema() -> None:
    prompt = _prompt_asset()
    aliases = {"test.judge": ModelAlias(alias="test.judge", provider="test", model="deterministic-json", enabled=True)}
    gateway = LLMGateway(
        prompt_assets={prompt.name: prompt},
        model_aliases=aliases,
        providers={"test": TestLLMProvider(response='{"result": "pass", "confidence": 0.91}')},
    )

    with pytest.raises(AegisQAError) as missing_variable:
        gateway.call("judge", {}, trigger_reason="unit", permissions=_permissions())
    assert missing_variable.value.code == "PROMPT_VARIABLE_MISSING"

    with pytest.raises(AegisQAError) as denied_prompt:
        gateway.call("judge", {"text": "hello"}, trigger_reason="unit", permissions={**_permissions(), "allowed_prompt_names": []})
    assert denied_prompt.value.code == "LLM_PERMISSION_DENIED"

    with pytest.raises(AegisQAError) as denied_alias:
        gateway.call(
            "judge",
            {"text": "hello"},
            trigger_reason="unit",
            model_alias="test.other",
            permissions=_permissions(),
        )
    assert denied_alias.value.code == "MODEL_ALIAS_NOT_ALLOWED"

    invalid_gateway = LLMGateway(
        prompt_assets={prompt.name: prompt},
        model_aliases=aliases,
        providers={"test": TestLLMProvider(response='{"result": "pass"}')},
    )
    with pytest.raises(AegisQAError) as invalid_output:
        invalid_gateway.call("judge", {"text": "hello"}, trigger_reason="unit", permissions=_permissions())
    assert invalid_output.value.code == "OUTPUT_SCHEMA_INVALID"

    result = gateway.call("judge", {"text": "hello"}, trigger_reason="unit", permissions=_permissions())
    assert result.status == "succeeded"
    assert result.prompt_name == "judge"
    assert "hello" in result.rendered_prompt
    assert result.parsed_output == {"result": "pass", "confidence": 0.91}
    assert result.token_usage.total_tokens > 0
    assert result.trigger_reason == "unit"


def test_llm_gateway_reports_json_parse_errors() -> None:
    prompt = _prompt_asset()
    gateway = LLMGateway(
        prompt_assets={prompt.name: prompt},
        model_aliases={"test.judge": ModelAlias(alias="test.judge", provider="test", model="deterministic-json", enabled=True)},
        providers={"test": TestLLMProvider(response="not-json")},
    )

    with pytest.raises(AegisQAError) as error:
        gateway.call("judge", {"text": "hello"}, trigger_reason="unit", permissions=_permissions())

    assert error.value.code == "JSON_PARSE_ERROR"
    assert error.value.details["prompt_name"] == "judge"


def test_v1_package_context_llm_call_uses_registered_prompt_assets(tmp_path) -> None:
    handler_path = tmp_path / "handler.py"
    handler_path.write_text(
        """
def run(input_data, context):
    call = context.llm.call("judge", {"text": input_data["text"]}, trigger_reason="contract")
    return {
        "output": {"result": call["parsed_output"]["result"]},
        "metrics": {"prompt_calls": len(context.llm.calls)},
    }
""",
        encoding="utf-8",
    )
    manifest = SkillManifest(
        schema_version=1,
        skill_id="plugin.context_llm@0.1.0",
        name="Context LLM",
        version="0.1.0",
        description="Calls context.llm",
        type="hybrid",
        category="judge",
        prompts=[{"name": "judge", "path": "prompts/judge"}],
        llm_permissions={
            "allowed_prompt_names": ["judge"],
            "allowed_model_aliases": ["test.judge"],
            "max_calls_per_run": 1,
            "max_tokens_per_run": 1000,
        },
        input_schema={"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        output_schema={"type": "object", "properties": {"result": {"type": "string"}}, "required": ["result"]},
        example_input={"text": "hello"},
    )
    skill = SubprocessPackageSkill(
        manifest,
        handler_path,
        prompt_assets=[
            {
                **_prompt_asset().model_dump(mode="json"),
                "test_response": '{"result": "pass", "confidence": 0.9}',
            }
        ],
        model_aliases=[ModelAlias(alias="test.judge", provider="test", model="deterministic-json").model_dump(mode="json")],
    )

    result = skill.contract_test()

    assert result["ok"] is True
    assert result["output"] == {"result": "pass"}
    assert result["metrics"]["prompt_calls"] == 1


def test_v1_package_context_llm_call_enforces_call_and_token_limits(tmp_path) -> None:
    handler_path = tmp_path / "handler.py"
    handler_path.write_text(
        """
def run(input_data, context):
    context.llm.call("judge", {"text": input_data["text"]}, trigger_reason="first")
    context.llm.call("judge", {"text": input_data["text"]}, trigger_reason="second")
    return {"output": {"result": "pass"}}
""",
        encoding="utf-8",
    )
    manifest = SkillManifest(
        schema_version=1,
        skill_id="plugin.context_llm_limited@0.1.0",
        name="Context LLM Limited",
        version="0.1.0",
        description="Calls context.llm too often",
        type="hybrid",
        category="judge",
        prompts=[{"name": "judge", "path": "prompts/judge"}],
        llm_permissions={
            "allowed_prompt_names": ["judge"],
            "allowed_model_aliases": ["test.judge"],
            "max_calls_per_run": 1,
            "max_tokens_per_run": 1000,
        },
        input_schema={"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        output_schema={"type": "object", "properties": {"result": {"type": "string"}}, "required": ["result"]},
        example_input={"text": "hello"},
    )
    skill = SubprocessPackageSkill(
        manifest,
        handler_path,
        prompt_assets=[
            {
                **_prompt_asset().model_dump(mode="json"),
                "test_response": '{"result": "pass", "confidence": 0.9}',
            }
        ],
        model_aliases=[ModelAlias(alias="test.judge", provider="test", model="deterministic-json").model_dump(mode="json")],
    )

    with pytest.raises(AegisQAError) as error:
        skill.run({"text": "hello"})

    assert error.value.code == "SKILL_PACKAGE_RUNTIME_ERROR"
    assert "TOKEN_BUDGET_EXCEEDED" not in error.value.message
    assert "LLM_MAX_CALLS_EXCEEDED" in error.value.message

    skill.manifest.llm_permissions = {
        "allowed_prompt_names": ["judge"],
        "allowed_model_aliases": ["test.judge"],
        "max_calls_per_run": 2,
        "max_tokens_per_run": 1,
    }

    with pytest.raises(AegisQAError) as token_error:
        skill.run({"text": "hello"})

    assert token_error.value.code == "SKILL_PACKAGE_RUNTIME_ERROR"
    assert "TOKEN_BUDGET_EXCEEDED" in token_error.value.message


def _prompt_asset() -> PromptAsset:
    return PromptAsset(
        name="judge",
        path="prompts/judge",
        prompt_hash="hash",
        template="Judge {{ text }}",
        input_variables={"text": {"type": "string"}},
        output_schema={
            "type": "object",
            "properties": {"result": {"type": "string"}, "confidence": {"type": "number"}},
            "required": ["result", "confidence"],
        },
        model_policy={"default_alias": "test.judge", "allowed_aliases": ["test.judge"]},
        retry_policy={"max_retries": 0},
    )


def _permissions() -> dict[str, object]:
    return {
        "allowed_prompt_names": ["judge"],
        "allowed_model_aliases": ["test.judge"],
        "max_calls_per_run": 2,
        "max_tokens_per_run": 1000,
    }
