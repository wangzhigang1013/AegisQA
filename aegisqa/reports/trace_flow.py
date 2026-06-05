"""Task Trace Flow 构建器。

Trace Tree 适合看调用层级，但评测用户更需要知道一条样本的数据如何从 row
进入 Skill、写回 context/metrics、最后形成 Badcase。本模块把 Run 的执行快照
整理成前端可以直接展示的数据流视图。
"""

from __future__ import annotations

from math import ceil
from typing import Any

from aegisqa.api.experience import enrich_step_flow
from aegisqa.engine.runner import RunItem, RunRecord, RunItemStep
from aegisqa.reports.aggregator import aggregate_run_report


def build_task_trace_flow(task: dict[str, Any], run: RunRecord, *, page: int = 1, page_size: int = 50) -> dict[str, Any]:
    """构建围绕 Task 的样本级数据流。"""

    report = aggregate_run_report(run)
    badcases_by_item_id = {badcase.item_id: badcase for badcase in report.badcases}
    total_items = len(run.items)
    safe_page = max(page, 1)
    safe_page_size = min(max(page_size, 1), 100)
    start = (safe_page - 1) * safe_page_size
    page_items = run.items[start : start + safe_page_size]
    return {
        "task": task,
        "dataset": {
            "dataset_id": task.get("dataset_id"),
            "name": task.get("dataset_name"),
            "version": task.get("dataset_version"),
            "version_id": task.get("dataset_version_id") or run.snapshot.get("dataset_version"),
        },
        "workflow": {
            "workflow_id": task.get("workflow_id"),
            "name": task.get("workflow_name") or run.workflow.name,
            "version_id": task.get("workflow_version_id") or run.workflow.version_id,
            "snapshot_hash": run.workflow.snapshot_hash,
        },
        "attempt": {
            "run_id": run.run_id,
            "status": run.status,
            "current_attempt": task.get("current_attempt", 1),
            "started_at": run.started_at,
            "finished_at": run.finished_at,
        },
        "queue_message_shape": sorted(run.queue_messages[0].keys()) if run.queue_messages else [],
        "data_edges": _data_edges(run),
        # Trace Flow 单条样本包含 row/context/steps/参数追踪，体积明显大于普通列表。
        # 这里先切片再构建 item flow，避免大任务接口一次性序列化全部样本明细。
        "items": [_item_flow(item, badcases_by_item_id.get(item.item_id), task_id=str(task.get("task_id") or "")) for item in page_items],
        "pagination": {
            "page": safe_page,
            "page_size": safe_page_size,
            "total_items": total_items,
            "total_pages": ceil(total_items / safe_page_size) if total_items else 0,
        },
    }


def _data_edges(run: RunRecord) -> list[dict[str, str]]:
    edges: list[dict[str, str]] = []
    previous_step_id = "dataset.row"
    for step in run.workflow.steps:
        edges.append({"source": previous_step_id, "target": f"{step.step_id}.input"})
        edges.append({"source": f"{step.step_id}.output", "target": "context.metrics"})
        previous_step_id = f"{step.step_id}.output"
    return edges


def _item_flow(item: RunItem, badcase: Any | None, *, task_id: str) -> dict[str, Any]:
    context_snapshot = item.context_snapshot or {}
    return {
        "item_id": item.item_id,
        "row_id": item.row_id,
        "row_index": item.row_index,
        "repeat_index": item.repeat_index,
        "status": item.status,
        "row": context_snapshot.get("row", {}),
        "context": context_snapshot.get("context", {}),
        "metrics": item.metrics,
        "error": item.error,
        "steps": [enrich_step_flow(_step_flow(step), task_id=task_id, item_id=item.item_id) for step in item.steps],
        "badcase": _badcase_flow(badcase),
    }


def _step_flow(step: RunItemStep) -> dict[str, Any]:
    return {
        "step_id": step.step_id,
        "skill_ref": step.skill_ref,
        "status": step.status,
        "input": step.input_snapshot,
        "resolved_config": step.config_snapshot,
        "parameter_trace": step.parameter_trace,
        "output": step.output_snapshot,
        "metrics": step.metrics,
        "latency_ms": step.latency_ms,
        "cache_hit": step.cache_hit,
        "error": step.error,
    }


def _badcase_flow(badcase: Any | None) -> dict[str, Any]:
    if badcase is None:
        return {"is_badcase": False}
    return {
        "is_badcase": True,
        "reason": badcase.reason,
        "score": badcase.score,
        "label": badcase.label,
        "payload": badcase.payload,
    }
