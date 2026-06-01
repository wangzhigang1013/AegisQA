from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def _base_graph() -> dict:
    return {
        "name": "发布前校验 Workflow",
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成回答",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.question"},
                "output_mapping": {"answer": "context.answer"},
                "config": {"model": "demo-model", "temperature": 0},
            },
            {
                "node_id": "judge",
                "node_type": "skill",
                "label": "裁判",
                "skill_ref": "llm.judge@0.1.0",
                "input_mapping": {"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
                "output_mapping": {"score": "metrics.score"},
                "config": {"threshold": 0.6},
            },
            {"node_id": "report", "node_type": "output", "label": "报告"},
        ],
        "edges": [
            {"source": "answer", "target": "judge"},
            {"source": "judge", "target": "report"},
        ],
    }


def _error_codes(response_json: dict) -> list[str]:
    if "errors" in response_json:
        return [item["code"] for item in response_json["errors"]]
    return [item["code"] for item in response_json["details"]["errors"]]


def test_publish_rejects_disabled_or_unapproved_skill(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    client.post("/skills/llm.call@0.1.0/disable", json={"reason": "发布前阻断测试"})

    response = client.post("/workflow-graphs/publish", json={"graph": _base_graph()})

    assert response.status_code == 400
    assert "SKILL_NOT_AVAILABLE" in _error_codes(response.json())


def test_publish_rejects_multi_input_without_join(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    graph = _base_graph()
    graph["nodes"].append(
        {
            "node_id": "rule_check",
            "node_type": "skill",
            "label": "规则检查",
            "skill_ref": "llm.judge@0.1.0",
            "input_mapping": {"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
            "output_mapping": {"score": "metrics.rule_score"},
            "config": {"threshold": 0.7},
        }
    )
    graph["edges"] = [
        {"source": "answer", "target": "judge"},
        {"source": "answer", "target": "rule_check"},
        {"source": "judge", "target": "report"},
        {"source": "rule_check", "target": "report"},
    ]

    response = client.post("/workflow-graphs/publish", json={"graph": graph})

    assert response.status_code == 400
    assert "JOIN_REQUIRED" in _error_codes(response.json())


def test_publish_rejects_branch_without_condition(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    graph = _base_graph()
    graph["nodes"].insert(0, {"node_id": "branch_low_score", "node_type": "branch", "label": "低分分支"})
    graph["edges"] = [
        {"source": "branch_low_score", "target": "answer"},
        {"source": "answer", "target": "judge"},
        {"source": "judge", "target": "report"},
    ]

    response = client.post("/workflow-graphs/publish", json={"graph": graph})

    assert response.status_code == 400
    assert "BRANCH_CONDITION_REQUIRED" in _error_codes(response.json())


def test_publish_rejects_missing_required_skill_input_mapping(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    graph = _base_graph()
    graph["nodes"][0]["input_mapping"] = {}

    validate_response = client.post("/workflow-graphs/validate", json={"graph": graph})
    publish_response = client.post("/workflow-graphs/publish", json={"graph": graph})

    assert validate_response.status_code == 200
    validation = validate_response.json()
    assert validation["ok"] is False
    assert "REQUIRED_INPUT_MAPPING_MISSING" in _error_codes(validation)
    assert publish_response.status_code == 400
    assert "REQUIRED_INPUT_MAPPING_MISSING" in _error_codes(publish_response.json())


def test_validate_accepts_node_field_reference_without_output_mapping(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    graph = _base_graph()
    graph["nodes"][0]["output_mapping"] = {}
    graph["nodes"][1]["input_mapping"]["answer"] = "answer.answer"

    response = client.post("/workflow-graphs/validate", json={"graph": graph, "sample_row": {"question": "Q", "reference": "AegisQA"}})

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["errors"] == []


def test_validate_reports_disconnected_upstream_output_reference(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    graph = _base_graph()
    graph["nodes"][0]["output_mapping"] = {}
    graph["nodes"][1]["input_mapping"]["answer"] = "answer.answer"
    graph["edges"] = [{"source": "judge", "target": "report"}]

    response = client.post("/workflow-graphs/validate", json={"graph": graph, "sample_row": {"question": "Q", "reference": "AegisQA"}})

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["errors"][0]["code"] == "UPSTREAM_OUTPUT_NOT_CONNECTED"
    assert payload["errors"][0]["node_id"] == "judge"
    assert payload["errors"][0]["details"]["missing_path"] == "answer.answer"
    assert payload["errors"][0]["details"]["referenced_node_id"] == "answer"


def test_validate_ignores_blank_optional_skill_input_mapping(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    graph = _base_graph()
    graph["nodes"][0]["input_mapping"]["variables"] = ""

    response = client.post("/workflow-graphs/validate", json={"graph": graph, "sample_row": {"question": "Q", "reference": "AegisQA"}})

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["errors"] == []


def test_validate_ignores_empty_optional_object_cell(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    graph = _base_graph()
    graph["nodes"][0]["input_mapping"]["variables"] = "row.variables"

    response = client.post("/workflow-graphs/validate", json={"graph": graph, "sample_row": {"question": "Q", "reference": "AegisQA", "variables": ""}})

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["errors"] == []


def test_validate_reports_unknown_skill_as_graph_issue(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    graph = _base_graph()
    graph["nodes"][0]["skill_ref"] = "missing.skill@9.9.9"

    validate_response = client.post("/workflow-graphs/validate", json={"graph": graph})
    publish_response = client.post("/workflow-graphs/publish", json={"graph": graph})

    assert validate_response.status_code == 200
    validation = validate_response.json()
    assert validation["ok"] is False
    assert "SKILL_NOT_FOUND" in _error_codes(validation)
    assert publish_response.status_code == 400
    assert "SKILL_NOT_FOUND" in _error_codes(publish_response.json())


def test_linear_workflow_publish_rejects_missing_required_skill_input_mapping(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    response = client.post(
        "/workflows/publish",
        json={
            "name": "兼容入口坏映射 Workflow",
            "steps": [
                {
                    "step_id": "answer",
                    "skill_ref": "llm.call@0.1.0",
                    "input_mapping": {},
                    "output_mapping": {"answer": "context.answer"},
                    "config": {"model": "demo-model"},
                }
            ],
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["code"] == "BAD_REQUEST"
    assert "Skill 必填输入未配置字段映射" in payload["message"]


def test_workflow_graph_publish_rejects_missing_required_skill_config(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    llm_manifest = app.state.registry.get_manifest("llm.call@0.1.0")
    llm_manifest.config_schema["required"] = ["model"]

    response = client.post(
        "/workflow-graphs/publish",
        json={
            "graph": {
                "name": "缺少模型参数 Workflow",
                "nodes": [
                    {
                        "node_id": "answer",
                        "node_type": "skill",
                        "label": "生成回答",
                        "skill_ref": "llm.call@0.1.0",
                        "input_mapping": {"prompt": "row.question"},
                        "output_mapping": {"answer": "context.answer"},
                        "config": {"temperature": 0},
                    },
                    {"node_id": "report", "node_type": "output", "label": "报告"},
                ],
                "edges": [{"source": "answer", "target": "report"}],
            }
        },
    )

    assert response.status_code == 400
    payload = response.json()
    error_codes = {error["code"] for error in payload["details"]["errors"]}
    assert "CONFIG_REQUIRED_MISSING" in error_codes
    assert payload["details"]["errors"][0]["details"]["missing_fields"] == ["model"]


def test_workflow_draft_delete_is_hidden_by_default_but_filterable(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    created = client.post("/workflow-drafts", json={"name": "可删除草稿", "graph": _base_graph()}).json()
    deleted = client.delete(f"/workflow-drafts/{created['draft_id']}").json()

    assert deleted["status"] == "deleted"
    assert client.get("/workflow-drafts").json() == []
    deleted_rows = client.get("/workflow-drafts", params={"status": "deleted"}).json()
    assert [row["draft_id"] for row in deleted_rows] == [created["draft_id"]]


def test_publish_workflow_draft_returns_structured_validation_errors(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    graph = _base_graph()
    graph["nodes"][0]["input_mapping"] = {}
    created = client.post("/workflow-drafts", json={"name": "坏映射草稿", "graph": graph}).json()

    response = client.post(f"/workflow-drafts/{created['draft_id']}/publish")

    assert response.status_code == 400
    payload = response.json()
    assert payload["code"] == "HTTP_ERROR"
    assert payload["message"] == "Workflow Graph 校验失败"
    assert "REQUIRED_INPUT_MAPPING_MISSING" in {error["code"] for error in payload["details"]["errors"]}
