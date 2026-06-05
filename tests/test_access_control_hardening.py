import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import _get_record, _save_record, create_app


def _write_jsonl(path: Path) -> None:
    rows = [
        {"question": "Q1", "reference": "AegisQA", "expected_label": "pass"},
        {"question": "Q2", "reference": "Badcase", "expected_label": "fail"},
    ]
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _graph_payload() -> dict:
    return {
        "name": "权限治理 Workflow",
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成回答",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.question"},
                "output_mapping": {"answer": "context.answer"},
                "config": {"model": "demo-model", "temperature": 0},
            },
            {"node_id": "report", "node_type": "output", "label": "报告"},
        ],
        "edges": [{"source": "answer", "target": "report"}],
    }


def test_viewer_is_forbidden_from_critical_write_operations(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "dataset.jsonl"
    _write_jsonl(data_path)

    denied_dataset = client.post(
        "/datasets/from-path",
        json={"name": "viewer-upload", "path": str(data_path), "role": "Viewer", "actor": "viewer"},
    )
    assert denied_dataset.status_code == 403
    assert denied_dataset.json()["code"] == "FORBIDDEN"
    assert denied_dataset.json()["details"]["required_permission"] == "dataset:create"

    denied_workflow = client.post(
        "/workflow-graphs/publish",
        json={"graph": _graph_payload(), "role": "Viewer", "actor": "viewer"},
    )
    assert denied_workflow.status_code == 403
    assert denied_workflow.json()["details"]["required_permission"] == "workflow:publish"

    dataset = client.post(
        "/datasets/from-path",
        json={"name": "allowed-upload", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={"name": "权限任务", "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"], "workflow_version_id": workflow["version_id"]},
    ).json()
    denied_execute = client.post(f"/tasks/{task['task_id']}/execute", params={"role": "Viewer", "actor": "viewer"})
    assert denied_execute.status_code == 403
    assert denied_execute.json()["details"]["required_permission"] == "run:create"

    app.state.registry.disable("llm.call@0.1.0", reason="等待权限测试")
    denied_skill_approval = client.post("/skills/llm.call@0.1.0/approve", json={"role": "Viewer", "actor": "viewer", "reason": "尝试审批"})
    assert denied_skill_approval.status_code == 403
    assert denied_skill_approval.json()["details"]["required_permission"] == "skill:approve"

    _save_record(
        app.state.store,
        "experiments",
        "experiment_id",
        {"experiment_id": "exp-new", "dataset_id": dataset["dataset_id"], "workflow_id": workflow["version_id"], "metrics": {"pass_rate": 0.9}},
    )
    _save_record(
        app.state.store,
        "experiment_baseline_suggestions",
        "suggestion_id",
        {
            "suggestion_id": "suggestion-viewer-denied",
            "status": "pending_apply",
            "suggested_experiment_id": "exp-new",
            "previous_baseline_experiment_id": None,
        },
    )
    denied_baseline = client.post(
        "/experiment-baseline-suggestions/suggestion-viewer-denied/apply",
        json={"actor": "viewer", "role": "Viewer", "note": "尝试应用 baseline"},
    )
    assert denied_baseline.status_code == 403
    assert denied_baseline.json()["details"]["required_permission"] == "baseline:apply"

    events = client.get("/audit-events", params={"actor": "viewer"}).json()
    denied_events = [event for event in events if event["result"] == "forbidden"]
    assert {event["action"] for event in denied_events} >= {
        "dataset.create",
        "workflow.publish",
        "task.execute",
        "skill.approve",
        "experiment_baseline.apply",
    }
    assert all(event["role"] == "Viewer" for event in denied_events)
    assert all(event["trace_id"].startswith("trace_") for event in denied_events)


def test_dataset_governance_write_routes_require_permission_and_record_actor_role(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "dataset_governance.jsonl"
    _write_jsonl(data_path)

    dataset = client.post(
        "/datasets/from-path",
        json={"name": "dataset-governance", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()

    denied_source = client.post(
        "/datasets/source-materialize",
        json={"name": "viewer-source", "rows": [{"question": "q"}], "role": "Viewer", "actor": "viewer"},
    )
    assert denied_source.status_code == 403
    assert denied_source.json()["details"]["required_permission"] == "dataset:create"

    denied_field = client.post(
        f"/datasets/{dataset['dataset_id']}/versions/{dataset['version']}/fields/expected_label",
        json={"field_type": "enum:pass,fail", "role": "Viewer", "actor": "viewer"},
    )
    assert denied_field.status_code == 403
    assert denied_field.json()["details"]["required_permission"] == "dataset:create"

    materialized = client.post(
        "/datasets/source-materialize",
        json={
            "name": "source-governance",
            "rows": [{"question": "来自 Source", "reference": "AegisQA", "expected_label": "pass"}],
            "golden": True,
            "label_field": "expected_label",
            "role": "Evaluator",
            "actor": "source_operator",
        },
    )
    assert materialized.status_code == 200

    corrected = client.post(
        f"/datasets/{dataset['dataset_id']}/versions/{dataset['version']}/fields/expected_label",
        json={"field_type": "enum:pass,fail", "role": "Evaluator", "actor": "field_steward"},
    )
    assert corrected.status_code == 200

    events = client.get("/audit-events").json()
    forbidden_events = [event for event in events if event["actor"] == "viewer" and event["result"] == "forbidden"]
    assert {event["action"] for event in forbidden_events} >= {"dataset.source_materialize", "dataset.field_type.correct"}
    assert all(event["role"] == "Viewer" for event in forbidden_events)

    source_event = next(event for event in events if event["action"] == "dataset.source_materialize" and event["result"] == "success")
    assert source_event["actor"] == "source_operator"
    assert source_event["role"] == "Evaluator"
    assert source_event["detail"]["role"] == "Evaluator"

    field_event = next(event for event in events if event["action"] == "dataset.field_type.correct" and event["result"] == "success")
    assert field_event["actor"] == "field_steward"
    assert field_event["role"] == "Evaluator"
    assert field_event["detail"]["field_type"] == "enum:pass,fail"


def test_legacy_run_write_routes_require_permission_and_record_actor_role(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "legacy_run_controls.jsonl"
    _write_jsonl(data_path)

    dataset = client.post(
        "/datasets/from-path",
        json={"name": "legacy-run-controls", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    create_payload = {"workflow": workflow, "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"]}

    denied_create = client.post("/runs", json={**create_payload, "role": "Viewer", "actor": "viewer"})
    assert denied_create.status_code == 403
    assert denied_create.json()["details"]["required_permission"] == "run:create"

    executable = client.post("/runs", json={**create_payload, "role": "Evaluator", "actor": "legacy_creator"}).json()
    denied_execute = client.post(f"/runs/{executable['run_id']}/execute", params={"role": "Viewer", "actor": "viewer"})
    assert denied_execute.status_code == 403
    assert denied_execute.json()["details"]["required_permission"] == "run:control"
    executed = client.post(f"/runs/{executable['run_id']}/execute", params={"role": "Evaluator", "actor": "legacy_runner"})
    assert executed.status_code == 200

    pause_target = client.post("/runs", json={**create_payload, "role": "Evaluator", "actor": "pause_creator"}).json()
    denied_pause = client.post(f"/runs/{pause_target['run_id']}/pause", params={"role": "Viewer", "actor": "viewer"})
    assert denied_pause.status_code == 403
    assert denied_pause.json()["details"]["required_permission"] == "run:control"
    paused = client.post(f"/runs/{pause_target['run_id']}/pause", params={"role": "Evaluator", "actor": "legacy_pauser"})
    assert paused.status_code == 200

    denied_resume = client.post(f"/runs/{pause_target['run_id']}/resume", params={"role": "Viewer", "actor": "viewer"})
    assert denied_resume.status_code == 403
    assert denied_resume.json()["details"]["required_permission"] == "run:control"
    resumed = client.post(f"/runs/{pause_target['run_id']}/resume", params={"role": "Evaluator", "actor": "legacy_resumer"})
    assert resumed.status_code == 200

    cancel_target = client.post("/runs", json={**create_payload, "role": "Evaluator", "actor": "cancel_creator"}).json()
    denied_cancel = client.post(f"/runs/{cancel_target['run_id']}/cancel", params={"role": "Viewer", "actor": "viewer"})
    assert denied_cancel.status_code == 403
    assert denied_cancel.json()["details"]["required_permission"] == "run:control"
    canceled = client.post(f"/runs/{cancel_target['run_id']}/cancel", params={"role": "Evaluator", "actor": "legacy_canceler"})
    assert canceled.status_code == 200

    retry_target = client.post("/runs", json={**create_payload, "role": "Evaluator", "actor": "retry_creator"}).json()
    denied_retry = client.post(f"/runs/{retry_target['run_id']}/retry-failed", params={"role": "Viewer", "actor": "viewer"})
    assert denied_retry.status_code == 403
    assert denied_retry.json()["details"]["required_permission"] == "run:control"
    retried = client.post(f"/runs/{retry_target['run_id']}/retry-failed", params={"role": "Evaluator", "actor": "legacy_retry"})
    assert retried.status_code == 200

    events = client.get("/audit-events").json()
    forbidden_events = [event for event in events if event["actor"] == "viewer" and event["result"] == "forbidden"]
    assert {event["action"] for event in forbidden_events} >= {
        "run.create",
        "run.execute",
        "run.pause",
        "run.resume",
        "run.cancel",
        "run.retry_failed",
    }
    assert all(event["role"] == "Viewer" for event in forbidden_events)

    success_events = [event for event in events if event["result"] == "success"]
    assert any(event["action"] == "run.create" and event["target"] == executable["run_id"] and event["actor"] == "legacy_creator" for event in success_events)
    assert any(event["action"] == "run.execute" and event["target"] == executable["run_id"] and event["actor"] == "legacy_runner" for event in success_events)
    assert any(event["action"] == "run.pause" and event["target"] == pause_target["run_id"] and event["actor"] == "legacy_pauser" for event in success_events)
    assert any(event["action"] == "run.resume" and event["target"] == pause_target["run_id"] and event["actor"] == "legacy_resumer" for event in success_events)
    assert any(event["action"] == "run.cancel" and event["target"] == cancel_target["run_id"] and event["actor"] == "legacy_canceler" for event in success_events)
    assert any(event["action"] == "run.retry_failed" and event["target"] == retry_target["run_id"] and event["actor"] == "legacy_retry" for event in success_events)


def test_judge_governance_write_routes_require_permission_and_record_actor_role(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "judge_governance.jsonl"
    _write_jsonl(data_path)

    dataset = client.post(
        "/datasets/from-path",
        json={"name": "judge-governance", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()

    denied_standalone_audit = client.post(
        "/judge-audits",
        json={
            "judge_profile_id": "judge-denied",
            "dataset_version_id": dataset["version_id"],
            "human_labels": ["pass", "fail"],
            "judge_labels": ["pass", "pass"],
            "role": "Viewer",
            "actor": "viewer",
        },
    )
    assert denied_standalone_audit.status_code == 403
    assert denied_standalone_audit.json()["details"]["required_permission"] == "judge:audit"

    denied_profile = client.post(
        "/judge-profiles",
        json={
            "name": "Viewer 不可创建 Judge",
            "model": "judge-model",
            "prompt": "判断是否通过",
            "rubric": {"pass": "通过", "fail": "失败"},
            "threshold": 0.6,
            "output_schema": {"type": "object"},
            "role": "Viewer",
            "actor": "viewer",
        },
    )
    assert denied_profile.status_code == 403
    assert denied_profile.json()["details"]["required_permission"] == "judge:audit"

    profile_response = client.post(
        "/judge-profiles",
        json={
            "name": "可追责 Judge",
            "model": "judge-model",
            "prompt": "判断是否通过",
            "rubric": {"pass": "通过", "fail": "失败"},
            "threshold": 0.6,
            "output_schema": {"type": "object"},
            "role": "Reviewer",
            "actor": "judge_owner",
        },
    )
    assert profile_response.status_code == 200
    profile = profile_response.json()

    denied_profile_audit = client.post(
        f"/judge-profiles/{profile['profile_id']}/audits",
        json={
            "dataset_version_id": dataset["version_id"],
            "human_labels": ["pass", "fail"],
            "judge_labels": ["pass", "pass"],
            "role": "Viewer",
            "actor": "viewer",
        },
    )
    assert denied_profile_audit.status_code == 403
    assert denied_profile_audit.json()["details"]["required_permission"] == "judge:audit"

    standalone_audit = client.post(
        "/judge-audits",
        json={
            "judge_profile_id": profile["profile_id"],
            "dataset_version_id": dataset["version_id"],
            "human_labels": ["pass", "fail"],
            "judge_labels": ["pass", "pass"],
            "role": "Reviewer",
            "actor": "judge_auditor",
        },
    )
    assert standalone_audit.status_code == 200

    profile_audit = client.post(
        f"/judge-profiles/{profile['profile_id']}/audits",
        json={
            "dataset_version_id": dataset["version_id"],
            "human_labels": ["pass", "fail"],
            "judge_labels": ["pass", "pass"],
            "role": "Reviewer",
            "actor": "profile_auditor",
        },
    )
    assert profile_audit.status_code == 200

    events = client.get("/audit-events").json()
    forbidden_events = [event for event in events if event["actor"] == "viewer" and event["result"] == "forbidden"]
    assert {event["action"] for event in forbidden_events} >= {
        "judge.audit",
        "judge_profile.create",
        "judge_profile.audit",
    }
    assert all(event["role"] == "Viewer" for event in forbidden_events)

    success_events = {event["action"]: event for event in events if event["result"] == "success"}
    assert success_events["judge_profile.create"]["actor"] == "judge_owner"
    assert success_events["judge_profile.create"]["role"] == "Reviewer"
    assert success_events["judge.audit"]["actor"] == "judge_auditor"
    assert success_events["judge.audit"]["role"] == "Reviewer"
    assert success_events["judge_profile.audit"]["actor"] == "profile_auditor"
    assert success_events["judge_profile.audit"]["role"] == "Reviewer"


def test_task_attempt_and_control_routes_require_permission_and_record_actor_role(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_controls.jsonl"
    _write_jsonl(data_path)

    dataset = client.post(
        "/datasets/from-path",
        json={"name": "task-control-dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()

    def create_task(name: str, *, actor: str = "api") -> dict:
        return client.post(
            "/tasks",
            json={
                "name": name,
                "dataset_id": dataset["dataset_id"],
                "dataset_version": dataset["version"],
                "workflow_version_id": workflow["version_id"],
                "actor": actor,
                "role": "Evaluator",
            },
        ).json()

    pause_target = create_task("Viewer 不可暂停")
    denied_pause = client.post(f"/tasks/{pause_target['task_id']}/pause", params={"role": "Viewer", "actor": "viewer"})
    assert denied_pause.status_code == 403
    assert denied_pause.json()["details"]["required_permission"] == "run:control"

    cancel_target = create_task("Viewer 不可取消")
    denied_cancel = client.post(f"/tasks/{cancel_target['task_id']}/cancel", params={"role": "Viewer", "actor": "viewer"})
    assert denied_cancel.status_code == 403
    assert denied_cancel.json()["details"]["required_permission"] == "run:control"

    resume_target = create_task("Viewer 不可恢复")
    paused = client.post(f"/tasks/{resume_target['task_id']}/pause", params={"role": "Evaluator", "actor": "operator"})
    assert paused.status_code == 200
    denied_resume = client.post(f"/tasks/{resume_target['task_id']}/resume", params={"role": "Viewer", "actor": "viewer"})
    assert denied_resume.status_code == 403
    assert denied_resume.json()["details"]["required_permission"] == "run:control"

    retry_target = create_task("Viewer 不可重试失败项")
    retry_target["status"] = "failed"
    _save_record(app.state.store, "tasks", "task_id", retry_target)
    denied_retry = client.post(f"/tasks/{retry_target['task_id']}/retry-failed", params={"role": "Viewer", "actor": "viewer"})
    assert denied_retry.status_code == 403
    assert denied_retry.json()["details"]["required_permission"] == "run:control"

    attempt_target = create_task("Viewer 不可创建 Attempt")
    executed = client.post(f"/tasks/{attempt_target['task_id']}/execute", params={"role": "Evaluator", "actor": "runner"})
    assert executed.status_code == 200
    denied_attempt = client.post(f"/tasks/{attempt_target['task_id']}/attempts", params={"role": "Viewer", "actor": "viewer"})
    assert denied_attempt.status_code == 403
    assert denied_attempt.json()["details"]["required_permission"] == "run:create"

    controlled = create_task("可追责控制任务", actor="creator")
    canceled = client.post(f"/tasks/{controlled['task_id']}/cancel", params={"role": "Evaluator", "actor": "controller"})
    assert canceled.status_code == 200

    events = client.get("/audit-events").json()
    forbidden_events = [event for event in events if event["actor"] == "viewer" and event["result"] == "forbidden"]
    assert {event["action"] for event in forbidden_events} >= {
        "task.pause",
        "task.cancel",
        "task.resume",
        "task.retry_failed",
        "task.attempt.create",
    }
    assert all(event["role"] == "Viewer" for event in forbidden_events)

    create_event = next(event for event in events if event["action"] == "task.create" and event["target"] == controlled["task_id"])
    assert create_event["actor"] == "creator"
    assert create_event["role"] == "Evaluator"
    assert create_event["detail"]["role"] == "Evaluator"

    cancel_event = next(event for event in events if event["action"] == "task.cancel" and event["target"] == controlled["task_id"])
    assert cancel_event["actor"] == "controller"
    assert cancel_event["role"] == "Evaluator"
    assert cancel_event["detail"]["role"] == "Evaluator"


def test_task_preflight_and_template_routes_require_permission_and_record_actor_role(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_preflight_controls.jsonl"
    _write_jsonl(data_path)

    dataset = client.post(
        "/datasets/from-path",
        json={"name": "preflight-control-dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()

    denied_template = client.post(
        "/task-execution-templates",
        json={"name": "Viewer 不可创建模板", "role": "Viewer", "actor": "viewer"},
    )
    assert denied_template.status_code == 403
    assert denied_template.json()["details"]["required_permission"] == "run:create"

    denied_preflight = client.post(
        "/tasks/preflight",
        json={
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "role": "Viewer",
            "actor": "viewer",
        },
    )
    assert denied_preflight.status_code == 403
    assert denied_preflight.json()["details"]["required_permission"] == "run:create"

    template = client.post(
        "/task-execution-templates",
        json={
            "name": "可追责模板",
            "evaluation_goal": "上线前回归",
            "execution_config": {"sample_repeat_times": 2},
            "role": "Evaluator",
            "actor": "template_owner",
        },
    )
    assert template.status_code == 200

    preflight = client.post(
        "/tasks/preflight",
        json={
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "execution_template_id": template.json()["template_id"],
            "role": "Evaluator",
            "actor": "preflight_runner",
        },
    )
    assert preflight.status_code == 200
    assert preflight.json()["preflight_id"].startswith("preflight-")

    events = client.get("/audit-events").json()
    forbidden_events = [event for event in events if event["actor"] == "viewer" and event["result"] == "forbidden"]
    assert {event["action"] for event in forbidden_events} >= {"task_execution_template.create", "task.preflight"}
    assert all(event["role"] == "Viewer" for event in forbidden_events)

    success_events = {event["action"]: event for event in events if event["result"] == "success"}
    assert success_events["task_execution_template.create"]["actor"] == "template_owner"
    assert success_events["task_execution_template.create"]["role"] == "Evaluator"
    assert success_events["task.preflight"]["actor"] == "preflight_runner"
    assert success_events["task.preflight"]["role"] == "Evaluator"
    assert success_events["task.preflight"]["detail"]["workflow_version_id"] == workflow["version_id"]


def test_repair_task_write_routes_require_permission_and_record_actor_role(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "repair_controls.jsonl"
    _write_jsonl(data_path)

    dataset = client.post(
        "/datasets/from-path",
        json={"name": "repair-control-dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={"name": "修复任务权限", "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"], "workflow_version_id": workflow["version_id"]},
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    repair = client.post(f"/tasks/{executed['task_id']}/repair-tasks/from-diagnostics").json()["repair_tasks"][0]
    repair_id = repair["repair_task_id"]

    denied_start = client.post(f"/repair-tasks/{repair_id}/start", json={"owner": "viewer", "role": "Viewer", "actor": "viewer"})
    assert denied_start.status_code == 403
    assert denied_start.json()["details"]["required_permission"] == "badcase:correct"

    denied_assign = client.post(f"/repair-tasks/{repair_id}/assign", json={"owner": "viewer", "role": "Viewer", "actor": "viewer"})
    assert denied_assign.status_code == 403
    assert denied_assign.json()["details"]["required_permission"] == "badcase:correct"

    denied_resolve = client.post(f"/repair-tasks/{repair_id}/resolve", json={"resolution_note": "尝试完成", "role": "Viewer", "actor": "viewer"})
    assert denied_resolve.status_code == 403
    assert denied_resolve.json()["details"]["required_permission"] == "badcase:correct"

    denied_reopen = client.post(f"/repair-tasks/{repair_id}/reopen", json={"reason": "尝试重开", "role": "Viewer", "actor": "viewer"})
    assert denied_reopen.status_code == 403
    assert denied_reopen.json()["details"]["required_permission"] == "badcase:correct"

    denied_action = client.post(
        f"/repair-tasks/{repair_id}/actions",
        json={"action": "seed_annotation_queue", "assignee": "viewer", "role": "Viewer", "actor": "viewer"},
    )
    assert denied_action.status_code == 403
    assert denied_action.json()["details"]["required_permission"] == "badcase:correct"

    started = client.post(f"/repair-tasks/{repair_id}/start", json={"owner": "qa_owner", "role": "Evaluator", "actor": "operator"})
    assert started.status_code == 200
    assigned = client.post(f"/repair-tasks/{repair_id}/assign", json={"owner": "qa_lead", "role": "Evaluator", "actor": "lead"})
    assert assigned.status_code == 200
    resolved = client.post(f"/repair-tasks/{repair_id}/resolve", json={"resolution_note": "已修复", "role": "Evaluator", "actor": "resolver"})
    assert resolved.status_code == 200
    reopened = client.post(f"/repair-tasks/{repair_id}/reopen", json={"reason": "复测继续跟进", "role": "Evaluator", "actor": "reopener"})
    assert reopened.status_code == 200
    action = client.post(
        f"/repair-tasks/{repair_id}/actions",
        json={"action": "seed_annotation_queue", "assignee": "qa_owner", "role": "Evaluator", "actor": "actioner"},
    )
    assert action.status_code == 200

    events = client.get("/audit-events").json()
    forbidden_events = [event for event in events if event["actor"] == "viewer" and event["result"] == "forbidden"]
    assert {event["action"] for event in forbidden_events} >= {
        "repair_task.start",
        "repair_task.assign",
        "repair_task.resolve",
        "repair_task.reopen",
        "repair_task.action.seed_annotation_queue",
    }
    assert all(event["role"] == "Viewer" for event in forbidden_events)

    success_events = {event["action"]: event for event in events if event["target"] == repair_id and event["result"] == "success"}
    assert success_events["repair_task.start"]["actor"] == "operator"
    assert success_events["repair_task.start"]["role"] == "Evaluator"
    assert success_events["repair_task.assign"]["actor"] == "lead"
    assert success_events["repair_task.resolve"]["actor"] == "resolver"
    assert success_events["repair_task.reopen"]["actor"] == "reopener"
    assert success_events["repair_task.action.seed_annotation_queue"]["actor"] == "actioner"
    assert success_events["repair_task.action.seed_annotation_queue"]["role"] == "Evaluator"


def test_annotation_queue_write_routes_require_permission_and_record_actor_role(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "annotation_controls.jsonl"
    _write_jsonl(data_path)

    dataset = client.post(
        "/datasets/from-path",
        json={"name": "annotation-control-dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={"name": "人工审核权限", "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"], "workflow_version_id": workflow["version_id"]},
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()

    denied_seed = client.post(
        "/annotation-queue/seed-from-run",
        json={"run_id": executed["run_id"], "strategy": "all", "limit": 2, "role": "Viewer", "actor": "viewer"},
    )
    assert denied_seed.status_code == 403
    assert denied_seed.json()["details"]["required_permission"] == "annotation:review"

    seed = client.post(
        "/annotation-queue/seed-from-run",
        json={"run_id": executed["run_id"], "strategy": "all", "limit": 2, "role": "Evaluator", "actor": "seeder"},
    )
    assert seed.status_code == 200
    annotation_tasks = seed.json()["tasks"]
    first_task_id = annotation_tasks[0]["task_id"]
    second_task_id = annotation_tasks[1]["task_id"]

    denied_dispatch = client.post(
        "/annotation-queue/dispatch",
        json={"assignees": [{"assignee": "qa_owner", "capacity": 2}], "role": "Viewer", "actor": "viewer"},
    )
    assert denied_dispatch.status_code == 403
    assert denied_dispatch.json()["details"]["required_permission"] == "annotation:review"

    dispatched = client.post(
        "/annotation-queue/dispatch",
        json={"assignees": [{"assignee": "qa_owner", "capacity": 2}], "role": "Evaluator", "actor": "dispatcher"},
    )
    assert dispatched.status_code == 200

    denied_assign = client.post(f"/annotation-queue/{first_task_id}/assign", json={"assignee": "viewer", "role": "Viewer", "actor": "viewer"})
    assert denied_assign.status_code == 403
    assert denied_assign.json()["details"]["required_permission"] == "annotation:review"

    assigned = client.post(f"/annotation-queue/{first_task_id}/assign", json={"assignee": "qa_lead", "role": "Evaluator", "actor": "assigner"})
    assert assigned.status_code == 200

    denied_review = client.post(
        f"/annotation-queue/{first_task_id}/review",
        json={"human_label": "fail", "note": "尝试审核", "add_to_golden": True, "role": "Viewer", "actor": "viewer"},
    )
    assert denied_review.status_code == 403
    assert denied_review.json()["details"]["required_permission"] == "annotation:review"

    reviewed = client.post(
        f"/annotation-queue/{first_task_id}/review",
        json={"human_label": "fail", "note": "人工确认", "add_to_golden": True, "role": "Evaluator", "actor": "reviewer"},
    )
    assert reviewed.status_code == 200
    assert reviewed.json()["review"]["reviewer"] == "reviewer"

    denied_bulk_review = client.post(
        "/annotation-queue/bulk-review",
        json={"task_ids": [second_task_id], "human_label": "fail", "note": "批量尝试", "add_to_golden": True, "role": "Viewer", "actor": "viewer"},
    )
    assert denied_bulk_review.status_code == 403
    assert denied_bulk_review.json()["details"]["required_permission"] == "annotation:review"

    bulk_reviewed = client.post(
        "/annotation-queue/bulk-review",
        json={"task_ids": [second_task_id], "human_label": "fail", "note": "批量确认", "add_to_golden": True, "role": "Evaluator", "actor": "bulk_reviewer"},
    )
    assert bulk_reviewed.status_code == 200
    assert {candidate["reviewer"] for candidate in bulk_reviewed.json()["candidates"]} == {"bulk_reviewer"}

    events = client.get("/audit-events").json()
    forbidden_events = [event for event in events if event["actor"] == "viewer" and event["result"] == "forbidden"]
    assert {event["action"] for event in forbidden_events} >= {
        "annotation_queue.seed",
        "annotation_queue.dispatch",
        "annotation_task.assign",
        "annotation_task.review",
        "annotation_task.bulk_review",
    }
    assert all(event["role"] == "Viewer" for event in forbidden_events)

    success_by_action = {event["action"]: event for event in events if event["result"] == "success"}
    assert success_by_action["annotation_queue.seed"]["actor"] == "seeder"
    assert success_by_action["annotation_queue.seed"]["role"] == "Evaluator"
    assert success_by_action["annotation_queue.dispatch"]["actor"] == "dispatcher"
    assert success_by_action["annotation_task.assign"]["actor"] == "assigner"
    assert success_by_action["annotation_task.review"]["actor"] == "reviewer"
    assert success_by_action["annotation_task.bulk_review"]["actor"] == "bulk_reviewer"
    assert success_by_action["annotation_task.bulk_review"]["role"] == "Evaluator"


def test_candidate_asset_write_routes_require_permission_and_record_actor_role(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "candidate_controls.jsonl"
    _write_jsonl(data_path)

    dataset = client.post(
        "/datasets/from-path",
        json={"name": "candidate-control-dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={"name": "候选资产权限", "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"], "workflow_version_id": workflow["version_id"]},
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    experiment = client.post("/experiments/from-run", json={"run_id": executed["run_id"], "name": "候选资产权限实验"}).json()
    now = "2026-06-05T00:00:00+00:00"

    def save_candidate(candidate_id: str, **overrides: object) -> dict[str, object]:
        record: dict[str, object] = {
            "candidate_id": candidate_id,
            "kind": "prompt_skill_version_diff",
            "status": "candidate",
            "source_task_id": executed["task_id"],
            "source_run_id": executed["run_id"],
            "current_versions": [],
            "version_diffs": [{"step_id": "answer", "field": "model", "baseline_value": "baseline-model", "current_value": "demo-model"}],
            "created_at": now,
            "updated_at": now,
        }
        record.update(overrides)
        _save_record(app.state.store, "prompt_skill_candidates", "candidate_id", record)
        return record

    save_candidate("candidate-review")
    save_candidate("candidate-bulk")
    save_candidate("candidate-archive", status="rejected", updated_at="2026-04-01T00:00:00+00:00")
    save_candidate("candidate-escalate", owner="qa_owner", due_at="2000-01-01T00:00:00+00:00")
    save_candidate("candidate-draft", status="approved")
    _save_record(
        app.state.store,
        "workflow_drafts",
        "draft_id",
        {"draft_id": "draft-candidate-ready", "name": "已发布候选草稿", "status": "published", "published_version_id": workflow["version_id"], "updated_at": now},
    )
    save_candidate("candidate-retest", status="draft_created", workflow_draft_id="draft-candidate-ready")
    save_candidate(
        "candidate-promotion",
        status="retested",
        retest_task_id=executed["task_id"],
        candidate_run_id=executed["run_id"],
        candidate_experiment_id=experiment["experiment_id"],
        scorecard={
            "current": {"workflow_version_id": workflow["version_id"]},
            "candidate": {"workflow_version_id": workflow["version_id"], "task_id": executed["task_id"], "run_id": executed["run_id"]},
        },
        promotion_recommendation={"decision": "promote", "summary": "候选版本达到晋升门槛。", "checks": []},
    )
    _save_record(
        app.state.store,
        "workflow_promotion_reviews",
        "review_id",
        {
            "review_id": "promotion-review-denied",
            "candidate_id": "candidate-promotion",
            "status": "pending_review",
            "candidate_workflow_version_id": workflow["version_id"],
            "created_at": now,
            "updated_at": now,
        },
    )

    denied_review = client.post(
        "/prompt-skill-candidates/candidate-review/review",
        json={"decision": "approved", "reviewer": "viewer", "role": "Viewer", "actor": "viewer"},
    )
    assert denied_review.status_code == 403
    assert denied_review.json()["details"]["required_permission"] == "candidate:govern"

    denied_bulk_review = client.post(
        "/prompt-skill-candidates/bulk-review",
        json={"candidate_ids": ["candidate-bulk"], "decision": "approved", "reviewer": "viewer", "role": "Viewer", "actor": "viewer"},
    )
    assert denied_bulk_review.status_code == 403
    assert denied_bulk_review.json()["details"]["required_permission"] == "candidate:govern"

    denied_assign = client.post(
        "/prompt-skill-candidates/bulk-assign",
        json={"candidate_ids": ["candidate-bulk"], "owner": "viewer", "role": "Viewer", "actor": "viewer"},
    )
    assert denied_assign.status_code == 403
    assert denied_assign.json()["details"]["required_permission"] == "candidate:govern"

    denied_archive = client.post(
        "/prompt-skill-candidates/bulk-archive",
        json={"candidate_ids": ["candidate-archive"], "statuses": ["rejected"], "role": "Viewer", "actor": "viewer"},
    )
    assert denied_archive.status_code == 403
    assert denied_archive.json()["details"]["required_permission"] == "candidate:govern"

    denied_escalate = client.post("/prompt-skill-candidates/escalate-overdue", json={"role": "Viewer", "actor": "viewer"})
    assert denied_escalate.status_code == 403
    assert denied_escalate.json()["details"]["required_permission"] == "candidate:govern"

    denied_draft = client.post("/prompt-skill-candidates/candidate-draft/workflow-draft", json={"role": "Viewer", "actor": "viewer"})
    assert denied_draft.status_code == 403
    assert denied_draft.json()["details"]["required_permission"] == "candidate:govern"

    denied_retest = client.post("/prompt-skill-candidates/candidate-retest/retest", json={"role": "Viewer", "actor": "viewer"})
    assert denied_retest.status_code == 403
    assert denied_retest.json()["details"]["required_permission"] == "candidate:govern"

    denied_promotion_review = client.post(
        "/prompt-skill-candidates/candidate-promotion/promotion-review",
        json={"requester": "viewer", "role": "Viewer", "actor": "viewer", "note": "尝试提交晋升"},
    )
    assert denied_promotion_review.status_code == 403
    assert denied_promotion_review.json()["details"]["required_permission"] == "candidate:govern"

    denied_promotion_decision = client.post(
        "/workflow-promotion-reviews/promotion-review-denied/reject",
        json={"reviewer": "viewer", "role": "Viewer", "actor": "viewer", "note": "尝试拒绝晋升"},
    )
    assert denied_promotion_decision.status_code == 403
    assert denied_promotion_decision.json()["details"]["required_permission"] == "candidate:govern"

    reviewed = client.post(
        "/prompt-skill-candidates/candidate-review/review",
        json={"decision": "approved", "reviewer": "candidate_reviewer", "role": "Reviewer", "actor": "candidate_reviewer", "note": "通过候选"},
    )
    assert reviewed.status_code == 200
    assert reviewed.json()["review"]["reviewer"] == "candidate_reviewer"

    assigned = client.post(
        "/prompt-skill-candidates/bulk-assign",
        json={"candidate_ids": ["candidate-bulk"], "owner": "qa_owner", "role": "Evaluator", "actor": "candidate_lead"},
    )
    assert assigned.status_code == 200

    archived = client.post(
        "/prompt-skill-candidates/bulk-archive",
        json={"candidate_ids": ["candidate-archive"], "statuses": ["rejected"], "role": "Evaluator", "actor": "candidate_archiver"},
    )
    assert archived.status_code == 200

    escalated = client.post("/prompt-skill-candidates/escalate-overdue", json={"role": "Evaluator", "actor": "candidate_escalator"})
    assert escalated.status_code == 200

    draft_payload = client.post("/prompt-skill-candidates/candidate-draft/workflow-draft", json={"role": "Evaluator", "actor": "draft_creator"})
    assert draft_payload.status_code == 200
    assert draft_payload.json()["draft"]["source_candidate_id"] == "candidate-draft"

    retest = client.post("/prompt-skill-candidates/candidate-retest/retest", json={"role": "Evaluator", "actor": "candidate_retester"})
    assert retest.status_code == 200
    assert retest.json()["candidate"]["action_history"][-1]["actor"] == "candidate_retester"

    promotion_review = client.post(
        "/prompt-skill-candidates/candidate-promotion/promotion-review",
        json={"requester": "release_requester", "role": "Evaluator", "actor": "release_requester", "note": "提交晋升"},
    )
    assert promotion_review.status_code == 200

    promotion_decision = client.post(
        "/workflow-promotion-reviews/promotion-review-denied/reject",
        json={"reviewer": "release_reviewer", "role": "Reviewer", "actor": "release_reviewer", "note": "拒绝晋升"},
    )
    assert promotion_decision.status_code == 200

    events = client.get("/audit-events").json()
    forbidden_events = [event for event in events if event["actor"] == "viewer" and event["result"] == "forbidden"]
    assert {event["action"] for event in forbidden_events} >= {
        "prompt_skill_candidate.review",
        "prompt_skill_candidate.bulk_review",
        "prompt_skill_candidate.bulk_assign",
        "prompt_skill_candidate.bulk_archive",
        "prompt_skill_candidate.escalate_overdue",
        "prompt_skill_candidate.create_workflow_draft",
        "prompt_skill_candidate.retest",
        "workflow_promotion_review.create",
        "workflow_promotion_review.rejected",
    }
    assert all(event["role"] == "Viewer" for event in forbidden_events)

    success_events = {event["action"]: event for event in events if event["result"] == "success"}
    assert success_events["prompt_skill_candidate.review"]["actor"] == "candidate_reviewer"
    assert success_events["prompt_skill_candidate.review"]["role"] == "Reviewer"
    assert success_events["prompt_skill_candidate.bulk_assign"]["actor"] == "candidate_lead"
    assert success_events["prompt_skill_candidate.bulk_assign"]["role"] == "Evaluator"
    assert success_events["prompt_skill_candidate.bulk_archive"]["actor"] == "candidate_archiver"
    assert success_events["prompt_skill_candidate.escalate_overdue"]["actor"] == "candidate_escalator"
    assert success_events["prompt_skill_candidate.create_workflow_draft"]["actor"] == "draft_creator"
    assert success_events["prompt_skill_candidate.retest"]["actor"] == "candidate_retester"
    assert success_events["prompt_skill_candidate.retest"]["role"] == "Evaluator"
    assert success_events["workflow_promotion_review.create"]["actor"] == "release_requester"
    assert success_events["workflow_promotion_review.rejected"]["actor"] == "release_reviewer"
    assert _get_record(app.state.store, "prompt_skill_candidates", "candidate-review")["review"]["reviewer"] == "candidate_reviewer"


def test_quality_governance_write_routes_require_permission_and_record_actor_role(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "quality_governance.jsonl"
    _write_jsonl(data_path)

    dataset = client.post(
        "/datasets/from-path",
        json={"name": "quality-governance-dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={"name": "质量治理权限", "dataset_id": dataset["dataset_id"], "dataset_version": dataset["version"], "workflow_version_id": workflow["version_id"]},
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    gate_rule = {"gate_id": "pass-rate", "metric": "pass_rate", "operator": ">=", "threshold": 0.8, "blocking": True}

    denied_scan = client.post("/red-team/scans", json={"task_id": executed["task_id"], "role": "Viewer", "actor": "viewer"})
    assert denied_scan.status_code == 403
    assert denied_scan.json()["details"]["required_permission"] == "redteam:scan"

    denied_experiment = client.post(
        "/experiments/from-run",
        json={"run_id": executed["run_id"], "name": "Viewer 不可创建实验", "role": "Viewer", "actor": "viewer"},
    )
    assert denied_experiment.status_code == 403
    assert denied_experiment.json()["details"]["required_permission"] == "experiment:create"

    denied_gate = client.post(
        "/ci-gates",
        json={"name": "Viewer 不可创建门禁", "gates": [gate_rule], "role": "Viewer", "actor": "viewer"},
    )
    assert denied_gate.status_code == 403
    assert denied_gate.json()["details"]["required_permission"] == "ci_gate:manage"

    denied_evaluation = client.post(
        "/ci-gates/evaluate",
        json={"metrics": {"pass_rate": 0.9}, "gates": [gate_rule], "role": "Viewer", "actor": "viewer"},
    )
    assert denied_evaluation.status_code == 403
    assert denied_evaluation.json()["details"]["required_permission"] == "ci_gate:manage"

    scan = client.post("/red-team/scans", json={"task_id": executed["task_id"], "role": "Evaluator", "actor": "redteam_operator"})
    assert scan.status_code == 200

    experiment = client.post(
        "/experiments/from-run",
        json={"run_id": executed["run_id"], "name": "可追责实验", "role": "Evaluator", "actor": "experiment_owner"},
    )
    assert experiment.status_code == 200

    gate = client.post(
        "/ci-gates",
        json={"name": "可追责质量门禁", "gates": [gate_rule], "role": "Evaluator", "actor": "gate_owner"},
    )
    assert gate.status_code == 200

    evaluation = client.post(
        "/ci-gates/evaluate",
        json={"config_id": gate.json()["config_id"], "task_id": executed["task_id"], "role": "Evaluator", "actor": "gate_runner"},
    )
    assert evaluation.status_code == 200

    events = client.get("/audit-events").json()
    forbidden_events = [event for event in events if event["actor"] == "viewer" and event["result"] == "forbidden"]
    assert {event["action"] for event in forbidden_events} >= {
        "red_team.scan",
        "experiment.create",
        "ci_gate.create",
        "ci_gate.evaluate",
    }
    assert all(event["role"] == "Viewer" for event in forbidden_events)

    success_events = {event["action"]: event for event in events if event["result"] == "success"}
    assert success_events["red_team.scan"]["actor"] == "redteam_operator"
    assert success_events["red_team.scan"]["role"] == "Evaluator"
    assert success_events["experiment.create"]["actor"] == "experiment_owner"
    assert success_events["experiment.create"]["role"] == "Evaluator"
    assert success_events["ci_gate.create"]["actor"] == "gate_owner"
    assert success_events["ci_gate.evaluate"]["actor"] == "gate_runner"
    assert success_events["ci_gate.evaluate"]["detail"]["role"] == "Evaluator"


def test_skill_lifecycle_success_audit_records_request_actor_and_role(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    disabled = client.post(
        "/skills/llm.call@0.1.0/disable",
        json={"role": "Skill Developer", "actor": "alice", "reason": "临时下线排查"},
    )
    assert disabled.status_code == 200

    approved = client.post(
        "/skills/llm.call@0.1.0/approve",
        json={"role": "Skill Developer", "actor": "bob", "reason": "排查完成恢复"},
    )
    assert approved.status_code == 200

    deprecated = client.post(
        "/skills/llm.call@0.1.0/deprecate",
        json={"role": "Skill Developer", "actor": "carol", "reason": "旧模型节点废弃"},
    )
    assert deprecated.status_code == 200

    events = client.get("/audit-events", params={"target": "llm.call@0.1.0"}).json()
    lifecycle_events = {event["action"]: event for event in events if event["action"] in {"skill.disable", "skill.approve", "skill.deprecate"}}

    assert lifecycle_events["skill.disable"]["actor"] == "alice"
    assert lifecycle_events["skill.disable"]["role"] == "Skill Developer"
    assert lifecycle_events["skill.disable"]["detail"]["reason"] == "临时下线排查"
    assert lifecycle_events["skill.approve"]["actor"] == "bob"
    assert lifecycle_events["skill.approve"]["role"] == "Skill Developer"
    assert lifecycle_events["skill.deprecate"]["actor"] == "carol"
    assert lifecycle_events["skill.deprecate"]["role"] == "Skill Developer"


def test_agent_skill_import_requires_permission_and_records_actor_role(tmp_path: Path, monkeypatch) -> None:
    skill_roots = tmp_path / "agent_skill_roots"
    skill_dir = skill_roots / "agent-governance"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        """---
name: agent-governance
description: 用于验证 Agent Skill 本机导入权限的测试 Skill。
---

# Agent Governance

只读安全模式 Skill，用于权限治理回归。
""",
        encoding="utf-8",
    )
    monkeypatch.setenv("AEGISQA_AGENT_SKILL_ROOTS", str(skill_roots))

    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    denied = client.post(
        "/agent-skills/import",
        json={"source_dir": str(skill_dir), "role": "Viewer", "actor": "viewer"},
    )
    assert denied.status_code == 403
    assert denied.json()["code"] == "FORBIDDEN"
    assert denied.json()["details"]["required_permission"] == "skill:register"

    imported = client.post(
        "/agent-skills/import",
        json={
            "source_dir": str(skill_dir),
            "skill_id": "agent.governance@0.1.0",
            "role": "Skill Developer",
            "actor": "skill_author",
        },
    )
    assert imported.status_code == 200
    assert imported.json()["manifest"]["skill_id"] == "agent.governance@0.1.0"

    events = client.get("/audit-events").json()
    forbidden_events = [event for event in events if event["actor"] == "viewer" and event["result"] == "forbidden"]
    assert {event["action"] for event in forbidden_events} >= {"agent_skill.import"}
    assert all(event["role"] == "Viewer" for event in forbidden_events)

    import_event = next(event for event in events if event["action"] == "agent_skill.import" and event["result"] == "success")
    assert import_event["target"] == "agent.governance@0.1.0"
    assert import_event["actor"] == "skill_author"
    assert import_event["role"] == "Skill Developer"
    assert import_event["detail"]["role"] == "Skill Developer"
