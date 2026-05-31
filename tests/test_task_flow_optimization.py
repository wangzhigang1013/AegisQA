import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _graph_payload() -> dict[str, object]:
    return {
        "name": "全流程优化 Workflow",
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成回答",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.question"},
                "output_mapping": {"answer": "context.answer", "tokens": "metrics.tokens"},
                "config": {"model": "flow-model", "temperature": 0, "prompt_version": "prompt-flow-v1"},
                "cacheable": True,
            },
            {
                "node_id": "judge",
                "node_type": "skill",
                "label": "质量裁判",
                "skill_ref": "llm.judge@0.1.0",
                "input_mapping": {"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
                "output_mapping": {"score": "metrics.judge_score", "label": "context.judge_label"},
                "config": {"threshold": 0.6, "prompt_version": "judge-flow-v1"},
            },
            {"node_id": "report", "node_type": "output", "label": "报告"},
        ],
        "edges": [{"source": "answer", "target": "judge"}, {"source": "judge", "target": "report"}],
    }


def _seed_dataset_and_workflow(tmp_path: Path, *, include_reference: bool) -> tuple[TestClient, dict[str, object], dict[str, object]]:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_flow.jsonl"
    rows: list[dict[str, object]] = [
        {"question": "AegisQA 是什么?", "expected_label": "pass", "scene": "faq"},
        {"question": "支付失败怎么办?", "expected_label": "fail", "scene": "payment"},
    ]
    if include_reference:
        rows[0]["reference"] = "AegisQA 是 AI 评测工作台。"
        rows[1]["reference"] = "完全不相关答案"
    _write_jsonl(data_path, rows)

    dataset = client.post(
        "/datasets/from-path",
        json={"name": "task_flow", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    return client, dataset, workflow


def test_task_preflight_blocks_missing_workflow_fields(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=False)

    response = client.post(
        "/tasks/preflight",
        json={
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.8, "max_badcase_count": 0},
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "blocked"
    assert any(check["check_id"] == "field_mapping" and check["status"] == "blocked" for check in result["checks"])


def test_task_stores_goal_gate_preflight_and_creates_repair_tasks(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=True)

    task = client.post(
        "/tasks",
        json={
            "name": "上线门禁任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
        },
    ).json()

    assert task["evaluation_goal"] == "release_gate"
    assert task["quality_gate"]["pass_rate"] == 0.9
    assert task["preflight_result"]["status"] in {"passed", "warning"}

    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()

    assert repair["created_count"] >= 1
    assert client.get(f"/repair-tasks?source_task_id={executed['task_id']}").json()[0]["source_task_id"] == executed["task_id"]


def test_repair_task_status_flow_is_traceable(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    task = client.post(
        "/tasks",
        json={
            "name": "修复闭环任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.95, "max_badcase_count": 0},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()["repair_tasks"][0]

    started = client.post(f"/repair-tasks/{repair['repair_task_id']}/start", json={"owner": "qa_owner"}).json()
    assert started["status"] == "in_progress"
    assert started["owner"] == "qa_owner"
    assert started["started_at"]

    resolved = client.post(f"/repair-tasks/{repair['repair_task_id']}/resolve", json={"resolution_note": "已修复 prompt 并补充 Golden。"}).json()
    assert resolved["status"] == "resolved"
    assert resolved["resolution_note"] == "已修复 prompt 并补充 Golden。"
    assert resolved["resolved_at"]

    reopened = client.post(f"/repair-tasks/{repair['repair_task_id']}/reopen", json={"reason": "复测仍未通过。"}).json()
    assert reopened["status"] == "open"
    assert reopened["reopen_reason"] == "复测仍未通过。"
    assert reopened["reopened_at"]
