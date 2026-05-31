import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _graph_payload() -> dict:
    return {
        "name": "可信评测 Workflow",
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成回答",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.question"},
                "output_mapping": {"answer": "context.answer", "tokens": "metrics.tokens"},
                "config": {"model": "quality-model", "prompt_version": "prompt-v2", "temperature": 0},
                "cacheable": True,
            },
            {
                "node_id": "judge",
                "node_type": "skill",
                "label": "裁判",
                "skill_ref": "llm.judge@0.1.0",
                "input_mapping": {"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
                "output_mapping": {"score": "metrics.judge_score", "label": "context.judge_label"},
                "config": {"threshold": 0.6, "prompt_version": "judge-rubric-v1"},
            },
            {"node_id": "report", "node_type": "output", "label": "报告"},
        ],
        "edges": [{"source": "answer", "target": "judge"}, {"source": "judge", "target": "report"}],
    }


def _seed_executed_task(tmp_path: Path) -> tuple[TestClient, dict, dict, dict]:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "trusted.jsonl"
    rows = [
        {"question": "什么是 AegisQA?", "reference": "AegisQA", "expected_label": "pass", "scene": "faq"},
        {"question": "支付失败怎么办?", "reference": "完全不相关的标准答案", "expected_label": "fail", "scene": "payment"},
    ]
    _write_jsonl(data_path, rows)

    dataset = client.post(
        "/datasets/from-path",
        json={"name": "trusted_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "可信评测任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "skill_overrides": {"answer": {"model": "task-quality-model"}},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    return client, dataset, workflow, executed


def test_dataset_lineage_tracks_source_fields_and_downstream_tasks(tmp_path: Path) -> None:
    client, dataset, _, task = _seed_executed_task(tmp_path)

    response = client.get(f"/datasets/{dataset['dataset_id']}/versions/{dataset['version']}/lineage")

    assert response.status_code == 200
    lineage = response.json()
    assert lineage["dataset_version_id"] == dataset["version_id"]
    assert lineage["source"]["type"] == "file_upload"
    assert lineage["source"]["ref"]["filename"] == "trusted.jsonl"
    assert lineage["field_count"] == 4
    assert lineage["fields"]["question"] == "text"
    assert lineage["downstream_tasks"][0]["task_id"] == task["task_id"]
    assert lineage["downstream_tasks"][0]["workflow_version_id"] == task["workflow_version_id"]


def test_task_report_returns_quality_decision_and_parameter_governance(tmp_path: Path) -> None:
    client, _, _, task = _seed_executed_task(tmp_path)

    response = client.get(f"/tasks/{task['task_id']}/report")

    assert response.status_code == 200
    report = response.json()
    assert report["quality_decision"]["status"] in {"passed", "warning", "blocked"}
    assert report["quality_decision"]["next_actions"]
    assert report["quality_decision"]["risk_summary"]["badcase_count"] >= 1
    assert report["parameter_governance"]["prompt_skill_versions"][0]["skill_ref"] == "llm.call@0.1.0"
    assert report["parameter_governance"]["prompt_skill_versions"][0]["prompt_version"] == "prompt-v2"
    answer_sources = next(item for item in report["parameter_governance"]["parameter_sources"] if item["step_id"] == "answer")
    assert answer_sources["parameters"]["model"]["source"] == "task_override"


def test_task_parameter_governance_endpoint_explains_runtime_sources(tmp_path: Path) -> None:
    client, _, _, task = _seed_executed_task(tmp_path)

    response = client.get(f"/tasks/{task['task_id']}/parameter-governance")

    assert response.status_code == 200
    governance = response.json()
    assert governance["task_id"] == task["task_id"]
    assert governance["run_id"] == task["run_id"]
    assert governance["execution_config"]["skill_overrides"]["answer"]["model"] == "task-quality-model"
    assert governance["parameter_sources"][0]["parameters"]
    assert governance["secret_policy"]["redacted"] is True


def test_judge_cross_validation_returns_pairwise_agreement(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    response = client.post(
        "/judge-cross-validation",
        json={
            "dataset_version_id": "golden:v1",
            "human_labels": ["pass", "fail"],
            "judge_outputs_by_profile": {
                "judge-a": ["pass", "fail"],
                "judge-b": ["pass", "pass"],
            },
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert result["dataset_version_id"] == "golden:v1"
    assert result["profile_count"] == 2
    assert result["pairwise_agreement"]["judge-a|judge-b"] == 0.5
    assert result["audits"]["judge-a"]["accuracy"] == 1.0
