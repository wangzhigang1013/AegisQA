import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def _write_jsonl(path: Path) -> None:
    rows = [
        {"question": "AegisQA 是什么?", "reference": "AegisQA", "expected_label": "pass"},
        {"question": "这个回答会失败吗?", "reference": "不存在的参考词", "expected_label": "fail"},
    ]
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def test_api_runs_full_mvp_flow(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "rag.jsonl"
    _write_jsonl(data_path)

    assert client.get("/health").json()["status"] == "ok"
    skills = client.get("/skills").json()
    assert "llm.call@0.1.0" in {skill["skill_id"] for skill in skills}

    dataset_response = client.post(
        "/datasets/from-path",
        json={"name": "api_rag", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    )
    assert dataset_response.status_code == 200
    dataset = dataset_response.json()
    assert dataset["row_count"] == 2

    corrected_schema = client.post(
        f"/datasets/{dataset['dataset_id']}/versions/{dataset['version']}/fields/expected_label",
        json={"field_type": "enum:pass,fail"},
    ).json()
    assert corrected_schema["field_schema"]["expected_label"] == "enum:pass,fail"

    templates = client.get("/workflow-templates").json()
    assert "rag_regression" in {template["template_id"] for template in templates}
    rag_template = next(template for template in templates if template["template_id"] == "rag_regression")
    assert rag_template["graph"]["nodes"]
    assert rag_template["graph"]["edges"]
    assert any(node["skill_ref"] == "llm.call@0.1.0" for node in rag_template["graph"]["nodes"] if node["node_type"] == "skill")

    workflow_response = client.post(
        "/workflows/publish",
        json={
            "name": "api_rag_regression",
            "steps": [
                {
                    "step_id": "answer",
                    "skill_ref": "llm.call@0.1.0",
                    "input_mapping": {"prompt": "row.question"},
                    "output_mapping": {"answer": "context.answer", "tokens": "metrics.tokens"},
                    "config": {"model": "demo-model", "temperature": 0},
                    "cacheable": True,
                },
                {
                    "step_id": "judge",
                    "skill_ref": "llm.judge@0.1.0",
                    "input_mapping": {"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
                    "output_mapping": {"score": "metrics.judge_score", "label": "context.judge_label", "reason": "context.judge_reason"},
                    "config": {"threshold": 0.6},
                },
            ],
        },
    )
    assert workflow_response.status_code == 200
    workflow = workflow_response.json()

    copied = client.post(f"/workflows/{workflow['version_id']}/copy", json={"name": "复制 API Workflow"}).json()
    assert copied["name"] == "复制 API Workflow"

    run_response = client.post(
        "/runs",
        json={
            "workflow": workflow,
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "chunk_size": 1,
            "concurrency": 2,
        },
    )
    assert run_response.status_code == 200
    run = run_response.json()
    assert run["queue_messages"] == [{"item_id": run["items"][0]["item_id"]}, {"item_id": run["items"][1]["item_id"]}]

    executed = client.post(f"/runs/{run['run_id']}/execute").json()
    assert executed["status"] == "completed"

    paused_run = client.post(
        "/runs",
        json={
            "workflow": workflow,
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
        },
    ).json()
    assert client.post(f"/runs/{paused_run['run_id']}/pause").json()["status"] == "paused"
    assert client.post(f"/runs/{paused_run['run_id']}/resume").json()["status"] == "completed"

    report = client.get(f"/runs/{run['run_id']}/report").json()
    assert report["total_items"] == 2
    assert report["error_rate"] == 0
    assert "pass_rate" in report["metrics"]

    audit = client.post(
        "/judge-audits",
        json={
            "judge_profile_id": "judge-api-v1",
            "dataset_version_id": dataset["version_id"],
            "human_labels": ["pass", "fail"],
            "judge_labels": ["pass", "pass"],
            "positive_label": "pass",
        },
    ).json()
    assert audit["accuracy"] == 0.5
    assert audit["confusion_matrix"]["fail"]["pass"] == 1

    profile = client.post(
        "/judge-profiles",
        json={
            "name": "API Judge",
            "model": "judge-model",
            "prompt": "判断是否通过",
            "rubric": {"pass": "通过", "fail": "失败"},
            "threshold": 0.6,
            "output_schema": {"type": "object", "properties": {"label": {"type": "string"}}},
        },
    ).json()
    stored_audit = client.post(
        f"/judge-profiles/{profile['profile_id']}/audits",
        json={
            "dataset_version_id": dataset["version_id"],
            "human_labels": ["pass", "fail"],
            "judge_labels": ["pass", "pass"],
            "positive_label": "pass",
        },
    ).json()
    bias = client.get(f"/judge-audits/{stored_audit['audit_id']}/bias").json()
    assert bias["label_bias"]["pass"]["false_positive"] == 1

    access = client.get("/access/check", params={"role": "Viewer", "permission": "workflow:publish"}).json()
    assert access["allowed"] is False


def test_audit_events_can_be_filtered_by_actor_and_action(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    client.app.state.audit_service.record(actor="api", action="task.create", target="task-a")
    client.app.state.audit_service.record(actor="api", action="task.create", target="task-b")
    client.app.state.audit_service.record(actor="operator", action="skill.approve", target="skill-a")

    response = client.get("/audit-events", params={"actor": "api", "action": "task.create", "target": "task-b"})

    assert response.status_code == 200
    events = response.json()
    assert [event["target"] for event in events] == ["task-b"]


def test_governance_runtime_status_reports_current_boundaries(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    response = client.get("/governance/runtime-status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["storage"]["backend"] == "json"
    assert payload["storage"]["status"] == "available"
    assert payload["executor"]["backend"] == "local_thread"
    assert payload["executor"]["status"] in {"demo", "available"}
    assert payload["model_gateway"]["provider"] == "mock"
    assert payload["model_gateway"]["status"] == "demo"
    assert payload["skill_sandbox"]["mode"] == "subprocess"
    assert payload["skill_sandbox"]["permissions_required"] is True
    assert payload["external_services"]["mysql"]["status"] == "not_connected"
    assert payload["external_services"]["redis"]["status"] == "not_connected"
    assert payload["external_services"]["celery"]["status"] in {"not_connected", "configured"}
    components = {component["component_id"]: component for component in payload["components"]}
    assert set(components) == {"storage", "executor", "model_gateway", "skill_sandbox", "mysql", "redis", "celery"}
    for component in components.values():
        assert component["status_label"] in {"可用", "演示", "未接入", "未配置", "已配置"}
        assert component["doc_url"]
        assert "config_url" in component
    assert components["mysql"]["status"] == "not_connected"
    assert components["mysql"]["status_label"] == "未接入"
    assert components["redis"]["status"] == "not_connected"
    assert components["redis"]["status_label"] == "未接入"
    assert components["storage"]["config_url"] == "/governance#runtime-storage"
    assert components["model_gateway"]["config_url"] == "/governance#model-gateway"


def test_root_endpoint_points_user_to_frontend_and_docs(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "AegisQA"
    assert payload["status"] == "ok"
    assert payload["frontend_url"] == "http://localhost:5173"
    assert payload["docs_url"] == "/docs"
