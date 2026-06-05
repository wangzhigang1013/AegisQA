import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import _get_record, _save_record, create_app


def _write_jsonl(path: Path) -> None:
    rows = [
        {"question": "AegisQA 是什么?", "reference": "AI 评测工作台", "expected_label": "pass"},
        {"question": "支付失败怎么办?", "reference": "联系人工客服", "expected_label": "pass"},
    ]
    path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows), encoding="utf-8")


def _graph_payload(name: str = "生产门禁 Workflow") -> dict[str, object]:
    return {
        "name": name,
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成回答",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.question"},
                "output_mapping": {"answer": "context.answer"},
                "config": {"model": "flow-model", "temperature": 0},
            },
            {
                "node_id": "judge",
                "node_type": "skill",
                "label": "质量裁判",
                "skill_ref": "llm.judge@0.1.0",
                "input_mapping": {"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
                "output_mapping": {"score": "metrics.judge_score", "label": "context.judge_label"},
                "config": {"threshold": 0.1},
            },
        ],
        "edges": [{"source": "answer", "target": "judge"}],
    }


def _seed_executed_task_and_experiment(tmp_path: Path) -> tuple[TestClient, dict[str, object], dict[str, object], dict[str, object], dict[str, object]]:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "production_flow.jsonl"
    _write_jsonl(data_path)
    dataset = client.post(
        "/datasets/from-path",
        json={"name": "production_flow", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "生产门禁任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "quality_gate": {"pass_rate": 0.0, "max_badcase_count": 10},
        },
    ).json()
    task = client.post(f"/tasks/{task['task_id']}/execute").json()
    experiment = client.post("/experiments/from-run", json={"run_id": task["run_id"], "name": "候选实验"}).json()
    return client, dataset, workflow, task, experiment


def _create_promotion_review(client: TestClient, workflow: dict[str, object], task: dict[str, object], experiment: dict[str, object]) -> dict[str, object]:
    candidate = {
        "candidate_id": "candidate-production-gate",
        "kind": "prompt_skill_version_diff",
        "status": "retested",
        "source_task_id": task["task_id"],
        "source_run_id": task["run_id"],
        "retest_task_id": task["task_id"],
        "candidate_run_id": task["run_id"],
        "candidate_experiment_id": experiment["experiment_id"],
        "candidate_workflow_version_id": workflow["version_id"],
        "current_versions": [],
        "version_diffs": [],
        "scorecard": {
            "current": {"workflow_version_id": workflow["version_id"]},
            "candidate": {"workflow_version_id": workflow["version_id"], "task_id": task["task_id"], "run_id": task["run_id"]},
        },
        "comparisons": {"current_to_candidate": {"pass_rate_delta": 0.0}},
        "promotion_recommendation": {"decision": "promote", "summary": "候选版本达到发布门槛。", "checks": []},
        "created_at": "2026-06-04T00:00:00+00:00",
        "updated_at": "2026-06-04T00:00:00+00:00",
    }
    _save_record(client.app.state.store, "prompt_skill_candidates", "candidate_id", candidate)
    return client.post(
        f"/prompt-skill-candidates/{candidate['candidate_id']}/promotion-review",
        json={"requester": "qa_owner", "note": "提交生产发布审批。"},
    ).json()["review"]


def test_workflow_promotion_approval_requires_active_ci_gate(tmp_path: Path) -> None:
    client, _, workflow, task, experiment = _seed_executed_task_and_experiment(tmp_path)
    review = _create_promotion_review(client, workflow, task, experiment)

    response = client.post(
        f"/workflow-promotion-reviews/{review['review_id']}/approve",
        json={"reviewer": "release_owner", "note": "没有 CI Gate 时不能批准。"},
    )

    assert response.status_code == 409
    assert response.json()["code"] == "WORKFLOW_PROMOTION_CI_GATE_REQUIRED"
    stored_review = _get_record(client.app.state.store, "workflow_promotion_reviews", review["review_id"])
    stored_candidate = _get_record(client.app.state.store, "prompt_skill_candidates", "candidate-production-gate")
    assert stored_review["status"] == "pending_review"
    assert stored_candidate["status"] == "promotion_review_pending"


def test_baseline_apply_forces_ci_gate_and_records_guard_and_impact(tmp_path: Path) -> None:
    client, dataset, workflow, task, experiment = _seed_executed_task_and_experiment(tmp_path)
    suggestion = {
        "suggestion_id": "baseline-suggestion-production",
        "candidate_id": "candidate-production-gate",
        "review_id": "promotion-review-production",
        "status": "pending_apply",
        "suggested_experiment_id": experiment["experiment_id"],
        "suggested_run_id": experiment["run_id"],
        "previous_baseline_experiment_id": None,
        "previous_baseline_run_id": None,
        "workflow_version_id": workflow["version_id"],
        "metrics": experiment["metrics"],
        "baseline_metrics": None,
        "reason": "测试 baseline apply 门禁。",
        "target_url": "/experiments?baseline_suggestion_id=baseline-suggestion-production",
        "created_at": "2026-06-04T00:00:00+00:00",
        "updated_at": "2026-06-04T00:00:00+00:00",
    }
    _save_record(client.app.state.store, "experiment_baseline_suggestions", "suggestion_id", suggestion)

    missing_gate = client.post(
        "/experiment-baseline-suggestions/baseline-suggestion-production/apply",
        json={"actor": "release_owner", "note": "缺少 CI Gate。"},
    )

    assert missing_gate.status_code == 409
    assert missing_gate.json()["code"] == "BASELINE_APPLY_CI_GATE_REQUIRED"

    blocking_gate = client.post(
        "/ci-gates",
        json={
            "name": "阻断发布门禁",
            "gates": [{"gate_id": "pass-rate", "metric": "pass_rate", "operator": ">=", "threshold": 1.1, "blocking": True}],
        },
    ).json()
    blocked = client.post(
        "/experiment-baseline-suggestions/baseline-suggestion-production/apply",
        json={"actor": "release_owner", "note": "门禁失败不能应用。"},
    )
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "BASELINE_APPLY_CI_GATE_BLOCKED"
    assert blocked.json()["details"]["ci_gate_guard"]["status"] == "blocked"

    blocking_gate["status"] = "disabled"
    _save_record(client.app.state.store, "ci_gate_configs", "config_id", blocking_gate)
    passing_gate = client.post(
        "/ci-gates",
        json={
            "name": "通过发布门禁",
            "gates": [{"gate_id": "pass-rate", "metric": "pass_rate", "operator": ">=", "threshold": 0.0, "blocking": True}],
        },
    ).json()
    applied = client.post(
        "/experiment-baseline-suggestions/baseline-suggestion-production/apply",
        json={"actor": "release_owner", "note": "通过 CI Gate 后应用 baseline。"},
    ).json()

    assert applied["status"] == "applied"
    assert applied["ci_gate_guard"]["status"] == "passed"
    assert applied["ci_gate_guard"]["ci_gate_evaluations"][0]["config_id"] == passing_gate["config_id"]
    assert applied["impact"]["scope"]["dataset_id"] == dataset["dataset_id"]
    assert applied["baseline"]["history"][-1]["ci_gate_guard_status"] == "passed"
    assert applied["baseline"]["history"][-1]["note"] == "通过 CI Gate 后应用 baseline。"
    assert applied["suggestion"]["apply_ci_gate_guard_status"] == "passed"
    assert applied["suggestion"]["apply_impact"]["summary"]["affected_tasks"] >= 1

    _save_record(
        client.app.state.store,
        "workflow_release_records",
        "record_id",
        {
            "record_id": "workflow-release-production",
            "candidate_id": "candidate-production-gate",
            "review_id": "promotion-review-production",
            "workflow_version_id": workflow["version_id"],
            "candidate_experiment_id": experiment["experiment_id"],
            "source_task_id": task["task_id"],
            "retest_task_id": task["task_id"],
            "status": "ready_to_release",
            "ci_gate_config_ids": [passing_gate["config_id"]],
            "ci_gate_evaluation_ids": [applied["ci_gate_guard"]["ci_gate_evaluations"][0]["evaluation_id"]],
            "blocking_failures": 0,
            "approved_by": "release_owner",
            "approval_note": "通过 CI Gate 后可发布。",
            "created_at": "2026-06-04T00:00:00+00:00",
            "updated_at": "2026-06-04T00:00:00+00:00",
        },
    )
    report = client.get(f"/tasks/{task['task_id']}/report").json()
    assert report["release_context"]["baselines"][0]["baseline_id"] == applied["baseline"]["baseline_id"]
    assert report["release_context"]["baselines"][0]["current_experiment_id"] == experiment["experiment_id"]
    assert report["release_context"]["release_records"][0]["record_id"] == "workflow-release-production"
    assert report["release_context"]["release_records"][0]["approval_note"] == "通过 CI Gate 后可发布。"
