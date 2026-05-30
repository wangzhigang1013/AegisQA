import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def _write_jsonl(path: Path) -> None:
    rows = [
        {"question": "什么是 Trace?", "reference": "AegisQA", "expected_label": "pass", "scene": "trace"},
        {"question": "什么是坏例?", "reference": "不存在的参考词", "expected_label": "fail", "scene": "trace"},
    ]
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _graph_payload() -> dict:
    return {
        "name": "Trace Flow Workflow",
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成回答",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.question"},
                "output_mapping": {"answer": "context.answer", "tokens": "metrics.tokens"},
                "config": {"model": "trace-model", "temperature": 0},
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


def test_task_trace_flow_explains_dataset_step_metrics_and_badcase(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "trace.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "trace_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "Trace 任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()

    trace_flow = client.get(f"/tasks/{task['task_id']}/trace-flow").json()

    assert trace_flow["task"]["task_id"] == task["task_id"]
    assert trace_flow["dataset"]["version_id"] == dataset["version_id"]
    assert trace_flow["workflow"]["version_id"] == workflow["version_id"]
    assert trace_flow["attempt"]["run_id"] == executed["run_id"]
    assert trace_flow["queue_message_shape"] == ["item_id"]
    assert trace_flow["data_edges"][0] == {"source": "dataset.row", "target": "answer.input"}

    first_item = trace_flow["items"][0]
    assert first_item["row"]["question"] == "什么是 Trace?"
    assert first_item["steps"][0]["step_id"] == "answer"
    assert first_item["steps"][0]["input"]["prompt"] == "什么是 Trace?"
    assert first_item["steps"][0]["resolved_config"]["model"] == "trace-model"
    assert first_item["steps"][0]["parameter_trace"]["model"]["source"] == "workflow_config"
    assert "answer" in first_item["steps"][0]["output"]
    assert "tokens" in first_item["metrics"]

    failed_item = next(item for item in trace_flow["items"] if item["badcase"]["is_badcase"])
    assert failed_item["badcase"]["reason"] == "judge_label=fail"
