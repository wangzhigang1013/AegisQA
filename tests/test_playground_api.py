"""Playground API 端点测试。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    app = create_app(store_root=tmp_path)
    return TestClient(app)


# ── /playground/execute 测试 ──────────────────────────────────

class TestPlaygroundExecute:
    def test_basic_execute(self, client: TestClient) -> None:
        response = client.post("/playground/execute", json={
            "prompt": "Hello, world!",
        })
        assert response.status_code == 200
        data = response.json()
        assert "output" in data
        assert "model" in data
        assert "latency_ms" in data

    def test_execute_with_variables(self, client: TestClient) -> None:
        response = client.post("/playground/execute", json={
            "prompt": "Analyze: {{text}}",
            "variables": {"text": "This is a test"},
        })
        assert response.status_code == 200
        data = response.json()
        assert "output" in data

    def test_execute_with_model_params(self, client: TestClient) -> None:
        response = client.post("/playground/execute", json={
            "prompt": "Hello",
            "temperature": 0.5,
            "max_tokens": 100,
        })
        assert response.status_code == 200

    def test_execute_empty_prompt(self, client: TestClient) -> None:
        response = client.post("/playground/execute", json={
            "prompt": "",
        })
        # Should still work with empty prompt
        assert response.status_code in (200, 400, 422)


# ── /playground/judge 测试 ────────────────────────────────────

class TestPlaygroundJudge:
    def test_basic_judge(self, client: TestClient) -> None:
        response = client.post("/playground/judge", json={
            "output": "The answer is 42.",
            "judge_prompt": "Evaluate this output: {{output}}",
        })
        assert response.status_code == 200
        data = response.json()
        assert "result" in data
        assert "model" in data
        assert "latency_ms" in data

    def test_judge_with_model(self, client: TestClient) -> None:
        response = client.post("/playground/judge", json={
            "output": "Test output",
            "judge_prompt": "Rate this: {{output}}",
            "model": "mock-eval-model",
        })
        assert response.status_code == 200

    def test_judge_missing_output(self, client: TestClient) -> None:
        response = client.post("/playground/judge", json={
            "judge_prompt": "Evaluate: {{output}}",
        })
        # Should return validation error
        assert response.status_code in (400, 422)

    def test_judge_missing_prompt(self, client: TestClient) -> None:
        response = client.post("/playground/judge", json={
            "output": "Test output",
        })
        # Should return validation error
        assert response.status_code in (400, 422)
