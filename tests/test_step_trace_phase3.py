from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from aegisqa.datasets.service import DatasetService
from aegisqa.engine.runner import RunRequest, WorkflowRunner
from aegisqa.reports.trace_flow import build_task_trace_flow
from aegisqa.skills.base import BaseSkill, SkillManifest, SkillResult
from aegisqa.skills.registry import SkillRegistry
from aegisqa.storage.json_store import JsonStore
from aegisqa.workflows.models import WorkflowDraft, WorkflowStep


def test_step_trace_persists_resolved_raw_validated_and_skill_version(tmp_path: Path) -> None:
    store, dataset_service, dataset = _dataset(tmp_path, [{"question": "Trace?"}])
    registry = SkillRegistry.with_builtin_skills()
    workflow = WorkflowDraft(
        name="trace fields",
        steps=[
            WorkflowStep(
                step_id="answer",
                skill_ref="llm.call@0.1.0",
                input_mapping={"prompt": "row.question"},
                output_mapping={"answer": "context.answer"},
            )
        ],
    ).publish()
    runner = WorkflowRunner(store, dataset_service, registry)

    run = runner.create_run(RunRequest(workflow=workflow, dataset_id=dataset.dataset_id, dataset_version=dataset.version))
    completed = runner.execute_run(run.run_id)
    step = completed.items[0].steps[0]

    assert step.skill_version == "0.1.0"
    assert step.resolved_input == {"prompt": "Trace?"}
    assert step.input_snapshot == step.resolved_input
    assert step.raw_output["answer"].startswith("模型回答：Trace?")
    assert step.validated_output == step.raw_output
    assert step.output_snapshot == step.validated_output
    assert step.schema_errors == []
    flow = build_task_trace_flow({"task_id": "task-demo"}, completed)
    flow_step = flow["items"][0]["steps"][0]
    assert flow_step["resolved_input"] == step.resolved_input
    assert flow_step["raw_output"] == step.raw_output
    assert flow_step["validated_output"] == step.validated_output
    assert flow_step["state"] == "SUCCEEDED"


def test_output_schema_invalid_keeps_raw_output_and_empty_validated_output(tmp_path: Path) -> None:
    store, dataset_service, dataset = _dataset(tmp_path, [{"text": "hello"}])
    registry = SkillRegistry()
    registry.register(InvalidOutputSkill())
    workflow = WorkflowDraft(
        name="invalid output",
        steps=[
            WorkflowStep(
                step_id="bad",
                skill_ref="plugin.invalid_output@0.1.0",
                input_mapping={"text": "row.text"},
            )
        ],
    ).publish()
    runner = WorkflowRunner(store, dataset_service, registry)

    run = runner.create_run(RunRequest(workflow=workflow, dataset_id=dataset.dataset_id, dataset_version=dataset.version))
    failed = runner.execute_run(run.run_id)
    step = failed.items[0].steps[0]

    assert step.status == "failed"
    assert step.state == "SCHEMA_INVALID"
    assert step.raw_output == {"wrong": "hello"}
    assert step.validated_output == {}
    assert step.schema_errors
    assert step.error["code"] == "OUTPUT_SCHEMA_INVALID"


class InvalidOutputSkill(BaseSkill):
    manifest = SkillManifest(
        skill_id="plugin.invalid_output@0.1.0",
        name="Invalid Output",
        version="0.1.0",
        description="Returns output that violates schema",
        input_schema={"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        output_schema={"type": "object", "properties": {"echo": {"type": "string"}}, "required": ["echo"]},
    )

    def run(self, inputs: dict[str, Any], config: dict[str, Any] | None = None) -> SkillResult:
        return SkillResult(output={"wrong": inputs["text"]})


def _dataset(tmp_path: Path, rows: list[dict[str, object]]):
    store = JsonStore(tmp_path / "store")
    dataset_service = DatasetService(store)
    path = tmp_path / "rows.jsonl"
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    dataset = dataset_service.upload_dataset("rows", path)
    return store, dataset_service, dataset
