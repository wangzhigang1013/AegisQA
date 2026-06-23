"""覆盖 Skill 回滚端点。

这组测试锁定回滚端点的核心契约：
- 回滚只在已上传的 Skill 包版本之间执行。
- 回滚目标必须通过合约测试。
- 回滚操作将目标版本设为 approved，源版本设为 deprecated。
- 回滚后版本历史正确反映状态变更。
"""

from __future__ import annotations

import base64
import json
from io import BytesIO
from zipfile import ZipFile

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def test_rollback_requires_uploaded_packages(tmp_path) -> None:
    """回滚只能在已上传的 Skill 包版本之间执行。"""
    client = TestClient(create_app(store_root=tmp_path / "store"))
    response = client.post(
        "/skills/plugin.echo@0.1.0/rollback",
        json={
            "target_skill_id": "plugin.echo@0.1.1",
            "reason": "测试回滚",
        },
    )
    # 应该失败，因为没有上传过任何包
    assert response.status_code in {400, 404, 422, 500}


def test_rollback_requires_same_skill_family(tmp_path) -> None:
    """回滚只能在同一 Skill 版本族内执行。"""
    client = TestClient(create_app(store_root=tmp_path / "store"))
    skill_id_1 = "plugin.echo@0.1.0"
    skill_id_2 = "plugin.other@0.1.0"

    # 上传两个不同 skill 的包
    client.post("/skills/packages/upload", json={"filename": "echo.zip", "content_base64": _plugin_zip(skill_id=skill_id_1)})
    client.post("/skills/packages/upload", json={"filename": "other.zip", "content_base64": _plugin_zip(skill_id=skill_id_2)})

    response = client.post(
        f"/skills/{skill_id_1}/rollback",
        json={
            "target_skill_id": skill_id_2,
            "reason": "测试跨 skill 回滚",
        },
    )
    # 应该失败，因为不是同一 skill 版本族
    assert response.status_code in {400, 422, 500}


def test_rollback_requires_contract_test_pass(tmp_path) -> None:
    """回滚目标必须先通过合约测试。"""
    client = TestClient(create_app(store_root=tmp_path / "store"))
    skill_id = "plugin.echo@0.1.0"
    target_skill_id = "plugin.echo@0.1.1"

    # 上传两个版本，但不运行合约测试
    client.post("/skills/packages/upload", json={"filename": "echo-v1.zip", "content_base64": _plugin_zip(skill_id=skill_id, version="0.1.0")})
    client.post("/skills/packages/upload", json={"filename": "echo-v2.zip", "content_base64": _plugin_zip(skill_id=target_skill_id, version="0.1.1"), "conflict_strategy": "new_version"})

    response = client.post(
        f"/skills/{skill_id}/rollback",
        json={
            "target_skill_id": target_skill_id,
            "reason": "测试未通过合约的回滚",
        },
    )
    # 应该失败，因为目标版本未通过合约测试
    assert response.status_code in {400, 422, 500}


def test_rollback_approves_target_and_deprecates_source(tmp_path) -> None:
    """回滚操作将目标版本设为 approved，源版本设为 deprecated。"""
    client = TestClient(create_app(store_root=tmp_path / "store"))
    skill_id = "plugin.echo@0.1.0"
    target_skill_id = "plugin.echo@0.1.1"

    # 上传两个版本
    client.post("/skills/packages/upload", json={"filename": "echo-v1.zip", "content_base64": _plugin_zip(skill_id=skill_id, version="0.1.0")})
    client.post("/skills/packages/upload", json={"filename": "echo-v2.zip", "content_base64": _plugin_zip(skill_id=target_skill_id, version="0.1.1"), "conflict_strategy": "new_version"})

    # 对目标版本运行合约测试
    contract = client.post(f"/skills/{target_skill_id}/contract-test").json()
    assert contract["ok"] is True

    # 执行回滚
    rollback_response = client.post(
        f"/skills/{skill_id}/rollback",
        json={
            "target_skill_id": target_skill_id,
            "reason": "测试回滚",
        },
    )
    assert rollback_response.status_code == 200

    # 验证版本历史
    versions_response = client.get(f"/skills/{target_skill_id}/versions")
    assert versions_response.status_code == 200
    versions = versions_response.json()["versions"]

    # 找到目标版本和源版本
    target_version = next((v for v in versions if v["skill_id"] == target_skill_id), None)
    source_version = next((v for v in versions if v["skill_id"] == skill_id), None)

    assert target_version is not None, "目标版本应存在于版本历史中"
    assert source_version is not None, "源版本应存在于版本历史中"

    # 目标版本应为 approved，源版本应为 deprecated
    assert target_version["status"] == "approved", f"目标版本状态应为 approved，实际为 {target_version['status']}"
    assert source_version["status"] == "deprecated", f"源版本状态应为 deprecated，实际为 {source_version['status']}"


def test_rollback_records_lifecycle_events(tmp_path) -> None:
    """回滚操作应记录生命周期事件。"""
    client = TestClient(create_app(store_root=tmp_path / "store"))
    skill_id = "plugin.echo@0.1.0"
    target_skill_id = "plugin.echo@0.1.1"

    # 上传两个版本
    client.post("/skills/packages/upload", json={"filename": "echo-v1.zip", "content_base64": _plugin_zip(skill_id=skill_id, version="0.1.0")})
    client.post("/skills/packages/upload", json={"filename": "echo-v2.zip", "content_base64": _plugin_zip(skill_id=target_skill_id, version="0.1.1"), "conflict_strategy": "new_version"})

    # 对目标版本运行合约测试
    client.post(f"/skills/{target_skill_id}/contract-test")

    # 执行回滚
    rollback_response = client.post(
        f"/skills/{skill_id}/rollback",
        json={
            "target_skill_id": target_skill_id,
            "reason": "测试生命周期事件",
        },
    )
    assert rollback_response.status_code == 200

    # 验证版本历史中包含回滚事件
    versions_response = client.get(f"/skills/{target_skill_id}/versions")
    versions = versions_response.json()["versions"]

    # 检查目标版本是否有 rollback_target 生命周期事件
    target_version = next((v for v in versions if v["skill_id"] == target_skill_id), None)
    assert target_version is not None
    assert "approval_history" in target_version, "目标版本应包含审批历史"
    assert any(
        event.get("action") == "rollback_target"
        for event in target_version.get("approval_history", [])
    ), "目标版本应有 rollback_target 事件"

    # 检查源版本是否有 rollback_source 生命周期事件
    source_version = next((v for v in versions if v["skill_id"] == skill_id), None)
    assert source_version is not None
    assert "approval_history" in source_version, "源版本应包含审批历史"
    assert any(
        event.get("action") == "rollback_source"
        for event in source_version.get("approval_history", [])
    ), "源版本应有 rollback_source 事件"


def _plugin_zip(skill_id: str = "plugin.echo@0.1.0", version: str = "0.1.0") -> str:
    """生成测试用的 Skill 包 zip 文件的 base64 编码。"""
    manifest = {
        "skill_id": skill_id,
        "name": "Echo Skill",
        "version": version,
        "description": "rollback test",
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
