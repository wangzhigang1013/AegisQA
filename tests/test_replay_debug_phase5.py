from __future__ import annotations

import base64
import io
import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def test_step_replay_and_repro_bundle_export_real_step_fields(tmp_path: Path) -> None:
    client = TestClient(create_app(store_root=tmp_path / "store"))
    run = _executed_run(client, tmp_path)
    item = run["items"][0]
    step = item["steps"][0]

    replay = client.post(
        f"/runs/{run['run_id']}/items/{item['item_id']}/steps/{step['step_id']}/replay",
        json={"override_input": {"prompt": "override prompt"}, "disable_cache": True, "mock_llm_calls": True},
    ).json()

    assert replay["status"] == "succeeded"
    assert replay["resolved_input"] == {"prompt": "override prompt"}
    assert "raw_output" in replay
    assert replay["persisted"] is False

    bundle = client.get(f"/runs/{run['run_id']}/items/{item['item_id']}/steps/{step['step_id']}/repro-bundle").json()
    assert bundle["run_id"] == run["run_id"]
    assert bundle["step"]["resolved_input"]
    assert bundle["step"]["raw_output"]
    assert bundle["workflow"]["version_id"] == run["workflow"]["version_id"]
    assert bundle["artifact_uri"].startswith("local://repro-bundles/")
    assert bundle["artifact_metadata"]["content_type"] == "application/json"
    stored_bundle = client.app.state.artifact_store.get_json(bundle["artifact_uri"])
    assert stored_bundle["bundle_id"] == bundle["bundle_id"]
    assert stored_bundle["step"]["raw_output"] == bundle["step"]["raw_output"]


def test_prompt_debug_renders_and_validates_prompt_asset(tmp_path: Path) -> None:
    client = TestClient(create_app(store_root=tmp_path / "store"))
    client.post("/model-aliases", json={"alias": "test.judge", "provider": "test", "model": "deterministic-json"})
    skill_id = "debug.prompt@0.1.0"
    upload = client.post(
        "/skills/packages/upload",
        json={"filename": "debug_prompt.zip", "content_base64": _prompt_skill_zip(skill_id)},
    ).json()
    assert upload["manifest"]["skill_id"] == skill_id

    result = client.post(
        f"/skills/{skill_id}/versions/0.1.0/prompts/judge/debug",
        json={"variables": {"answer": "AegisQA"}, "trigger_reason": "phase5_test"},
    ).json()

    assert result["prompt_name"] == "judge"
    assert "AegisQA" in result["rendered_prompt"]
    assert result["parsed_output"] == {"result": "pass"}
    assert result["schema_validation"]["ok"] is True
    assert result["token_usage"]["total_tokens"] > 0
    assert result["artifact_uris"]["rendered_prompt"].startswith("local://prompt-debug/")
    assert client.app.state.artifact_store.get_bytes(result["artifact_uris"]["rendered_prompt"]).decode("utf-8") == result["rendered_prompt"]
    assert client.app.state.artifact_store.get_bytes(result["artifact_uris"]["raw_response"]).decode("utf-8") == result["raw_response"]
    assert client.app.state.artifact_store.get_json(result["artifact_uris"]["debug_result"])["parsed_output"] == {"result": "pass"}


def test_step_replay_can_mock_recorded_llm_calls(tmp_path: Path) -> None:
    client = TestClient(create_app(store_root=tmp_path / "store"))
    client.post("/model-aliases", json={"alias": "test.judge", "provider": "test", "model": "deterministic-json"})
    skill_id = "replay.hybrid@0.1.0"
    client.post(
        "/skills/packages/upload",
        json={"filename": "replay_hybrid.zip", "content_base64": _prompt_skill_zip(skill_id)},
    )
    contract = client.post(f"/skills/{skill_id}/contract-test").json()
    assert contract["ok"] is True
    client.post(f"/skills/{skill_id}/approve", json={"reason": "replay mock test"})
    run = _executed_prompt_run(client, tmp_path, skill_id)
    item = run["items"][0]
    step = item["steps"][0]
    assert step["prompt_calls"][0]["prompt_name"] == "judge"

    replay = client.post(
        f"/runs/{run['run_id']}/items/{item['item_id']}/steps/{step['step_id']}/replay",
        json={"override_input": {"answer": "changed"}, "mock_llm_calls": True},
    ).json()

    assert replay["status"] == "succeeded"
    assert replay["resolved_input"] == {"answer": "changed"}
    assert replay["raw_output"] == step["raw_output"]
    assert replay["prompt_calls"][0]["prompt_name"] == "judge"
    assert replay["prompt_calls"][0]["mocked"] is True


def _executed_run(client: TestClient, tmp_path: Path) -> dict:
    data_path = tmp_path / "phase5.jsonl"
    with data_path.open("w", encoding="utf-8") as handle:
        handle.write(json.dumps({"question": "什么是 AegisQA?", "reference": "AegisQA"}, ensure_ascii=False) + "\n")
    dataset = client.post("/datasets/from-path", json={"name": "phase5_dataset", "path": str(data_path)}).json()
    workflow = client.post(
        "/workflow-graphs/publish",
        json={
            "graph": {
                "name": "phase5_workflow",
                "nodes": [
                    {
                        "node_id": "answer",
                        "node_type": "skill",
                        "label": "answer",
                        "skill_ref": "llm.call@0.1.0",
                        "input_mapping": {"prompt": "row.question"},
                        "output_mapping": {"answer": "context.answer"},
                        "config": {"model": "demo-model"},
                    },
                    {"node_id": "report", "node_type": "output", "label": "report"},
                ],
                "edges": [{"source": "answer", "target": "report"}],
            }
        },
    ).json()
    run = client.post("/runs", json={"workflow": workflow, "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"]}).json()
    return client.post(f"/runs/{run['run_id']}/execute").json()


def _executed_prompt_run(client: TestClient, tmp_path: Path, skill_id: str) -> dict:
    data_path = tmp_path / "phase5_prompt.jsonl"
    with data_path.open("w", encoding="utf-8") as handle:
        handle.write(json.dumps({"answer": "AegisQA"}, ensure_ascii=False) + "\n")
    dataset = client.post("/datasets/from-path", json={"name": "phase5_prompt_dataset", "path": str(data_path)}).json()
    workflow = client.post(
        "/workflow-graphs/publish",
        json={
            "graph": {
                "name": "phase5_prompt_workflow",
                "nodes": [
                    {
                        "node_id": "judge",
                        "node_type": "skill",
                        "label": "judge",
                        "skill_ref": skill_id,
                        "input_mapping": {"answer": "row.answer"},
                        "output_mapping": {"result": "context.result"},
                        "config": {},
                    },
                    {"node_id": "report", "node_type": "output", "label": "report"},
                ],
                "edges": [{"source": "judge", "target": "report"}],
            }
        },
    ).json()
    run = client.post("/runs", json={"workflow": workflow, "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"]}).json()
    return client.post(f"/runs/{run['run_id']}/execute").json()


def _prompt_skill_zip(skill_id: str) -> str:
    manifest = {
        "schema_version": 1,
        "skill_id": skill_id,
        "name": "Debug Prompt",
        "version": "0.1.0",
        "description": "Prompt debug fixture.",
        "author": "QA",
        "type": "prompt",
        "category": "judge",
        "input_schema": {"type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"]},
        "output_schema": {"type": "object", "properties": {"result": {"type": "string"}}, "required": ["result"]},
        "config_schema": {"type": "object", "properties": {}},
        "example_input": {"answer": "AegisQA"},
        "example_config": {},
        "prompts": [{"name": "judge", "path": "prompts/judge"}],
        "llm_permissions": {"allowed_prompt_names": ["judge"], "allowed_model_aliases": ["test.judge"]},
        "limits": {"max_calls_per_run": 1, "max_tokens_per_run": 100},
    }
    prompt_yaml = {
        "input_variables": {"answer": {"type": "string"}},
        "output_schema": {"type": "object", "properties": {"result": {"type": "string"}}, "required": ["result"]},
        "model_policy": {"default_alias": "test.judge", "allowed_aliases": ["test.judge"]},
        "retry_policy": {"max_attempts": 1},
        "test_response": '{"result": "pass"}',
    }
    handler = """
def run(input_data, context):
    call = context.llm.call("judge", {"answer": input_data["answer"]}, "contract_test")
    return {"output": call["parsed_output"], "metrics": {}, "logs": []}
"""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("skill.json", json.dumps(manifest, ensure_ascii=False))
        archive.writestr("handler.py", handler)
        archive.writestr("prompts/judge/prompt.yaml", json.dumps(prompt_yaml, ensure_ascii=False))
        archive.writestr("prompts/judge/prompt.md", "Judge answer: {{ answer }}")
    return base64.b64encode(buffer.getvalue()).decode("ascii")
