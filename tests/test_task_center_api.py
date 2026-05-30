import base64
import io
import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def _plugin_zip(*, include_manifest: bool = True, include_handler: bool = True, handler_body: str | None = None) -> str:
    manifest = {
        "skill_id": "plugin.echo@0.1.0",
        "name": "插件 Echo Skill",
        "version": "0.1.0",
        "description": "用于验证插件包上传和合约测试。",
        "author": "QA",
        "tags": ["plugin", "echo"],
        "scenarios": ["task_center"],
        "input_schema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        "output_schema": {"type": "object", "properties": {"echo": {"type": "string"}}, "required": ["echo"]},
        "config_schema": {"type": "object", "properties": {}},
        "example_input": {"text": "hello"},
        "example_config": {},
        "permissions": [],
        "cacheable": True,
    }
    handler = handler_body or """
def run(inputs, config):
    return {"output": {"echo": inputs["text"]}, "metrics": {"chars": len(inputs["text"])}, "logs": ["ok"]}
"""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        if include_manifest:
            archive.writestr("skill.json", json.dumps(manifest, ensure_ascii=False))
        if include_handler:
            archive.writestr("handler.py", handler)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _write_jsonl(path: Path) -> None:
    rows = [
        {"question": "什么是 AegisQA?", "reference": "AegisQA", "expected_label": "pass"},
        {"question": "什么是坏例?", "reference": "Badcase", "expected_label": "fail"},
    ]
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _graph_payload() -> dict:
    return {
        "name": "任务中心 Workflow",
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成回答",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.question"},
                "output_mapping": {"answer": "context.answer", "tokens": "metrics.tokens"},
                "config": {"model": "demo-model", "temperature": 0},
                "cacheable": True,
            },
            {
                "node_id": "judge",
                "node_type": "skill",
                "label": "裁判",
                "skill_ref": "llm.judge@0.1.0",
                "input_mapping": {"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
                "output_mapping": {"score": "metrics.judge_score", "label": "context.judge_label"},
                "config": {"threshold": 0.6},
            },
            {"node_id": "report", "node_type": "output", "label": "报告"},
        ],
        "edges": [{"source": "answer", "target": "judge"}, {"source": "judge", "target": "report"}],
    }


def test_skill_package_upload_contract_and_approval_gate(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    missing_manifest = client.post(
        "/skills/packages/upload",
        json={"filename": "broken.zip", "content_base64": _plugin_zip(include_manifest=False)},
    )
    assert missing_manifest.status_code == 400
    assert missing_manifest.json()["code"] == "BAD_REQUEST"

    uploaded = client.post(
        "/skills/packages/upload",
        json={"filename": "echo.zip", "content_base64": _plugin_zip()},
    ).json()
    assert uploaded["manifest"]["skill_id"] == "plugin.echo@0.1.0"
    assert uploaded["status"] == "pending_review"
    assert uploaded["manifest"]["enabled"] is False

    blocked = client.post("/skills/plugin.echo@0.1.0/approve").json()
    assert blocked["code"] == "BAD_REQUEST"
    assert "合约测试" in blocked["message"]

    contract = client.post("/skills/plugin.echo@0.1.0/contract-test").json()
    assert contract["ok"] is True
    assert contract["output"] == {"echo": "hello"}

    approved = client.post("/skills/plugin.echo@0.1.0/approve").json()
    assert approved["status"] == "approved"
    assert approved["enabled"] is True
    assert client.get("/skills/packages").json()[0]["status"] == "approved"


def test_task_lifecycle_report_and_trace_tree(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_dataset.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "task_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()

    task = client.post(
        "/tasks",
        json={
            "name": "RAG 任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
        },
    ).json()
    assert task["status"] == "queued"
    assert task["total_items"] == 2
    assert task["completed_items"] == 0
    assert task["workflow_version_id"] == workflow["version_id"]

    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    assert executed["status"] == "completed"
    assert executed["completed_items"] == 2
    assert executed["pass_rate"] == 0.5
    assert executed["badcase_count"] == 1

    tasks = client.get("/tasks").json()
    assert tasks[0]["task_id"] == task["task_id"]
    assert tasks[0]["dataset_name"] == "task_dataset"
    assert tasks[0]["workflow_name"] == "任务中心 Workflow"

    report = client.get(f"/tasks/{task['task_id']}/report").json()
    assert report["task"]["task_id"] == task["task_id"]
    assert report["report"]["run_id"] == executed["run_id"]
    assert report["export_links"]["html"].endswith("file_format=html")

    trace_tree = client.get(f"/tasks/{task['task_id']}/trace-tree").json()
    assert trace_tree["run_id"] == executed["run_id"]
    assert trace_tree["items"][0]["children"][0]["skill_ref"] == "llm.call@0.1.0"
