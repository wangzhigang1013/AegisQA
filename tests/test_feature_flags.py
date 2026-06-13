from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
from aegisqa.core.features import FEATURE_FLAG_DEFAULTS, load_feature_flags


def test_feature_flags_default_false_and_env_override(monkeypatch) -> None:
    for feature in FEATURE_FLAG_DEFAULTS:
        monkeypatch.delenv(f"AEGISQA_ENABLE_{feature.upper()}", raising=False)

    flags = load_feature_flags()

    assert flags["ci_gate"] is False
    assert flags["candidate_assets"] is False
    assert flags["repair_tasks"] is False
    assert flags["experiments"] is False
    assert flags["annotation_queue"] is False
    assert flags["judge_audit"] is False

    monkeypatch.setenv("AEGISQA_ENABLE_CI_GATE", "true")
    monkeypatch.setenv("AEGISQA_ENABLE_REPAIR_TASKS", "1")

    enabled = load_feature_flags()

    assert enabled["ci_gate"] is True
    assert enabled["repair_tasks"] is True
    assert enabled["candidate_assets"] is False


def test_features_endpoint_returns_current_flags(tmp_path, monkeypatch) -> None:
    for feature in FEATURE_FLAG_DEFAULTS:
        monkeypatch.delenv(f"AEGISQA_ENABLE_{feature.upper()}", raising=False)
    monkeypatch.setenv("AEGISQA_ENABLE_ANNOTATION_QUEUE", "yes")

    client = TestClient(create_app(store_root=tmp_path / "store"))
    payload = client.get("/features").json()

    assert payload["flags"]["annotation_queue"] is True
    assert payload["flags"]["ci_gate"] is False
    assert payload["defaults"]["ci_gate"] is False
    assert payload["env_prefix"] == "AEGISQA_ENABLE_"
