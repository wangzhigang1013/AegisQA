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
