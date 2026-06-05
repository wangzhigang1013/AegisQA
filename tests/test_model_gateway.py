import json

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
import aegisqa.models.gateway as gateway_module
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


def test_model_gateway_config_saves_secret_ref_without_plaintext_api_key(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("AEGISQA_TEST_MODEL_KEY", "sk-secret-1234567890")
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    saved = client.put(
        "/model-gateway/config",
        json={
            "provider": "openai_compatible",
            "base_url": "https://api.example.com/v1",
            "secret_ref": "env:AEGISQA_TEST_MODEL_KEY",
            "api_key": "sk-secret-1234567890",
            "default_model": "example-model",
            "timeout_seconds": 120,
        },
    )

    assert saved.status_code == 200
    saved_payload = saved.json()
    assert saved_payload["provider"] == "openai_compatible"
    assert saved_payload["base_url"] == "https://api.example.com/v1"
    assert saved_payload["api_key_configured"] is True
    assert saved_payload["api_key_masked"].endswith("7890")
    assert saved_payload["secret_ref"] == "env:AEGISQA_TEST_MODEL_KEY"
    assert "sk-secret-1234567890" not in saved.text
    settings_text = (tmp_path / "store" / "settings" / "model_gateway.json").read_text(encoding="utf-8")
    assert "sk-secret-1234567890" not in settings_text
    assert '"api_key"' not in settings_text
    assert "env:AEGISQA_TEST_MODEL_KEY" in settings_text

    status = client.get("/model-gateway/status").json()
    assert status["provider"] == "openai_compatible"
    assert status["default_model"] == "example-model"
    assert status["base_url_configured"] is True
    assert status["api_key_configured"] is True
    assert status["timeout_seconds"] == 120


def test_model_gateway_test_accepts_temporary_api_key_without_persisting(tmp_path, monkeypatch) -> None:
    captured: dict[str, str | None] = {}

    class FakeOpenAIResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback) -> None:
            return None

        def read(self) -> bytes:
            return json.dumps(
                {
                    "id": "chatcmpl-test",
                    "model": "temp-model",
                    "choices": [{"message": {"content": "临时密钥调用成功"}, "finish_reason": "stop"}],
                    "usage": {"total_tokens": 7},
                },
                ensure_ascii=False,
            ).encode("utf-8")

    def fake_urlopen(request, timeout):  # noqa: ANN001 - 测试替身只需要捕获 urllib Request。
        captured["authorization"] = request.get_header("Authorization")
        captured["timeout"] = str(timeout)
        return FakeOpenAIResponse()

    monkeypatch.setattr(gateway_module, "urlopen", fake_urlopen)
    client = TestClient(create_app(store_root=tmp_path / "store"))
    client.put(
        "/model-gateway/config",
        json={
            "provider": "openai_compatible",
            "base_url": "https://api.example.com/v1",
            "secret_ref": "env:NOT_CONFIGURED_FOR_TEST",
            "default_model": "example-model",
            "timeout_seconds": 33,
        },
    )

    probe = client.post(
        "/model-gateway/test",
        json={
            "prompt": "验证临时密钥",
            "api_key": "sk-temp-abcdef123456",
            "model": "temp-model",
        },
    )

    assert probe.status_code == 200
    assert probe.json()["response"]["text"] == "临时密钥调用成功"
    assert captured["authorization"] == "Bearer sk-temp-abcdef123456"
    settings_text = (tmp_path / "store" / "settings" / "model_gateway.json").read_text(encoding="utf-8")
    assert "sk-temp-abcdef123456" not in settings_text


def test_model_gateway_legacy_plaintext_config_is_migrated_to_unconfigured(tmp_path) -> None:
    settings_dir = tmp_path / "store" / "settings"
    settings_dir.mkdir(parents=True)
    settings_file = settings_dir / "model_gateway.json"
    settings_file.write_text(
        json.dumps(
            {
                "provider": "openai_compatible",
                "base_url": "https://api.example.com/v1",
                "api_key": "sk-legacy-plaintext",
                "default_model": "legacy-model",
                "timeout_seconds": 45,
            }
        ),
        encoding="utf-8",
    )

    client = TestClient(create_app(store_root=tmp_path / "store"))
    config = client.get("/model-gateway/config").json()

    assert config["provider"] == "openai_compatible"
    assert config["api_key_configured"] is False
    assert config["api_key_masked"] is None
    migrated_text = settings_file.read_text(encoding="utf-8")
    assert "sk-legacy-plaintext" not in migrated_text
    assert '"api_key"' not in migrated_text


def test_model_gateway_legacy_model_name_provider_is_migrated(tmp_path) -> None:
    settings_dir = tmp_path / "store" / "settings"
    settings_dir.mkdir(parents=True)
    settings_file = settings_dir / "model_gateway.json"
    settings_file.write_text(
        json.dumps(
            {
                "provider": "deepseek-v4-flash",
                "base_url": "https://api.deepseek.com/v1",
                "secret_ref": "env:DEEPSEEK_API_KEY",
                "default_model": "mock-eval-model",
                "timeout_seconds": 45,
            }
        ),
        encoding="utf-8",
    )

    client = TestClient(create_app(store_root=tmp_path / "store"))
    config = client.get("/model-gateway/config").json()

    assert config["provider"] == "openai_compatible"
    assert config["default_model"] == "deepseek-v4-flash"
    status = client.get("/model-gateway/status").json()
    assert status["provider"] == "openai_compatible"
    migrated = json.loads(settings_file.read_text(encoding="utf-8"))
    assert migrated["provider"] == "openai_compatible"
    assert migrated["default_model"] == "deepseek-v4-flash"


def test_model_gateway_legacy_connection_model_name_provider_is_migrated(tmp_path) -> None:
    settings_dir = tmp_path / "store" / "settings"
    settings_dir.mkdir(parents=True)
    connections_file = settings_dir / "model_gateway_connections.json"
    connections_file.write_text(
        json.dumps(
            {
                "connections": [
                    {
                        "connection_id": "qwen-prod",
                        "name": "Qwen 生产",
                        "provider": "qwen-plus",
                        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                        "secret_ref": "env:QWEN_API_KEY",
                        "default_model": "mock-eval-model",
                        "timeout_seconds": 60,
                        "enabled": True,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    client = TestClient(create_app(store_root=tmp_path / "store"))
    connections = client.get("/model-gateway/connections").json()

    assert connections[0]["provider"] == "openai_compatible"
    assert connections[0]["default_model"] == "qwen-plus"
    migrated = json.loads(connections_file.read_text(encoding="utf-8"))
    assert migrated["connections"][0]["provider"] == "openai_compatible"
    assert migrated["connections"][0]["default_model"] == "qwen-plus"


def test_model_gateway_config_persists_after_app_restart(tmp_path) -> None:
    store_root = tmp_path / "store"
    first_client = TestClient(create_app(store_root=store_root))
    first_client.put(
        "/model-gateway/config",
        json={
            "provider": "mock",
            "base_url": None,
            "secret_ref": None,
            "default_model": "ui-configured-model",
            "timeout_seconds": 90,
        },
    )

    restarted_client = TestClient(create_app(store_root=store_root))
    config = restarted_client.get("/model-gateway/config").json()
    assert config["provider"] == "mock"
    assert config["default_model"] == "ui-configured-model"
    assert config["timeout_seconds"] == 90
    assert config["api_key_configured"] is False

    probe = restarted_client.post("/model-gateway/test", json={"prompt": "验证持久化配置。"}).json()
    assert probe["ok"] is True
    assert probe["response"]["model"] == "ui-configured-model"


def test_model_gateway_connections_provide_aliases_without_plaintext_secret(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("AEGISQA_QWEN_KEY", "sk-qwen-secret-value")
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    created = client.post(
        "/model-gateway/connections",
        json={
            "connection_id": "qwen-prod",
            "name": "Qwen 生产连接",
            "provider": "mock",
            "base_url": "https://dashscope.example.com/compatible-mode/v1",
            "secret_ref": "env:AEGISQA_QWEN_KEY",
            "api_key": "sk-qwen-secret-value",
            "default_model": "qwen-max",
            "timeout_seconds": 77,
        },
    )

    assert created.status_code == 200
    payload = created.json()
    assert payload["connection_id"] == "qwen-prod"
    assert payload["default_model"] == "qwen-max"
    assert payload["api_key_configured"] is True
    assert "sk-qwen-secret-value" not in created.text
    settings_text = (tmp_path / "store" / "settings" / "model_gateway_connections.json").read_text(encoding="utf-8")
    assert "sk-qwen-secret-value" not in settings_text
    assert '"api_key"' not in settings_text

    listed = client.get("/model-gateway/connections").json()
    assert [connection["connection_id"] for connection in listed] == ["qwen-prod"]

    probe = client.post(
        "/model-gateway/test",
        json={"prompt": "验证连接别名", "model_connection_id": "qwen-prod"},
    ).json()
    assert probe["ok"] is True
    assert probe["response"]["model"] == "qwen-max"

    skill_result = app.state.registry.get("model.chat@0.1.0").run(
        {"prompt": "验证 Workflow 节点连接别名"},
        {"model_connection_id": "qwen-prod"},
    )
    assert skill_result.output["model"] == "qwen-max"

    updated = client.put(
        "/model-gateway/connections/qwen-prod",
        json={"provider": "mock", "default_model": "qwen-turbo", "timeout_seconds": 33},
    ).json()
    assert updated["default_model"] == "qwen-turbo"

    deleted = client.delete("/model-gateway/connections/qwen-prod").json()
    assert deleted["deleted"] is True
    assert client.get("/model-gateway/connections").json() == []


def test_model_gateway_write_and_test_routes_require_admin_permission(tmp_path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    denied_config = client.put(
        "/model-gateway/config",
        json={"provider": "mock", "default_model": "viewer-model", "role": "Viewer", "actor": "viewer"},
    )
    assert denied_config.status_code == 403
    assert denied_config.json()["code"] == "FORBIDDEN"
    assert denied_config.json()["details"]["required_permission"] == "model:configure"

    denied_create = client.post(
        "/model-gateway/connections",
        json={"connection_id": "viewer-conn", "provider": "mock", "default_model": "viewer-model", "role": "Viewer", "actor": "viewer"},
    )
    assert denied_create.status_code == 403
    assert denied_create.json()["details"]["required_permission"] == "model:configure"

    denied_test = client.post("/model-gateway/test", json={"prompt": "Viewer 尝试测试模型。", "role": "Viewer", "actor": "viewer"})
    assert denied_test.status_code == 403
    assert denied_test.json()["details"]["required_permission"] == "model:configure"

    created = client.post(
        "/model-gateway/connections",
        json={"connection_id": "admin-conn", "provider": "mock", "default_model": "admin-model"},
    )
    assert created.status_code == 200
    denied_delete = client.delete("/model-gateway/connections/admin-conn", params={"role": "Viewer", "actor": "viewer"})
    assert denied_delete.status_code == 403
    assert denied_delete.json()["details"]["required_permission"] == "model:configure"
    assert [connection["connection_id"] for connection in client.get("/model-gateway/connections").json()] == ["admin-conn"]

    events = client.get("/audit-events", params={"actor": "viewer"}).json()
    forbidden_events = [event for event in events if event["result"] == "forbidden"]
    assert {event["action"] for event in forbidden_events} >= {
        "model_gateway.config_update",
        "model_gateway.connection.upsert",
        "model_gateway.test",
        "model_gateway.connection.delete",
    }
    assert all(event["role"] == "Viewer" for event in forbidden_events)
    assert all(event["detail"]["required_permission"] == "model:configure" for event in forbidden_events)


def test_model_gateway_success_audit_records_actor_and_role_without_plaintext_secret(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("AEGISQA_MODEL_AUDIT_KEY", "sk-audit-secret-123456")
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    saved = client.put(
        "/model-gateway/config",
        json={
            "provider": "mock",
            "secret_ref": "env:AEGISQA_MODEL_AUDIT_KEY",
            "api_key": "sk-audit-secret-123456",
            "default_model": "audit-model",
            "role": "Admin",
            "actor": "ops",
        },
    )
    assert saved.status_code == 200

    created = client.post(
        "/model-gateway/connections",
        json={
            "connection_id": "audit-conn",
            "provider": "mock",
            "secret_ref": "env:AEGISQA_MODEL_AUDIT_KEY",
            "api_key": "sk-audit-secret-123456",
            "default_model": "audit-connection-model",
            "role": "Admin",
            "actor": "ops",
        },
    )
    assert created.status_code == 200

    probe = client.post(
        "/model-gateway/test",
        json={
            "prompt": "审计归因测试",
            "model_connection_id": "audit-conn",
            "api_key": "sk-temp-secret-should-not-be-audited",
            "role": "Admin",
            "actor": "qa",
        },
    )
    assert probe.status_code == 200

    deleted = client.delete("/model-gateway/connections/audit-conn", params={"role": "Admin", "actor": "ops"})
    assert deleted.status_code == 200

    events = client.get("/audit-events").json()
    event_text = json.dumps(events, ensure_ascii=False)
    assert "sk-audit-secret-123456" not in event_text
    assert "sk-temp-secret-should-not-be-audited" not in event_text

    config_event = next(event for event in events if event["action"] == "model_gateway.config_update")
    assert config_event["actor"] == "ops"
    assert config_event["role"] == "Admin"
    assert config_event["detail"]["role"] == "Admin"

    upsert_event = next(event for event in events if event["action"] == "model_gateway.connection.upsert" and event["target"] == "audit-conn")
    assert upsert_event["actor"] == "ops"
    assert upsert_event["role"] == "Admin"
    assert upsert_event["detail"]["role"] == "Admin"

    test_event = next(event for event in events if event["action"] == "model_gateway.test")
    assert test_event["actor"] == "qa"
    assert test_event["role"] == "Admin"
    assert test_event["detail"]["role"] == "Admin"

    delete_event = next(event for event in events if event["action"] == "model_gateway.connection.delete")
    assert delete_event["actor"] == "ops"
    assert delete_event["role"] == "Admin"
    assert delete_event["detail"]["role"] == "Admin"
