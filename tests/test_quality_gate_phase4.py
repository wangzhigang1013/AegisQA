from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
from aegisqa.api.app import _ci_gate_metrics_from_run
from aegisqa.engine.runner import RunItem, RunItemStep, RunRecord
from aegisqa.quality.gates import GateEvaluator
from aegisqa.quality.models import GateContext, GateRule
from aegisqa.quality.rules import build_standard_gate_rules
from aegisqa.workflows.models import WorkflowDraft, WorkflowStep


def test_gate_evaluator_fails_blocking_rule_and_skips_missing_metric() -> None:
    evaluator = GateEvaluator()
    result = evaluator.evaluate(
        GateContext(metrics={"pass_rate": 0.72}, target={"kind": "task", "id": "task-1"}),
        [
            GateRule(rule_id="pass-rate", metric="pass_rate", operator=">=", threshold=0.8, blocking=True),
            GateRule(rule_id="cost-budget", metric="total_cost", operator="<=", threshold=1.0, blocking=True),
        ],
    )

    assert result.decision == "failed"
    assert result.blocking_failures == 1
    assert [item.status for item in result.quality_checks] == ["failed", "skipped"]
    assert result.quality_checks[1].reason == "metric_unavailable"


def test_ci_gate_evaluate_uses_skipped_for_unavailable_metrics(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    result = client.post(
        "/ci-gates/evaluate",
        json={
            "metrics": {},
            "gates": [
                {"gate_id": "cost-budget", "metric": "total_cost", "operator": "<=", "threshold": 1.0, "blocking": True}
            ],
        },
    ).json()

    assert result["status"] == "skipped"
    assert result["blocking_failures"] == 0
    assert result["results"][0]["status"] == "skipped"
    assert result["results"][0]["reason"] == "metric_unavailable"
    assert result["gate_evaluation"]["decision"] == "skipped"
    assert result["quality_checks"][0]["status"] == "skipped"


def test_task_preflight_exposes_unified_quality_checks_and_gate_evaluation(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_dataset.jsonl"
    with data_path.open("w", encoding="utf-8") as handle:
        handle.write(json.dumps({"question": "hello"}, ensure_ascii=False) + "\n")

    dataset = client.post("/datasets/from-path", json={"name": "phase4_dataset", "path": str(data_path)}).json()
    workflow = client.post(
        "/workflow-graphs/publish",
        json={
            "graph": {
                "name": "phase4_workflow",
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

    preflight = client.post(
        "/tasks/preflight",
        json={
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "exploration",
            "quality_gate": {},
        },
    ).json()

    assert "quality_checks" in preflight
    assert "gate_evaluation" in preflight
    assert preflight["gate_evaluation"]["decision"] in {"passed", "skipped"}
    assert any(check["check_id"] == "quality_gate" and check["status"] == "skipped" for check in preflight["quality_checks"])


def test_task_report_exposes_quality_gate_evaluation_when_gate_is_configured(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "report_gate_dataset.jsonl"
    with data_path.open("w", encoding="utf-8") as handle:
        handle.write(json.dumps({"question": "hello"}, ensure_ascii=False) + "\n")
    dataset = client.post("/datasets/from-path", json={"name": "report_gate_dataset", "path": str(data_path)}).json()
    workflow = client.post(
        "/workflow-graphs/publish",
        json={
            "graph": {
                "name": "report_gate_workflow",
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
    task = client.post(
        "/tasks",
        json={
            "name": "Report Gate Task",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "quality_gate": {"pass_rate": 1.0, "max_badcase_count": 0},
        },
    ).json()
    client.post(f"/tasks/{task['task_id']}/execute")

    report = client.get(f"/tasks/{task['task_id']}/report").json()

    assert {check["check_id"] for check in report["quality_checks"]} >= {"pass_rate_gate", "badcase_count_gate"}
    assert report["gate_evaluation"]["decision"] == "failed"
    assert report["gate_evaluation"]["results"] == report["quality_checks"]
    assert report["gate_evaluation"]["failed_blocking_rules"][0]["check_id"] == "pass_rate_gate"
    assert report["gate_evaluation"]["failed_blocking_rules"][0]["evidence"]["actual"] == 0.0
    assert "Quality checks are not configured." not in report["unavailable_reasons"]


def test_standard_gate_rule_catalog_covers_reality_first_rules() -> None:
    rules = {rule.rule_id: rule for rule in build_standard_gate_rules({"cost_budget": 1.5})}

    assert set(rules) >= {
        "workflow_graph_valid",
        "skill_approved",
        "input_mapping_resolvable",
        "skill_input_schema_compliance",
        "skill_output_schema_compliance",
        "step_error_rate",
        "run_item_failure_rate",
        "latency_threshold",
        "llm_json_parse_rate",
        "prompt_output_schema_rate",
        "cost_budget",
        "golden_accuracy",
    }
    assert rules["cost_budget"].metric == "total_cost"
    assert rules["cost_budget"].threshold == 1.5


def test_ci_gate_metrics_from_run_exposes_real_step_and_prompt_rates() -> None:
    workflow = WorkflowDraft(
        name="phase4 metrics",
        steps=[WorkflowStep(step_id="judge", skill_ref="skill.judge@1.0.0")],
    ).publish()
    run = RunRecord(
        run_id="run-phase4",
        status="failed",
        workflow=workflow,
        dataset_id="ds-1",
        dataset_version=1,
        chunk_size=100,
        concurrency=1,
        created_at="2026-06-03T00:00:00+00:00",
        items=[
            RunItem(
                item_id="item-1",
                run_id="run-phase4",
                row_id="row-1",
                row_index=0,
                row_hash="h1",
                status="succeeded",
                metrics={"judge_score": 1.0},
                steps=[
                    RunItemStep(
                        step_id="judge",
                        skill_ref="skill.judge@1.0.0",
                        status="succeeded",
                        prompt_calls=[{"status": "succeeded", "error_code": None, "schema_validation": {"valid": True}}],
                    )
                ],
            ),
            RunItem(
                item_id="item-2",
                run_id="run-phase4",
                row_id="row-2",
                row_index=1,
                row_hash="h2",
                status="failed",
                steps=[
                    RunItemStep(
                        step_id="judge",
                        skill_ref="skill.judge@1.0.0",
                        status="failed",
                        error={"code": "OUTPUT_SCHEMA_INVALID"},
                        prompt_calls=[{"status": "failed", "error_code": "JSON_PARSE_ERROR", "schema_validation": {"valid": False}}],
                    )
                ],
            ),
        ],
    )

    metrics = _ci_gate_metrics_from_run(run)

    assert metrics["step_error_rate"] == 0.5
    assert metrics["run_item_failure_rate"] == 0.5
    assert metrics["llm_json_parse_rate"] == 0.5
    assert metrics["prompt_output_schema_rate"] == 0.5
