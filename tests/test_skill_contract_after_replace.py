"""合约测试状态在「替换上传」后必须落到前端展示的那条记录上。

背景：同一个 skill_id 在历史里可能存在多条 skill_packages 记录（被替换/被废弃的旧版本仍保留）。
后端 `_find_skill_package` 早期实现取列表第一条；当旧记录的 mtime 更新时，合约测试结果会写到
一条前端不再展示的旧记录上，页面因此一直显示「未通过」。

这里用持久化数据直接复刻该场景：保留一条已被替换、合约未通过的旧记录，再做一次合约测试，
断言「前端 indexBySkillId 会取到的那条记录」与「后端写入的那条记录」是同一条，且 last_contract_ok=True。
"""

from __future__ import annotations

import base64
import json
from io import BytesIO
from zipfile import ZipFile

from fastapi.testclient import TestClient

from aegisqa.api.app import _find_skill_package, create_app
from aegisqa.storage.json_store import JsonStore


def test_contract_test_after_replace_updates_record_shown_by_frontend(tmp_path) -> None:
    store_root = tmp_path / "store"
    app = create_app(store_root=store_root)
    client = TestClient(app)

    skill_id = "plugin.echo@0.1.0"
    client.post(
        "/skills/packages/upload",
        json={"filename": "echo.zip", "content_base64": _plugin_zip()},
    )
    # 第一次合约测试通过并审批，让这条记录成为历史版本。
    assert client.post(f"/skills/{skill_id}/contract-test").json()["ok"] is True
    client.post(f"/skills/{skill_id}/approve", json={"reason": "v1 稳定"})

    # 直接在存储里插入一条「陈旧、已被替换、合约未通过」的旧记录，模拟历史脏数据。
    # 它的 updated_at 刻意设为最新，复刻后端 list_json 可能先返回它的场景。
    store = JsonStore(store_root)
    active_record = _find_skill_package(store, skill_id)
    assert active_record is not None
    stale_record = json.loads(json.dumps(active_record))
    stale_record["package_id"] = "pkg-stale-legacy"
    stale_record["status"] = "replaced"
    stale_record["last_contract_ok"] = False
    stale_record["last_contract_at"] = "2026-06-01T00:00:00+00:00"
    stale_record["created_at"] = "2026-06-01T00:00:00+00:00"
    stale_record["updated_at"] = "2026-06-23T23:59:59+08:00"
    store.write_json(["skill_packages", "pkg-stale-legacy.json"], stale_record)

    # 再次跑合约测试（模拟「替换上传后重新验证」）。后端必须写入「未被替换」的那条记录。
    result = client.post(f"/skills/{skill_id}/contract-test").json()
    assert result["ok"] is True

    # 后端 `_find_skill_package` 现在会跳过 replaced 记录，定位到真正生效的那条。
    canonical = _find_skill_package(store, skill_id)
    assert canonical is not None
    assert canonical["status"] != "replaced"
    assert canonical["last_contract_ok"] is True

    # 前端会从 /skills/packages 取「最新未替换」的那条展示，断言它就是后端写入的那条。
    packages = client.get("/skills/packages").json()
    shown = _frontend_index_by_skill_id([p for p in packages if p["manifest"]["skill_id"] == skill_id])
    assert shown["package_id"] == canonical["package_id"]
    assert shown["last_contract_ok"] is True
    # 陈旧记录不应再污染展示。
    assert shown["package_id"] != "pkg-stale-legacy"


def _frontend_index_by_skill_id(records: list[dict]) -> dict:
    """复刻前端 indexPackagesBySkillId：取未被替换且 updated_at 最新的记录。"""
    chosen = None
    for record in records:
        if chosen is None or _is_more_canonical(record, chosen):
            chosen = record
    return chosen


def _is_more_canonical(candidate: dict, incumbent: dict) -> bool:
    candidate_replaced = candidate.get("status") == "replaced"
    incumbent_replaced = incumbent.get("status") == "replaced"
    if candidate_replaced != incumbent_replaced:
        return not candidate_replaced
    return str(candidate.get("updated_at") or "") > str(incumbent.get("updated_at") or "")


def _plugin_zip() -> str:
    manifest = {
        "skill_id": "plugin.echo@0.1.0",
        "name": "Echo Skill",
        "version": "0.1.0",
        "description": "replace-bug repro",
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
