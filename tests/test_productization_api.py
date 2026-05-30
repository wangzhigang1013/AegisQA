import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


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
        "name": "产品化增强验证 Workflow",
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


def _executed_run(client: TestClient, tmp_path: Path) -> dict:
    data_path = tmp_path / "productization.jsonl"
    _write_jsonl(data_path)
    dataset = client.post("/datasets/from-path", json={"name": "productization_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    run = client.post("/runs", json={"workflow": workflow, "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"]}).json()
    return client.post(f"/runs/{run['run_id']}/execute").json()


def test_experiment_snapshot_and_trace_tree_are_created_from_run(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    run = _executed_run(client, tmp_path)

    experiment = client.post("/experiments/from-run", json={"run_id": run["run_id"], "name": "主链路实验", "baseline_run_id": None}).json()
    assert experiment["run_id"] == run["run_id"]
    assert experiment["snapshot"]["workflow_version"] == run["workflow"]["version_id"]
    assert experiment["metrics"]["pass_rate"] == 0.5
    assert client.get("/experiments").json()[0]["experiment_id"] == experiment["experiment_id"]

    trace_tree = client.get(f"/runs/{run['run_id']}/trace-tree").json()
    assert trace_tree["run_id"] == run["run_id"]
    assert trace_tree["items"][0]["children"][0]["skill_ref"] == "llm.call@0.1.0"
    assert "latency_ms" in trace_tree["items"][0]["children"][0]


def test_assertion_dsl_and_ci_gate_return_actionable_results(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    assertion_result = client.post(
        "/assertions/evaluate",
        json={
            "payload": {"answer": "AegisQA 可以做 AI 评测", "latency_ms": 120, "cost": 0.03},
            "assertions": [
                {"assertion_id": "contains-aegis", "type": "contains", "field_path": "answer", "expected": "AegisQA"},
                {"assertion_id": "latency-budget", "type": "latency", "field_path": "latency_ms", "max": 200},
                {"assertion_id": "regex-quality", "type": "regex", "field_path": "answer", "pattern": "AI.*评测"},
            ],
        },
    ).json()
    assert assertion_result["ok"] is True
    assert [item["status"] for item in assertion_result["results"]] == ["passed", "passed", "passed"]

    gate_result = client.post(
        "/ci-gates/evaluate",
        json={
            "metrics": {"pass_rate": 0.78, "redteam_failures": 0, "p95_latency_ms": 450},
            "gates": [
                {"gate_id": "pass-rate", "metric": "pass_rate", "operator": ">=", "threshold": 0.8, "blocking": True},
                {"gate_id": "redteam", "metric": "redteam_failures", "operator": "<=", "threshold": 0, "blocking": True},
            ],
        },
    ).json()
    assert gate_result["status"] == "blocked"
    assert gate_result["results"][0]["message"].startswith("质量门禁未通过")


def test_annotation_queue_supports_assignment_and_review(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    run = _executed_run(client, tmp_path)

    seed = client.post("/annotation-queue/seed-from-run", json={"run_id": run["run_id"], "strategy": "failed_or_low_score", "limit": 5}).json()
    assert seed["created_count"] == 1
    task = client.get("/annotation-queue").json()[0]
    assert task["status"] == "pending"

    assigned = client.post(f"/annotation-queue/{task['task_id']}/assign", json={"assignee": "qa_owner"}).json()
    assert assigned["status"] == "assigned"
    assert assigned["assignee"] == "qa_owner"

    reviewed = client.post(
        f"/annotation-queue/{task['task_id']}/review",
        json={"human_label": "fail", "note": "人工确认参考缺失", "add_to_golden": True},
    ).json()
    assert reviewed["status"] == "reviewed"
    assert reviewed["review"]["add_to_golden"] is True
