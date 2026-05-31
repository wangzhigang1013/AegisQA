import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def _write_jsonl(path: Path, count: int = 12) -> None:
    rows = [
        {
            "question": f"第 {index} 条调用树样本是什么?",
            "reference": "AegisQA" if index % 2 == 0 else "Badcase",
            "expected_label": "pass" if index % 2 == 0 else "fail",
        }
        for index in range(count)
    ]
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _graph_payload() -> dict:
    return {
        "name": "Trace Tree Pagination Workflow",
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成回答",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.question"},
                "output_mapping": {"answer": "context.answer", "tokens": "metrics.tokens"},
                "config": {"model": "trace-tree-model", "temperature": 0},
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


def test_run_trace_tree_supports_server_side_pagination(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "trace_tree_run.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "trace_tree_run", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    run = client.post("/runs", json={"workflow": workflow, "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"]}).json()
    executed = client.post(f"/runs/{run['run_id']}/execute").json()

    trace_tree = client.get(f"/runs/{executed['run_id']}/trace-tree?page=2&page_size=5").json()

    assert trace_tree["pagination"] == {"page": 2, "page_size": 5, "total_items": 12, "total_pages": 3}
    assert [item["row_id"] for item in trace_tree["items"]] == ["6", "7", "8", "9", "10"]
    assert trace_tree["items"][0]["children"][0]["skill_ref"] == "llm.call@0.1.0"


def test_task_trace_tree_supports_server_side_pagination(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "trace_tree_task.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "trace_tree_task", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "Trace Tree 分页任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
        },
    ).json()
    client.post(f"/tasks/{task['task_id']}/execute")

    trace_tree = client.get(f"/tasks/{task['task_id']}/trace-tree?page=3&page_size=4").json()

    assert trace_tree["pagination"] == {"page": 3, "page_size": 4, "total_items": 12, "total_pages": 3}
    assert [item["row_id"] for item in trace_tree["items"]] == ["9", "10", "11", "12"]
