import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import _save_record, create_app


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


def _graph_payload_with_answer_prompt(prompt_version: str) -> dict[str, object]:
    graph = _graph_payload()
    nodes = graph["nodes"]
    assert isinstance(nodes, list)
    answer = next(node for node in nodes if isinstance(node, dict) and node["node_id"] == "answer")
    config = answer["config"]
    assert isinstance(config, dict)
    config["prompt_version"] = prompt_version
    return graph


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


def test_repair_task_prompt_skill_version_action_compares_with_experiment_baseline(tmp_path: Path) -> None:
    client, dataset, _ = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    baseline_workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload_with_answer_prompt("prompt-flow-v0")}).json()
    baseline_run = client.post(
        "/runs",
        json={"workflow": baseline_workflow, "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"]},
    ).json()
    baseline_run = client.post(f"/runs/{baseline_run['run_id']}/execute").json()
    baseline_experiment = client.post(
        "/experiments/from-run",
        json={"run_id": baseline_run["run_id"], "name": "baseline prompt v0"},
    ).json()
    current_workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload_with_answer_prompt("prompt-flow-v1")}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "Prompt 版本对比任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": current_workflow["version_id"],
            "evaluation_goal": "prompt_experiment",
            "quality_gate": {"pass_rate": 0.95, "max_badcase_count": 0},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()["repair_tasks"][0]

    result = client.post(
        f"/repair-tasks/{repair['repair_task_id']}/actions",
        json={"action": "compare_prompt_skill_versions"},
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["action"] == "compare_prompt_skill_versions"
    current_answer = next(item for item in payload["result"]["current_versions"] if item["step_id"] == "answer")
    assert current_answer["prompt_version"] == "prompt-flow-v1"
    baseline = next(item for item in payload["result"]["baseline_candidates"] if item["experiment_id"] == baseline_experiment["experiment_id"])
    prompt_diff = next(item for item in baseline["version_diffs"] if item["step_id"] == "answer" and item["field"] == "prompt_version")
    assert prompt_diff["baseline_value"] == "prompt-flow-v0"
    assert prompt_diff["current_value"] == "prompt-flow-v1"
    assert prompt_diff["recommended_action"] == "compare_or_rollback_prompt_version"
    assert payload["result"]["candidate_actions"][0]["action"] == "create_prompt_skill_candidate"
    assert payload["repair_task"]["action_history"][-1]["action"] == "compare_prompt_skill_versions"


def test_repair_task_version_diff_actions_materialize_candidate_and_workflow_draft(tmp_path: Path) -> None:
    client, dataset, _ = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    baseline_workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload_with_answer_prompt("prompt-flow-v0")}).json()
    baseline_run = client.post(
        "/runs",
        json={"workflow": baseline_workflow, "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"]},
    ).json()
    baseline_run = client.post(f"/runs/{baseline_run['run_id']}/execute").json()
    baseline_experiment = client.post(
        "/experiments/from-run",
        json={"run_id": baseline_run["run_id"], "name": "baseline prompt v0"},
    ).json()
    current_workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload_with_answer_prompt("prompt-flow-v1")}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "Prompt 版本候选任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": current_workflow["version_id"],
            "evaluation_goal": "prompt_experiment",
            "quality_gate": {"pass_rate": 0.95, "max_badcase_count": 0},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()["repair_tasks"][0]
    client.post(
        f"/repair-tasks/{repair['repair_task_id']}/actions",
        json={"action": "compare_prompt_skill_versions"},
    )

    candidate_result = client.post(
        f"/repair-tasks/{repair['repair_task_id']}/actions",
        json={"action": "create_prompt_skill_candidate"},
    )
    draft_result = client.post(
        f"/repair-tasks/{repair['repair_task_id']}/actions",
        json={"action": "create_workflow_draft_from_version_diff"},
    )

    assert candidate_result.status_code == 200
    candidate_payload = candidate_result.json()
    candidate = candidate_payload["result"]["candidates"][0]
    assert candidate["source_task_id"] == executed["task_id"]
    assert candidate["baseline_experiment_id"] == baseline_experiment["experiment_id"]
    assert candidate["version_diffs"][0]["field"] == "prompt_version"
    assert candidate_payload["repair_task"]["action_history"][-1]["action"] == "create_prompt_skill_candidate"

    assert draft_result.status_code == 200
    draft_payload = draft_result.json()
    draft = draft_payload["result"]["draft"]
    assert draft["status"] == "draft"
    assert draft["source_repair_task_id"] == repair["repair_task_id"]
    answer = next(node for node in draft["graph"]["nodes"] if node["node_id"] == "answer")
    assert answer["config"]["prompt_version"] == "prompt-flow-v0"
    assert draft_payload["repair_task"]["action_history"][-1]["action"] == "create_workflow_draft_from_version_diff"


def test_prompt_skill_candidates_are_reviewed_before_draft_creation(tmp_path: Path) -> None:
    client, dataset, _ = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    baseline_workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload_with_answer_prompt("prompt-flow-v0")}).json()
    baseline_run = client.post(
        "/runs",
        json={"workflow": baseline_workflow, "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"]},
    ).json()
    baseline_run = client.post(f"/runs/{baseline_run['run_id']}/execute").json()
    baseline_experiment = client.post("/experiments/from-run", json={"run_id": baseline_run["run_id"], "name": "baseline prompt v0"}).json()
    current_workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload_with_answer_prompt("prompt-flow-v1")}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "候选资产审批任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": current_workflow["version_id"],
            "evaluation_goal": "prompt_experiment",
            "quality_gate": {"pass_rate": 0.95, "max_badcase_count": 0},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()["repair_tasks"][0]
    client.post(f"/repair-tasks/{repair['repair_task_id']}/actions", json={"action": "compare_prompt_skill_versions"})
    candidate = client.post(f"/repair-tasks/{repair['repair_task_id']}/actions", json={"action": "create_prompt_skill_candidate"}).json()["result"]["candidates"][0]

    listed = client.get(f"/prompt-skill-candidates?source_task_id={executed['task_id']}").json()
    assert [item["candidate_id"] for item in listed] == [candidate["candidate_id"]]
    assert listed[0]["status"] == "candidate"
    assert listed[0]["baseline_experiment_id"] == baseline_experiment["experiment_id"]

    blocked_draft = client.post(f"/prompt-skill-candidates/{candidate['candidate_id']}/workflow-draft")
    assert blocked_draft.status_code == 400
    assert blocked_draft.json()["code"] == "PROMPT_SKILL_CANDIDATE_NOT_APPROVED"

    approved = client.post(
        f"/prompt-skill-candidates/{candidate['candidate_id']}/review",
        json={"decision": "approved", "reviewer": "qa_owner", "note": "baseline 指标更好，允许生成回滚草稿。"},
    ).json()
    assert approved["status"] == "approved"
    assert approved["review"]["reviewer"] == "qa_owner"
    assert approved["review_history"][-1]["decision"] == "approved"

    draft_payload = client.post(f"/prompt-skill-candidates/{candidate['candidate_id']}/workflow-draft").json()
    draft = draft_payload["draft"]
    assert draft["status"] == "draft"
    assert draft["source_candidate_id"] == candidate["candidate_id"]
    answer = next(node for node in draft["graph"]["nodes"] if node["node_id"] == "answer")
    assert answer["config"]["prompt_version"] == "prompt-flow-v0"
    updated_candidate = draft_payload["candidate"]
    assert updated_candidate["status"] == "draft_created"
    assert updated_candidate["workflow_draft_id"] == draft["draft_id"]


def test_prompt_skill_candidate_bulk_governance_and_sla_escalation(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    due_at = "2000-01-01T00:00:00+00:00"
    for index in range(2):
        _save_record(
            client.app.state.store,
            "prompt_skill_candidates",
            "candidate_id",
            {
                "candidate_id": f"candidate-sla-{index}",
                "kind": "prompt_skill_version_diff",
                "status": "candidate",
                "source_task_id": "task-sla",
                "source_run_id": "run-sla",
                "baseline_experiment_id": "exp-baseline",
                "current_versions": [],
                "version_diffs": [{"step_id": "answer", "field": "prompt_version", "baseline_value": "v0", "current_value": "v1"}],
                "recommended_actions": ["create_workflow_draft"],
                "created_at": due_at,
                "updated_at": due_at,
            },
        )

    assigned = client.post(
        "/prompt-skill-candidates/bulk-assign",
        json={"candidate_ids": ["candidate-sla-0", "candidate-sla-1"], "owner": "qa_owner", "due_at": due_at, "actor": "lead"},
    ).json()
    assert assigned["assigned_count"] == 2
    assert all(candidate["owner"] == "qa_owner" for candidate in assigned["candidates"])
    assert all(candidate["overdue"] is True for candidate in assigned["candidates"])

    workload = client.get("/prompt-skill-candidates/workload").json()
    assert workload["summary"]["total_candidates"] == 2
    assert workload["summary"]["total_overdue"] == 2
    assert workload["owners"][0]["owner"] == "qa_owner"
    assert workload["owners"][0]["overdue_count"] == 2

    escalated = client.post("/prompt-skill-candidates/escalate-overdue", json={"actor": "lead"}).json()
    assert escalated["escalated_count"] == 2
    assert escalated["candidates"][0]["escalation_status"] == "escalated"
    assert escalated["candidates"][0]["action_history"][-1]["action"] == "escalate_overdue"

    reviewed = client.post(
        "/prompt-skill-candidates/bulk-review",
        json={"candidate_ids": ["candidate-sla-0", "candidate-sla-1"], "decision": "approved", "reviewer": "qa_owner", "note": "批量通过候选资产。"},
    ).json()
    assert reviewed["reviewed_count"] == 2
    assert all(candidate["status"] == "approved" for candidate in reviewed["candidates"])
    assert reviewed["candidates"][0]["review_history"][-1]["decision"] == "approved"


def test_prompt_skill_candidate_bulk_assign_respects_owner_capacity(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    store = client.app.state.store
    for record in [
        {
            "candidate_id": "candidate-owned-open",
            "kind": "prompt_skill_version_diff",
            "status": "candidate",
            "owner": "qa_owner",
            "source_task_id": "task-capacity",
            "current_versions": [],
            "version_diffs": [],
            "created_at": "2026-05-31T00:00:00Z",
            "updated_at": "2026-05-31T00:00:00Z",
        },
        {
            "candidate_id": "candidate-capacity-1",
            "kind": "prompt_skill_version_diff",
            "status": "candidate",
            "source_task_id": "task-capacity",
            "current_versions": [],
            "version_diffs": [],
            "created_at": "2026-05-31T00:00:00Z",
            "updated_at": "2026-05-31T00:00:00Z",
        },
        {
            "candidate_id": "candidate-capacity-2",
            "kind": "prompt_skill_version_diff",
            "status": "candidate",
            "source_task_id": "task-capacity",
            "current_versions": [],
            "version_diffs": [],
            "created_at": "2026-05-31T00:00:00Z",
            "updated_at": "2026-05-31T00:00:00Z",
        },
    ]:
        _save_record(store, "prompt_skill_candidates", "candidate_id", record)

    assigned = client.post(
        "/prompt-skill-candidates/bulk-assign",
        json={
            "candidate_ids": ["candidate-capacity-1", "candidate-capacity-2"],
            "owner": "qa_owner",
            "due_at": "2026-06-01T00:00:00+00:00",
            "actor": "lead",
            "max_open_per_owner": 2,
        },
    ).json()

    assert assigned["assigned_count"] == 1
    assert assigned["skipped_count"] == 1
    assert assigned["capacity"]["owner"] == "qa_owner"
    assert assigned["capacity"]["max_open_per_owner"] == 2
    assert assigned["capacity"]["open_before"] == 1
    assert assigned["capacity"]["open_after"] == 2
    assert assigned["skipped"][0]["candidate_id"] == "candidate-capacity-2"
    assert assigned["skipped"][0]["reason"] == "owner_capacity_exceeded"
    workload = client.get("/prompt-skill-candidates/workload").json()
    owner = next(item for item in workload["owners"] if item["owner"] == "qa_owner")
    assert owner["open_count"] == 2


def test_prompt_skill_candidate_retest_plan_prioritizes_ready_and_overdue_candidates(tmp_path: Path) -> None:
    client, _, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    store = client.app.state.store
    _save_record(
        store,
        "workflow_drafts",
        "draft_id",
        {"draft_id": "draft-ready", "name": "已发布候选草稿", "status": "published", "published_version_id": workflow["version_id"], "updated_at": "2026-05-31T00:00:00Z"},
    )
    _save_record(
        store,
        "workflow_drafts",
        "draft_id",
        {"draft_id": "draft-needs-publish", "name": "待发布候选草稿", "status": "draft", "updated_at": "2026-05-31T00:00:00Z"},
    )
    for record in [
        {
            "candidate_id": "candidate-ready",
            "status": "draft_created",
            "owner": "qa_owner",
            "workflow_draft_id": "draft-ready",
            "due_at": "2000-01-01T00:00:00+00:00",
            "escalation_status": "escalated",
            "updated_at": "2026-05-31T01:00:00Z",
        },
        {
            "candidate_id": "candidate-needs-publish",
            "status": "draft_created",
            "owner": "workflow_owner",
            "workflow_draft_id": "draft-needs-publish",
            "due_at": "2000-01-01T00:00:00+00:00",
            "updated_at": "2026-05-31T02:00:00Z",
        },
        {
            "candidate_id": "candidate-needs-draft",
            "status": "approved",
            "owner": "qa_owner",
            "updated_at": "2026-05-31T03:00:00Z",
        },
        {
            "candidate_id": "candidate-retested",
            "status": "retested",
            "owner": "release_owner",
            "retest_task_id": "task-candidate",
            "updated_at": "2026-05-31T04:00:00Z",
        },
    ]:
        _save_record(store, "prompt_skill_candidates", "candidate_id", record)

    plan = client.get("/prompt-skill-candidates/retest-plan").json()

    assert plan["summary"]["total_candidates"] == 4
    assert plan["summary"]["ready_for_retest"] == 1
    assert plan["summary"]["needs_publish"] == 1
    assert plan["summary"]["needs_draft"] == 1
    assert plan["items"][0]["candidate_id"] == "candidate-ready"
    assert plan["items"][0]["next_action"] == "retest_candidate"
    assert plan["items"][0]["priority_score"] > plan["items"][1]["priority_score"]
    assert "已升级" in plan["items"][0]["reasons"]
    actions = {item["candidate_id"]: item["next_action"] for item in plan["items"]}
    assert actions["candidate-needs-publish"] == "publish_workflow_draft"
    assert actions["candidate-needs-draft"] == "create_workflow_draft"
    assert actions["candidate-retested"] == "review_retest_result"


def test_prompt_skill_candidate_bulk_retest_runs_ready_candidates_and_skips_blocked(tmp_path: Path) -> None:
    client, dataset, workflow = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    task = client.post(
        "/tasks",
        json={
            "name": "候选批量复跑来源任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "prompt_experiment",
            "quality_gate": {"pass_rate": 0.8, "max_badcase_count": 1},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    store = client.app.state.store
    _save_record(
        store,
        "workflow_drafts",
        "draft_id",
        {"draft_id": "draft-bulk-ready", "name": "可复跑草稿", "status": "published", "published_version_id": workflow["version_id"], "updated_at": "2026-05-31T00:00:00Z"},
    )
    _save_record(
        store,
        "workflow_drafts",
        "draft_id",
        {"draft_id": "draft-bulk-needs-publish", "name": "待发布草稿", "status": "draft", "updated_at": "2026-05-31T00:00:00Z"},
    )
    for record in [
        {
            "candidate_id": "candidate-bulk-ready",
            "kind": "prompt_skill_version_diff",
            "status": "draft_created",
            "source_task_id": executed["task_id"],
            "source_run_id": executed["run_id"],
            "workflow_draft_id": "draft-bulk-ready",
            "current_versions": [],
            "version_diffs": [{"step_id": "answer", "field": "prompt_version", "baseline_value": "v0", "current_value": "v1"}],
            "recommended_actions": ["retest_candidate"],
            "updated_at": "2026-05-31T01:00:00Z",
        },
        {
            "candidate_id": "candidate-bulk-needs-publish",
            "kind": "prompt_skill_version_diff",
            "status": "draft_created",
            "source_task_id": executed["task_id"],
            "source_run_id": executed["run_id"],
            "workflow_draft_id": "draft-bulk-needs-publish",
            "current_versions": [],
            "version_diffs": [{"step_id": "answer", "field": "prompt_version", "baseline_value": "v0", "current_value": "v2"}],
            "recommended_actions": ["publish_workflow_draft"],
            "updated_at": "2026-05-31T02:00:00Z",
        },
    ]:
        _save_record(store, "prompt_skill_candidates", "candidate_id", record)

    result = client.post(
        "/prompt-skill-candidates/bulk-retest",
        json={"candidate_ids": ["candidate-bulk-ready", "candidate-bulk-needs-publish"], "max_count": 10, "actor": "qa_owner"},
    ).json()

    assert result["retested_count"] == 1
    assert result["skipped_count"] == 1
    assert result["results"][0]["candidate_id"] == "candidate-bulk-ready"
    assert result["results"][0]["task_id"].startswith("task-")
    assert result["skipped"][0]["candidate_id"] == "candidate-bulk-needs-publish"
    assert result["skipped"][0]["next_action"] == "publish_workflow_draft"
    updated = client.get("/prompt-skill-candidates?status=retested").json()[0]
    assert updated["candidate_id"] == "candidate-bulk-ready"
    assert updated["action_history"][-1]["action"] == "bulk_retest"
    plan = client.get("/prompt-skill-candidates/retest-plan").json()
    actions = {item["candidate_id"]: item["next_action"] for item in plan["items"]}
    assert actions["candidate-bulk-ready"] == "review_retest_result"
    assert actions["candidate-bulk-needs-publish"] == "publish_workflow_draft"


def test_prompt_skill_candidate_retest_requires_published_draft_and_returns_three_way_metrics(tmp_path: Path) -> None:
    client, dataset, _ = _seed_dataset_and_workflow(tmp_path, include_reference=True)
    baseline_workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload_with_answer_prompt("prompt-flow-v0")}).json()
    baseline_run = client.post(
        "/runs",
        json={"workflow": baseline_workflow, "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"]},
    ).json()
    baseline_run = client.post(f"/runs/{baseline_run['run_id']}/execute").json()
    baseline_experiment = client.post("/experiments/from-run", json={"run_id": baseline_run["run_id"], "name": "baseline prompt v0"}).json()
    current_workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload_with_answer_prompt("prompt-flow-v1")}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "候选资产复跑任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": current_workflow["version_id"],
            "evaluation_goal": "prompt_experiment",
            "quality_gate": {"pass_rate": 0.95, "max_badcase_count": 0},
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()["repair_tasks"][0]
    client.post(f"/repair-tasks/{repair['repair_task_id']}/actions", json={"action": "compare_prompt_skill_versions"})
    candidate = client.post(f"/repair-tasks/{repair['repair_task_id']}/actions", json={"action": "create_prompt_skill_candidate"}).json()["result"]["candidates"][0]
    client.post(f"/prompt-skill-candidates/{candidate['candidate_id']}/review", json={"decision": "approved", "reviewer": "qa_owner"})
    draft = client.post(f"/prompt-skill-candidates/{candidate['candidate_id']}/workflow-draft").json()["draft"]

    blocked = client.post(f"/prompt-skill-candidates/{candidate['candidate_id']}/retest")
    assert blocked.status_code == 400
    assert blocked.json()["code"] == "PROMPT_SKILL_CANDIDATE_DRAFT_NOT_PUBLISHED"

    published = client.post(f"/workflow-drafts/{draft['draft_id']}/publish").json()
    retest = client.post(f"/prompt-skill-candidates/{candidate['candidate_id']}/retest").json()

    assert retest["status"] == "retested"
    assert retest["task"]["dataset_id"] == dataset["dataset_id"]
    assert retest["task"]["dataset_version"] == dataset["version"]
    assert retest["task"]["workflow_version_id"] == published["version_id"]
    assert retest["task"]["status"] == "completed"
    assert retest["scorecard"]["baseline"]["experiment_id"] == baseline_experiment["experiment_id"]
    assert retest["scorecard"]["current"]["task_id"] == executed["task_id"]
    assert retest["scorecard"]["candidate"]["task_id"] == retest["task"]["task_id"]
    assert "pass_rate_delta" in retest["comparisons"]["current_to_candidate"]
    recommendation = retest["promotion_recommendation"]
    assert recommendation["decision"] == "hold"
    assert recommendation["thresholds"]["pass_rate"] == 0.95
    assert recommendation["thresholds"]["max_badcase_count"] == 0
    assert any(check["check_id"] == "pass_rate_gate" and check["status"] == "failed" for check in recommendation["checks"])
    assert any(check["check_id"] == "current_improvement" and check["status"] == "warning" for check in recommendation["checks"])
    assert recommendation["next_actions"][0]["action"] == "open_candidate_report"
    updated_candidate = retest["candidate"]
    assert updated_candidate["status"] == "retested"
    assert updated_candidate["retest_task_id"] == retest["task"]["task_id"]
    assert updated_candidate["candidate_experiment_id"] == retest["candidate_experiment"]["experiment_id"]
    assert updated_candidate["promotion_recommendation"]["decision"] == "hold"

    cached = client.post(f"/prompt-skill-candidates/{candidate['candidate_id']}/retest").json()
    assert cached["promotion_recommendation"]["decision"] == "hold"

    blocked_review = client.post(
        f"/prompt-skill-candidates/{candidate['candidate_id']}/promotion-review",
        json={"requester": "qa_owner", "note": "尝试创建晋升审批。"},
    )
    assert blocked_review.status_code == 400
    assert blocked_review.json()["code"] == "PROMPT_SKILL_CANDIDATE_PROMOTION_NOT_RECOMMENDED"

    promotable_candidate = cached["candidate"]
    promotable_candidate["promotion_recommendation"] = {
        **cached["promotion_recommendation"],
        "decision": "promote",
        "summary": "建议晋升：候选版本已达到质量门槛，并且相对当前版本有明确改善。",
        "next_actions": [{"action": "create_promotion_review", "label": "创建 Workflow 晋升审批"}],
    }
    _save_record(client.app.state.store, "prompt_skill_candidates", "candidate_id", promotable_candidate)
    promotion_review_payload = client.post(
        f"/prompt-skill-candidates/{candidate['candidate_id']}/promotion-review",
        json={"requester": "qa_owner", "note": "候选指标达标，提交晋升审批。"},
    ).json()
    promotion_review = promotion_review_payload["review"]
    assert promotion_review_payload["candidate"]["status"] == "promotion_review_pending"
    assert promotion_review["status"] == "pending_review"
    assert promotion_review["candidate_id"] == candidate["candidate_id"]
    assert promotion_review["candidate_workflow_version_id"] == retest["scorecard"]["candidate"]["workflow_version_id"]
    assert promotion_review["promotion_recommendation"]["decision"] == "promote"
    assert promotion_review["target_url"] == f"/workflows?workflow_version_id={promotion_review['candidate_workflow_version_id']}"
    listed_reviews = client.get(f"/workflow-promotion-reviews?candidate_id={candidate['candidate_id']}").json()
    assert listed_reviews[0]["review_id"] == promotion_review["review_id"]

    cached_review = client.post(f"/prompt-skill-candidates/{candidate['candidate_id']}/promotion-review").json()["review"]
    assert cached_review["review_id"] == promotion_review["review_id"]

    gate_config = client.post(
        "/ci-gates",
        json={
            "name": "Workflow 晋升发布门禁",
            "gates": [{"gate_id": "pass-rate", "metric": "pass_rate", "operator": ">=", "threshold": 0.0, "blocking": True}],
        },
    ).json()
    approved_review = client.post(
        f"/workflow-promotion-reviews/{promotion_review['review_id']}/approve",
        json={"reviewer": "release_owner", "note": "同意晋升为推荐 Workflow 版本。"},
    ).json()
    assert approved_review["review"]["status"] == "approved"
    assert approved_review["candidate"]["status"] == "promoted"
    assert approved_review["candidate"]["promoted_workflow_version_id"] == promotion_review["candidate_workflow_version_id"]
    artifacts = approved_review["release_artifacts"]
    baseline_suggestion = artifacts["baseline_suggestion"]
    assert baseline_suggestion["status"] == "pending_apply"
    assert baseline_suggestion["candidate_id"] == candidate["candidate_id"]
    assert baseline_suggestion["suggested_experiment_id"] == retest["candidate_experiment"]["experiment_id"]
    assert baseline_suggestion["previous_baseline_experiment_id"] == baseline_experiment["experiment_id"]
    release_record = artifacts["release_record"]
    assert release_record["status"] == "ready_to_release"
    assert release_record["workflow_version_id"] == promotion_review["candidate_workflow_version_id"]
    assert release_record["ci_gate_config_ids"] == [gate_config["config_id"]]
    assert release_record["blocking_failures"] == 0
    assert artifacts["ci_gate_evaluations"][0]["source"] == "workflow_promotion_review"
    assert approved_review["review"]["baseline_suggestion_id"] == baseline_suggestion["suggestion_id"]
    assert approved_review["review"]["release_record_id"] == release_record["record_id"]
    assert approved_review["candidate"]["baseline_suggestion_id"] == baseline_suggestion["suggestion_id"]
    assert approved_review["candidate"]["release_record_id"] == release_record["record_id"]
    assert client.get(f"/experiment-baseline-suggestions?candidate_id={candidate['candidate_id']}").json()[0]["suggestion_id"] == baseline_suggestion["suggestion_id"]
    assert client.get(f"/workflow-release-records?review_id={promotion_review['review_id']}").json()[0]["record_id"] == release_record["record_id"]
    assert client.get(f"/ci-gates/evaluations?task_id={retest['task']['task_id']}").json()[0]["evaluation_id"] == artifacts["ci_gate_evaluations"][0]["evaluation_id"]

    applied_baseline = client.post(
        f"/experiment-baseline-suggestions/{baseline_suggestion['suggestion_id']}/apply",
        json={"actor": "release_owner", "note": "候选版本通过发布门禁，应用为新 baseline。"},
    ).json()
    assert applied_baseline["suggestion"]["status"] == "applied"
    assert applied_baseline["baseline"]["current_experiment_id"] == retest["candidate_experiment"]["experiment_id"]
    assert applied_baseline["baseline"]["previous_experiment_id"] == baseline_experiment["experiment_id"]
    assert applied_baseline["baseline"]["history"][-1]["action"] == "apply"
    assert applied_baseline["notifications"][0]["action"] == "apply"
    assert applied_baseline["notifications"][0]["status"] == "unread"
    assert "release_owner" in applied_baseline["notifications"][0]["recipients"]
    assert applied_baseline["notifications"][0]["summary"]["affected_tasks"] >= 1
    listed_notifications = client.get(f"/baseline-change-notifications?suggestion_id={baseline_suggestion['suggestion_id']}").json()
    assert listed_notifications[0]["notification_id"] == applied_baseline["notifications"][0]["notification_id"]
    acknowledged_notification = client.post(
        f"/baseline-change-notifications/{listed_notifications[0]['notification_id']}/ack",
        json={"actor": "qa_owner", "note": "已同步给评测负责人。"},
    ).json()
    assert acknowledged_notification["status"] == "acknowledged"
    assert acknowledged_notification["acknowledged_by"] == "qa_owner"
    listed_baselines = client.get(f"/experiment-baselines?workflow_id={applied_baseline['baseline']['scope']['workflow_id']}").json()
    assert listed_baselines[0]["baseline_id"] == applied_baseline["baseline"]["baseline_id"]
    impact = client.get(f"/experiment-baseline-suggestions/{baseline_suggestion['suggestion_id']}/impact").json()
    assert impact["suggestion_id"] == baseline_suggestion["suggestion_id"]
    assert impact["scope"]["dataset_id"] == dataset["dataset_id"]
    assert impact["suggested_experiment_id"] == retest["candidate_experiment"]["experiment_id"]
    assert impact["previous_baseline_experiment_id"] == baseline_experiment["experiment_id"]
    assert impact["metric_delta"]["pass_rate_delta"] == retest["comparisons"]["baseline_to_candidate"]["pass_rate_delta"]
    assert impact["summary"]["affected_tasks"] >= 1
    assert impact["recommendations"][0]["action"] == "apply_baseline"

    rolled_back_baseline = client.post(
        f"/experiment-baseline-suggestions/{baseline_suggestion['suggestion_id']}/rollback",
        json={"actor": "release_owner", "note": "回滚到原 baseline。"},
    ).json()
    assert rolled_back_baseline["suggestion"]["status"] == "rolled_back"
    assert rolled_back_baseline["baseline"]["current_experiment_id"] == baseline_experiment["experiment_id"]
    assert rolled_back_baseline["baseline"]["history"][-1]["action"] == "rollback"
    assert rolled_back_baseline["rollback_guard"]["status"] == "passed"
    assert rolled_back_baseline["rollback_guard"]["ci_gate_evaluations"][0]["source"] == "experiment_baseline_rollback"
    assert rolled_back_baseline["notifications"][0]["action"] == "rollback"
    assert rolled_back_baseline["notifications"][0]["summary"]["rollback_guard_status"] == "passed"
    rollback_notifications = client.get(
        f"/baseline-change-notifications?baseline_id={rolled_back_baseline['baseline']['baseline_id']}&status=unread"
    ).json()
    assert rollback_notifications[0]["action"] == "rollback"
