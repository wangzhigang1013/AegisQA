import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _graph_payload() -> dict[str, object]:
    return {
        "name": "全流程优化 Workflow",
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成回答",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.question"},
                "output_mapping": {"answer": "context.answer", "tokens": "metrics.tokens"},
                "config": {"model": "flow-model", "temperature": 0, "prompt_version": "prompt-flow-v1"},
                "cacheable": True,
            },
            {
                "node_id": "judge",
                "node_type": "skill",
                "label": "质量裁判",
                "skill_ref": "llm.judge@0.1.0",
                "input_mapping": {"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
                "output_mapping": {"score": "metrics.judge_score", "label": "context.judge_label"},
                "config": {"threshold": 0.6, "prompt_version": "judge-flow-v1"},
            },
            {"node_id": "report", "node_type": "output", "label": "报告"},
        ],
        "edges": [{"source": "answer", "target": "judge"}, {"source": "judge", "target": "report"}],
    }


def _seed_dataset_and_workflow(tmp_path: Path, *, include_reference: bool) -> tuple[TestClient, dict[str, object], dict[str, object]]:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_flow.jsonl"
    rows: list[dict[str, object]] = [
        {"question": "AegisQA 是什么?", "expected_label": "pass", "scene": "faq"},
        {"question": "支付失败怎么办?", "expected_label": "fail", "scene": "payment"},
    ]
    if include_reference:
        rows[0]["reference"] = "AegisQA 是 AI 评测工作台。"
        rows[1]["reference"] = "完全不相关答案"
    _write_jsonl(data_path, rows)

    dataset = client.post(
        "/datasets/from-path",
        json={"name": "task_flow", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    return client, dataset, workflow


def test_task_preflight_blocks_missing_workflow_fields(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=False)

    response = client.post(
        "/tasks/preflight",
        json={
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.8, "max_badcase_count": 0},
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "blocked"
    assert any(check["check_id"] == "field_mapping" and check["status"] == "blocked" for check in result["checks"])


def test_task_stores_goal_gate_preflight_and_creates_repair_tasks(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=True)

    task = client.post(
        "/tasks",
        json={
            "name": "上线门禁任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
        },
    ).json()

    assert task["evaluation_goal"] == "release_gate"
    assert task["quality_gate"]["pass_rate"] == 0.9
    assert task["preflight_result"]["status"] in {"passed", "warning"}

    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()

    assert repair["created_count"] >= 1
    assert client.get(f"/repair-tasks?source_task_id={executed['task_id']}").json()[0]["source_task_id"] == executed["task_id"]


def test_repair_task_status_flow_is_traceable(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    task = client.post(
        "/tasks",
        json={
            "name": "修复闭环任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.95, "max_badcase_count": 0},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()["repair_tasks"][0]

    started = client.post(f"/repair-tasks/{repair['repair_task_id']}/start", json={"owner": "qa_owner"}).json()
    assert started["status"] == "in_progress"
    assert started["owner"] == "qa_owner"
    assert started["started_at"]

    resolved = client.post(f"/repair-tasks/{repair['repair_task_id']}/resolve", json={"resolution_note": "已修复 prompt 并补充 Golden。"}).json()
    assert resolved["status"] == "resolved"
    assert resolved["resolution_note"] == "已修复 prompt 并补充 Golden。"
    assert resolved["resolved_at"]

    reopened = client.post(f"/repair-tasks/{repair['repair_task_id']}/reopen", json={"reason": "复测仍未通过。"}).json()
    assert reopened["status"] == "open"
    assert reopened["reopen_reason"] == "复测仍未通过。"
    assert reopened["reopened_at"]


def test_repair_task_actions_create_traceable_follow_up_work(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    task = client.post(
        "/tasks",
        json={
            "name": "修复动作任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.95, "max_badcase_count": 0},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()["repair_tasks"][0]

    annotation_result = client.post(
        f"/repair-tasks/{repair['repair_task_id']}/actions",
        json={"action": "seed_annotation_queue", "assignee": "qa_owner", "limit": 10},
    ).json()

    assert annotation_result["action"] == "seed_annotation_queue"
    assert annotation_result["result"]["created_count"] >= 1
    assert annotation_result["repair_task"]["action_history"][0]["action"] == "seed_annotation_queue"
    annotation_tasks = client.get(f"/annotation-queue?source_task_id={executed['task_id']}").json()
    assert annotation_tasks
    assert annotation_tasks[0]["assignee"] == "qa_owner"

    gate_result = client.post(
        f"/repair-tasks/{repair['repair_task_id']}/actions",
        json={"action": "evaluate_ci_gate"},
    ).json()

    assert gate_result["action"] == "evaluate_ci_gate"
    assert gate_result["result"]["target"] == {"kind": "task", "id": executed["task_id"]}
    assert gate_result["repair_task"]["action_history"][-1]["action"] == "evaluate_ci_gate"
    evaluations = client.get(f"/ci-gates/evaluations?task_id={executed['task_id']}").json()
    assert evaluations


def test_repair_task_retest_action_creates_attempt_and_compares_result(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    task = client.post(
        "/tasks",
        json={
            "name": "修复后复跑任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.95, "max_badcase_count": 0},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()["repair_tasks"][0]

    result = client.post(
        f"/repair-tasks/{repair['repair_task_id']}/actions",
        json={"action": "retest_and_compare"},
    ).json()

    assert result["action"] == "retest_and_compare"
    assert result["result"]["status"] == "completed"
    assert result["result"]["previous_run_id"] == executed["run_id"]
    assert result["result"]["new_run_id"] != executed["run_id"]
    assert result["result"]["comparison"]["pass_rate_delta"] == 0
    assert result["result"]["comparison"]["badcase_count_delta"] == 0
    assert result["repair_task"]["action_history"][-1]["action"] == "retest_and_compare"
    assert result["repair_task"]["last_action_result"]["result"]["comparison_status"] == "unchanged"

    refreshed_task = client.get(f"/tasks/{executed['task_id']}").json()
    assert refreshed_task["current_attempt"] == 2
    assert refreshed_task["run_id"] == result["result"]["new_run_id"]
    assert refreshed_task["attempts"][0]["run_id"] == executed["run_id"]
    assert refreshed_task["attempts"][1]["report"]["run_id"] == result["result"]["new_run_id"]


def test_repair_task_can_generate_contextual_remediation_plan_after_retest(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    task = client.post(
        "/tasks",
        json={
            "name": "修复建议任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.95, "max_badcase_count": 0},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()["repair_tasks"][0]
    client.post(f"/repair-tasks/{repair['repair_task_id']}/actions", json={"action": "retest_and_compare"})

    result = client.post(
        f"/repair-tasks/{repair['repair_task_id']}/actions",
        json={"action": "generate_remediation_plan"},
    ).json()

    assert result["action"] == "generate_remediation_plan"
    assert result["result"]["status"] == "completed"
    assert result["result"]["comparison_status"] == "unchanged"
    areas = {item["area"] for item in result["result"]["recommendations"]}
    assert {"annotation", "workflow_parameters", "retest"}.issubset(areas)
    assert result["result"]["recommendations"][0]["target_url"]
    assert result["repair_task"]["last_action_result"]["result"]["recommendations"]
    assert result["repair_task"]["action_history"][-1]["action"] == "generate_remediation_plan"


def test_repair_task_can_split_remediation_plan_into_followup_tasks(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    task = client.post(
        "/tasks",
        json={
            "name": "修复建议拆分任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.95, "max_badcase_count": 0},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()["repair_tasks"][0]
    client.post(f"/repair-tasks/{repair['repair_task_id']}/actions", json={"action": "retest_and_compare"})
    client.post(f"/repair-tasks/{repair['repair_task_id']}/actions", json={"action": "generate_remediation_plan"})

    result = client.post(
        f"/repair-tasks/{repair['repair_task_id']}/actions",
        json={"action": "create_followup_repair_tasks"},
    ).json()

    assert result["action"] == "create_followup_repair_tasks"
    assert result["result"]["created_count"] >= 2
    assert result["result"]["reused_count"] == 0
    assert result["repair_task"]["action_history"][-1]["action"] == "create_followup_repair_tasks"
    followups = [item for item in client.get(f"/repair-tasks?source_task_id={executed['task_id']}").json() if item.get("parent_repair_task_id") == repair["repair_task_id"]]
    assert {item["recommended_action"] for item in followups}.issuperset({"seed_annotation_queue", "plan_workflow_parameter_changes"})
    assert all(item["target_url"] for item in followups)

    duplicate = client.post(
        f"/repair-tasks/{repair['repair_task_id']}/actions",
        json={"action": "create_followup_repair_tasks"},
    ).json()

    assert duplicate["result"]["created_count"] == 0
    assert duplicate["result"]["reused_count"] >= result["result"]["created_count"]


def test_repair_task_tree_summarizes_followup_progress(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    task = client.post(
        "/tasks",
        json={
            "name": "修复树进度任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.95, "max_badcase_count": 0},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()["repair_tasks"][0]
    client.post(f"/repair-tasks/{repair['repair_task_id']}/actions", json={"action": "retest_and_compare"})
    client.post(f"/repair-tasks/{repair['repair_task_id']}/actions", json={"action": "generate_remediation_plan"})
    split = client.post(
        f"/repair-tasks/{repair['repair_task_id']}/actions",
        json={"action": "create_followup_repair_tasks"},
    ).json()
    followups = split["result"]["repair_tasks"]

    client.post(f"/repair-tasks/{followups[0]['repair_task_id']}/resolve", json={"resolution_note": "已完成人工审核。"})
    response = client.get(f"/repair-tasks/{repair['repair_task_id']}/tree")

    assert response.status_code == 200
    result = response.json()
    assert result["repair_task"]["repair_task_id"] == repair["repair_task_id"]
    assert result["summary"]["total_children"] >= 2
    assert result["summary"]["resolved_children"] == 1
    assert result["summary"]["open_children"] >= 1
    assert 0 < result["summary"]["completion_rate"] < 1
    assert result["summary"]["overall_status"] == "open"
    assert result["summary"]["blocking_children"]
    assert result["summary"]["next_actions"]
    assert result["children"][0]["parent_repair_task_id"] == repair["repair_task_id"]


def test_repair_task_assignment_due_date_and_overdue_are_traceable(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    task = client.post(
        "/tasks",
        json={
            "name": "修复协作任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.95, "max_badcase_count": 0},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()["repair_tasks"][0]
    client.post(f"/repair-tasks/{repair['repair_task_id']}/actions", json={"action": "retest_and_compare"})
    client.post(f"/repair-tasks/{repair['repair_task_id']}/actions", json={"action": "generate_remediation_plan"})
    split = client.post(
        f"/repair-tasks/{repair['repair_task_id']}/actions",
        json={"action": "create_followup_repair_tasks"},
    ).json()
    followup = split["result"]["repair_tasks"][0]

    assigned = client.post(
        f"/repair-tasks/{followup['repair_task_id']}/assign",
        json={"owner": "dataset_owner", "due_at": "2000-01-01T00:00:00+00:00"},
    )

    assert assigned.status_code == 200
    assigned_payload = assigned.json()
    assert assigned_payload["owner"] == "dataset_owner"
    assert assigned_payload["due_at"] == "2000-01-01T00:00:00+00:00"
    assert assigned_payload["overdue"] is True

    tree = client.get(f"/repair-tasks/{repair['repair_task_id']}/tree").json()
    assert tree["summary"]["overdue_children"] == 1
    assert followup["repair_task_id"] in tree["summary"]["overdue_task_ids"]
    next_action = next(item for item in tree["summary"]["next_actions"] if item["repair_task_id"] == followup["repair_task_id"])
    assert next_action["owner"] == "dataset_owner"
    assert next_action["due_at"] == "2000-01-01T00:00:00+00:00"
    assert next_action["overdue"] is True

    resolved = client.post(
        f"/repair-tasks/{followup['repair_task_id']}/resolve",
        json={"resolution_note": "已完成参数治理复核。"},
    )

    assert resolved.status_code == 200
    assert resolved.json()["overdue"] is False


def test_repair_task_dataset_field_action_returns_fix_plan(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=False)
    task = client.post(
        "/tasks",
        json={
            "name": "数据字段修复任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.95, "max_badcase_count": 0},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair_tasks = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()["repair_tasks"]
    data_repair = next(item for item in repair_tasks if item["cause_type"] == "data_quality")

    result = client.post(
        f"/repair-tasks/{data_repair['repair_task_id']}/actions",
        json={"action": "fix_dataset_fields"},
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["action"] == "fix_dataset_fields"
    assert payload["result"]["status"] == "planned"
    assert payload["result"]["dataset"]["dataset_id"] == dataset["dataset_id"]
    assert payload["result"]["dataset"]["version"] == dataset["version"]
    assert payload["result"]["missing_required_fields"] == ["reference"]
    reference_action = next(item for item in payload["result"]["field_actions"] if item["field"] == "reference")
    assert reference_action["action"] == "add_or_map_field"
    assert reference_action["missing_count"] == dataset["row_count"]
    assert reference_action["required_by_workflow"] is True
    assert payload["result"]["target_url"] == f"/datasets?dataset_id={dataset['dataset_id']}&version={dataset['version']}"
    assert payload["repair_task"]["action_history"][-1]["action"] == "fix_dataset_fields"
    assert payload["repair_task"]["last_action_result"]["result"]["field_actions"]


def test_repair_task_workflow_parameter_action_returns_diff_and_rollback_plan(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    task = client.post(
        "/tasks",
        json={
            "name": "参数回滚任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.95, "max_badcase_count": 0},
            "skill_overrides": {"answer": {"model": "task-quality-model", "temperature": 0.7}},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair_tasks = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()["repair_tasks"]
    parameter_repair = next(item for item in repair_tasks if item["cause_type"] == "parameter_risk")

    result = client.post(
        f"/repair-tasks/{parameter_repair['repair_task_id']}/actions",
        json={"action": "plan_workflow_parameter_changes"},
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["action"] == "plan_workflow_parameter_changes"
    assert payload["result"]["status"] == "planned"
    model_diff = next(item for item in payload["result"]["parameter_diffs"] if item["step_id"] == "answer" and item["parameter"] == "model")
    assert model_diff["source"] == "task_override"
    assert model_diff["workflow_value_preview"] == "flow-model"
    assert model_diff["current_value_preview"] == "task-quality-model"
    assert model_diff["recommended_action"] == "remove_task_override_or_promote_to_workflow"
    assert {"step_id": "answer", "parameter": "model"} in payload["result"]["rollback_plan"]["skill_overrides_remove"]
    assert payload["result"]["target_url"] == f"/reports?task_id={executed['task_id']}&panel=parameter-governance"
    assert payload["repair_task"]["action_history"][-1]["action"] == "plan_workflow_parameter_changes"
