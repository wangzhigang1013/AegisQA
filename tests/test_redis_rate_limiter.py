from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
from aegisqa.datasets.service import DatasetService
from aegisqa.engine.rate_limit import RedisRateLimiter
from aegisqa.engine.runner import RunRequest, WorkflowRunner
from aegisqa.skills.base import BaseSkill, SkillManifest, SkillResult
from aegisqa.skills.registry import SkillRegistry
from aegisqa.storage.json_store import JsonStore
from aegisqa.workflows.models import WorkflowDraft, WorkflowStep


def _write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def test_redis_rate_limiter_shares_token_bucket_across_instances() -> None:
    redis = _FakeRedis()
    clock = _ManualClock(1_000.0)
    first_worker = RedisRateLimiter({"llm.call@0.1.0": 1}, redis_client=redis, clock=clock.time)
    second_worker = RedisRateLimiter({"llm.call@0.1.0": 1}, redis_client=redis, clock=clock.time)

    first = first_worker.acquire("llm.call@0.1.0")
    second = second_worker.acquire("llm.call@0.1.0")

    assert first.rate_limited_count == 0
    assert first.wait_ms == 0
    assert second.rate_limited_count == 1
    assert second.wait_ms == pytest.approx(1000)
    assert redis.values["aegisqa:rate-limit:llm.call@0.1.0"] == pytest.approx(1_002_000)


def test_workflow_runner_can_use_redis_rate_limiter_and_preserves_step_trace(tmp_path: Path) -> None:
    store = JsonStore(tmp_path / "store")
    dataset_service = DatasetService(store)
    registry = SkillRegistry()
    registry.register(_EchoSkill())
    data_path = tmp_path / "redis-rate-limit.csv"
    _write_csv(
        data_path,
        [
            {"question": "Q1", "reference": "AegisQA"},
            {"question": "Q2", "reference": "AegisQA"},
        ],
    )
    dataset = dataset_service.upload_dataset("redis_rate_limit", data_path)
    workflow = WorkflowDraft(
        name="redis_rate_limit_workflow",
        steps=[
                WorkflowStep(
                    step_id="answer",
                    skill_ref="test.echo@0.1.0",
                    input_mapping={"text": "row.question"},
                    output_mapping={"answer": "context.answer"},
                )
            ],
        ).publish()
    redis = _FakeRedis()
    clock = _ManualClock(2_000.0)
    runner = WorkflowRunner(
        store,
        dataset_service,
        registry,
        rate_limiter_factory=lambda qps: RedisRateLimiter(qps, redis_client=redis, clock=clock.time),
    )

    run = runner.create_run(
        RunRequest(
            workflow=workflow,
                dataset_id=dataset.dataset_id,
                dataset_version=dataset.version,
                rate_limits={"test.echo@0.1.0": 1},
            )
        )
    completed = runner.execute_run(run.run_id)

    assert completed.status == "completed"
    assert completed.items[0].steps[0].rate_limited_count == 0
    assert completed.items[1].steps[0].rate_limited_count == 1
    assert completed.items[1].steps[0].rate_limit_wait_ms == pytest.approx(1000)


def test_governance_runtime_status_reports_redis_rate_limit_backend(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AEGISQA_RATE_LIMIT_BACKEND", "redis")
    monkeypatch.setenv("AEGISQA_REDIS_URL", "redis://redis:6379/0")
    client = TestClient(create_app(store_root=tmp_path / "store"))

    payload = client.get("/governance/runtime-status").json()
    components = {component["component_id"]: component for component in payload["components"]}

    assert payload["external_services"]["redis"]["status"] == "configured"
    assert components["redis"]["status"] == "configured"
    assert components["redis"]["status_label"] == "已配置"


class _ManualClock:
    def __init__(self, now: float) -> None:
        self.now = now

    def time(self) -> float:
        return self.now


class _EchoSkill(BaseSkill):
    manifest = SkillManifest(
        skill_id="test.echo@0.1.0",
        name="Echo",
        version="0.1.0",
        description="本地限流测试 Echo Skill。",
        input_schema={"type": "object", "required": ["text"], "properties": {"text": {"type": "string"}}},
        output_schema={"type": "object", "required": ["answer"], "properties": {"answer": {"type": "string"}}},
    )

    def run(self, inputs: dict[str, object], config: dict[str, object] | None = None) -> SkillResult:
        return SkillResult(output={"answer": str(inputs["text"])})


class _FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, float] = {}

    def eval(self, _: str, numkeys: int, key: str, now_ms: float, interval_ms: float, __: int) -> list[float]:
        assert numkeys == 1
        current = float(self.values.get(key, now_ms))
        if now_ms < current:
            wait_ms = current - now_ms
            next_allowed = current + interval_ms
        else:
            wait_ms = 0.0
            next_allowed = now_ms + interval_ms
        self.values[key] = next_allowed
        return [wait_ms, next_allowed]

    def set(self, key: str, value: Any, px: int | None = None) -> None:  # pragma: no cover - fallback 兼容。
        self.values[key] = float(value)
