"""覆盖 Skill 上传冲突策略（replace / new_version）。

这组测试锁定本次 bug 修复后的契约：
- replace：新建一条记录（新 package_id），旧记录标 replaced 且 replaced_by 指向新包；
  合约测试只写到 active（非 replaced）记录；前端取 canonical 记录与后端写入一致。
- new_version：自动递增版本号，新旧版本共存于版本历史。
"""

from __future__ import annotations

import base64
import json
from io import BytesIO
from zipfile import ZipFile

from fastapi.testclient import TestClient

from aegisqa.api.app import _find_skill_package, create_app
from aegisqa.storage.json_store import JsonStore


def test_replace_strategy_creates_new_record_and_marks_old_replaced(tmp_path) -> None:
    store_root = tmp_path / "store"
    client = TestClient(create_app(store_root=store_root))
    skill_id = "plugin.echo@0.1.0"

    first = client.post(
        "/skills/packages/upload",
        json={"filename": "echo-v1.zip", "content_base64": _plugin_zip()},
    ).json()
    first_pkg = first["package_id"]

    replaced = client.post(
        "/skills/packages/upload",
        json={"filename": "echo-v2.zip", "content_base64": _plugin_zip(), "conflict_strategy": "replace"},
    ).json()
    new_pkg = replaced["package_id"]

    # replace 必须新建一条记录，而不是复用旧 package_id（原子顺序：先写新，再标旧 replaced）。
    assert new_pkg != first_pkg
    assert replaced["status"] == "pending_review"

    packages = {p["package_id"]: p for p in client.get("/skills/packages").json() if p["manifest"]["skill_id"] == skill_id}
    assert packages[first_pkg]["status"] == "replaced"
    assert packages[first_pkg]["replaced_by"] == new_pkg
    assert packages[new_pkg]["status"] == "pending_review"

    # 后端 _find_skill_package 必须落到 active 记录上，而不是被替换的旧记录。
    active = _find_skill_package(JsonStore(store_root), skill_id)
    assert active is not None
    assert active["package_id"] == new_pkg
    assert active["status"] != "replaced"


def test_contract_test_after_replace_writes_to_active_record(tmp_path) -> None:
    store_root = tmp_path / "store"
    client = TestClient(create_app(store_root=store_root))
    skill_id = "plugin.echo@0.1.0"

    client.post("/skills/packages/upload", json={"filename": "echo.zip", "content_base64": _plugin_zip()})
    client.post("/skills/packages/upload", json={"filename": "echo.zip", "content_base64": _plugin_zip(), "conflict_strategy": "replace"})

    contract = client.post(f"/skills/{skill_id}/contract-test").json()
    assert contract["ok"] is True

    store = JsonStore(store_root)
    active = _find_skill_package(store, skill_id)
    assert active is not None
    assert active["status"] != "replaced"
    assert active["last_contract_ok"] is True

    # 合约结果不应写到被替换的旧记录上。
    replaced_records = [
        r for r in store.list_json(["skill_packages"])
        if r["manifest"]["skill_id"] == skill_id and r.get("status") == "replaced"
    ]
    for record in replaced_records:
        assert record["last_contract_ok"] is not True, "被替换的旧记录不应被合约测试更新"


def test_new_version_strategy_auto_increments_and_coexists(tmp_path) -> None:
    client = TestClient(create_app(store_root=tmp_path / "store"))
    skill_id = "plugin.echo@0.1.0"

    client.post("/skills/packages/upload", json={"filename": "echo-v1.zip", "content_base64": _plugin_zip(version="0.1.0")})
    new_version = client.post(
        "/skills/packages/upload",
        json={"filename": "echo-v2.zip", "content_base64": _plugin_zip(version="0.1.0"), "conflict_strategy": "new_version"},
    ).json()

    new_skill_id = new_version["manifest"]["skill_id"]
    # 新版本模式：skill_id 递增到下一个版本（0.1.0 -> 0.1.1），且与原版本共存。
    assert new_skill_id == "plugin.echo@0.1.1"
    assert new_skill_id != skill_id

    history = client.get(f"/skills/{new_skill_id}/versions").json()
    versions = [item["skill_id"] for item in history["versions"]]
    assert skill_id in versions
    assert new_skill_id in versions
    assert history["base_skill_id"] == "plugin.echo"


def test_default_error_strategy_rejects_duplicate(tmp_path) -> None:
    client = TestClient(create_app(store_root=tmp_path / "store"))
    skill_id = "plugin.echo@0.1.0"

    client.post("/skills/packages/upload", json={"filename": "echo.zip", "content_base64": _plugin_zip()})
    duplicate = client.post(
        "/skills/packages/upload",
        json={"filename": "echo.zip", "content_base64": _plugin_zip(), "conflict_strategy": "error"},
    )

    assert duplicate.status_code == 400
    body = duplicate.json()
    assert body["code"] == "SKILL_ALREADY_EXISTS"
    assert body["details"]["existing_skill_id"] == skill_id


def _plugin_zip(skill_id: str = "plugin.echo@0.1.0", version: str = "0.1.0") -> str:
    manifest = {
        "skill_id": skill_id,
        "name": "Echo Skill",
        "version": version,
        "description": "conflict-strategy test",
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
