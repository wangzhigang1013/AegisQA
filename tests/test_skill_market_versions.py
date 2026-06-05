from __future__ import annotations

import base64
import json
from io import BytesIO
from zipfile import ZipFile

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def test_skill_market_version_history_compare_and_rollback(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    client.post("/skills/packages/upload", json={"filename": "echo-v1.zip", "content_base64": _plugin_zip("plugin.echo@0.1.0", "0.1.0", "Echo v1")})
    assert client.post("/skills/plugin.echo@0.1.0/contract-test").json()["ok"] is True
    assert client.post("/skills/plugin.echo@0.1.0/approve", json={"reason": "v1 稳定"}).json()["status"] == "approved"

    client.post("/skills/packages/upload", json={"filename": "echo-v2.zip", "content_base64": _plugin_zip("plugin.echo@0.2.0", "0.2.0", "Echo v2 with improved schema")})
    assert client.post("/skills/plugin.echo@0.2.0/contract-test").json()["ok"] is True
    assert client.post("/skills/plugin.echo@0.2.0/approve", json={"reason": "v2 升级"}).json()["status"] == "approved"

    history = client.get("/skills/plugin.echo@0.2.0/versions").json()

    assert history["base_skill_id"] == "plugin.echo"
    assert [item["skill_id"] for item in history["versions"]] == ["plugin.echo@0.1.0", "plugin.echo@0.2.0"]
    latest = history["versions"][-1]
    assert latest["contract_history"][0]["ok"] is True
    assert latest["approval_history"][-1]["action"] == "approve"
    assert any(diff["field"] == "manifest.description" for diff in latest["diff_from_previous"])

    rollback = client.post(
        "/skills/plugin.echo@0.2.0/rollback",
        json={"target_skill_id": "plugin.echo@0.1.0", "reason": "回滚到稳定版本"},
    ).json()

    assert rollback["latest_approved_skill_id"] == "plugin.echo@0.1.0"
    versions = {item["skill_id"]: item for item in rollback["versions"]}
    assert versions["plugin.echo@0.1.0"]["status"] == "approved"
    assert versions["plugin.echo@0.2.0"]["status"] == "deprecated"
    assert versions["plugin.echo@0.2.0"]["approval_history"][-1]["action"] == "rollback_source"


def test_workflow_publish_pins_exact_skill_version_and_newer_disable_does_not_block_old_version(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    client.post("/skills/packages/upload", json={"filename": "echo-v1.zip", "content_base64": _plugin_zip("plugin.echo@0.1.0", "0.1.0", "Echo v1")})
    client.post("/skills/plugin.echo@0.1.0/contract-test")
    client.post("/skills/plugin.echo@0.1.0/approve", json={"reason": "v1 稳定"})
    client.post("/skills/packages/upload", json={"filename": "echo-v2.zip", "content_base64": _plugin_zip("plugin.echo@0.2.0", "0.2.0", "Echo v2")})
    client.post("/skills/plugin.echo@0.2.0/contract-test")
    client.post("/skills/plugin.echo@0.2.0/approve", json={"reason": "v2 上线"})
    client.post("/skills/plugin.echo@0.2.0/deprecate", json={"reason": "新版本暂停引用"})

    published = client.post("/workflow-graphs/publish", json={"graph": _echo_graph("plugin.echo@0.1.0")}).json()

    assert published["steps"][0]["skill_ref"] == "plugin.echo@0.1.0"
    assert client.get("/skills/plugin.echo@0.1.0/versions").json()["versions"][0]["status"] == "approved"


def _plugin_zip(skill_id: str, version: str, description: str) -> str:
    manifest = {
        "skill_id": skill_id,
        "name": "Echo Skill",
        "version": version,
        "description": description,
        "author": "QA",
        "tags": ["plugin", "echo"],
        "scenarios": ["skill-version"],
        "runtime": {"mode": "script", "entrypoint": "handler.py:run"},
        "input_schema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        "output_schema": {"type": "object", "properties": {"echo": {"type": "string"}}, "required": ["echo"]},
        "config_schema": {"type": "object", "properties": {}},
        "example_input": {"text": "hello"},
        "example_config": {},
        "permissions": [],
        "cacheable": True,
    }
    handler = "def run(inputs, config):\n    return {'output': {'echo': inputs['text']}, 'metrics': {}}\n"
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("skill.json", json.dumps(manifest, ensure_ascii=False))
        archive.writestr("handler.py", handler)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _echo_graph(skill_ref: str) -> dict:
    return {
        "name": "Echo Version Workflow",
        "nodes": [
            {
                "node_id": "echo",
                "node_type": "skill",
                "skill_ref": skill_ref,
                "input_mapping": {"text": "row.text"},
                "output_mapping": {"echo": "context.echo"},
                "config": {},
            },
            {"node_id": "report", "node_type": "output", "label": "报告"},
        ],
        "edges": [{"source": "echo", "target": "report"}],
    }
