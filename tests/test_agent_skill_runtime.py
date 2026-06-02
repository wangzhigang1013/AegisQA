from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def test_agent_skill_discover_import_contract_approval_and_reload(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "agent_skill_roots"
    skill_dir = _write_agent_skill(root, "qa-helper")
    monkeypatch.setenv("AEGISQA_AGENT_SKILL_ROOTS", str(root))

    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    discovered = client.get("/agent-skills/discover").json()
    assert discovered["count"] == 1
    assert discovered["items"][0]["name"] == "qa-helper"
    assert discovered["items"][0]["source_dir"] == str(skill_dir)

    imported = client.post("/agent-skills/import", json={"source_dir": str(skill_dir)}).json()
    assert imported["status"] == "pending_review"
    assert imported["runtime_mode"] == "safe_model"
    assert imported["manifest"]["enabled"] is False
    assert imported["manifest"]["skill_id"].startswith("agent.qa-helper@")

    skill_id = imported["manifest"]["skill_id"]
    skills = client.get("/skills").json()
    assert any(skill["skill_id"] == skill_id and skill["status"] == "pending_review" for skill in skills)

    contract = client.post(f"/skills/{skill_id}/contract-test").json()
    assert contract["ok"] is True
    assert "answer" in contract["output"]

    approved = client.post(f"/skills/{skill_id}/approve", json={"reason": "安全模式测试通过"}).json()
    assert approved["status"] == "approved"

    # 重启应用后，已导入的 Agent Skill 必须从持久化记录重新注册，避免今天重启明天丢失。
    reloaded = create_app(store_root=tmp_path / "store")
    assert reloaded.state.registry.get_manifest(skill_id).status == "approved"


def test_agent_skill_can_run_as_workflow_node_after_approval(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "agent_skill_roots"
    skill_dir = _write_agent_skill(root, "question-rewriter")
    monkeypatch.setenv("AEGISQA_AGENT_SKILL_ROOTS", str(root))

    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    skill_id = client.post("/agent-skills/import", json={"source_dir": str(skill_dir)}).json()["manifest"]["skill_id"]

    blocked = client.post("/workflow-graphs/validate", json={"graph": _agent_graph(skill_id), "sample_row": {"question": "AegisQA 是什么？"}}).json()
    assert blocked["ok"] is False
    assert blocked["errors"][0]["code"] == "SKILL_NOT_AVAILABLE"

    assert client.post(f"/skills/{skill_id}/contract-test").json()["ok"] is True
    client.post(f"/skills/{skill_id}/approve", json={"reason": "允许进入 Workflow"})

    dataset_path = tmp_path / "dataset.jsonl"
    dataset_path.write_text(json.dumps({"question": "AegisQA 是什么？"}, ensure_ascii=False) + "\n", encoding="utf-8")
    dataset = client.post("/datasets/from-path", json={"name": "agent_skill_dataset", "path": str(dataset_path)}).json()

    published = client.post("/workflow-graphs/publish", json={"graph": _agent_graph(skill_id)}).json()
    run = client.post("/runs", json={"workflow": published, "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"]}).json()
    executed = client.post(f"/runs/{run['run_id']}/execute").json()

    assert executed["status"] == "completed"
    first_step = executed["items"][0]["steps"][0]
    assert first_step["skill_ref"] == skill_id
    assert first_step["output_snapshot"]["answer"].startswith("模型回答：")
    assert executed["items"][0]["context_snapshot"]["agent_node"]["answer"] == first_step["output_snapshot"]["answer"]


def _write_agent_skill(root: Path, dirname: str) -> Path:
    skill_dir = root / dirname
    (skill_dir / "references").mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        """---
name: qa-helper
description: 把输入问题整理成可评测的结构化回答。
---

# QA Helper

你是一个只读安全模式的 Agent Skill。请根据用户任务输出简洁中文回答。
""",
        encoding="utf-8",
    )
    (skill_dir / "references" / "style.md").write_text("回答要短，保留关键事实。", encoding="utf-8")
    return skill_dir


def _agent_graph(skill_id: str) -> dict[str, object]:
    return {
        "name": "Agent Skill Workflow",
        "nodes": [
            {
                "node_id": "agent_node",
                "node_type": "skill",
                "label": "Agent Skill 节点",
                "skill_ref": skill_id,
                "input_mapping": {"task": "row.question"},
                "config": {"model": "mock-eval-model"},
            },
            {"node_id": "report", "node_type": "output", "label": "报告"},
        ],
        "edges": [{"source": "agent_node", "target": "report"}],
    }
