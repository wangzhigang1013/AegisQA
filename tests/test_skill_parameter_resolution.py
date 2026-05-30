import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
from aegisqa.datasets.service import DatasetService
from aegisqa.engine.runner import RunRequest, WorkflowRunner
from aegisqa.skills.parameters import SkillParameterResolver
from aegisqa.skills.registry import SkillRegistry
from aegisqa.storage.json_store import JsonStore
from aegisqa.workflows.models import WorkflowDraft, WorkflowStep


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def test_parameter_resolver_applies_defaults_overrides_expressions_and_secret_redaction() -> None:
    resolver = SkillParameterResolver(
        config_schema={
            "type": "object",
            "properties": {
                "model": {"type": "string", "default": "schema-model"},
                "temperature": {"type": "number", "default": 0.2},
                "prompt": {"type": "string"},
                "api_key": {"type": "string"},
            },
        }
    )
    resolved = resolver.resolve(
        workflow_config={
            "temperature": 0.4,
            "prompt": {"type": "expression", "path": "row.question"},
            "api_key": {"type": "secret", "name": "LLM_API_KEY"},
        },
        task_override={"model": "task-model"},
        runtime_context={"row": {"question": "什么是 AegisQA?"}, "context": {}, "metrics": {}},
        secret_values={"LLM_API_KEY": "sk-real-secret"},
    )

    assert resolved.config == {
        "model": "task-model",
        "temperature": 0.4,
        "prompt": "什么是 AegisQA?",
        "api_key": "sk-real-secret",
    }
    assert resolved.trace["model"]["source"] == "task_override"
    assert resolved.trace["temperature"]["source"] == "workflow_config"
    assert resolved.trace["prompt"]["source"] == "runtime_expression"
    assert resolved.trace["prompt"]["expression_path"] == "row.question"
    assert resolved.trace["api_key"]["source"] == "secret_ref"
    assert resolved.trace["api_key"]["redacted"] is True
    assert resolved.trace["api_key"]["value_preview"] == "***REDACTED***"


def test_runner_records_resolved_config_and_parameter_trace(tmp_path: Path) -> None:
    store = JsonStore(tmp_path / "store")
    dataset_service = DatasetService(store)
    registry = SkillRegistry.with_builtin_skills()
    data_path = tmp_path / "rows.jsonl"
    _write_jsonl(data_path, [{"question": "参数如何流转?", "reference": "AegisQA"}])
    dataset = dataset_service.upload_dataset("param_dataset", data_path)
    workflow = WorkflowDraft(
        name="参数追踪 Workflow",
        steps=[
            WorkflowStep(
                step_id="answer",
                skill_ref="llm.call@0.1.0",
                input_mapping={"prompt": "row.question"},
                output_mapping={"answer": "context.answer", "tokens": "metrics.tokens"},
                config={"model": "workflow-model", "temperature": {"type": "expression", "path": "row.temperature"}, "api_key": {"type": "secret", "name": "LLM_API_KEY"}},
            )
        ],
    ).publish()
    # 上传数据集后再补一个动态字段，模拟任务运行时表达式从 row 中取参数。
    row_store = store.path("datasets", dataset.dataset_id, f"v{dataset.version}", "rows.jsonl")
    row_store.write_text(json.dumps({"row_id": "1", "row_index": 0, "data": {"question": "参数如何流转?", "reference": "AegisQA", "temperature": 0.1}, "row_hash": "h"}, ensure_ascii=False) + "\n", encoding="utf-8")
    runner = WorkflowRunner(store, dataset_service, registry)

    run = runner.create_run(
        RunRequest(
            workflow=workflow,
            dataset_id=dataset.dataset_id,
            dataset_version=dataset.version,
            task_config_snapshot={"skill_overrides": {"answer": {"model": "task-model"}}},
        )
    )
    completed = runner.execute_run(run.run_id)
    step = completed.items[0].steps[0]

    assert step.config_snapshot["model"] == "task-model"
    assert step.config_snapshot["temperature"] == 0.1
    assert step.config_snapshot["api_key"] == "***REDACTED***"
    assert step.parameter_trace["model"]["source"] == "task_override"
    assert step.parameter_trace["temperature"]["source"] == "runtime_expression"
    assert step.parameter_trace["api_key"]["source"] == "secret_ref"
    assert completed.snapshot["task_config_snapshot"]["skill_overrides"]["answer"]["model"] == "task-model"


def test_workflow_parameter_preview_api_returns_sources_and_bad_expression_errors(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    graph = {
        "name": "参数预览 Workflow",
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成回答",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.question"},
                "output_mapping": {"answer": "context.answer"},
                "config": {"model": "workflow-model", "temperature": {"type": "expression", "path": "row.temperature"}},
            },
            {"node_id": "report", "node_type": "output", "label": "报告"},
        ],
        "edges": [{"source": "answer", "target": "report"}],
    }

    preview = client.post(
        "/workflow-graphs/parameter-preview",
        json={"graph": graph, "sample_row": {"question": "Q", "temperature": 0.3}, "task_overrides": {"answer": {"model": "task-model"}}},
    )
    assert preview.status_code == 200
    payload = preview.json()
    assert payload["nodes"][0]["node_id"] == "answer"
    assert payload["nodes"][0]["resolved_config"]["model"] == "task-model"
    assert payload["nodes"][0]["parameter_trace"]["temperature"]["source"] == "runtime_expression"

    bad_preview = client.post(
        "/workflow-graphs/parameter-preview",
        json={"graph": graph, "sample_row": {"question": "Q"}, "task_overrides": {}},
    )
    assert bad_preview.status_code == 400
    assert bad_preview.json()["code"] == "PARAMETER_PREVIEW_FAILED"
    assert "row.temperature" in bad_preview.json()["details"]["errors"][0]["message"]
