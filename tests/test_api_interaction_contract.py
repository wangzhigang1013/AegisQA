import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def _write_jsonl(path: Path) -> None:
    rows = [
        {"question": "什么是 AegisQA?", "reference": "AI 评测平台", "expected_label": "pass"},
        {"question": "什么是 Workflow?", "reference": "流程编排", "expected_label": "pass"},
    ]
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _graph_payload() -> dict:
    return {
        "name": "交互回归 Workflow",
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
        "edges": [
            {"source": "answer", "target": "judge"},
            {"source": "judge", "target": "report"},
        ],
    }


def test_frontend_list_and_summary_api_contract(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "dataset.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "interaction_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    run = client.post("/runs", json={"workflow": workflow, "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"]}).json()
    executed = client.post(f"/runs/{run['run_id']}/execute").json()

    datasets = client.get("/datasets").json()
    assert datasets[0]["dataset_id"] == dataset["dataset_id"]
    assert datasets[0]["versions"][0]["version_id"] == dataset["version_id"]
    assert "row.question" in datasets[0]["versions"][0]["field_paths"]

    workflows = client.get("/workflows").json()
    assert workflows[0]["version_id"] == workflow["version_id"]
    assert workflows[0]["graph"]["name"] == "交互回归 Workflow"

    runs = client.get("/runs").json()
    assert runs[0]["run_id"] == executed["run_id"]
    assert runs[0]["status"] == "completed"

    summary = client.get("/dashboard/summary").json()
    assert summary["dataset_count"] == 1
    assert summary["workflow_count"] == 1
    assert summary["run_count"] == 1
    assert summary["latest_run"]["run_id"] == executed["run_id"]


def test_workflow_draft_skill_contract_and_run_controls(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "dataset.jsonl"
    _write_jsonl(data_path)
    dataset = client.post("/datasets/from-path", json={"name": "control_dataset", "path": str(data_path)}).json()

    draft = client.post("/workflow-drafts", json={"name": "草稿流程", "graph": _graph_payload()}).json()
    assert draft["status"] == "draft"
    assert draft["graph"]["nodes"][0]["node_id"] == "answer"

    updated_graph = _graph_payload()
    updated_graph["name"] = "草稿流程已修改"
    updated = client.put(f"/workflow-drafts/{draft['draft_id']}", json={"name": "草稿流程已修改", "graph": updated_graph}).json()
    assert updated["graph"]["name"] == "草稿流程已修改"
    assert client.get("/workflow-drafts").json()[0]["draft_id"] == draft["draft_id"]

    published = client.post(f"/workflow-drafts/{draft['draft_id']}/publish").json()
    assert published["name"] == "草稿流程已修改"

    contract = client.post("/skills/llm.call@0.1.0/contract-test").json()
    assert contract["ok"] is True
    assert contract["skill_id"] == "llm.call@0.1.0"

    run = client.post("/runs", json={"workflow": published, "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"]}).json()
    paused = client.post(f"/runs/{run['run_id']}/pause").json()
    assert paused["status"] == "paused"
    resumed = client.post(f"/runs/{run['run_id']}/resume").json()
    assert resumed["status"] == "completed"
    canceled = client.post(f"/runs/{run['run_id']}/cancel").json()
    assert canceled["status"] == "canceled"


def test_badcase_judge_and_export_actions(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    badcase = client.post(
        "/badcases",
        json={"run_id": "run-demo", "item_id": "item-demo", "reason": "judge_label=fail", "payload": {"question": "Q", "score": 0.2}},
    ).json()
    reopened = client.post(f"/badcases/{badcase['badcase_id']}/reopen").json()
    assert reopened["status"] == "reopened"

    bulk = client.post(
        "/badcases/bulk-correct",
        json={
            "badcase_ids": [badcase["badcase_id"]],
            "human_label": "fail",
            "problem_type": "reference_miss",
            "note": "人工确认",
            "add_to_golden": True,
        },
    ).json()
    assert bulk[0]["status"] == "accepted_to_golden"

    clusters = client.get("/badcases/clusters").json()
    assert clusters[0]["count"] == 1

    exported = client.get("/badcases/export", params={"file_format": "jsonl"}).json()
    assert exported["row_count"] == 1
    assert exported["content"].startswith("{")

    profile = client.post(
        "/judge-profiles",
        json={"name": "默认裁判", "model": "demo", "prompt": "judge", "rubric": {"pass": "正确"}, "threshold": 0.6, "output_schema": {"type": "object"}},
    ).json()
    audit = client.post(
        f"/judge-profiles/{profile['profile_id']}/audits",
        json={"dataset_version_id": "dataset:v1", "human_labels": ["pass", "fail"], "judge_labels": ["pass", "pass"]},
    ).json()
    assert client.get("/judge-profiles").json()[0]["profile_id"] == profile["profile_id"]
    assert client.get("/judge-audits").json()[0]["audit_id"] == audit["audit_id"]

