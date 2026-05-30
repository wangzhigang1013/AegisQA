import csv
import json
from pathlib import Path

from aegisqa.audit.service import AuditService
from aegisqa.badcases.service import BadcaseService
from aegisqa.datasets.service import DatasetService
from aegisqa.reports.aggregator import RunReport, compare_reports, export_report_csv
from aegisqa.security.access import AccessControl
from aegisqa.skills.registry import SkillRegistry
from aegisqa.storage.json_store import JsonStore
from aegisqa.workflows.templates import WorkflowTemplateService


def _write_jsonl(path: Path) -> None:
    rows = [
        {"question": "Q1", "reference": "AegisQA", "expected_label": "pass"},
        {"question": "Q2", "reference": "missing", "expected_label": "fail"},
    ]
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def test_skill_governance_templates_exports_rbac_and_audit(tmp_path: Path) -> None:
    store = JsonStore(tmp_path / "store")
    registry = SkillRegistry.with_builtin_skills()
    registry.disable("llm.call@0.1.0", reason="等待审批")

    disabled = registry.get_manifest("llm.call@0.1.0")
    assert disabled.enabled is False
    assert registry.can_reference_new_workflow("llm.call@0.1.0") is False
    assert registry.get("llm.call@0.1.0").manifest.skill_id == "llm.call@0.1.0"

    registry.approve("llm.call@0.1.0")
    assert registry.can_reference_new_workflow("llm.call@0.1.0") is True

    templates = WorkflowTemplateService(registry).list_templates()
    assert {"rag_regression", "asr_eval", "prompt_regression"} <= {template.template_id for template in templates}
    rag_draft = WorkflowTemplateService(registry).create_workflow("rag_regression", name="来自模板的 RAG 回归")
    assert rag_draft.steps[0].skill_ref == "llm.call@0.1.0"

    data_path = tmp_path / "dataset.jsonl"
    _write_jsonl(data_path)
    dataset_service = DatasetService(store)
    dataset = dataset_service.upload_dataset("exportable", data_path, golden=True, label_field="expected_label")
    export_path = tmp_path / "export.csv"
    dataset_service.export_rows(dataset.dataset_id, dataset.version, export_path, file_format="csv")
    with export_path.open("r", encoding="utf-8-sig", newline="") as handle:
        exported_rows = list(csv.DictReader(handle))
    assert len(exported_rows) == 2

    access = AccessControl()
    assert access.can("Admin", "skill:approve") is True
    assert access.can("Viewer", "workflow:publish") is False

    audit = AuditService(store)
    event = audit.record(actor="alice", action="workflow.publish", target="wf-1", detail={"version": 1})
    assert audit.list_events()[0].event_id == event.event_id


def test_badcase_bulk_cluster_and_report_export(tmp_path: Path) -> None:
    store = JsonStore(tmp_path / "store")
    service = BadcaseService(store)
    first = service.create_badcase("run-1", "item-1", "judge_label=fail", {"question": "支付失败怎么办"})
    second = service.create_badcase("run-1", "item-2", "judge_label=fail", {"question": "支付超时怎么办"})

    corrected = service.bulk_correct(
        [first.badcase_id, second.badcase_id],
        human_label="incorrect",
        problem_type="payment",
        note="同类支付问题",
        add_to_golden=True,
    )
    assert {item.status for item in corrected} == {"accepted_to_golden"}

    clusters = service.cluster_badcases()
    assert clusters[0]["count"] == 2

    export_path = tmp_path / "badcases.jsonl"
    service.export_badcases(export_path)
    assert export_path.read_text(encoding="utf-8").count("\n") >= 2

    before = RunReport(
        run_id="run-a",
        total_items=10,
        completed_items=10,
        failed_items=1,
        pass_rate=0.7,
        error_rate=0.1,
        average_latency_ms=10,
        p95_latency_ms=12,
        metrics={"avg_judge_score": 0.7},
        error_distribution={"TypeMismatchError": 1},
        badcases=[],
    )
    after = before.model_copy(update={"run_id": "run-b", "pass_rate": 0.9, "metrics": {"avg_judge_score": 0.9}})
    diff = compare_reports(before, after)
    assert diff["pass_rate_delta"] == 0.2

    report_path = tmp_path / "report.csv"
    export_report_csv(after, report_path)
    assert "pass_rate" in report_path.read_text(encoding="utf-8")

