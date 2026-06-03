import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def _write_jsonl(path: Path) -> None:
    rows = [
        {"question": "什么是 AegisQA?", "reference": "AegisQA", "expected_label": "pass"},
        {"question": "什么是 Badcase?", "reference": "坏例", "expected_label": "fail"},
    ]
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _graph_payload() -> dict:
    return {
        "name": "图形化 RAG 回归评测",
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
                "node_id": "judge_a",
                "node_type": "skill",
                "label": "裁判 A",
                "skill_ref": "llm.judge@0.1.0",
                "input_mapping": {"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
                "output_mapping": {"score": "metrics.judge_a_score", "label": "context.judge_a_label"},
                "config": {"threshold": 0.6},
            },
            {
                "node_id": "judge_b",
                "node_type": "skill",
                "label": "裁判 B",
                "skill_ref": "llm.judge@0.1.0",
                "input_mapping": {"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
                "output_mapping": {"score": "metrics.judge_b_score", "label": "context.judge_b_label"},
                "config": {"threshold": 0.7},
            },
            {"node_id": "join_quality", "node_type": "join", "label": "合并裁判结果"},
            {"node_id": "report", "node_type": "output", "label": "输出报告"},
        ],
        "edges": [
            {"source": "answer", "target": "judge_a"},
            {"source": "answer", "target": "judge_b"},
            {"source": "judge_a", "target": "join_quality"},
            {"source": "judge_b", "target": "join_quality"},
            {"source": "join_quality", "target": "report"},
        ],
    }


def test_workflow_graph_validate_publish_and_dry_run_contract(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "rag.jsonl"
    _write_jsonl(data_path)
    dataset = client.post("/datasets/from-path", json={"name": "graph_rag", "path": str(data_path)}).json()

    validate_response = client.post("/workflow-graphs/validate", json={"graph": _graph_payload(), "sample_row": {"question": "Q", "reference": "A"}})
    assert validate_response.status_code == 200
    validation = validate_response.json()
    assert validation["ok"] is True
    assert validation["execution_levels"] == [["answer"], ["judge_a", "judge_b"], ["join_quality"], ["report"]]
    assert validation["graph_tips"][0]["title"] == "点对多"

    publish_response = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()})
    assert publish_response.status_code == 200
    workflow = publish_response.json()
    assert workflow["name"] == "图形化 RAG 回归评测"
    assert [step["step_id"] for step in workflow["steps"]] == ["answer", "judge_a", "judge_b"]
    assert workflow["graph"]["nodes"][0]["node_id"] == "answer"

    dry_run = client.post(
        "/workflow-graphs/dry-run",
        json={"graph": _graph_payload(), "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"], "sample_size": 1},
    ).json()
    assert dry_run["status"] == "completed"
    assert dry_run["queue_messages"] == [{"item_id": dry_run["items"][0]["item_id"]}]


def test_workflow_graph_rejects_unsafe_shapes_and_type_mismatch(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    graph = _graph_payload()
    graph["nodes"] = [node for node in graph["nodes"] if node["node_id"] != "join_quality"]
    graph["edges"] = [
        {"source": "answer", "target": "judge_a"},
        {"source": "answer", "target": "judge_b"},
        {"source": "judge_a", "target": "report"},
        {"source": "judge_b", "target": "report"},
    ]

    join_error = client.post("/workflow-graphs/validate", json={"graph": graph}).json()
    assert join_error["ok"] is False
    assert join_error["errors"][0]["code"] == "JOIN_REQUIRED"
    assert "join" in join_error["errors"][0]["details"]["allowed_node_types"]

    cyclic = _graph_payload()
    cyclic["edges"].append({"source": "report", "target": "answer"})
    cycle_error = client.post("/workflow-graphs/validate", json={"graph": cyclic}).json()
    assert cycle_error["ok"] is False
    assert cycle_error["errors"][0]["code"] == "DAG_CYCLE"

    mismatch = client.post("/workflow-graphs/validate", json={"graph": _graph_payload(), "sample_row": {"question": 123, "reference": "A"}}).json()
    assert mismatch["ok"] is False
    assert mismatch["errors"][0]["code"] == "TYPE_MISMATCH"
    assert mismatch["errors"][0]["details"]["field_path"] == "prompt"


def test_source_materialize_trace_badcase_filter_and_error_contract(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    materialized = client.post(
        "/datasets/source-materialize",
        json={
            "name": "source_rows",
            "rows": [{"question": "Q1", "reference": "AegisQA", "expected_label": "pass"}],
            "golden": True,
            "label_field": "expected_label",
        },
    ).json()
    assert materialized["row_count"] == 1
    assert materialized["field_paths"] == ["row.expected_label", "row.question", "row.reference"]

    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    run = client.post(
        "/runs",
        json={"workflow": workflow, "dataset_id": materialized["dataset_id"], "dataset_version": materialized["version"]},
    ).json()
    executed = client.post(f"/runs/{run['run_id']}/execute").json()
    trace = client.get(f"/runs/{executed['run_id']}/trace").json()
    assert trace["run_id"] == executed["run_id"]
    assert trace["queue_message_shape"] == ["item_id"]
    assert trace["items"][0]["steps"][0]["input_snapshot"]["prompt"] == "Q1"

    created_badcase = client.post(
        "/badcases",
        json={
            "run_id": executed["run_id"],
            "item_id": executed["items"][0]["item_id"],
            "reason": "judge_label=fail",
            "payload": {
                "skill": "llm.judge@0.1.0",
                "score": 0.4,
                "question": "Q1",
                "source": "step",
                "source_id": executed["items"][0]["steps"][0]["step_id"],
                "evidence": {"score": 0.4},
            },
        },
    ).json()
    badcases = client.get("/badcases", params={"status": "pending_review", "skill": "llm.judge@0.1.0", "min_score": 0.2}).json()
    assert [item["badcase_id"] for item in badcases] == [created_badcase["badcase_id"]]

    missing = client.get("/runs/run-missing")
    assert missing.status_code == 404
    error = missing.json()
    assert error["code"] == "NOT_FOUND"
    assert error["message"] == "Run 不存在：run-missing"
    assert error["trace_id"].startswith("trace_")
