import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def _write_badcase_jsonl(path: Path, count: int = 12) -> None:
    rows = [
        {
            "question": f"第 {index} 条坏例样本",
            "reference": "不存在的参考答案",
            "expected_label": "fail",
            "scene": "report_badcase",
        }
        for index in range(count)
    ]
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _graph_payload() -> dict:
    return {
        "name": "Task Report Badcase Pagination Workflow",
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成回答",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.question"},
                "output_mapping": {"answer": "context.answer", "tokens": "metrics.tokens"},
                "config": {"model": "report-badcase-model", "temperature": 0},
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


def test_task_report_badcases_are_paginated_without_truncating_export(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "report_badcases.jsonl"
    _write_badcase_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "report_badcases", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "报告坏例分页任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
        },
    ).json()
    client.post(f"/tasks/{task['task_id']}/execute")

    report_page = client.get(f"/tasks/{task['task_id']}/report?badcase_page=2&badcase_page_size=5").json()

    assert report_page["badcase_pagination"] == {"page": 2, "page_size": 5, "total_items": 12, "total_pages": 3}
    assert len(report_page["badcases"]) == 5
    assert len(report_page["report"]["badcases"]) == 5
    assert report_page["task"]["badcase_count"] == 12

    exported = client.get(f"/tasks/{task['task_id']}/report/export", params={"file_format": "json"}).json()
    assert len(exported["content"]["badcases"]) == 12
    assert exported["content"]["badcase_pagination"]["total_items"] == 12
    artifact = exported["artifact"]
    assert artifact["kind"] == "reports"
    assert artifact["artifact_id"] == f"tasks/{task['task_id']}/reports/report.json"
    saved_report = json.loads(client.app.state.artifact_store.read_bytes(artifact["kind"], artifact["artifact_id"]).decode("utf-8"))
    assert saved_report["task"]["task_id"] == task["task_id"]
    assert len(saved_report["badcases"]) == 12
