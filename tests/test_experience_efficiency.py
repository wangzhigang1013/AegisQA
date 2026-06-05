import json
from pathlib import Path

from fastapi.testclient import TestClient

from aegisqa.api.app import create_app
from aegisqa.skills.base import BaseSkill, SkillManifest, SkillResult


def _write_jsonl(path: Path) -> None:
    rows = [
        {"question": "AegisQA 是什么?", "reference": "AegisQA 是 AI 评测工作台。", "expected_label": "pass", "scene": "faq"},
        {"question": "支付失败怎么办?", "reference": "完全不相关答案", "expected_label": "fail", "scene": "payment"},
    ]
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _graph_payload() -> dict[str, object]:
    return {
        "name": "体验效率优化 Workflow",
        "nodes": [
            {
                "node_id": "answer",
                "node_type": "skill",
                "label": "生成回答",
                "skill_ref": "llm.call@0.1.0",
                "input_mapping": {"prompt": "row.question"},
                "output_mapping": {"answer": "context.answer", "tokens": "metrics.tokens"},
                "config": {"model": "experience-model", "temperature": 0, "prompt_version": "prompt-experience-v1"},
                "cacheable": True,
            },
            {
                "node_id": "judge",
                "node_type": "skill",
                "label": "质量裁判",
                "skill_ref": "llm.judge@0.1.0",
                "input_mapping": {"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
                "output_mapping": {"score": "metrics.judge_score", "label": "context.judge_label"},
                "config": {"threshold": 0.6, "prompt_version": "judge-experience-v1"},
            },
            {"node_id": "report", "node_type": "output", "label": "报告"},
        ],
        "edges": [{"source": "answer", "target": "judge"}, {"source": "judge", "target": "report"}],
    }


def _seed_executed_task(tmp_path: Path) -> tuple[TestClient, dict[str, object]]:
    client = TestClient(create_app(store_root=tmp_path / "store"))
    data_path = tmp_path / "experience.jsonl"
    _write_jsonl(data_path)
    dataset = client.post(
        "/datasets/from-path",
        json={"name": "experience_dataset", "path": str(data_path), "golden": True, "label_field": "expected_label"},
    ).json()
    workflow = client.post("/workflow-graphs/publish", json={"graph": _graph_payload()}).json()
    task = client.post(
        "/tasks",
        json={
            "name": "体验效率优化任务",
            "dataset_id": dataset["dataset_id"],
            "dataset_version": dataset["version"],
            "workflow_version_id": workflow["version_id"],
            "evaluation_goal": "release_gate",
            "quality_gate": {"pass_rate": 0.95, "max_badcase_count": 0},
        },
    ).json()
    return client, client.post(f"/tasks/{task['task_id']}/execute").json()


def test_overview_workbench_returns_real_continue_work_without_demo_fallback(tmp_path: Path) -> None:
    empty_client = TestClient(create_app(store_root=tmp_path / "empty-store"))
    empty_payload = empty_client.get("/overview/workbench").json()

    assert empty_payload["source"] == "real_store"
    assert empty_payload["summary"]["task_count"] == 0
    assert empty_payload["empty_state"]["message"] == "当前没有真实任务数据。请先上传 Dataset、发布 Workflow，再创建 Task。"
    assert empty_payload["recent_tasks"] == []
    assert empty_payload["continue_actions"] == []

    client, task = _seed_executed_task(tmp_path)
    payload = client.get("/overview/workbench").json()

    assert payload["source"] == "real_store"
    assert payload["summary"]["task_count"] == 1
    assert payload["summary"]["pending_badcase_count"] >= 1
    assert payload["recent_tasks"][0]["task_id"] == task["task_id"]
    assert payload["recent_reports"][0]["task_id"] == task["task_id"]
    assert any(action["action"] == "open_report" and action["target_url"] == f"/reports?task_id={task['task_id']}" for action in payload["continue_actions"])
    assert any(action["action"] == "open_trace_flow" for action in payload["continue_actions"])
    assert all(action["id"] == action["action"] for action in payload["continue_actions"])
    assert all("target" in action and "payload" in action and "disabled" in action for action in payload["continue_actions"])


def test_task_detail_exposes_action_preflight_gate_and_run_summaries(tmp_path: Path) -> None:
    client, task = _seed_executed_task(tmp_path)

    detail = client.get(f"/tasks/{task['task_id']}").json()
    actions = {item["action"]: item for item in detail["available_actions"]}

    assert detail["latest_run_summary"]["run_id"] == task["run_id"]
    assert detail["latest_run_summary"]["status"] == task["status"]
    assert detail["preflight_summary"]["status"] in {"passed", "warning"}
    assert detail["gate_summary"]["status"] in {"warning", "blocked"}
    assert actions["open_trace_flow"]["enabled"] is True
    assert actions["open_report"]["target_url"] == f"/reports?task_id={task['task_id']}"
    assert actions["open_report"]["id"] == "open_report"
    assert actions["open_report"]["target"]["type"] == "route"
    assert actions["open_report"]["payload"]["task_id"] == task["task_id"]
    assert actions["execute"]["enabled"] is False
    assert actions["execute"]["disabled"] is True
    assert "已完成" in actions["execute"]["disabled_reason"]
    assert actions["attempt"]["enabled"] is True


def test_trace_flow_steps_include_diagnostics_and_detail_actions(tmp_path: Path) -> None:
    client, task = _seed_executed_task(tmp_path)

    trace_flow = client.get(f"/tasks/{task['task_id']}/trace-flow").json()
    first_step = trace_flow["items"][0]["steps"][0]

    assert "diagnostic_tags" in first_step
    assert "available_actions" in first_step
    assert "error_explanation" in first_step
    assert any(action["action"] == "view_step_detail" for action in first_step["available_actions"])
    assert any(action["action"] == "open_repro_bundle" for action in first_step["available_actions"])
    assert all(action["id"] == action["action"] for action in first_step["available_actions"])


def test_step_replay_prompt_debug_and_repro_bundle_are_callable(tmp_path: Path) -> None:
    client, task = _seed_executed_task(tmp_path)
    trace_flow = client.get(f"/tasks/{task['task_id']}/trace-flow").json()
    item = trace_flow["items"][0]
    step = item["steps"][0]
    base_path = f"/runs/{task['run_id']}/items/{item['item_id']}/steps/{step['step_id']}"

    replay = client.post(f"{base_path}/replay", json={}).json()
    assert replay["mode"] == "replay"
    assert replay["status"] == "skipped"
    assert replay["mock_llm_calls"] is True
    assert replay["resolved_input"]["prompt"] == item["row"]["question"]
    assert replay["raw_output"]
    assert replay["step"]["skill_ref"] == step["skill_ref"]

    live_replay = client.post(f"{base_path}/replay", json={"mock_llm_calls": False}).json()
    assert live_replay["status"] == "succeeded"
    assert live_replay["validated_output"]
    assert live_replay["cache"]["disabled"] is True

    prompt_debug = client.post(f"{base_path}/prompt-debug", json={}).json()
    assert prompt_debug["mode"] == "prompt_debug"
    assert prompt_debug["rendered_prompt"] == item["row"]["question"]
    assert prompt_debug["token_usage"]["total_tokens"] >= 1
    assert prompt_debug["mock_llm_calls"] is True
    assert prompt_debug["prompt_calls"]
    prompt_artifacts = prompt_debug["prompt_calls"][0]["artifacts"]
    rendered_prompt_artifact = prompt_artifacts["rendered_prompt"]
    raw_response_artifact = prompt_artifacts["raw_response"]
    assert rendered_prompt_artifact["kind"] == "rendered_prompts"
    assert raw_response_artifact["kind"] == "raw_llm_responses"
    saved_prompt = client.app.state.artifact_store.read_bytes(rendered_prompt_artifact["kind"], rendered_prompt_artifact["artifact_id"]).decode("utf-8")
    saved_response = client.app.state.artifact_store.read_bytes(raw_response_artifact["kind"], raw_response_artifact["artifact_id"]).decode("utf-8")
    assert saved_prompt == item["row"]["question"]
    assert "模型回答" in saved_response

    bundle = client.get(f"{base_path}/repro-bundle").json()
    assert bundle["bundle_type"] == "step_repro_bundle"
    assert bundle["schema_version"] == "aegisqa.step_repro_bundle.v1"
    assert bundle["workflow"]["version_id"] == task["workflow_version_id"]
    assert bundle["skill_manifest"]["skill_id"] == step["skill_ref"]
    assert bundle["resolved_input"]["prompt"] == item["row"]["question"]
    assert bundle["raw_output"]
    assert bundle["replay_endpoint"] == f"{base_path}/replay"
    assert bundle["prompt_debug_endpoint"] == f"{base_path}/prompt-debug"
    assert bundle["artifact"]["kind"] == "repro_bundles"
    assert bundle["artifact"]["artifact_id"] == f"runs/{task['run_id']}/items/{item['item_id']}/steps/{step['step_id']}/repro-bundle.json"
    saved_bundle = json.loads(client.app.state.artifact_store.read_bytes(bundle["artifact"]["kind"], bundle["artifact"]["artifact_id"]).decode("utf-8"))
    assert saved_bundle["bundle_type"] == "step_repro_bundle"
    assert saved_bundle["resolved_input"] == bundle["resolved_input"]


def test_step_debug_endpoints_reject_viewer_role(tmp_path: Path) -> None:
    client, task = _seed_executed_task(tmp_path)
    trace_flow = client.get(f"/tasks/{task['task_id']}/trace-flow").json()
    item = trace_flow["items"][0]
    step = item["steps"][0]
    base_path = f"/runs/{task['run_id']}/items/{item['item_id']}/steps/{step['step_id']}"

    denied_replay = client.post(f"{base_path}/replay", json={"role": "Viewer", "actor": "viewer"})
    denied_prompt = client.post(f"{base_path}/prompt-debug", json={"role": "Viewer", "actor": "viewer"})
    denied_bundle = client.get(f"{base_path}/repro-bundle?role=Viewer&actor=viewer")

    for response in (denied_replay, denied_prompt, denied_bundle):
        assert response.status_code == 403
        assert response.json()["code"] == "FORBIDDEN"
        assert response.json()["details"]["required_permission"] == "run:create"


def test_step_live_replay_preserves_raw_output_when_output_schema_invalid(tmp_path: Path) -> None:
    client, task = _seed_executed_task(tmp_path)
    trace_flow = client.get(f"/tasks/{task['task_id']}/trace-flow").json()
    item = trace_flow["items"][0]
    answer_step = item["steps"][0]
    base_path = f"/runs/{task['run_id']}/items/{item['item_id']}/steps/{answer_step['step_id']}"

    class InvalidReplaySkill(BaseSkill):
        manifest = SkillManifest(
            skill_id=answer_step["skill_ref"],
            name="Invalid Replay Skill",
            version="test",
            description="测试 replay output_schema invalid 时是否保留 raw output。",
            input_schema={"type": "object", "required": ["prompt"], "properties": {"prompt": {"type": "string"}}},
            output_schema={
                "type": "object",
                "required": ["answer", "tokens"],
                "properties": {"answer": {"type": "string"}, "tokens": {"type": "integer"}},
            },
        )

        def run(self, inputs: dict[str, object], config: dict[str, object] | None = None) -> SkillResult:
            return SkillResult(output={"answer": f"raw:{inputs['prompt']}"}, metrics={"debug": 1})

    client.app.state.registry.register(InvalidReplaySkill())

    replay = client.post(
        f"{base_path}/replay",
        json={
            "input_mode": "override",
            "override_input": {"prompt": "override prompt"},
            "mock_llm_calls": False,
            "disable_cache": True,
        },
    ).json()

    assert replay["input_mode"] == "override"
    assert replay["resolved_input"] == {"prompt": "override prompt"}
    assert replay["status"] == "failed"
    assert replay["error_code"] == "OUTPUT_SCHEMA_INVALID"
    assert replay["raw_output"] == {"answer": "raw:override prompt"}
    assert replay["validated_output"] == {}
    assert replay["schema_errors"]


def test_task_report_promotes_findings_and_action_targets(tmp_path: Path) -> None:
    client, task = _seed_executed_task(tmp_path)

    report = client.get(f"/tasks/{task['task_id']}/report").json()
    actions = {item["action"]: item for item in report["recommended_actions"]}

    assert report["primary_findings"]
    assert report["action_targets"]["open_trace_flow"] == f"/tasks/{task['task_id']}/trace"
    assert report["action_targets"]["open_report"] == f"/reports?task_id={task['task_id']}"
    assert "create_repair_tasks" in actions
    assert actions["create_repair_tasks"]["target_url"] == f"/reports?task_id={task['task_id']}&action=create_repair_tasks"
    assert actions["create_repair_tasks"]["target"]["type"] == "route"
    assert actions["create_repair_tasks"]["payload"]["task_id"] == task["task_id"]
    assert all(finding.get("evidence") for finding in report["primary_findings"] if finding["status"] != "skipped")
