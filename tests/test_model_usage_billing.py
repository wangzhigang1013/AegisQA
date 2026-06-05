import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
import aegisqa.models.gateway as gateway_module


def test_real_model_usage_is_recorded_on_steps_and_report_budget(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class FakeOpenAIResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback) -> None:
            return None

        def read(self) -> bytes:
            return json.dumps(
                {
                    "id": "chatcmpl-billing",
                    "model": "billing-model",
                    "choices": [{"message": {"content": "真实 usage 账单响应"}, "finish_reason": "stop"}],
                    "usage": {
                        "prompt_tokens": 17,
                        "completion_tokens": 5,
                        "total_tokens": 22,
                        "total_cost": 0.0012,
                        "currency": "USD",
                    },
                },
                ensure_ascii=False,
            ).encode("utf-8")

    def fake_urlopen(request, timeout):  # noqa: ANN001 - 测试替身只需要捕获 urllib Request。
        captured["url"] = request.full_url
        captured["timeout"] = timeout
        return FakeOpenAIResponse()

    monkeypatch.setattr(gateway_module, "urlopen", fake_urlopen)
    client = TestClient(create_app(store_root=tmp_path / "store"))
    client.put(
        "/model-gateway/config",
        json={
            "provider": "openai_compatible",
            "base_url": "https://api.example.com/v1",
            "default_model": "billing-model",
            "timeout_seconds": 20,
        },
    )
    data_path = tmp_path / "billing_dataset.jsonl"
    data_path.write_text(json.dumps({"question": "请介绍 AegisQA"}, ensure_ascii=False) + "\n", encoding="utf-8")

    dataset = client.post("/datasets/from-path", json={"name": "billing_dataset", "path": str(data_path)}).json()
    workflow = client.post(
        "/workflow-graphs/publish",
        json={
            "graph": {
                "name": "模型 usage 账单流程",
                "nodes": [
                    {
                        "node_id": "chat",
                        "node_type": "skill",
                        "label": "模型调用",
                        "skill_ref": "model.chat@0.1.0",
                        "input_mapping": {"prompt": "row.question"},
                        "output_mapping": {"text": "context.answer"},
                        "config": {"model": "billing-model", "temperature": 0},
                    },
                    {"node_id": "report", "node_type": "output", "label": "报告"},
                ],
                "edges": [{"source": "chat", "target": "report"}],
            }
        },
    ).json()
    task = client.post(
        "/tasks",
        json={
            "name": "真实 usage 账单任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "cost_budget": 0.01,
        },
    ).json()

    executed = client.post(f"/tasks/{task['task_id']}/execute").json()

    assert captured["url"] == "https://api.example.com/v1/chat/completions"
    assert executed["status"] == "completed"
    run = client.get(f"/runs/{executed['run_id']}").json()
    step_metrics = run["items"][0]["steps"][0]["metrics"]
    assert step_metrics["prompt_tokens"] == 17
    assert step_metrics["completion_tokens"] == 5
    assert step_metrics["total_tokens"] == 22
    assert step_metrics["cost"] == pytest.approx(0.0012)
    assert step_metrics["cost_source"] == "provider_usage.total_cost"

    report = client.get(f"/tasks/{task['task_id']}/report").json()
    assert report["report"]["metrics"]["prompt_tokens"] == 17
    assert report["report"]["metrics"]["completion_tokens"] == 5
    assert report["report"]["metrics"]["total_tokens"] == 22
    assert report["report"]["metrics"]["cost"] == pytest.approx(0.0012)
    assert report["report"]["metrics"]["cost_source"] == "provider_usage.total_cost"
    assert report["budget_status"]["cost_used"] == pytest.approx(0.0012)
    assert report["budget_status"]["cost_source"] == "provider_usage.total_cost"
    assert report["budget_status"]["prompt_tokens"] == 17
    assert report["budget_status"]["completion_tokens"] == 5
    assert report["budget_status"]["message"].startswith("模型网关 usage 成本")
