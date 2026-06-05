import base64
import csv
import io
import json
import time
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
from aegisqa.api.routes.tasks import _build_task_report_export_csv
from aegisqa.workflows.models import WorkflowDraft, WorkflowStep


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


def _write_xss_jsonl(path: Path) -> None:
    rows = [
        {"question": "<script>alert(1)</script>", "reference": "不会命中", "expected_label": "fail"},
    ]
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _write_formula_jsonl(path: Path) -> None:
    rows = [
        {"question": '=HYPERLINK("http://evil.local","click")', "reference": "+SUM(1,1)", "expected_label": "fail"},
        {"question": "普通问题", "reference": " \t@cmd", "expected_label": "pass"},
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
    paged_report = client.get(
        f"/tasks/{task['task_id']}/report",
        params={"step_page": 2, "step_page_size": 1, "diagnostic_step_page": 2, "diagnostic_step_page_size": 1},
    ).json()
    assert paged_report["step_distribution"][0]["step_id"] == "judge"
    assert paged_report["step_distribution_pagination"] == {"page": 2, "page_size": 1, "total_items": 2, "total_pages": 2}
    assert paged_report["diagnostics"]["step_health"][0]["step_id"] == "judge"
    assert paged_report["diagnostics_pagination"]["step_health"] == {"page": 2, "page_size": 1, "total_items": 2, "total_pages": 2}
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


def test_legacy_run_report_html_export_escapes_badcase_payload(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "xss_dataset.jsonl"
    _write_xss_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "xss_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "HTML 导出转义任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
        },
    ).json()
    executed = client.post(f"/tasks/{task['task_id']}/execute").json()

    html_export = client.get(f"/runs/{executed['run_id']}/report/export", params={"file_format": "html"}).json()

    assert "<script>alert(1)</script>" not in html_export["content"]
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html_export["content"]


def test_task_result_export_includes_each_item_row_context_metrics_and_step_outputs(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "result_export_dataset.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "result_export_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "结果导出任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
        },
    ).json()
    client.post(f"/tasks/{task['task_id']}/execute")

    csv_export = client.get(f"/tasks/{task['task_id']}/results/export", params={"file_format": "csv"})
    assert csv_export.status_code == 200
    assert csv_export.headers["content-type"].startswith("text/csv")
    assert csv_export.headers["x-aegisqa-row-count"] == "2"
    assert csv_export.headers["x-aegisqa-streaming"] == "true"
    assert "attachment;" in csv_export.headers["content-disposition"]
    assert "row.question" in csv_export.text
    assert "context.answer" in csv_export.text
    assert "metrics.tokens" in csv_export.text
    assert "step.answer.output.answer" not in csv_export.text

    csv_with_steps = client.get(f"/tasks/{task['task_id']}/results/export", params={"file_format": "csv", "include_steps": True})
    assert "step.answer.output.answer" in csv_with_steps.text
    assert "step.judge.output.label" in csv_with_steps.text

    jsonl_export = client.get(f"/tasks/{task['task_id']}/results/export", params={"file_format": "jsonl"})
    assert jsonl_export.headers["content-type"].startswith("application/x-ndjson")
    rows = [json.loads(line) for line in jsonl_export.text.splitlines()]
    assert len(rows) == 2
    assert rows[0]["row.question"] == "什么是 AegisQA?"
    assert rows[0]["context.answer"].startswith("模型回答：")
    assert rows[0]["metrics.tokens"] > 0

    json_export = client.get(f"/tasks/{task['task_id']}/results/export", params={"file_format": "json"})
    assert json_export.headers["content-type"].startswith("application/json")
    assert json_export.json()[0]["item_id"].startswith("item-")

    export_events = client.get("/audit-events", params={"action": "task.results.export", "target": task["task_id"]}).json()
    assert export_events[-1]["detail"]["streaming"] is True
    assert export_events[-1]["detail"]["row_count"] == 2


def test_task_result_csv_export_escapes_formula_like_cells(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "formula_result_export_dataset.jsonl"
    _write_formula_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "formula_result_export_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "公式注入结果导出任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
        },
    ).json()
    client.post(f"/tasks/{task['task_id']}/execute")

    csv_export = client.get(f"/tasks/{task['task_id']}/results/export", params={"file_format": "csv"})

    assert csv_export.status_code == 200
    rows = list(csv.DictReader(io.StringIO(csv_export.text)))
    assert rows[0]["row.question"].startswith("'=HYPERLINK")
    assert rows[0]["row.reference"] == "'+SUM(1,1)"
    assert rows[1]["row.reference"].startswith("' \t@cmd")
    assert not rows[0]["row.question"].startswith("=")
    assert not rows[0]["row.reference"].startswith("+")


def test_task_result_export_records_request_actor_and_role_for_audit(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "audited_result_export_dataset.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "audited_result_export_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "原始结果导出审计任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
        },
    ).json()
    client.post(f"/tasks/{task['task_id']}/execute")

    export_response = client.get(
        f"/tasks/{task['task_id']}/results/export",
        params={"file_format": "jsonl", "role": "Reviewer", "actor": "alice"},
    )

    assert export_response.status_code == 200
    export_events = client.get("/audit-events", params={"action": "task.results.export", "target": task["task_id"]}).json()
    event = export_events[-1]
    assert event["actor"] == "alice"
    assert event["role"] == "Reviewer"
    assert event["detail"]["role"] == "Reviewer"
    assert event["detail"]["file_format"] == "jsonl"


def test_task_report_csv_export_escapes_formula_like_cells() -> None:
    payload = {
        "task": {"task_id": "task-formula", "run_id": "run-formula"},
        "report": {"pass_rate": 0.1},
        "preflight_evidence": {
            "preflight_id": "preflight-formula",
            "summary": '=HYPERLINK("http://evil.local","summary")',
            "status": "+SUM(1,1)",
            "checks": [
                {"check_id": "dataset_non_empty", "status": "passed", "message": "@cmd"},
            ],
        },
        "quality_decision": {"status": "warning", "summary": "-1+2"},
        "segments": [
            {"segment_key": "=scene", "segment_value": "bad", "pass_rate": 0.1, "sample_count": 2, "badcase_count": 1},
        ],
        "badcases": [
            {"item_id": "item-formula", "status": "pending", "reason": '=HYPERLINK("http://evil.local","badcase")'},
        ],
    }

    content = _build_task_report_export_csv(payload)
    rows = list(csv.DictReader(io.StringIO(content)))
    by_section_field = {(row["section"], row["field"]): row for row in rows}

    assert by_section_field[("preflight", "preflight_id")]["details"].startswith("'=HYPERLINK")
    assert by_section_field[("preflight", "preflight_status")]["value"] == "'+SUM(1,1)"
    assert by_section_field[("preflight_check", "dataset_non_empty")]["details"] == "'@cmd"
    assert by_section_field[("quality_decision", "status")]["details"] == "'-1+2"
    segment_row = next(row for row in rows if row["section"] == "segment")
    assert segment_row["field"] == "'=scene=bad"
    assert by_section_field[("badcase", "item-formula")]["details"].startswith("'=HYPERLINK")


def test_task_background_execute_returns_running_and_updates_progress(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "background_dataset.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "background_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "后台执行任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
        },
    ).json()

    started = client.post(f"/tasks/{task['task_id']}/execute", params={"background": True}).json()

    assert started["status"] == "running"
    assert started["completed_items"] == 0

    latest = started
    for _ in range(50):
        latest = client.get(f"/tasks/{task['task_id']}").json()
        if latest["status"] == "completed":
            break
        time.sleep(0.05)

    assert latest["status"] == "completed"
    assert latest["completed_items"] == 2


def test_background_execute_uses_injected_executor_and_running_state_survives_app_reload(tmp_path: Path) -> None:
    class CapturingTaskExecutor:
        backend = "capturing"

        def __init__(self) -> None:
            self.submissions: list[dict[str, str]] = []

        def submit(self, *, task_id: str, run_id: str, execute) -> dict[str, str]:  # noqa: ANN001 - 测试替身只关心提交边界。
            self.submissions.append({"task_id": task_id, "run_id": run_id})
            return {"backend": self.backend, "job_id": f"captured-{task_id}"}

    store_root = tmp_path / "store"
    executor = CapturingTaskExecutor()
    app = create_app(store_root=store_root, task_executor=executor)
    client = TestClient(app)
    data_path = tmp_path / "executor_reload_dataset.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "executor_reload_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "后台执行器持久化任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
        },
    ).json()

    started = client.post(f"/tasks/{task['task_id']}/execute", params={"background": True}).json()

    assert executor.submissions == [{"task_id": task["task_id"], "run_id": task["run_id"]}]
    assert started["status"] == "running"
    assert started["execution_state"]["executor_backend"] == "capturing"
    assert started["execution_state"]["executor_job_id"] == f"captured-{task['task_id']}"

    reloaded = TestClient(create_app(store_root=store_root, task_executor=CapturingTaskExecutor())).get(f"/tasks/{task['task_id']}").json()
    assert reloaded["status"] == "running"
    assert reloaded["execution_state"]["executor_backend"] == "capturing"
    assert reloaded["run_id"] == task["run_id"]


def test_background_execute_rolls_back_running_state_when_executor_submit_fails(tmp_path: Path) -> None:
    class FailingTaskExecutor:
        backend = "failing"

        def submit(self, *, task_id: str, run_id: str, execute) -> dict[str, str]:  # noqa: ANN001 - 测试替身只关心失败提交边界。
            raise RuntimeError("broker down")

    store_root = tmp_path / "store"
    app = create_app(store_root=store_root, task_executor=FailingTaskExecutor())
    client = TestClient(app, raise_server_exceptions=False)
    data_path = tmp_path / "executor_failure_dataset.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "executor_failure_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "后台执行器失败任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
        },
    ).json()

    response = client.post(f"/tasks/{task['task_id']}/execute", params={"background": True})

    assert response.status_code == 503
    assert response.json()["code"] == "TASK_EXECUTOR_SUBMIT_FAILED"
    stored = TestClient(create_app(store_root=store_root, task_executor=FailingTaskExecutor())).get(f"/tasks/{task['task_id']}").json()
    assert stored["status"] == "queued"
    assert stored["execution_state"]["executor_backend"] == "failing"
    assert stored["execution_state"]["submit_error"] == "broker down"


def test_tasks_support_server_side_pagination_and_status_filter(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_page_dataset.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "task_page_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    for index in range(6):
        task = client.post(
            "/tasks",
            json={
                "name": f"分页任务 {index}",
                "dataset_id": dataset["dataset_id"],
                "dataset_version": dataset["version"],
                "workflow_version_id": workflow["version_id"],
            },
        ).json()
        if index % 2 == 0:
            client.post(f"/tasks/{task['task_id']}/execute")

    legacy = client.get("/tasks").json()
    assert isinstance(legacy, list)
    assert len(legacy) == 6

    payload = client.get("/tasks", params={"status": "queued", "page": 2, "page_size": 2}).json()
    assert payload["pagination"] == {"page": 2, "page_size": 2, "total_items": 3, "total_pages": 2}
    assert len(payload["items"]) == 1
    assert {item["status"] for item in payload["items"]} == {"queued"}


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


def test_task_creation_uses_latest_draft_mapping_after_publish(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "ap_dataset.jsonl"
    rows = [{"ap_code": "AP001"}, {"ap_code": "AP002"}]
    with data_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    dataset = client.post("/datasets/from-path", json={"name": "ap_dataset", "path": str(data_path)}).json()
    draft = client.post("/workflow-drafts", json={"name": "旧默认字段草稿", "graph": _graph_payload()}).json()
    updated_graph = {
        "name": "AP ASR 评测流程",
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成查询",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.ap_code"},
                "output_mapping": {"answer": "context.answer"},
                "config": {"model": "demo-model", "temperature": 0},
            },
            {"node_id": "report", "node_type": "output", "label": "报告"},
        ],
        "edges": [{"source": "answer", "target": "report"}],
    }
    client.put(f"/workflow-drafts/{draft['draft_id']}", json={"name": "AP ASR 评测流程", "graph": updated_graph})
    workflow = client.post(f"/workflow-drafts/{draft['draft_id']}/publish").json()

    task = client.post(
        "/tasks",
        json={
            "name": "AP ASR 任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
        },
    ).json()

    assert task["status"] == "queued"
    assert task["workflow_name"] == "AP ASR 评测流程"
    assert task["preflight_result"]["status"] in {"passed", "warning"}
    field_check = next(check for check in task["preflight_result"]["checks"] if check["check_id"] == "field_mapping")
    assert field_check["status"] == "passed"


def test_task_preflight_blocks_historical_workflow_missing_required_skill_mapping(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_dataset.jsonl"
    _write_jsonl(data_path)
    dataset = client.post("/datasets/from-path", json={"name": "task_dataset", "path": str(data_path)}).json()
    workflow = WorkflowDraft(
        name="历史坏映射 Workflow",
        steps=[
            WorkflowStep(
                step_id="answer",
                skill_ref="llm.call@0.1.0",
                input_mapping={},
                output_mapping={"answer": "context.answer"},
                config={"model": "demo-model"},
            )
        ],
    ).publish()
    client.app.state.workflow_service._save(workflow)

    preflight = client.post(
        "/tasks/preflight",
        json={
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow.version_id,
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
        },
    ).json()
    schema_check = next(check for check in preflight["checks"] if check["check_id"] == "workflow_schema_mapping")

    assert preflight["status"] == "blocked"
    assert schema_check["status"] == "blocked"
    assert schema_check["details"]["issues"][0]["code"] == "REQUIRED_INPUT_MAPPING_MISSING"
    assert schema_check["details"]["issues"][0]["missing_fields"] == ["prompt"]

    blocked = client.post(
        "/tasks",
        json={
            "name": "历史坏映射任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow.version_id,
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
        },
    )

    assert blocked.status_code == 409
    assert blocked.json()["details"]["blocked_checks"][0]["check_id"] == "workflow_schema_mapping"


def test_task_preflight_blocks_invalid_skill_override_config(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_dataset.jsonl"
    _write_jsonl(data_path)
    dataset = client.post("/datasets/from-path", json={"name": "task_dataset", "path": str(data_path)}).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()

    preflight = client.post(
        "/tasks/preflight",
        json={
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
            "skill_overrides": {"answer": {"temperature": "hot"}},
        },
    ).json()
    config_check = next(check for check in preflight["checks"] if check["check_id"] == "skill_config")

    assert preflight["status"] == "blocked"
    assert config_check["status"] == "blocked"
    assert config_check["details"]["issues"][0]["code"] == "CONFIG_VALUE_INVALID"
    assert config_check["details"]["issues"][0]["field_path"] == "temperature"

    blocked = client.post(
        "/tasks",
        json={
            "name": "坏参数覆盖任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
            "skill_overrides": {"answer": {"temperature": "hot"}},
        },
    )

    assert blocked.status_code == 409
    assert blocked.json()["details"]["blocked_checks"][0]["check_id"] == "skill_config"


def test_task_preflight_checks_skill_expression_config_against_preview_rows(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_dataset.jsonl"
    with data_path.open("w", encoding="utf-8") as handle:
        handle.write(json.dumps({"question": "第一条有温度", "reference": "AegisQA", "temperature": 0.2}, ensure_ascii=False) + "\n")
        handle.write(json.dumps({"question": "第二条缺温度", "reference": "AegisQA"}, ensure_ascii=False) + "\n")
    dataset = client.post("/datasets/from-path", json={"name": "task_dataset", "path": str(data_path)}).json()
    graph = _graph_payload()
    graph["nodes"][0]["config"]["temperature"] = {"type": "expression", "path": "row.temperature"}
    workflow = client.post("/workflow-graphs/publish", json={"graph": graph}).json()

    preflight = client.post(
        "/tasks/preflight",
        json={
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
        },
    ).json()
    config_check = next(check for check in preflight["checks"] if check["check_id"] == "skill_config")

    assert preflight["status"] == "blocked"
    assert config_check["status"] == "blocked"
    assert config_check["details"]["issues"][0]["code"] == "CONFIG_EXPRESSION_PATH_MISSING"
    assert config_check["details"]["issues"][0]["row_index"] == 1
    assert "row.temperature" in config_check["details"]["issues"][0]["message"]


def test_workflow_publish_rejects_unsafe_input_mapping_expression(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    graph = _graph_payload()
    graph["nodes"][0]["input_mapping"]["prompt"] = '__import__("os").system("calc")'

    response = client.post("/workflow-graphs/publish", json={"graph": graph})

    assert response.status_code == 400
    payload = response.json()
    assert payload["message"] == "Workflow Graph 校验失败"
    assert payload["details"]["errors"][0]["code"] == "INPUT_MAPPING_EXPRESSION_INVALID"
    assert payload["details"]["errors"][0]["details"]["field_path"] == "prompt"
    assert "不支持的表达式语法" in payload["details"]["errors"][0]["message"]


def test_task_preflight_reports_input_template_expression_error_position(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_dataset.jsonl"
    _write_jsonl(data_path)
    dataset = client.post("/datasets/from-path", json={"name": "task_dataset", "path": str(data_path)}).json()
    graph = _graph_payload()
    graph["nodes"][0]["input_mapping"]["prompt"] = "Q={{ row.question }} / scene={{ row.scene }}"
    workflow = client.post("/workflow-graphs/publish", json={"graph": graph}).json()

    preflight = client.post(
        "/tasks/preflight",
        json={
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
        },
    ).json()
    expression_check = next(check for check in preflight["checks"] if check["check_id"] == "workflow_input_expressions")

    assert preflight["status"] == "blocked"
    assert expression_check["status"] == "blocked"
    issue = expression_check["details"]["issues"][0]
    assert issue["code"] == "INPUT_MAPPING_EXPRESSION_PATH_MISSING"
    assert issue["step_id"] == "answer"
    assert issue["field_path"] == "prompt"
    assert issue["row_index"] == 0
    assert issue["expression"] == "Q={{ row.question }} / scene={{ row.scene }}"
    assert issue["missing_path"] == "row.scene"


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

    denied_export = client.get(f"/tasks/{task['task_id']}/report/export", params={"file_format": "json", "role": "Viewer", "actor": "viewer_denied"})
    assert denied_export.status_code == 403
    assert denied_export.json()["code"] == "REPORT_EXPORT_FORBIDDEN"

    export_request = client.post(
        f"/tasks/{task['task_id']}/report/export-requests",
        json={"file_format": "json", "requester_role": "Viewer", "actor": "business_viewer", "reason": "业务复盘需要离线报告。"},
    ).json()
    assert export_request["request_id"].startswith("rex-")
    assert export_request["status"] == "pending"
    assert export_request["task_id"] == task["task_id"]
    assert export_request["requested_permission"] == "report:export"

    listed = client.get("/report-export-requests", params={"task_id": task["task_id"]}).json()
    assert listed[0]["request_id"] == export_request["request_id"]

    reviewer_approval = client.post(
        f"/report-export-requests/{export_request['request_id']}/approve",
        json={"approver_role": "Reviewer", "actor": "reviewer_user", "note": "Reviewer 不能批准外发。"},
    )
    assert reviewer_approval.status_code == 403
    assert reviewer_approval.json()["code"] == "REPORT_EXPORT_APPROVAL_FORBIDDEN"

    approved = client.post(
        f"/report-export-requests/{export_request['request_id']}/approve",
        json={"approver_role": "Admin", "actor": "export_admin", "note": "允许本次离线复盘。"},
    ).json()
    assert approved["status"] == "approved"
    assert approved["approved_by"] == "Admin"
    assert approved["approved_by_actor"] == "export_admin"
    assert approved["approval_note"] == "允许本次离线复盘。"

    approved_export = client.get(
        f"/tasks/{task['task_id']}/report/export",
        params={"file_format": "json", "role": "Viewer", "actor": "business_viewer", "approval_request_id": export_request["request_id"]},
    ).json()
    assert approved_export["content"]["task"]["task_id"] == task["task_id"]

    forbidden_events = client.get("/audit-events", params={"actor": "reviewer_user"}).json()
    assert forbidden_events[-1]["action"] == "task.report.export.approve"
    assert forbidden_events[-1]["result"] == "forbidden"
    assert forbidden_events[-1]["role"] == "Reviewer"

    request_events = client.get("/audit-events", params={"action": "task.report.export.request", "target": task["task_id"]}).json()
    assert request_events[-1]["actor"] == "business_viewer"
    assert request_events[-1]["role"] == "Viewer"
    approve_events = client.get("/audit-events", params={"action": "task.report.export.approve", "target": task["task_id"]}).json()
    assert approve_events[-1]["actor"] == "export_admin"
    assert approve_events[-1]["role"] == "Admin"
    export_events = client.get("/audit-events", params={"action": "task.report.export", "target": task["task_id"]}).json()
    assert export_events[-1]["actor"] == "business_viewer"
    assert export_events[-1]["role"] == "Viewer"
    assert export_events[-1]["detail"]["approval_request_id"] == export_request["request_id"]
    assert export_events[-1]["detail"]["role"] == "Viewer"


def test_task_report_offline_package_contains_audit_bundle_and_uses_export_approval(tmp_path: Path) -> None:
    app = create_app(store_root=tmp_path / "store")
    client = TestClient(app)
    data_path = tmp_path / "task_dataset.jsonl"
    _write_jsonl(data_path)

    dataset = client.post("/datasets/from-path", json={"name": "task_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"}).json()
    graph = _graph_payload()
    graph["nodes"][0]["config"]["api_key"] = "sk-secret-offline-package"
    workflow = client.post("/workflow-graphs/publish", json={"graph": graph}).json()
    preflight = client.post(
        "/tasks/preflight",
        json={
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
        },
    ).json()
    task = client.post(
        "/tasks",
        json={
            "name": "离线审计包任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "preflight_id": preflight["preflight_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.9, "max_badcase_count": 0},
        },
    ).json()
    client.post(f"/tasks/{task['task_id']}/execute")

    denied = client.get(f"/tasks/{task['task_id']}/report/offline-package", params={"role": "Viewer"})
    assert denied.status_code == 403
    assert denied.json()["code"] == "REPORT_EXPORT_FORBIDDEN"

    export_request = client.post(
        f"/tasks/{task['task_id']}/report/export-requests",
        json={"file_format": "offline_zip", "requester_role": "Viewer", "reason": "离线审计归档。"},
    ).json()
    client.post(f"/report-export-requests/{export_request['request_id']}/approve", json={"approver_role": "Admin", "note": "允许导出离线包。"})
    exported = client.get(
        f"/tasks/{task['task_id']}/report/offline-package",
        params={"role": "Viewer", "approval_request_id": export_request["request_id"]},
    )

    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("application/zip")
    assert exported.headers["x-aegisqa-file-format"] == "offline_zip"
    archive = zipfile.ZipFile(io.BytesIO(exported.content))
    assert set(archive.namelist()) >= {
        "manifest.json",
        "report.html",
        "report.csv",
        "preflight.json",
        "workflow_snapshot.json",
        "skill_manifests.json",
        "dataset_schema.json",
    }
    manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
    assert manifest["task_id"] == task["task_id"]
    assert manifest["preflight_id"] == preflight["preflight_id"]
    assert "sk-secret-offline-package" not in exported.content.decode("utf-8", errors="ignore")
    assert "***REDACTED***" in archive.read("workflow_snapshot.json").decode("utf-8")
    export_events = client.get("/audit-events", params={"action": "task.report.export", "target": task["task_id"]}).json()
    assert export_events[-1]["detail"]["file_format"] == "offline_zip"
    assert export_events[-1]["detail"]["approval_request_id"] == export_request["request_id"]


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
        json={"file_format": "csv", "requester_role": "Viewer", "actor": "csv_requester", "reason": "需要给业务方离线分析。"},
    ).json()
    rejected = client.post(
        f"/report-export-requests/{rejected_request['request_id']}/reject",
        json={"approver_role": "Admin", "actor": "security_admin", "note": "CSV 明细包含敏感样本，暂不外发。"},
    ).json()
    assert rejected["status"] == "rejected"
    assert rejected["rejected_by"] == "Admin"
    assert rejected["rejected_by_actor"] == "security_admin"
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
        json={"file_format": "html", "requester_role": "Viewer", "actor": "html_requester", "reason": "临时排查。"},
    ).json()
    revoked = client.post(
        f"/report-export-requests/{revoked_request['request_id']}/revoke",
        json={"requester_role": "Viewer", "actor": "html_requester", "reason": "已改用在线报告，不再需要外发。"},
    ).json()
    assert revoked["status"] == "revoked"
    assert revoked["revoked_by"] == "Viewer"
    assert revoked["revoked_by_actor"] == "html_requester"

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
    events_by_action = {event["action"]: event for event in lifecycle_events if event["action"] in {"task.report.export.reject", "task.report.export.revoke"}}
    assert events_by_action["task.report.export.reject"]["actor"] == "security_admin"
    assert events_by_action["task.report.export.reject"]["role"] == "Admin"
    assert events_by_action["task.report.export.revoke"]["actor"] == "html_requester"
    assert events_by_action["task.report.export.revoke"]["role"] == "Viewer"


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
