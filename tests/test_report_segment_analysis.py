import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def test_task_report_returns_segment_analysis_and_recommendations(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "segments.jsonl"
    rows = [
        {
            "question": "什么是 AegisQA?",
            "reference": "AegisQA",
            "expected_label": "pass",
            "scene": "faq",
            "model_version": "gpt-4o-mini",
            "prompt_version": "prompt-v1",
        },
        {
            "question": "支付失败怎么办?",
            "reference": "完全不相关的标准答案",
            "expected_label": "fail",
            "scene": "payment",
            "model_version": "gpt-4o-mini",
            "prompt_version": "prompt-v1",
        },
    ]
    with data_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    dataset = client.post("/datasets/from-path", json={"name": "segment_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "分层报告任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
        },
    ).json()
    client.post(f"/tasks/{task['task_id']}/execute")

    report = client.get(f"/tasks/{task['task_id']}/report").json()

    payment_segment = next(item for item in report["segments"] if item["segment_key"] == "scene" and item["segment_value"] == "payment")
    assert payment_segment["sample_count"] == 1
    assert payment_segment["pass_rate"] == 0
    assert payment_segment["badcase_count"] == 1
    model_segment = next(item for item in report["segments"] if item["segment_key"] == "model_version")
    assert model_segment["sample_count"] == 2
    assert {item["action"] for item in report["recommendations"]} >= {"add_to_annotation_queue", "create_golden_candidates", "create_ci_gate"}


def _graph_payload() -> dict:
    return {
        "name": "报告分层 Workflow",
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
