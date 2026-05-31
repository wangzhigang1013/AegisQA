import base64
import io
import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app


def _plugin_zip(*, include_manifest: bool = True, include_handler: bool = True, handler_body: str | None = None) -> str:
    manifest = {
        "skill_id": "plugin.echo@0.1.0",
        "name": "插件 Echo Skill",
        "version": "0.1.0",
        "description": "用于验证插件包上传和合约测试。",
        "author": "QA",
        "tags": ["plugin", "echo"],
        "scenarios": ["task_center"],
        "input_schema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        "output_schema": {"type": "object", "properties": {"echo": {"type": "string"}}, "required": ["echo"]},
        "config_schema": {"type": "object", "properties": {}},
        "example_input": {"text": "hello"},
        "example_config": {},
        "permissions": [],
        "cacheable": True,
    }
    handler = handler_body or """
def run(inputs, config):
    return {"output": {"echo": inputs["text"]}, "metrics": {"chars": len(inputs["text"])}, "logs": ["ok"]}
"""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        if include_manifest:
            archive.writestr("skill.json", json.dumps(manifest, ensure_ascii=False))
        if include_handler:
            archive.writestr("handler.py", handler)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _write_jsonl(path: Path) -> None:
    rows = [
        {"question": "什么是 AegisQA?", "reference": "AegisQA", "expected_label": "pass"},
        {"question": "什么是坏例?", "reference": "Badcase", "expected_label": "fail"},
    ]
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _graph_payload() -> dict:
    return {
        "name": "任务中心 Workflow",
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成回答",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.question"},
                "output_mapping": {"answer": "context.answer", "tokens": "metrics.tokens"},
                "config": {"model": "demo-model", "temperature": 0},
                "cacheable": True,
            },
            {
                "node_id": "judge",
                "node_type": "skill",
                "label": "裁判",
                "skill_ref": "llm.judge@0.1.0",
                "input_mapping": {"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
                "output_mapping": {"score": "metrics.judge_score", "label": "context.judge_label"},
                "config": {"threshold": 0.6},
            },
            {"node_id": "report", "node_type": "output", "label": "报告"},
        ],
        "edges": [{"source": "answer", "target": "judge"}, {"source": "judge", "target": "report"}],
    }


def test_skill_package_upload_contract_and_approval_gate(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)

    missing_manifest = client.post(
        "/skills/packages/upload",
        json={"filename": "broken.zip", "content_base64": _plugin_zip(include_manifest=False)},
    )
    assert missing_manifest.status_code == 400
    assert missing_manifest.json()["code"] == "SKILL_PACKAGE_MANIFEST_MISSING"

    uploaded = client.post(
        "/skills/packages/upload",
        json={"filename": "echo.zip", "content_base64": _plugin_zip()},
    ).json()
    assert uploaded["manifest"]["skill_id"] == "plugin.echo@0.1.0"
    assert uploaded["status"] == "pending_review"
    assert uploaded["manifest"]["enabled"] is False

    blocked = client.post("/skills/plugin.echo@0.1.0/approve").json()
    assert blocked["code"] == "BAD_REQUEST"
    assert "合约测试" in blocked["message"]

    contract = client.post("/skills/plugin.echo@0.1.0/contract-test").json()
    assert contract["ok"] is True
    assert contract["output"] == {"echo": "hello"}

    approved = client.post("/skills/plugin.echo@0.1.0/approve").json()
    assert approved["status"] == "approved"
    assert approved["enabled"] is True
    assert client.get("/skills/packages").json()[0]["status"] == "approved"


def test_task_lifecycle_report_and_trace_tree(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_dataset.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "task_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()

    task = client.post(
        "/tasks",
        json={
            "name": "RAG 任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "concurrency": 3,
            "sample_repeat_times": 2,
            "max_retries": 4,
            "retry_backoff_seconds": 5,
            "cost_budget": 12.5,
        },
    ).json()
    assert task["status"] == "queued"
    assert task["total_items"] == 4
    assert task["completed_items"] == 0
    assert task["workflow_version_id"] == workflow["version_id"]
    assert task["execution_config"]["concurrency"] == 3
    assert task["execution_config"]["sample_repeat_times"] == 2
    assert task["execution_config"]["retry"]["max_retries"] == 4
    assert task["execution_config"]["retry"]["backoff_seconds"] == 5
    assert task["execution_config"]["cost_budget"] == 12.5

    executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    assert executed["status"] == "completed"
    assert executed["completed_items"] == 4
    assert executed["pass_rate"] == 0.5
    assert executed["badcase_count"] == 2

    tasks = client.get("/tasks").json()
    assert tasks[0]["task_id"] == task["task_id"]
    assert tasks[0]["dataset_name"] == "task_dataset"
    assert tasks[0]["workflow_name"] == "任务中心 Workflow"

    report = client.get(f"/tasks/{task['task_id']}/report").json()
    assert report["task"]["task_id"] == task["task_id"]
    assert report["task_summary"]["task_id"] == task["task_id"]
    assert report["task_summary"]["sample_count"] == 4
    assert report["version_snapshot"]["dataset"]["version_id"] == dataset["version_id"]
    assert report["version_snapshot"]["workflow"]["version_id"] == workflow["version_id"]
    assert report["step_distribution"][0]["step_id"] == "answer"
    assert report["step_distribution"][0]["total_calls"] == 4
    assert report["report"]["run_id"] == executed["run_id"]
    assert report["export_links"]["html"].endswith("file_format=html")
    html_export = client.get(f"/runs/{executed['run_id']}/report/export", params={"file_format": "html"}).json()
    csv_export = client.get(f"/runs/{executed['run_id']}/report/export", params={"file_format": "csv"}).json()
    json_export = client.get(f"/runs/{executed['run_id']}/report/export", params={"file_format": "json"}).json()
    assert html_export["content"].startswith("<html>")
    assert "pass_rate" in csv_export["content"]
    assert json_export["content"]["run_id"] == executed["run_id"]

    next_attempt = client.post(f"/tasks/{task['task_id']}/attempts").json()
    assert next_attempt["run_id"] != executed["run_id"]
    assert next_attempt["current_attempt"] == 2
    assert next_attempt["attempts"][0]["run_id"] == executed["run_id"]
    assert next_attempt["attempts"][0]["report"]["pass_rate"] == 0.5
    assert next_attempt["attempts"][1]["run_id"] == next_attempt["run_id"]
    assert next_attempt["attempts"][1]["status"] == "queued"

    second_executed = client.post(f"/tasks/{task['task_id']}/execute").json()
    assert second_executed["run_id"] == next_attempt["run_id"]
    assert second_executed["attempts"][0]["run_id"] == executed["run_id"]
    assert second_executed["attempts"][0]["report"]["run_id"] == executed["run_id"]
    assert second_executed["attempts"][1]["report"]["run_id"] == next_attempt["run_id"]

    trace_tree = client.get(f"/tasks/{task['task_id']}/trace-tree").json()
    assert trace_tree["run_id"] == next_attempt["run_id"]
    assert trace_tree["items"][0]["children"][0]["skill_ref"] == "llm.call@0.1.0"


def test_task_creation_blocks_failed_preflight_unless_explicitly_forced(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "missing_reference.jsonl"
    rows = [{"question": "缺少 reference 字段", "expected_label": "pass"}]
    with data_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    dataset = client.post("/datasets/from-path", json={"name": "missing_reference", "path": str(data_path)}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task_payload = {
        "name": "缺字段任务",
        "dataset_id": dataset["dataset_id"],
        "dataset_version": dataset["version"],
        "workflow_version_id": workflow["version_id"],
        "evaluation_goal": "release_gate",
        "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
        "cost_budget": 1.0,
    }

    blocked = client.post("/tasks", json=task_payload)
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "TASK_PREFLIGHT_BLOCKED"
    assert blocked.json()["details"]["preflight_result"]["status"] == "blocked"
    assert blocked.json()["details"]["blocked_checks"][0]["check_id"] == "field_mapping"

    forced = client.post("/tasks", json={**task_payload, "allow_blocked_preflight": True}).json()
    assert forced["status"] == "queued"
    assert forced["preflight_result"]["status"] == "blocked"
    assert forced["execution_config"]["allow_blocked_preflight"] is True


def test_task_creation_rejects_stale_preflight_signature(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_dataset.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "task_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    preflight = client.post(
        "/tasks/preflight",
        json={
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
            "sample_repeat_times": 1,
            "cost_budget": 10,
        },
    ).json()
    assert preflight["status"] in {"passed", "warning"}

    response = client.post(
        "/tasks",
        json={
            "name": "过期预检任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.96, "max_badcase_count": 0},
            "sample_repeat_times": 1,
            "cost_budget": 10,
            "preflight_result": preflight,
        },
    )

    assert response.status_code == 409
    error = response.json()
    assert error["code"] == "TASK_PREFLIGHT_STALE"
    assert error["details"]["mismatches"][0]["field"] == "quality_gate.pass_rate"


def test_task_creation_recomputes_preflight_instead_of_trusting_client_status(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "missing_reference.jsonl"
    rows = [{"question": "缺少 reference 字段", "expected_label": "pass"}]
    with data_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    dataset = client.post("/datasets/from-path", json={"name": "missing_reference", "path": str(data_path)}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    forged_preflight = {
        "status": "passed",
        "summary": "客户端伪造通过",
        "dataset_id": dataset["dataset_id"],
        "dataset_version": dataset["version"],
        "workflow_version_id": workflow["version_id"],
        "execution_template_id": None,
        "evaluation_goal": "release_gate",
        "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
        "sample_repeat_times": 1,
        "cost_budget": 1.0,
        "skill_overrides": {},
        "checks": [],
    }

    response = client.post(
        "/tasks",
        json={
            "name": "伪造预检任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
            "sample_repeat_times": 1,
            "cost_budget": 1.0,
            "preflight_result": forged_preflight,
        },
    )

    assert response.status_code == 409
    error = response.json()
    assert error["code"] == "TASK_PREFLIGHT_BLOCKED"
    assert error["details"]["preflight_result"]["status"] == "blocked"
    assert error["details"]["blocked_checks"][0]["check_id"] == "field_mapping"


def test_task_preflight_is_persisted_and_task_references_preflight_id(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_dataset.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "task_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    preflight = client.post(
        "/tasks/preflight",
        json={
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
            "sample_repeat_times": 1,
            "cost_budget": 10,
        },
    ).json()

    assert preflight["preflight_id"].startswith("preflight-")
    stored = client.get(f"/task-preflights/{preflight['preflight_id']}").json()
    assert stored["preflight_id"] == preflight["preflight_id"]
    assert stored["workflow_version_id"] == workflow["version_id"]

    task = client.post(
        "/tasks",
        json={
            "name": "引用预检 ID 的任务 <script>alert(1)</script>",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
            "sample_repeat_times": 1,
            "cost_budget": 10,
            "preflight_id": preflight["preflight_id"],
        },
    ).json()

    assert task["preflight_result"]["preflight_id"] == preflight["preflight_id"]
    assert task["execution_config"]["preflight_id"] == preflight["preflight_id"]
    report = client.get(f"/tasks/{task['task_id']}/report").json()
    assert report["preflight_evidence"]["preflight_id"] == preflight["preflight_id"]
    assert report["preflight_evidence"]["status"] in {"passed", "warning"}
    assert report["preflight_evidence"]["checks"][0]["check_id"] == "dataset_non_empty"
    json_export = client.get(f"/tasks/{task['task_id']}/report/export", params={"file_format": "json"}).json()
    assert json_export["content"]["preflight_evidence"]["preflight_id"] == preflight["preflight_id"]
    denied_export = client.get(f"/tasks/{task['task_id']}/report/export", params={"file_format": "json", "role": "Viewer"})
    assert denied_export.status_code == 403
    assert denied_export.json()["code"] == "REPORT_EXPORT_FORBIDDEN"
    assert denied_export.json()["details"]["required_permission"] == "report:export"
    csv_export = client.get(f"/tasks/{task['task_id']}/report/export", params={"file_format": "csv"}).json()
    assert f"preflight_id,{preflight['preflight_id']}" in csv_export["content"]
    assert "quality_decision,status" in csv_export["content"]
    assert "preflight_check,dataset_non_empty" in csv_export["content"]
    assert "segment," in csv_export["content"]
    html_export = client.get(f"/tasks/{task['task_id']}/report/export", params={"file_format": "html"}).json()
    assert preflight["preflight_id"] in html_export["content"]
    assert "<script>alert(1)</script>" not in html_export["content"]
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html_export["content"]
    assert "<h2>质量决策</h2>" in html_export["content"]
    assert "<h2>Preflight 检查</h2>" in html_export["content"]
    assert "<h2>分层分析</h2>" in html_export["content"]
    assert "<h2>Badcase 明细</h2>" in html_export["content"]
    export_events = client.get("/audit-events", params={"action": "task.report.export"}).json()
    assert export_events[-1]["target"] == task["task_id"]
    assert export_events[-1]["detail"]["file_format"] == "html"
    assert export_events[-1]["detail"]["preflight_id"] == preflight["preflight_id"]


def test_viewer_can_export_task_report_after_admin_approval(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_dataset.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "task_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "需要审批外发的报告",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
        },
    ).json()
    client.post(f"/tasks/{task['task_id']}/execute")

    denied_export = client.get(f"/tasks/{task['task_id']}/report/export", params={"file_format": "json", "role": "Viewer"})
    assert denied_export.status_code == 403
    assert denied_export.json()["code"] == "REPORT_EXPORT_FORBIDDEN"

    export_request = client.post(
        f"/tasks/{task['task_id']}/report/export-requests",
        json={"file_format": "json", "requester_role": "Viewer", "reason": "业务复盘需要离线报告。"},
    ).json()
    assert export_request["request_id"].startswith("rex-")
    assert export_request["status"] == "pending"
    assert export_request["task_id"] == task["task_id"]
    assert export_request["requested_permission"] == "report:export"

    listed = client.get("/report-export-requests", params={"task_id": task["task_id"]}).json()
    assert listed[0]["request_id"] == export_request["request_id"]

    reviewer_approval = client.post(
        f"/report-export-requests/{export_request['request_id']}/approve",
        json={"approver_role": "Reviewer", "note": "Reviewer 不能批准外发。"},
    )
    assert reviewer_approval.status_code == 403
    assert reviewer_approval.json()["code"] == "REPORT_EXPORT_APPROVAL_FORBIDDEN"

    approved = client.post(
        f"/report-export-requests/{export_request['request_id']}/approve",
        json={"approver_role": "Admin", "note": "允许本次离线复盘。"},
    ).json()
    assert approved["status"] == "approved"
    assert approved["approved_by"] == "Admin"
    assert approved["approval_note"] == "允许本次离线复盘。"

    approved_export = client.get(
        f"/tasks/{task['task_id']}/report/export",
        params={"file_format": "json", "role": "Viewer", "approval_request_id": export_request["request_id"]},
    ).json()
    assert approved_export["content"]["task"]["task_id"] == task["task_id"]

    export_events = client.get("/audit-events", params={"action": "task.report.export", "target": task["task_id"]}).json()
    assert export_events[-1]["detail"]["approval_request_id"] == export_request["request_id"]
    assert export_events[-1]["detail"]["role"] == "Viewer"


def test_report_export_request_lifecycle_reject_revoke_and_expire(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_dataset.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "task_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "报告外发生命周期任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
        },
    ).json()
    client.post(f"/tasks/{task['task_id']}/execute")

    rejected_request = client.post(
        f"/tasks/{task['task_id']}/report/export-requests",
        json={"file_format": "csv", "requester_role": "Viewer", "reason": "需要给业务方离线分析。"},
    ).json()
    rejected = client.post(
        f"/report-export-requests/{rejected_request['request_id']}/reject",
        json={"approver_role": "Admin", "note": "CSV 明细包含敏感样本，暂不外发。"},
    ).json()
    assert rejected["status"] == "rejected"
    assert rejected["rejected_by"] == "Admin"
    assert rejected["rejection_note"] == "CSV 明细包含敏感样本，暂不外发。"

    rejected_export = client.get(
        f"/tasks/{task['task_id']}/report/export",
        params={"file_format": "csv", "role": "Viewer", "approval_request_id": rejected_request["request_id"]},
    )
    assert rejected_export.status_code == 403
    assert rejected_export.json()["code"] == "REPORT_EXPORT_APPROVAL_INVALID"
    assert "status" in rejected_export.json()["details"]["failed_fields"]

    revoked_request = client.post(
        f"/tasks/{task['task_id']}/report/export-requests",
        json={"file_format": "html", "requester_role": "Viewer", "reason": "临时排查。"},
    ).json()
    revoked = client.post(
        f"/report-export-requests/{revoked_request['request_id']}/revoke",
        json={"requester_role": "Viewer", "reason": "已改用在线报告，不再需要外发。"},
    ).json()
    assert revoked["status"] == "revoked"
    assert revoked["revoked_by"] == "Viewer"

    approve_revoked = client.post(
        f"/report-export-requests/{revoked_request['request_id']}/approve",
        json={"approver_role": "Admin", "note": "尝试批准已撤销申请。"},
    )
    assert approve_revoked.status_code == 409
    assert approve_revoked.json()["code"] == "REPORT_EXPORT_APPROVAL_INVALID"

    expired_request = client.post(
        f"/tasks/{task['task_id']}/report/export-requests",
        json={
            "file_format": "json",
            "requester_role": "Viewer",
            "reason": "过期审批测试。",
            "expires_at": "2000-01-01T00:00:00+00:00",
        },
    ).json()
    assert expired_request["expires_at"] == "2000-01-01T00:00:00+00:00"

    approve_expired = client.post(
        f"/report-export-requests/{expired_request['request_id']}/approve",
        json={"approver_role": "Admin", "note": "过期后不能批准。"},
    )
    assert approve_expired.status_code == 409
    assert approve_expired.json()["code"] == "REPORT_EXPORT_APPROVAL_EXPIRED"

    lifecycle_events = client.get("/audit-events", params={"target": task["task_id"]}).json()
    lifecycle_actions = {event["action"] for event in lifecycle_events}
    assert "task.report.export.reject" in lifecycle_actions
    assert "task.report.export.revoke" in lifecycle_actions
    assert "task.report.export.expire" in lifecycle_actions


def test_task_creation_rejects_conflicting_preflight_ids(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_dataset.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "task_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    preflight = client.post(
        "/tasks/preflight",
        json={
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
            "sample_repeat_times": 1,
        },
    ).json()

    response = client.post(
        "/tasks",
        json={
            "name": "冲突预检 ID 任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
            "sample_repeat_times": 1,
            "preflight_id": preflight["preflight_id"],
            "preflight_result": {**preflight, "preflight_id": "preflight-other"},
        },
    )

    assert response.status_code == 409
    assert response.json()["code"] == "TASK_PREFLIGHT_STALE"
    assert response.json()["details"]["mismatches"][0]["field"] == "preflight_id"


def test_task_execution_templates_can_be_listed_created_and_snapshotted(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_dataset.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "task_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()

    defaults = client.get("/task-execution-templates").json()
    assert "release_gate_safe" in {template["template_id"] for template in defaults}

    created_template = client.post(
        "/task-execution-templates",
        json={
            "name": "高严谨回归模板",
            "description": "用于上线前高严谨回归。",
            "evaluation_goal": "regression",
            "quality_gate": {"pass_rate": 0.96, "max_badcase_count": 1},
            "execution_config": {
                "chunk_size": 50,
                "concurrency": 2,
                "sample_repeat_times": 3,
                "retry": {"max_retries": 2, "backoff_seconds": 4},
                "cost_budget": 30,
            },
            "tags": ["regression", "strict"],
        },
    ).json()
    assert created_template["template_id"].startswith("tasktpl-")
    assert created_template["execution_config"]["sample_repeat_times"] == 3

    preflight = client.post(
        "/tasks/preflight",
        json={
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "execution_template_id": created_template["template_id"],
            "evaluation_goal": created_template["evaluation_goal"],
            "quality_gate": created_template["quality_gate"],
            "sample_repeat_times": created_template["execution_config"]["sample_repeat_times"],
            "cost_budget": created_template["execution_config"]["cost_budget"],
        },
    ).json()
    assert preflight["execution_template_id"] == created_template["template_id"]
    assert preflight["sample_repeat_times"] == 3
    assert preflight["cost_budget"] == 30

    templates = client.get("/task-execution-templates").json()
    assert created_template["template_id"] in {template["template_id"] for template in templates}

    task = client.post(
        "/tasks",
        json={
            "name": "模板化任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "execution_template_id": created_template["template_id"],
            "evaluation_goal": created_template["evaluation_goal"],
            "quality_gate": created_template["quality_gate"],
            "chunk_size": created_template["execution_config"]["chunk_size"],
            "concurrency": created_template["execution_config"]["concurrency"],
            "sample_repeat_times": created_template["execution_config"]["sample_repeat_times"],
            "max_retries": created_template["execution_config"]["retry"]["max_retries"],
            "retry_backoff_seconds": created_template["execution_config"]["retry"]["backoff_seconds"],
            "cost_budget": created_template["execution_config"]["cost_budget"],
        },
    ).json()
    assert task["execution_config"]["execution_template_id"] == created_template["template_id"]
    assert task["execution_config"]["sample_repeat_times"] == 3
