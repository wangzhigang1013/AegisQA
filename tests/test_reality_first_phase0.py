import base64
import io
import json
from pathlib import Path
import zipfile

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
from aegisqa.workflows.models import WorkflowStep, WorkflowVersion


def test_features_default_disable_experimental_modules(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    response = client.get("/features")

    assert response.status_code == 200
    features = response.json()["features"]
    assert features["ci_gate"]["enabled"] is False
    assert features["candidate_assets"]["enabled"] is False
    assert features["repair_tasks"]["enabled"] is False
    assert features["experiments"]["enabled"] is False
    assert features["annotation_queue"]["enabled"] is False
    assert features["judge_audit"]["enabled"] is False
    assert features["ci_gate"]["reason"] == "Reality-first rebuild: hidden until backed by verified runtime behavior."


def test_feature_truth_audit_covers_required_modules() -> None:
    audit_path = Path("docs/audit/feature_truth_audit.md")

    content = audit_path.read_text(encoding="utf-8")

    required_modules = [
        "Dataset",
        "Skill Market / Skill Upload / Skill Approval",
        "Workflow Market / Workflow Designer / Workflow Publish",
        "Task Center / Run / RunItem / Step",
        "Preflight",
        "Trace Tree",
        "Trace Flow",
        "Report Center",
        "Badcase",
        "Quality Detection / Quality Decision",
        "Quality Gate",
        "CI Gate",
        "Experiment",
        "Repair Task",
        "Candidate Assets",
        "Annotation Queue",
        "Judge Audit",
        "Assertion DSL",
        "Governance / Audit",
        "Cost Budget",
        "Red Team / Safety Scan",
    ]
    required_columns = [
        "Feature",
        "Current UI",
        "Current API",
        "Persistence",
        "Uses Real Runtime Data",
        "Has Blocking Effect",
        "Has Tests",
        "Is Mock/Placeholder",
        "Decision",
        "Reason",
        "Required Fix",
    ]
    for module in required_modules:
        assert module in content
    for column in required_columns:
        assert column in content


def test_task_report_marks_quality_and_cost_unavailable_without_real_sources(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    dataset = client.post(
        "/datasets/source-materialize",
        json={"name": "phase0_rows", "rows": [{"question": "什么是 AegisQA?", "reference": "AegisQA"}]},
    ).json()
    workflow = WorkflowVersion(
        workflow_id="wf-phase0",
        name="Phase0",
        version=1,
        version_id="wf-phase0:v1",
        status="published",
        snapshot_hash="phase0-hash",
        published_at="2026-06-03T00:00:00Z",
        steps=[
            WorkflowStep(
                step_id="answer",
                skill_ref="llm.call@0.1.0",
                input_mapping={"prompt": "row.question"},
                output_mapping={"answer": "context.answer"},
                config={"model": "demo-model", "temperature": 0},
            )
        ],
    )
    client.app.state.workflow_service._save(workflow)
    task = client.post(
        "/tasks",
        json={
            "name": "Phase0 Task",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow.version_id,
            "quality_gate": {},
        },
    ).json()
    client.post(f"/tasks/{task['task_id']}/execute")

    report = client.get(f"/tasks/{task['task_id']}/report").json()

    assert report["quality_checks"] == []
    assert report["gate_evaluation"]["decision"] == "skipped"
    assert report["cost_status"]["source"] == "unavailable"
    assert "Quality checks are not configured." in report["unavailable_reasons"]
    assert "Token/cost unavailable until LLM Gateway token usage is enabled." in report["unavailable_reasons"]


def test_task_report_uses_real_llm_token_usage_when_prompt_calls_exist(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    client.post("/model-aliases", json={"alias": "test.judge", "provider": "test", "model": "deterministic-json"})
    skill_id = "report.prompt@0.1.0"
    client.post(
        "/skills/packages/upload",
        json={"filename": "report_prompt.zip", "content_base64": _prompt_skill_zip(skill_id)},
    )
    assert client.post(f"/skills/{skill_id}/contract-test").json()["ok"] is True
    assert client.post(f"/skills/{skill_id}/approve", json={"reason": "report cost test"}).json()["status"] == "approved"
    dataset = client.post(
        "/datasets/source-materialize",
        json={"name": "phase0_prompt_rows", "rows": [{"answer": "AegisQA"}]},
    ).json()
    workflow = WorkflowVersion(
        workflow_id="wf-phase0-prompt",
        name="Phase0 Prompt",
        version=1,
        version_id="wf-phase0-prompt:v1",
        status="published",
        snapshot_hash="phase0-prompt-hash",
        published_at="2026-06-03T00:00:00Z",
        steps=[
            WorkflowStep(
                step_id="judge",
                skill_ref=skill_id,
                input_mapping={"answer": "row.answer"},
                output_mapping={"result": "context.result"},
                config={},
            )
        ],
    )
    client.app.state.workflow_service._save(workflow)
    task = client.post(
        "/tasks",
        json={
            "name": "Phase0 Prompt Task",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow.version_id,
            "quality_gate": {},
        },
    ).json()
    executed_task = client.post(f"/tasks/{task['task_id']}/execute").json()
    executed = client.get(f"/runs/{executed_task['run_id']}").json()
    prompt_call = executed["items"][0]["steps"][0]["prompt_calls"][0]
    artifact_uris = prompt_call["artifact_uris"]
    assert client.app.state.artifact_store.get_bytes(artifact_uris["rendered_prompt"]).decode("utf-8") == prompt_call["rendered_prompt"]
    assert client.app.state.artifact_store.get_bytes(artifact_uris["raw_response"]).decode("utf-8") == prompt_call["raw_response"]

    report = client.get(f"/tasks/{task['task_id']}/report").json()

    assert report["cost_status"]["source"] == "llm_gateway"
    assert report["cost_status"]["token_usage"]["total_tokens"] > 0
    assert "Token/cost unavailable until LLM Gateway token usage is enabled." not in report["unavailable_reasons"]


def _prompt_skill_zip(skill_id: str) -> str:
    manifest = {
        "schema_version": 1,
        "skill_id": skill_id,
        "name": "Report Prompt",
        "version": "0.1.0",
        "description": "Report cost fixture.",
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
        "test_response": json.dumps({"result": "pass"}),
    }
    handler = """
def run(input_data, context):
    call = context.llm.call("judge", {"answer": input_data["answer"]}, "report_cost_test")
    return {"output": call["parsed_output"], "metrics": {}, "logs": []}
"""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("skill.yaml", json.dumps(manifest))
        archive.writestr("handler.py", handler)
        archive.writestr("prompts/judge/prompt.yaml", json.dumps(prompt_yaml))
        archive.writestr("prompts/judge/prompt.md", "Judge answer: {{ answer }}")
    return base64.b64encode(buffer.getvalue()).decode("ascii")
