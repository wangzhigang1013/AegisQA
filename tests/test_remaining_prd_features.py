import json
from pathlib import Path

from aegisqa.datasets.service import DatasetService
from aegisqa.engine.runner import RunRequest, WorkflowRunner
from aegisqa.judge.profiles import JudgeProfileService
from aegisqa.reports.multirun import aggregate_repeat_items
from aegisqa.skills.registry import SkillRegistry
from aegisqa.storage.json_store import JsonStore
from aegisqa.workflows.dag import DAGWorkflow, DAGWorkflowStep
from aegisqa.workflows.models import WorkflowDraft, WorkflowStep
from aegisqa.workflows.service import WorkflowService


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _workflow() -> WorkflowDraft:
    return WorkflowDraft(
        name="remaining_prd",
        steps=[
            WorkflowStep(
                step_id="answer",
                skill_ref="llm.call@0.1.0",
                input_mapping={"prompt": "row.question"},
                output_mapping={"answer": "context.answer"},
                config={"model": "demo-model", "temperature": 0},
                cacheable=True,
            ),
            WorkflowStep(
                step_id="judge",
                skill_ref="llm.judge@0.1.0",
                input_mapping={"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
                output_mapping={"score": "metrics.judge_score", "label": "context.judge_label"},
                config={"threshold": 0.6},
            ),
        ],
    )


def test_workflow_copy_archive_dry_run_dataset_type_correction_and_pause_resume(tmp_path: Path) -> None:
    store = JsonStore(tmp_path / "store")
    dataset_service = DatasetService(store)
    registry = SkillRegistry.with_builtin_skills()
    workflow_service = WorkflowService(store, registry)
    runner = WorkflowRunner(store, dataset_service, registry)
    data_path = tmp_path / "sample.jsonl"
    _write_jsonl(
        data_path,
        [
            {"question": "Q1", "reference": "AegisQA", "expected_label": "pass"},
            {"question": "Q2", "reference": "不存在", "expected_label": "fail"},
            {"question": "Q3", "reference": "AegisQA", "expected_label": "pass"},
        ],
    )
    dataset = dataset_service.upload_dataset("typed", data_path, golden=True, label_field="expected_label")
    corrected = dataset_service.correct_field_type(dataset.dataset_id, dataset.version, "expected_label", "enum:pass,fail")
    assert corrected.field_schema["expected_label"] == "enum:pass,fail"

    published = workflow_service.publish(_workflow())
    copied = workflow_service.copy_workflow(published.version_id, name="复制后的工作流")
    archived = workflow_service.archive(published.version_id)
    assert copied.name == "复制后的工作流"
    assert archived.status == "archived"

    dry_run = runner.dry_run(published, dataset.dataset_id, dataset.version, sample_size=2)
    assert dry_run.total_items == 2
    assert dry_run.status == "completed"

    run = runner.create_run(RunRequest(workflow=published, dataset_id=dataset.dataset_id, dataset_version=dataset.version))
    runner.pause_run(run.run_id)
    paused = runner.execute_run(run.run_id)
    assert paused.status == "paused"
    resumed = runner.resume_run(run.run_id)
    assert resumed.status == "completed"


def test_judge_profile_persistence_bias_analysis_cross_validation_and_repeat_report(tmp_path: Path) -> None:
    store = JsonStore(tmp_path / "store")
    service = JudgeProfileService(store)
    profile = service.create_profile(
        name="客服 RAG 裁判",
        model="judge-model",
        prompt="请判断回答是否命中参考答案",
        rubric={"pass": "命中", "fail": "未命中"},
        threshold=0.6,
        output_schema={"type": "object", "properties": {"label": {"type": "string"}}},
    )
    assert service.get_profile(profile.profile_id).version == 1

    audit = service.audit_and_store(
        profile.profile_id,
        dataset_version_id="golden:v1",
        human_labels=["pass", "pass", "fail", "fail", "fail"],
        judge_labels=["pass", "fail", "pass", "fail", "pass"],
        positive_label="pass",
    )
    stored = service.list_audits(profile.profile_id)
    assert stored[0].audit_id == audit.audit_id

    bias = service.bias_analysis(audit.audit_id)
    assert bias["label_bias"]["pass"]["false_positive"] == 2
    assert len(bias["high_confidence_misclassified"]) == 3

    cross = service.cross_validate(
        dataset_version_id="golden:v1",
        human_labels=["pass", "fail"],
        judge_outputs_by_profile={
            profile.profile_id: ["pass", "fail"],
            "judge-v2": ["fail", "fail"],
        },
    )
    assert cross["profile_count"] == 2
    assert cross["pairwise_agreement"][f"{profile.profile_id}|judge-v2"] == 0.5

    repeat_summary = aggregate_repeat_items(
        [
            {"row_id": "1", "label": "pass", "score": 0.9},
            {"row_id": "1", "label": "fail", "score": 0.3},
            {"row_id": "1", "label": "pass", "score": 0.8},
        ]
    )
    assert repeat_summary["rows"]["1"]["majority_vote_label"] == "pass"
    assert repeat_summary["rows"]["1"]["pass_probability"] == 2 / 3
    assert repeat_summary["unstable_row_ids"] == ["1"]


def test_db_api_source_manifests_and_minimal_dag_topology() -> None:
    registry = SkillRegistry.with_builtin_skills()
    skill_ids = {skill.skill_id for skill in registry.list_skills()}
    assert {"source.db_query@0.1.0", "source.api_pull@0.1.0"} <= skill_ids

    dag = DAGWorkflow(
        name="dag_demo",
        steps=[
            DAGWorkflowStep(step_id="load", skill_ref="source.api_pull@0.1.0"),
            DAGWorkflowStep(step_id="answer", skill_ref="llm.call@0.1.0", depends_on=["load"]),
            DAGWorkflowStep(step_id="judge", skill_ref="llm.judge@0.1.0", depends_on=["answer"]),
        ],
    )

    assert dag.topological_order() == ["load", "answer", "judge"]

