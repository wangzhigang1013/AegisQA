"""运行 AegisQA MVP 端到端演示。

这个脚本把 PRD 的最短闭环串起来：
1. 准备 1000 条 JSONL 数据；
2. 上传为 Golden Dataset；
3. 读取 YAML 线性 Workflow；
4. 分片创建 Run Items，队列消息只携带 item_id；
5. 执行 Skill 链路并生成报告；
6. 基于 expected_label 做 Judge 审计。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from aegisqa.datasets.service import DatasetService
from aegisqa.engine.runner import RunRequest, WorkflowRunner
from aegisqa.examples.generate_demo_data import generate_rag_dataset
from aegisqa.judge.audit import audit_judge_profile
from aegisqa.reports.aggregator import aggregate_run_report
from aegisqa.skills.registry import SkillRegistry
from aegisqa.storage.json_store import JsonStore
from aegisqa.workflows.models import RuntimeConfig, WorkflowDraft, WorkflowStep


def load_workflow_from_yaml(path: Path) -> WorkflowDraft:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    runtime_payload = payload.get("runtime", {})
    return WorkflowDraft(
        name=payload["name"],
        runtime=RuntimeConfig(**runtime_payload),
        steps=[WorkflowStep(**step) for step in payload["steps"]],
    )


def run_demo(store_root: Path = Path("data/demo_store"), *, include_full_badcases: bool = False) -> dict[str, Any]:
    data_path = Path("examples/data/rag_qa_1000.jsonl")
    if not data_path.exists():
        generate_rag_dataset(data_path)

    store = JsonStore(store_root)
    dataset_service = DatasetService(store)
    registry = SkillRegistry.with_builtin_skills()
    runner = WorkflowRunner(store, dataset_service, registry)
    dataset = dataset_service.upload_dataset("rag_qa_1000", data_path, golden=True, label_field="expected_label")
    workflow = load_workflow_from_yaml(Path("examples/workflows/rag_regression.yaml")).publish()

    run = runner.create_run(
        RunRequest(
            workflow=workflow,
            dataset_id=dataset.dataset_id,
            dataset_version=dataset.version,
            chunk_size=workflow.runtime.chunk_size,
            concurrency=workflow.runtime.concurrency,
            rate_limits={key: float(value) for key, value in workflow.runtime.rate_limits.items()},
        )
    )
    completed = runner.execute_run(run.run_id)
    report = aggregate_run_report(completed)

    human_labels = []
    judge_labels = []
    for item in completed.items:
        row = item.context_snapshot.get("row", {})
        human_labels.append(row.get("expected_label", "fail"))
        judge_labels.append(item.context_snapshot.get("context", {}).get("judge_label", "fail"))
    audit = audit_judge_profile(
        judge_profile_id="demo-judge-v1",
        dataset_version_id=dataset.version_id,
        human_labels=human_labels,
        judge_labels=judge_labels,
        positive_label="pass",
    )

    report_payload = report.model_dump(mode="json")
    if not include_full_badcases:
        report_payload["badcase_count"] = len(report.badcases)
        report_payload["badcases"] = report_payload["badcases"][:3]

    return {
        "dataset": dataset.model_dump(mode="json"),
        "run_id": completed.run_id,
        "run_status": completed.status,
        "queue_message_shape": sorted(completed.queue_messages[0].keys()) if completed.queue_messages else [],
        "report": report_payload,
        "judge_audit": audit.model_dump(mode="json"),
    }


def main() -> None:
    summary = run_demo()
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
