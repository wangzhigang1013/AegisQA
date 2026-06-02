from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
from aegisqa.models.gateway import ModelGateway, ModelGatewayConfig


def test_model_gateway_mock_provider_is_offline_and_deterministic() -> None:
    gateway = ModelGateway(ModelGatewayConfig(provider="mock", default_model="mock-eval-model"))

    response = gateway.generate(prompt="什么是 AegisQA?", temperature=0)

    assert response.provider == "mock"
    assert response.model == "mock-eval-model"
    assert response.text.startswith("模型回答：什么是 AegisQA?")
    assert response.usage["total_tokens"] > 0


def test_model_gateway_api_status_test_and_builtin_skill_contract(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    status = client.get("/model-gateway/status").json()
    assert status["provider"] == "mock"
    assert status["ready"] is True
    assert status["default_model"]
    assert status["skill_ref"] == "model.chat@0.1.0"

    probe = client.post("/model-gateway/test", json={"prompt": "用一句话介绍模型网关。"}).json()
    assert probe["ok"] is True
    assert probe["response"]["provider"] == "mock"
    assert "模型回答" in probe["response"]["text"]

    skill_ids = {skill["skill_id"] for skill in client.get("/skills").json()}
    assert "model.chat@0.1.0" in skill_ids
    contract = client.post("/skills/model.chat@0.1.0/contract-test").json()
    assert contract["ok"] is True
    assert contract["output"]["text"].startswith("模型回答：")
