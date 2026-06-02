from __future__ import annotations

import base64
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZipFile

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def test_agent_skill_zip_script_mode_upload_contract_and_reload(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    uploaded = client.post(
        "/skills/packages/upload",
        json={"filename": "keyword_agent_skill.zip", "content_base64": _agent_script_skill_zip()},
    ).json()

    assert uploaded["status"] == "pending_review"
    assert uploaded["runtime_mode"] == "script"
    assert uploaded["entrypoint"] == "scripts/run.py:run"
    assert uploaded["skill_md_path"].endswith("SKILL.md")
    assert uploaded["handler_path"] is None
    assert uploaded["manifest"]["skill_id"] == "agent.keyword_check@0.1.0"
    assert uploaded["manifest"]["enabled"] is False

    contract = client.post("/skills/agent.keyword_check@0.1.0/contract-test").json()

    assert contract["ok"] is True
    assert contract["output"] == {"hit": True, "matched_keywords": ["幻觉"]}
    assert contract["metrics"]["matched_count"] == 1

    approved = client.post("/skills/agent.keyword_check@0.1.0/approve", json={"reason": "脚本型 Agent Skill 测试通过"}).json()
    assert approved["status"] == "approved"

    # 上传后的 Skill 必须从持久化包记录恢复，避免服务重启后市场和 Workflow 引用丢失。
    reloaded = create_app(store_root=tmp_path / "store")
    manifest = reloaded.state.registry.get_manifest("agent.keyword_check@0.1.0")
    assert manifest.status == "approved"


def test_agent_skill_zip_script_mode_runs_in_workflow_and_exposes_node_output(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    client.post("/skills/packages/upload", json={"filename": "keyword_agent_skill.zip", "content_base64": _agent_script_skill_zip()})
    assert client.post("/skills/agent.keyword_check@0.1.0/contract-test").json()["ok"] is True
    client.post("/skills/agent.keyword_check@0.1.0/approve", json={"reason": "允许进入 Workflow"})

    dataset_path = tmp_path / "dataset.jsonl"
    dataset_path.write_text(json.dumps({"text": "这条回答存在幻觉"}, ensure_ascii=False) + "\n", encoding="utf-8")
    dataset = client.post("/datasets/from-path", json={"name": "agent_script_dataset", "path": str(dataset_path)}).json()

    published = client.post("/workflow-graphs/publish", json={"graph": _agent_script_graph()}).json()
    run = client.post(
        "/runs",
        json={"workflow": published, "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"]},
    ).json()
    executed = client.post(f"/runs/{run['run_id']}/execute").json()

    assert executed["status"] == "completed"
    first_step = executed["items"][0]["steps"][0]
    assert first_step["skill_ref"] == "agent.keyword_check@0.1.0"
    assert first_step["output_snapshot"]["hit"] is True
    assert executed["items"][0]["context_snapshot"]["keyword"]["hit"] is True


def test_instruction_agent_skill_zip_can_be_uploaded_without_handler(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    uploaded = client.post(
        "/skills/packages/upload",
        json={"filename": "instruction_agent_skill.zip", "content_base64": _instruction_agent_skill_zip()},
    ).json()

    assert uploaded["status"] == "pending_review"
    assert uploaded["runtime_mode"] == "instruction_model"
    assert uploaded["entrypoint"] is None
    assert uploaded["handler_path"] is None

    contract = client.post("/skills/agent.qa_helper@0.1.0/contract-test").json()

    assert contract["ok"] is True
    assert "answer" in contract["output"]
    assert contract["output"]["runtime_mode"] == "instruction_model"


def test_script_agent_skill_without_manifest_is_rejected(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    response = client.post(
        "/skills/packages/upload",
        json={"filename": "script_without_manifest.zip", "content_base64": _script_without_manifest_zip()},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "SKILL_PACKAGE_MANIFEST_MISSING"
    assert "纯参数或脚本型 Agent Skill 必须提供 skill.yaml" in response.json()["message"]


def _agent_script_skill_zip() -> str:
    skill_yaml = """
skill_id: agent.keyword_check@0.1.0
name: 关键词检查
version: 0.1.0
description: 不调用模型的参数化关键词检查 Agent Skill。
tags: [agent-skill, script]
scenarios: [keyword-check]
runtime:
  mode: script
  entrypoint: scripts/run.py:run
input_schema:
  type: object
  required: [text]
  properties:
    text:
      type: string
      description: 要检查的文本。
config_schema:
  type: object
  required: [keywords]
  properties:
    keywords:
      type: array
      items:
        type: string
output_schema:
  type: object
  required: [hit, matched_keywords]
  properties:
    hit:
      type: boolean
    matched_keywords:
      type: array
      items:
        type: string
cacheable: false
permissions: []
example_input:
  text: 这段回答存在幻觉
example_config:
  keywords: [幻觉]
"""
    script = """
def run(inputs, config):
    text = inputs["text"]
    keywords = config["keywords"]
    matched = [item for item in keywords if item in text]
    return {
        "output": {"hit": bool(matched), "matched_keywords": matched},
        "metrics": {"matched_count": len(matched)},
        "logs": ["script mode"],
    }
"""
    return _zip_bytes(
        {
            "SKILL.md": """---
name: keyword-check
description: 根据关键词判断一条文本是否命中。
---

# Keyword Check

这是一个脚本型 Agent Skill，不调用模型，只根据参数执行确定性检查。
""",
            "skill.yaml": skill_yaml,
            "scripts/run.py": script,
        }
    )


def _instruction_agent_skill_zip() -> str:
    skill_yaml = """
skill_id: agent.qa_helper@0.1.0
name: QA Helper
version: 0.1.0
description: 根据说明型 Agent Skill 生成回答。
tags: [agent-skill, instruction-model]
runtime:
  mode: instruction_model
input_schema:
  type: object
  required: [task]
  properties:
    task:
      type: string
output_schema:
  type: object
  required: [answer, text]
  properties:
    answer:
      type: string
    text:
      type: string
    skill_id:
      type: string
    runtime_mode:
      type: string
config_schema:
  type: object
  properties:
    model:
      type: string
    max_reference_chars:
      type: integer
example_input:
  task: 请说明 AegisQA 的用途
example_config: {}
permissions: [model:call]
"""
    return _zip_bytes(
        {
            "SKILL.md": """---
name: qa-helper
description: 把输入任务整理成评测可用回答。
---

# QA Helper

根据用户任务和 references 生成简洁中文结果。
""",
            "skill.yaml": skill_yaml,
            "references/style.md": "回答要短，保留关键事实。",
        }
    )


def _script_without_manifest_zip() -> str:
    return _zip_bytes(
        {
            "SKILL.md": """---
name: missing-manifest
description: 缺少机器可读 schema 的脚本型 Skill。
---
""",
            "scripts/run.py": "def run(inputs, config):\n    return {'output': {'ok': True}}\n",
        }
    )


def _zip_bytes(files: dict[str, str]) -> str:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _agent_script_graph() -> dict[str, object]:
    return {
        "name": "Agent Script Workflow",
        "nodes": [
            {
                "node_id": "keyword",
                "node_type": "skill",
                "label": "关键词检查",
                "skill_ref": "agent.keyword_check@0.1.0",
                "input_mapping": {"text": "row.text"},
                "config": {"keywords": ["幻觉"]},
            },
            {"node_id": "report", "node_type": "output", "label": "报告"},
        ],
        "edges": [{"source": "keyword", "target": "report"}],
    }
