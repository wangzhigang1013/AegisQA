import csv
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from threading import Event

import pytest

from aegisqa.badcases.service import BadcaseService
from aegisqa.core.mapper import MappingPathError, TypeMismatchError, resolve_input_mapping
from aegisqa.core.security import redact_secrets
from aegisqa.datasets.service import DatasetService
from aegisqa.engine.runner import RunRequest, WorkflowRunner
from aegisqa.judge.audit import audit_judge_profile
from aegisqa.reports.aggregator import aggregate_run_report
from aegisqa.skills.base import BaseSkill, SkillManifest, SkillResult
from aegisqa.skills.registry import SkillRegistry
from aegisqa.storage.json_store import JsonStore
from aegisqa.workflows.models import WorkflowDraft, WorkflowStep


def _write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


class CountingJsonStore(JsonStore):
    """测试用仓储，统计 Run 快照写入次数以防批量执行退化成逐条全量写盘。"""

    def __init__(self, root: Path | str) -> None:
        super().__init__(root)
        self.run_write_count = 0
        self.run_read_count = 0

    def write_json(self, parts, payload):  # noqa: ANN001 - 测试替身保持与 JsonStore 兼容的宽松签名。
        parts_list = list(parts)
        if len(parts_list) == 2 and parts_list[0] == "runs" and str(parts_list[1]).endswith(".json"):
            self.run_write_count += 1
        return super().write_json(parts_list, payload)

    def read_json(self, parts, default=None):  # noqa: ANN001 - 测试替身保持与 JsonStore 兼容的宽松签名。
        parts_list = list(parts)
        if len(parts_list) == 2 and parts_list[0] == "runs" and str(parts_list[1]).endswith(".json"):
            self.run_read_count += 1
        return super().read_json(parts_list, default=default)


class CountingItems:
    """统计 RunReport 聚合遍历次数，避免报告接口随样本量放大重复扫明细。"""

    def __init__(self, items: list[object]) -> None:
        self.items = items
        self.iteration_count = 0

    def __len__(self) -> int:
        return len(self.items)

    def __iter__(self):
        self.iteration_count += 1
        return iter(self.items)


def test_skill_registry_loads_example_manifests_and_contracts() -> None:
    registry = SkillRegistry.with_builtin_skills()

    skills = registry.list_skills()
    skill_ids = {skill.skill_id for skill in skills}

    assert {"llm.call@0.1.0", "llm.judge@0.1.0", "asr.eval@0.1.0", "source.csv@0.1.0", "source.jsonl@0.1.0"} <= skill_ids
    judge = registry.get("llm.judge@0.1.0")
    assert judge.manifest.config_schema["properties"]["threshold"]["type"] == "number"
    assert judge.contract_test()["ok"] is True


def test_dataset_upload_streams_rows_and_versions_csv_jsonl(tmp_path: Path) -> None:
    service = DatasetService(JsonStore(tmp_path / "store"))
    csv_path = tmp_path / "sample.csv"
    jsonl_path = tmp_path / "sample.jsonl"
    rows = [
        {"question": "Q1", "reference": "A1", "expected_label": "pass", "score": 0.9},
        {"question": "Q2", "reference": "A2", "expected_label": "fail", "score": 0.1},
    ]
    _write_csv(csv_path, rows)
    _write_jsonl(jsonl_path, rows)

    csv_version = service.upload_dataset("rag_eval", csv_path, golden=True, label_field="expected_label")
    jsonl_version = service.upload_dataset("rag_eval", jsonl_path)

    assert csv_version.version == 1
    assert jsonl_version.version == 2
    assert csv_version.row_count == 2
    assert csv_version.preview[0]["question"] == "Q1"
    assert csv_version.field_schema["score"] == "number"
    assert csv_version.golden is True
    assert csv_version.label_field == "expected_label"

    streamed_rows = list(service.iter_rows(csv_version.dataset_id, csv_version.version, chunk_size=1))
    assert [row.row_id for row in streamed_rows] == ["1", "2"]
    assert streamed_rows[1].data["reference"] == "A2"


def test_resolve_input_mapping_rejects_type_mismatch_before_skill_call() -> None:
    context = {"row": {"question": 123}, "context": {}, "metrics": {}, "steps": {}}
    input_schema = {
        "type": "object",
        "required": ["question"],
        "properties": {"question": {"type": "string"}},
    }

    with pytest.raises(TypeMismatchError) as exc:
        resolve_input_mapping({"question": "row.question"}, context, input_schema)

    assert exc.value.field_path == "question"
    assert exc.value.expected_type == "string"
    assert exc.value.actual_type == "int"


def test_resolve_input_mapping_parses_json_object_string_for_object_field() -> None:
    context = {"row": {"prompt": "生成回答", "variables": '{"topic": "AegisQA"}'}, "context": {}, "metrics": {}, "steps": {}}
    input_schema = {
        "type": "object",
        "required": ["prompt"],
        "properties": {"prompt": {"type": "string"}, "variables": {"type": "object"}},
    }

    resolved = resolve_input_mapping({"prompt": "row.prompt", "variables": "row.variables"}, context, input_schema)

    assert resolved["variables"] == {"topic": "AegisQA"}


def test_resolve_input_mapping_ignores_blank_optional_object_field() -> None:
    input_schema = {
        "type": "object",
        "required": ["prompt"],
        "properties": {"prompt": {"type": "string"}, "variables": {"type": "object"}},
    }
    context = {"row": {"prompt": "生成回答", "variables": ""}, "context": {}, "metrics": {}, "steps": {}}

    blank_path = resolve_input_mapping({"prompt": "row.prompt", "variables": ""}, context, input_schema)
    blank_cell = resolve_input_mapping({"prompt": "row.prompt", "variables": "row.variables"}, context, input_schema)

    assert blank_path == {"prompt": "生成回答"}
    assert blank_cell == {"prompt": "生成回答"}


def test_resolve_input_mapping_supports_controlled_expressions() -> None:
    context = {
        "row": {
            "question": "什么是 AegisQA?",
            "locale": "zh",
            "zh_question": "中文问题",
            "en_question": "English question",
        },
        "context": {},
        "metrics": {},
        "steps": {},
    }
    input_schema = {
        "type": "object",
        "required": ["prompt", "scene", "template"],
        "properties": {
            "prompt": {"type": "string"},
            "scene": {"type": "string"},
            "template": {"type": "string"},
        },
    }

    resolved = resolve_input_mapping(
        {
            "prompt": 'if(row.locale == "zh", row.zh_question, row.en_question)',
            "scene": 'row.scene ?? "general"',
            "template": "Q={{ row.question }} / scene={{ row.scene ?? \"general\" }}",
        },
        context,
        input_schema,
    )

    assert resolved == {
        "prompt": "中文问题",
        "scene": "general",
        "template": "Q=什么是 AegisQA? / scene=general",
    }


def test_resolve_input_mapping_rejects_arbitrary_code_expressions() -> None:
    context = {"row": {"question": "安全测试"}, "context": {}, "metrics": {}, "steps": {}}
    input_schema = {"type": "object", "required": ["prompt"], "properties": {"prompt": {"type": "string"}}}

    with pytest.raises(MappingPathError, match="不支持的表达式语法"):
        resolve_input_mapping({"prompt": '__import__("os").system("calc")'}, context, input_schema)


def test_workflow_runner_executes_chunked_items_and_generates_report(tmp_path: Path) -> None:
    store = JsonStore(tmp_path / "store")
    dataset_service = DatasetService(store)
    registry = SkillRegistry.with_builtin_skills()
    data_path = tmp_path / "rag.jsonl"
    rows = [
        {"question": "什么是 AegisQA?", "reference": "AI 评测平台", "expected_label": "pass"},
        {"question": "坏例是什么?", "reference": "badcase", "expected_label": "fail"},
        {"question": "如何审计裁判?", "reference": "golden", "expected_label": "pass"},
    ]
    _write_jsonl(data_path, rows)
    dataset = dataset_service.upload_dataset("rag", data_path, golden=True, label_field="expected_label")
    workflow = WorkflowDraft(
        name="rag_regression",
        steps=[
            WorkflowStep(
                step_id="answer",
                skill_ref="llm.call@0.1.0",
                input_mapping={"prompt": "row.question"},
                output_mapping={"answer": "context.answer", "tokens": "metrics.tokens", "latency_ms": "metrics.answer_latency_ms"},
                config={"model": "demo-model", "temperature": 0},
                cacheable=True,
            ),
            WorkflowStep(
                step_id="judge",
                skill_ref="llm.judge@0.1.0",
                input_mapping={"question": "row.question", "answer": "context.answer", "reference": "row.reference"},
                output_mapping={"score": "metrics.judge_score", "label": "context.judge_label", "reason": "context.judge_reason"},
                config={"threshold": 0.6, "model": "judge-model"},
            ),
        ],
    ).publish()
    runner = WorkflowRunner(store, dataset_service, registry)

    run = runner.create_run(RunRequest(workflow=workflow, dataset_id=dataset.dataset_id, dataset_version=dataset.version, chunk_size=2, concurrency=3))
    assert all(set(message.keys()) == {"item_id"} for message in run.queue_messages)
    assert len(run.queue_messages) == 3

    completed = runner.execute_run(run.run_id)
    report = aggregate_run_report(completed)

    assert completed.status == "completed"
    assert report.total_items == 3
    assert report.completed_items == 3
    assert report.pass_rate >= 0
    assert report.error_rate == 0
    assert report.average_latency_ms >= 0
    assert len(report.badcases) >= 1
    assert completed.items[0].steps[0].input_snapshot["prompt"] == "什么是 AegisQA?"
    assert "cache_hit" in completed.items[0].steps[0].model_dump()


def test_aggregate_run_report_scans_items_once() -> None:
    items = CountingItems(
        [
            SimpleNamespace(
                item_id="item-pass",
                row_id="row-1",
                status="succeeded",
                error=None,
                metrics={"judge_score": 0.9, "tokens": 10},
                context_snapshot={"context": {"judge_label": "pass"}, "metrics": {"judge_score": 0.9}},
                steps=[
                    SimpleNamespace(
                        status="succeeded",
                        latency_ms=12.0,
                        metrics={"prompt_tokens": 3, "completion_tokens": 4, "total_tokens": 7, "cost": 0.01, "cost_source": "provider_usage"},
                    )
                ],
            ),
            SimpleNamespace(
                item_id="item-fail",
                row_id="row-2",
                status="succeeded",
                error=None,
                metrics={"judge_score": 0.2, "tokens": 20},
                context_snapshot={"context": {"judge_label": "fail"}, "metrics": {"judge_score": 0.2}},
                steps=[
                    SimpleNamespace(
                        status="succeeded",
                        latency_ms=18.0,
                        metrics={"prompt_tokens": 5, "completion_tokens": 6, "total_tokens": 11, "cost": 0.02, "cost_source": "provider_usage"},
                    )
                ],
            ),
        ]
    )
    run = SimpleNamespace(run_id="run-counting", items=items)

    report = aggregate_run_report(run)

    assert items.iteration_count == 1
    assert report.total_items == 2
    assert report.completed_items == 2
    assert report.pass_rate == 0.5
    assert len(report.badcases) == 1
    assert report.metrics["total_tokens"] == 18
    assert report.metrics["cost"] == 0.03


def test_workflow_runner_reports_progress_after_each_item(tmp_path: Path) -> None:
    store = JsonStore(tmp_path / "store")
    dataset_service = DatasetService(store)
    registry = SkillRegistry.with_builtin_skills()
    data_path = tmp_path / "progress.jsonl"
    _write_jsonl(
        data_path,
        [
            {"question": "Q1", "reference": "A1", "expected_label": "pass"},
            {"question": "Q2", "reference": "A2", "expected_label": "pass"},
            {"question": "Q3", "reference": "A3", "expected_label": "pass"},
        ],
    )
    dataset = dataset_service.upload_dataset("progress", data_path, golden=True, label_field="expected_label")
    workflow = WorkflowDraft(
        name="progress_workflow",
        steps=[
            WorkflowStep(
                step_id="answer",
                skill_ref="llm.call@0.1.0",
                input_mapping={"prompt": "row.question"},
                output_mapping={},
                config={"model": "demo-model"},
            )
        ],
    ).publish()
    runner = WorkflowRunner(store, dataset_service, registry)
    run = runner.create_run(RunRequest(workflow=workflow, dataset_id=dataset.dataset_id, dataset_version=dataset.version))
    progress: list[tuple[str, int]] = []

    runner.execute_run(
        run.run_id,
        progress_callback=lambda current_run: progress.append(
            (current_run.status, len([item for item in current_run.items if item.status in {"succeeded", "failed"}]))
        ),
    )

    assert progress[0] == ("running", 0)
    assert progress[-1] == ("completed", 3)
    assert [completed for _, completed in progress if completed] == [1, 2, 3, 3]


def test_workflow_runner_batches_full_run_snapshot_writes(tmp_path: Path) -> None:
    store = CountingJsonStore(tmp_path / "store")
    dataset_service = DatasetService(store)
    registry = SkillRegistry.with_builtin_skills()
    data_path = tmp_path / "batched-progress.jsonl"
    _write_jsonl(data_path, [{"question": f"Q{index}", "reference": "A"} for index in range(25)])
    dataset = dataset_service.upload_dataset("batched_progress", data_path)
    workflow = WorkflowDraft(
        name="batched_progress_workflow",
        steps=[
            WorkflowStep(
                step_id="answer",
                skill_ref="llm.call@0.1.0",
                input_mapping={"prompt": "row.question"},
                output_mapping={},
                config={"model": "demo-model"},
            )
        ],
    ).publish()
    runner = WorkflowRunner(store, dataset_service, registry)
    run = runner.create_run(RunRequest(workflow=workflow, dataset_id=dataset.dataset_id, dataset_version=dataset.version))
    progress: list[int] = []

    completed = runner.execute_run(
        run.run_id,
        progress_callback=lambda current_run: progress.append(len([item for item in current_run.items if item.status in {"succeeded", "failed"}])),
    )

    assert completed.status == "completed"
    assert progress[-1] == 25
    assert store.run_write_count <= 6
    assert store.run_read_count <= 6
    assert runner.get_run(run.run_id).items[-1].status == "succeeded"


def test_workflow_runner_honors_pause_requested_during_active_execution(tmp_path: Path) -> None:
    store = JsonStore(tmp_path / "store")
    dataset_service = DatasetService(store)
    started = Event()
    release = Event()
    registry = SkillRegistry()
    registry.register(_BlockingEchoSkill(started, release))
    data_path = tmp_path / "pause.jsonl"
    _write_jsonl(
        data_path,
        [
            {"text": "第一条"},
            {"text": "第二条"},
            {"text": "第三条"},
        ],
    )
    dataset = dataset_service.upload_dataset("pause", data_path)
    workflow = WorkflowDraft(
        name="pause_workflow",
        steps=[
            WorkflowStep(
                step_id="echo",
                skill_ref="test.blocking_echo@0.1.0",
                input_mapping={"text": "row.text"},
                output_mapping={},
            )
        ],
    ).publish()
    runner = WorkflowRunner(store, dataset_service, registry)
    run = runner.create_run(RunRequest(workflow=workflow, dataset_id=dataset.dataset_id, dataset_version=dataset.version))

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(runner.execute_run, run.run_id)
        assert started.wait(timeout=2)
        paused = runner.pause_run(run.run_id)
        release.set()
        executed = future.result(timeout=3)

    latest = runner.get_run(run.run_id)
    item_statuses = [item.status for item in latest.items]

    assert paused.status == "paused"
    assert executed.status == "paused"
    assert latest.status == "paused"
    assert item_statuses.count("succeeded") == 1
    assert item_statuses.count("pending") == 2


def test_workflow_runner_exposes_outputs_by_step_id_without_output_mapping(tmp_path: Path) -> None:
    store = JsonStore(tmp_path / "store")
    dataset_service = DatasetService(store)
    registry = SkillRegistry.with_builtin_skills()
    data_path = tmp_path / "rag-node-output.jsonl"
    _write_jsonl(data_path, [{"question": "什么是 AegisQA?", "reference": "AegisQA", "expected_label": "pass"}])
    dataset = dataset_service.upload_dataset("rag_node_output", data_path, golden=True, label_field="expected_label")
    workflow = WorkflowDraft(
        name="node_namespace_outputs",
        steps=[
            WorkflowStep(
                step_id="answer",
                skill_ref="llm.call@0.1.0",
                input_mapping={"prompt": "row.question"},
                output_mapping={},
                config={"model": "demo-model", "temperature": 0},
            ),
            WorkflowStep(
                step_id="judge",
                skill_ref="llm.judge@0.1.0",
                input_mapping={"question": "row.question", "answer": "answer.answer", "reference": "row.reference"},
                output_mapping={},
                config={"threshold": 0.6, "model": "judge-model"},
            ),
        ],
    ).publish()
    runner = WorkflowRunner(store, dataset_service, registry)

    run = runner.create_run(RunRequest(workflow=workflow, dataset_id=dataset.dataset_id, dataset_version=dataset.version))
    completed = runner.execute_run(run.run_id)

    assert completed.status == "completed"
    assert completed.items[0].steps[1].input_snapshot["answer"].startswith("模型回答：什么是 AegisQA?")


class _BlockingEchoSkill(BaseSkill):
    manifest = SkillManifest(
        skill_id="test.blocking_echo@0.1.0",
        name="Blocking Echo",
        version="0.1.0",
        description="测试暂停控制信号的阻塞 Echo Skill。",
        input_schema={"type": "object", "required": ["text"], "properties": {"text": {"type": "string"}}},
        output_schema={"type": "object", "required": ["text"], "properties": {"text": {"type": "string"}}},
    )

    def __init__(self, started: Event, release: Event) -> None:
        self.started = started
        self.release = release
        super().__init__()

    def run(self, inputs: dict[str, object], config: dict[str, object] | None = None) -> SkillResult:
        self.started.set()
        assert self.release.wait(timeout=2)
        return SkillResult(output={"text": str(inputs["text"])})


def test_failed_type_validation_records_step_log_and_retry_keeps_success_items(tmp_path: Path) -> None:
    store = JsonStore(tmp_path / "store")
    dataset_service = DatasetService(store)
    registry = SkillRegistry.with_builtin_skills()
    data_path = tmp_path / "bad.jsonl"
    _write_jsonl(data_path, [{"question": 123, "reference": "文本"}])
    dataset = dataset_service.upload_dataset("bad", data_path)
    workflow = WorkflowDraft(
        name="type_guard",
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
    failed = runner.execute_run(run.run_id)

    assert failed.status == "failed"
    assert failed.items[0].status == "failed"
    assert failed.items[0].steps[0].status == "failed"
    assert failed.items[0].steps[0].error["type"] == "TypeMismatchError"
    assert failed.items[0].steps[0].called_skill is False

    retried = runner.retry_failed_items(run.run_id)
    assert retried.items[0].retry_count == 1


def test_badcase_correction_and_judge_audit_metrics(tmp_path: Path) -> None:
    service = BadcaseService(JsonStore(tmp_path / "store"))
    badcase = service.create_badcase(
        run_id="run-1",
        item_id="item-1",
        reason="judge_label=fail",
        payload={"question": "Q", "answer": "A"},
    )

    corrected = service.correct_badcase(
        badcase.badcase_id,
        human_label="correct",
        problem_type="judge_error",
        note="裁判误判",
        add_to_golden=True,
    )

    assert corrected.status == "accepted_to_golden"
    assert corrected.human_label == "correct"
    assert corrected.golden_candidate is True

    audit = audit_judge_profile(
        judge_profile_id="judge-v1",
        dataset_version_id="golden-v1",
        human_labels=["pass", "pass", "fail", "fail"],
        judge_labels=["pass", "fail", "fail", "pass"],
        positive_label="pass",
    )

    assert audit.accuracy == pytest.approx(0.5)
    assert audit.precision == pytest.approx(0.5)
    assert audit.recall == pytest.approx(0.5)
    assert audit.f1 == pytest.approx(0.5)
    assert -1 <= audit.cohen_kappa <= 1
    assert audit.confusion_matrix["pass"]["pass"] == 1
    assert len(audit.misclassified_items) == 2


def test_secret_redaction_removes_sensitive_values_from_nested_payloads() -> None:
    payload = {
        "config": {"api_key": "sk-real-secret", "model": "demo"},
        "context": {"answer": "ok", "nested": [{"password": "pw"}]},
        "metrics": {"tokens": 42, "generation_tokens": 10},
        "logs": "Authorization: Bearer abc.def",
    }

    redacted = redact_secrets(payload)

    assert "sk-real-secret" not in json.dumps(redacted)
    assert "abc.def" not in json.dumps(redacted)
    assert redacted["config"]["api_key"] == "***REDACTED***"
    assert redacted["context"]["nested"][0]["password"] == "***REDACTED***"
    assert redacted["metrics"]["tokens"] == 42
    assert redacted["metrics"]["generation_tokens"] == 10


def test_runner_handles_1000_rows_with_lightweight_queue_and_rate_limit(tmp_path: Path) -> None:
    store = JsonStore(tmp_path / "store")
    dataset_service = DatasetService(store)
    registry = SkillRegistry.with_builtin_skills()
    data_path = tmp_path / "rag_1000.jsonl"
    _write_jsonl(
        data_path,
        [
            {"question": f"问题 {index}", "reference": "AegisQA", "expected_label": "pass"}
            for index in range(1000)
        ],
    )
    dataset = dataset_service.upload_dataset("rag_1000", data_path, golden=True, label_field="expected_label")
    workflow = WorkflowDraft(
        name="rag_1000_regression",
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
    ).publish()
    runner = WorkflowRunner(store, dataset_service, registry)

    run = runner.create_run(
        RunRequest(
            workflow=workflow,
            dataset_id=dataset.dataset_id,
            dataset_version=dataset.version,
            chunk_size=128,
            concurrency=16,
            rate_limits={"llm.call@0.1.0": 2},
        )
    )

    assert len(run.queue_messages) == 1000
    assert all(set(message.keys()) == {"item_id"} for message in run.queue_messages)
    assert "row_json" not in json.dumps(run.queue_messages)

    completed = runner.execute_run(run.run_id)
    report = aggregate_run_report(completed)

    assert completed.status == "completed"
    assert report.total_items == 1000
    assert report.completed_items == 1000
    assert any(item.steps[0].rate_limited_count == 1 for item in completed.items[1:])


def test_sample_repeat_times_and_step_cache_are_recorded(tmp_path: Path) -> None:
    store = JsonStore(tmp_path / "store")
    dataset_service = DatasetService(store)
    registry = SkillRegistry.with_builtin_skills()
    data_path = tmp_path / "repeat.jsonl"
    _write_jsonl(data_path, [{"question": "重复运行样本", "reference": "AegisQA"}])
    dataset = dataset_service.upload_dataset("repeat", data_path)
    workflow = WorkflowDraft(
        name="repeat_cache",
        steps=[
            WorkflowStep(
                step_id="answer",
                skill_ref="llm.call@0.1.0",
                input_mapping={"prompt": "row.question"},
                output_mapping={"answer": "context.answer"},
                config={"model": "demo-model", "temperature": 0},
                cacheable=True,
            )
        ],
    ).publish()
    runner = WorkflowRunner(store, dataset_service, registry)

    run = runner.create_run(
        RunRequest(
            workflow=workflow,
            dataset_id=dataset.dataset_id,
            dataset_version=dataset.version,
            sample_repeat_times=2,
        )
    )
    completed = runner.execute_run(run.run_id)

    assert len(completed.items) == 2
    assert completed.items[0].repeat_index == 0
    assert completed.items[1].repeat_index == 1
    assert completed.items[1].steps[0].cache_hit is True
