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

    uploaded = client.post(
        "/skills/packages/upload",
        json={"filename": "echo.zip", "content_base64": _plugin_zip()},
    ).json()
    assert uploaded["status"] == "pending_review"
    assert uploaded["approved_by"] is None
    assert uploaded["approved_at"] is None
    assert uploaded["last_contract_at"] is None

    contract = client.post("/skills/plugin.echo@0.1.0/contract-test").json()
    assert contract["ok"] is True

    after_contract = client.get("/skills/packages").json()[0]
    assert after_contract["last_contract_ok"] is True
    assert after_contract["last_contract_at"]

    approved = client.post(
        "/skills/plugin.echo@0.1.0/approve",
        json={"actor": "dora", "role": "Skill Developer", "reason": "测试审批通过"},
    ).json()
    assert approved["status"] == "approved"

    after_approval = client.get("/skills/packages").json()[0]
    assert after_approval["status"] == "approved"
    assert after_approval["approved_by"] == "dora"
    assert after_approval["approved_by_role"] == "Skill Developer"
    assert after_approval["approved_at"]
    assert after_approval["approval_note"] == "测试审批通过"
    assert after_approval["approval_history"][-1]["action"] == "approve"
    assert after_approval["approval_history"][-1]["actor"] == "dora"
    assert after_approval["approval_history"][-1]["role"] == "Skill Developer"


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


def test_skill_package_upload_enforces_zip_size_and_file_count_limits(tmp_path) -> None:
    client = TestClient(create_app(store_root=tmp_path / "store"))

    too_many_files = client.post(
        "/skills/packages/upload",
        json={"filename": "too_many.zip", "content_base64": _raw_zip({f"files/{index}.txt": "x" for index in range(260)})},
    )
    assert too_many_files.status_code == 400
    assert too_many_files.json()["code"] == "SKILL_PACKAGE_TOO_MANY_FILES"

    single_too_large = client.post(
        "/skills/packages/upload",
        json={"filename": "single_large.zip", "content_base64": _raw_zip({"big.txt": "x" * 1_100_000})},
    )
    assert single_too_large.status_code == 400
    assert single_too_large.json()["code"] == "SKILL_PACKAGE_FILE_TOO_LARGE"

    total_too_large = client.post(
        "/skills/packages/upload",
        json={"filename": "total_large.zip", "content_base64": _raw_zip({"a.txt": "x" * 800_000, "b.txt": "x" * 800_000})},
    )
    assert total_too_large.status_code == 400
    assert total_too_large.json()["code"] == "SKILL_PACKAGE_TOO_LARGE"


def test_skill_package_manifest_must_declare_permissions(tmp_path) -> None:
    client = TestClient(create_app(store_root=tmp_path / "store"))

    response = client.post(
        "/skills/packages/upload",
        json={"filename": "missing_permissions.zip", "content_base64": _plugin_zip(include_permissions=False)},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "SKILL_PACKAGE_PERMISSIONS_REQUIRED"


def test_skill_package_rejects_dependency_declarations_in_local_runtime(tmp_path) -> None:
    client = TestClient(create_app(store_root=tmp_path / "store"))

    runtime_dependencies = client.post(
        "/skills/packages/upload",
        json={
            "filename": "runtime_deps.zip",
            "content_base64": _plugin_zip(
                skill_id="plugin.runtime_deps@0.1.0",
                runtime={"mode": "script", "entrypoint": "handler.py:run", "dependencies": ["requests==2.32.0"]},
            ),
        },
    )
    assert runtime_dependencies.status_code == 400
    assert runtime_dependencies.json()["code"] == "SKILL_PACKAGE_DEPENDENCIES_UNSUPPORTED"

    requirements_file = client.post(
        "/skills/packages/upload",
        json={
            "filename": "requirements.zip",
            "content_base64": _plugin_zip(
                skill_id="plugin.requirements@0.1.0",
                extra_files={"requirements.txt": "requests==2.32.0\n"},
            ),
        },
    )
    assert requirements_file.status_code == 400
    assert requirements_file.json()["code"] == "SKILL_PACKAGE_DEPENDENCIES_UNSUPPORTED"


def test_script_skill_cannot_read_files_outside_package_root(tmp_path) -> None:
    outside_file = tmp_path / "outside-secret.txt"
    outside_file.write_text("secret", encoding="utf-8")
    client = TestClient(create_app(store_root=tmp_path / "store"))
    handler = """
from pathlib import Path

def run(inputs, config):
    return {"output": {"echo": Path(config["path"]).read_text(encoding="utf-8")}}
"""
    client.post(
        "/skills/packages/upload",
        json={
            "filename": "outside_read.zip",
            "content_base64": _plugin_zip(
                skill_id="plugin.outside_read@0.1.0",
                handler=handler,
                example_config={"path": str(outside_file)},
            ),
        },
    )

    contract = client.post("/skills/plugin.outside_read@0.1.0/contract-test").json()

    assert contract["ok"] is False
    assert contract["code"] == "SKILL_PACKAGE_RUNTIME_ERROR"
    assert "SKILL_PACKAGE_FILE_ACCESS_DENIED" in contract["details"]["stderr"]
    assert str(outside_file) not in json.dumps(contract, ensure_ascii=False)


def test_script_skill_cannot_open_network_socket_by_default(tmp_path) -> None:
    client = TestClient(create_app(store_root=tmp_path / "store"))
    handler = """
import socket

def run(inputs, config):
    socket.socket()
    return {"output": {"echo": inputs["text"]}}
"""
    client.post(
        "/skills/packages/upload",
        json={"filename": "network.zip", "content_base64": _plugin_zip(skill_id="plugin.network@0.1.0", handler=handler)},
    )

    contract = client.post("/skills/plugin.network@0.1.0/contract-test").json()

    assert contract["ok"] is False
    assert contract["code"] == "SKILL_PACKAGE_RUNTIME_ERROR"
    assert "SKILL_PACKAGE_NETWORK_DENIED" in contract["details"]["stderr"]


def test_skill_package_upload_records_security_warnings_for_executable_and_direct_model_calls(tmp_path) -> None:
    client = TestClient(create_app(store_root=tmp_path / "store"))
    handler = """
import openai

def run(inputs, config):
    return {"output": {"echo": inputs["text"]}}
"""

    uploaded = client.post(
        "/skills/packages/upload",
        json={
            "filename": "warnings.zip",
            "content_base64": _plugin_zip(
                skill_id="plugin.warnings@0.1.0",
                handler=handler,
                extra_files={"bin/tool.exe": "MZ\x00binary"},
            ),
        },
    )

    assert uploaded.status_code == 200
    warnings = uploaded.json()["package_security"]["warnings"]
    codes = {item["code"] for item in warnings}
    assert "SKILL_PACKAGE_EXECUTABLE_FILE_WARNING" in codes
    assert "SKILL_PACKAGE_DIRECT_MODEL_SDK_WARNING" in codes


def _plugin_zip(
    skill_id: str = "plugin.echo@0.1.0",
    handler: str | None = None,
    *,
    include_permissions: bool = True,
    runtime: dict | None = None,
    example_config: dict | None = None,
    extra_files: dict[str, str] | None = None,
) -> str:
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
        "enabled": False,
        "status": "pending_review",
        "example_input": {"text": "hello"},
        "example_config": example_config or {},
    }
    if include_permissions:
        manifest["permissions"] = []
    if runtime is not None:
        manifest["runtime"] = runtime
    handler_body = handler or "def run(inputs, config):\n    return {'output': {'echo': inputs['text']}, 'metrics': {}}\n"

    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("skill.json", json.dumps(manifest, ensure_ascii=False))
        archive.writestr("handler.py", handler_body)
        for name, content in (extra_files or {}).items():
            archive.writestr(name, content)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _raw_zip(files: dict[str, str]) -> str:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return base64.b64encode(buffer.getvalue()).decode("ascii")
