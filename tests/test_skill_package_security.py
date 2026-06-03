from __future__ import annotations

import base64
from io import BytesIO
import json
from zipfile import ZipFile

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
from aegisqa.skills.packages import (
    DEFAULT_PACKAGE_SKILL_TIMEOUT_SECONDS,
    MAX_PACKAGE_SKILL_TIMEOUT_SECONDS,
    PACKAGE_SKILL_TIMEOUT_ENV,
    resolve_package_skill_timeout_seconds,
)


def test_package_skill_timeout_can_be_configured_by_environment(monkeypatch) -> None:
    monkeypatch.setenv(PACKAGE_SKILL_TIMEOUT_ENV, "120")
    assert resolve_package_skill_timeout_seconds() == 120

    monkeypatch.setenv(PACKAGE_SKILL_TIMEOUT_ENV, str(MAX_PACKAGE_SKILL_TIMEOUT_SECONDS + 100))
    assert resolve_package_skill_timeout_seconds() == MAX_PACKAGE_SKILL_TIMEOUT_SECONDS

    monkeypatch.setenv(PACKAGE_SKILL_TIMEOUT_ENV, "not-a-number")
    assert resolve_package_skill_timeout_seconds() == DEFAULT_PACKAGE_SKILL_TIMEOUT_SECONDS


def test_skill_market_can_hide_builtin_skills_for_clean_local_store(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    assert client.get("/skills").json()

    # 本地清空 Skill 市场只隐藏 builtin 展示，不删除内置代码；后续上传插件仍会展示。
    app.state.store.write_json(["settings", "skill_market.json"], {"hide_builtin_skills": True})
    assert client.get("/skills").json() == []

    client.post("/skills/packages/upload", json={"filename": "echo.zip", "content_base64": _plugin_zip()})
    skills = client.get("/skills").json()
    assert [skill["skill_id"] for skill in skills] == ["plugin.echo@0.1.0"]


def test_skill_package_records_contract_and_approval_metadata(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    package_content = _plugin_zip()

    uploaded = client.post(
        "/skills/packages/upload",
        json={"filename": "echo.zip", "content_base64": package_content},
    ).json()
    assert uploaded["status"] == "pending_review"
    assert uploaded["artifact_uri"].startswith("local://skill-packages/")
    assert client.app.state.artifact_store.get_bytes(uploaded["artifact_uri"]) == base64.b64decode(package_content)
    assert uploaded["approved_by"] is None
    assert uploaded["approved_at"] is None
    assert uploaded["last_contract_at"] is None

    contract = client.post("/skills/plugin.echo@0.1.0/contract-test").json()
    assert contract["ok"] is True

    after_contract = client.get("/skills/packages").json()[0]
    assert after_contract["last_contract_ok"] is True
    assert after_contract["last_contract_at"]

    approved = client.post("/skills/plugin.echo@0.1.0/approve", json={"reason": "测试审批通过"}).json()
    assert approved["status"] == "approved"

    after_approval = client.get("/skills/packages").json()[0]
    assert after_approval["status"] == "approved"
    assert after_approval["approved_by"] == "api"
    assert after_approval["approved_at"]
    assert after_approval["approval_note"] == "测试审批通过"


def test_skill_package_rejects_oversized_return_payload(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    handler = "def run(inputs, config):\n    return {'output': {'echo': 'x' * 120000}, 'metrics': {}}\n"
    client.post(
        "/skills/packages/upload",
        json={"filename": "oversized.zip", "content_base64": _plugin_zip(skill_id="plugin.oversized@0.1.0", handler=handler)},
    )

    contract = client.post("/skills/plugin.oversized@0.1.0/contract-test").json()

    assert contract["ok"] is False
    assert contract["code"] == "SKILL_PACKAGE_OUTPUT_TOO_LARGE"
    assert contract["details"]["actual_output_bytes"] > contract["details"]["max_output_bytes"]


def test_skill_package_truncates_long_process_streams(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    handler = """
import sys

def run(inputs, config):
    print("O" * 10000)
    print("E" * 10000, file=sys.stderr)
    raise RuntimeError("boom")
"""
    client.post(
        "/skills/packages/upload",
        json={"filename": "streams.zip", "content_base64": _plugin_zip(skill_id="plugin.streams@0.1.0", handler=handler)},
    )

    contract = client.post("/skills/plugin.streams@0.1.0/contract-test").json()

    assert contract["ok"] is False
    assert contract["code"] == "SKILL_PACKAGE_RUNTIME_ERROR"
    assert contract["details"]["stdout_truncated"] is True
    assert contract["details"]["stderr_truncated"] is True
    assert contract["details"]["stdout"].endswith("[已截断]")
    assert contract["details"]["stderr"].endswith("[已截断]")


def test_skill_package_runtime_error_does_not_leak_local_absolute_paths(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    handler = """
def run(inputs, config):
    raise RuntimeError("local path C:/Users/17343/secret/token.txt should be hidden")
"""
    client.post(
        "/skills/packages/upload",
        json={"filename": "path.zip", "content_base64": _plugin_zip(skill_id="plugin.path@0.1.0", handler=handler)},
    )

    contract = client.post("/skills/plugin.path@0.1.0/contract-test").json()
    payload_text = json.dumps(contract, ensure_ascii=False)

    assert contract["ok"] is False
    assert contract["code"] == "SKILL_PACKAGE_RUNTIME_ERROR"
    assert str(tmp_path) not in payload_text
    assert "C:/Users/17343/secret" not in payload_text


def test_skill_package_subprocess_does_not_receive_provider_api_keys(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret-from-parent")
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    handler = """
import os

def run(inputs, config):
    return {
        'output': {
            'echo': str(bool(os.getenv('OPENAI_API_KEY'))),
            'cwd_has_handler': str(os.path.exists(os.path.join(os.getcwd(), 'handler.py'))),
        },
        'metrics': {},
    }
"""
    client.post(
        "/skills/packages/upload",
        json={"filename": "env.zip", "content_base64": _plugin_zip(skill_id="plugin.env@0.1.0", handler=handler)},
    )

    contract = client.post("/skills/plugin.env@0.1.0/contract-test").json()

    assert contract["ok"] is True
    assert contract["output"]["echo"] == "False"
    assert contract["output"]["cwd_has_handler"] == "True"


def _plugin_zip(skill_id: str = "plugin.echo@0.1.0", handler: str | None = None) -> str:
    manifest = {
        "skill_id": skill_id,
        "name": "Echo Plugin",
        "version": "0.1.0",
        "description": "Echo plugin",
        "tags": ["test"],
        "scenarios": ["contract"],
        "input_schema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        "output_schema": {"type": "object", "properties": {"echo": {"type": "string"}}, "required": ["echo"]},
        "config_schema": {"type": "object"},
        "cacheable": False,
        "permissions": [],
        "enabled": False,
        "status": "pending_review",
        "example_input": {"text": "hello"},
        "example_config": {},
    }
    handler_body = handler or "def run(inputs, config):\n    return {'output': {'echo': inputs['text']}, 'metrics': {}}\n"

    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("skill.json", json.dumps(manifest, ensure_ascii=False))
        archive.writestr("handler.py", handler_body)
    return base64.b64encode(buffer.getvalue()).decode("ascii")
