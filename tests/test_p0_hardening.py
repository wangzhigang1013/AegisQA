import base64
import io
import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def test_dataset_upload_rejects_empty_files_and_reports_jsonl_line(tmp_path: Path) -> None:
    client = TestClient(create_app(store_root=tmp_path / "store"))

    empty_jsonl = client.post(
        "/datasets/upload",
        json={"name": "empty_jsonl", "filename": "empty.jsonl", "content": ""},
    )
    assert empty_jsonl.status_code == 400
    assert empty_jsonl.json()["code"] == "DATASET_EMPTY"
    assert empty_jsonl.json()["details"]["filename"] == "empty.jsonl"

    bad_jsonl = client.post(
        "/datasets/upload",
        json={
            "name": "bad_jsonl",
            "filename": "bad.jsonl",
            "content": json.dumps({"question": "ok"}, ensure_ascii=False) + "\nnot-json\n",
        },
    )
    assert bad_jsonl.status_code == 400
    assert bad_jsonl.json()["code"] == "DATASET_PARSE_ERROR"
    assert bad_jsonl.json()["details"]["line_number"] == 2

    empty_csv = client.post(
        "/datasets/upload",
        json={"name": "empty_csv", "filename": "empty.csv", "content": "question,reference\n"},
    )
    assert empty_csv.status_code == 400
    assert empty_csv.json()["code"] == "DATASET_EMPTY"


def test_skill_package_rejects_unsafe_paths_and_reports_contract_timeout(tmp_path: Path) -> None:
    client = TestClient(create_app(store_root=tmp_path / "store"))

    unsafe = client.post(
        "/skills/packages/upload",
        json={"filename": "unsafe.zip", "content_base64": _skill_zip(extra_files={"../evil.py": "print('bad')"})},
    )
    assert unsafe.status_code == 400
    assert unsafe.json()["code"] == "SKILL_PACKAGE_INVALID_PATH"

    timeout_upload = client.post(
        "/skills/packages/upload",
        json={
            "filename": "timeout.zip",
            "content_base64": _skill_zip(
                skill_id="plugin.timeout@0.1.0",
                handler_body="""
import time

def run(inputs, config):
    time.sleep(2)
    return {"output": {"echo": inputs["text"]}}
""",
            ),
        },
    )
    assert timeout_upload.status_code == 200

    contract = client.post("/skills/plugin.timeout@0.1.0/contract-test").json()
    assert contract["ok"] is False
    assert contract["code"] == "SKILL_CONTRACT_TIMEOUT"


def test_task_actions_reject_invalid_state_transitions(tmp_path: Path) -> None:
    store_root = tmp_path / "store"
    client = TestClient(create_app(store_root=store_root))
    dataset_path = tmp_path / "dataset.jsonl"
    _write_jsonl(dataset_path)
    dataset = client.post("/datasets/from-path", json={"name": "task_p0", "path": str(dataset_path)}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()

    completed_task = _create_task(client, dataset, workflow, "已完成任务")
    executed = client.post(f"/tasks/{completed_task['task_id']}/execute")
    assert executed.status_code == 200
    assert executed.json()["status"] == "completed"

    duplicate_execute = client.post(f"/tasks/{completed_task['task_id']}/execute")
    assert duplicate_execute.status_code == 409
    assert duplicate_execute.json()["code"] == "TASK_ALREADY_COMPLETED"

    running_task = _create_task(client, dataset, workflow, "运行中任务")
    task_path = store_root / "tasks" / f"{running_task['task_id']}.json"
    task_payload = json.loads(task_path.read_text(encoding="utf-8"))
    task_payload["status"] = "running"
    task_path.write_text(json.dumps(task_payload, ensure_ascii=False), encoding="utf-8")
    duplicate_running = client.post(f"/tasks/{running_task['task_id']}/execute")
    assert duplicate_running.status_code == 409
    assert duplicate_running.json()["code"] == "TASK_ALREADY_RUNNING"

    cancelled_task = _create_task(client, dataset, workflow, "已取消任务")
    cancelled = client.post(f"/tasks/{cancelled_task['task_id']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "canceled"

    pause_cancelled = client.post(f"/tasks/{cancelled_task['task_id']}/pause")
    assert pause_cancelled.status_code == 409
    assert pause_cancelled.json()["code"] == "TASK_ACTION_INVALID"
    assert pause_cancelled.json()["details"]["current_status"] == "canceled"


def _skill_zip(
    *,
    skill_id: str = "plugin.echo@0.1.0",
    handler_body: str | None = None,
    extra_files: dict[str, str] | None = None,
) -> str:
    manifest = {
        "skill_id": skill_id,
        "name": "P0 插件 Skill",
        "version": "0.1.0",
        "description": "用于 P0 安全测试。",
        "author": "QA",
        "tags": ["plugin", "p0"],
        "scenarios": ["hardening"],
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
    return {"output": {"echo": inputs["text"]}, "metrics": {}, "logs": ["ok"]}
"""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("skill.json", json.dumps(manifest, ensure_ascii=False))
        archive.writestr("handler.py", handler)
        for name, content in (extra_files or {}).items():
            archive.writestr(name, content)
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
        "name": "P0 Workflow",
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


def _create_task(client: TestClient, dataset: dict, workflow: dict, name: str) -> dict:
    return client.post(
        "/tasks",
        json={
            "name": name,
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
        },
    ).json()
