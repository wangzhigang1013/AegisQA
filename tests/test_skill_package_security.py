from __future__ import annotations

import base64
from io import BytesIO
import json
from zipfile import ZipFile

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


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

    approved = client.post("/skills/plugin.echo@0.1.0/approve", json={"reason": "测试审批通过"}).json()
    assert approved["status"] == "approved"

    after_approval = client.get("/skills/packages").json()[0]
    assert after_approval["status"] == "approved"
    assert after_approval["approved_by"] == "api"
    assert after_approval["approved_at"]
    assert after_approval["approval_note"] == "测试审批通过"


def _plugin_zip() -> str:
    manifest = {
        "skill_id": "plugin.echo@0.1.0",
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
    handler = "def run(inputs, config):\n    return {'output': {'echo': inputs['text']}, 'metrics': {}}\n"

    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        archive.writestr("skill.json", json.dumps(manifest, ensure_ascii=False))
        archive.writestr("handler.py", handler)
    return base64.b64encode(buffer.getvalue()).decode("ascii")
