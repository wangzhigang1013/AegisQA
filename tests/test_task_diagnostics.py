import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _graph_payload(name: str = "诊断 Workflow") -> dict[str, object]:
    return {
        "name": name,
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成回答",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.question"},
                "output_mapping": {"answer": "context.answer", "tokens": "metrics.tokens"},
                "config": {"model": "diagnostic-model", "temperature": 0, "prompt_version": "prompt-diagnostic-v1"},
                "cacheable": True,
            },
            {
                "node_id": "judge",
                "node_type": "skill",
                "label": "裁判",
                "skill_ref": "llm.judge@0.1.0",
                "input_mapping": {"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
                "output_mapping": {"score": "metrics.judge_score", "label": "context.judge_label"},
                "config": {"threshold": 0.6, "prompt_version": "judge-diagnostic-v1"},
            },
            {"node_id": "report", "node_type": "output", "label": "报告"},
        ],
        "edges": [{"source": "answer", "target": "judge"}, {"source": "judge", "target": "report"}],
    }


def _seed_task(
    tmp_path: Path,
    *,
    rows: list[dict[str, object]],
    skill_overrides: dict[str, dict[str, object]] | None = None,
) -> tuple[TestClient, dict[str, object]]:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "diagnostics.jsonl"
    _write_jsonl(data_path, rows)
    dataset = client.post(
        "/datasets/from-path",
        json={"name": "diagnostics", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "诊断任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "skill_overrides": skill_overrides or {},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    return client, executed


def test_task_report_returns_root_cause_diagnostics(tmp_path: Path) -> None:
    client, task = _seed_task(
        tmp_path,
        rows=[
            {"question": "AegisQA 是什么?", "reference": "AegisQA", "expected_label": "pass", "scene": "faq"},
            {"question": "支付失败怎么办?", "reference": "完全不相关答案", "expected_label": "fail", "scene": "payment"},
            {"question": "支付超时怎么办?", "reference": "完全不相关答案", "expected_label": "fail", "scene": "payment"},
        ],
    )

    response = client.get(f"/tasks/{task['task_id']}/report")

    assert response.status_code == 200
    diagnostics = response.json()["diagnostics"]
    assert diagnostics["summary"]["status"] in {"needs_attention", "healthy"}
    assert diagnostics["summary"]["primary_cause"] in {"judge_or_answer_quality", "runtime_error", "weak_segment", "data_quality", "healthy"}
    assert diagnostics["summary"]["evidence_count"] >= 1
    assert diagnostics["root_causes"]
    assert any(item["cause_type"] == "weak_segment" for item in diagnostics["root_causes"])
    assert diagnostics["step_health"][0]["step_id"]


def test_task_diagnostics_endpoint_explains_data_quality_and_parameters(tmp_path: Path) -> None:
    client, task = _seed_task(
        tmp_path,
        rows=[
            {"question": "缺少 reference 的样本", "expected_label": "fail", "scene": "data_quality"},
            {"question": "缺少 reference 的样本", "expected_label": "fail", "scene": "data_quality"},
            {"question": "正常样本", "reference": "AegisQA", "expected_label": "pass", "scene": "faq"},
        ],
        skill_overrides={"answer": {"temperature": 0.2}},
    )

    response = client.get(f"/tasks/{task['task_id']}/diagnostics")

    assert response.status_code == 200
    diagnostics = response.json()
    assert any(item["cause_type"] == "data_quality" for item in diagnostics["root_causes"])
    assert diagnostics["data_quality"]["duplicate_row_count"] >= 1
    reference_field = next(item for item in diagnostics["data_quality"]["field_coverage"] if item["field"] == "reference")
    assert reference_field["missing_count"] == 2
    assert diagnostics["parameter_risks"]["override_count"] >= 1
    assert diagnostics["parameter_risks"]["sources"]["task_override"] >= 1
