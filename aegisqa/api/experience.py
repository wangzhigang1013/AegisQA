"""体验效率聚合器。

本模块只做真实运行数据的二次整理：工作台摘要、Task 可用动作、Trace Step
诊断标签和 Report 顶部行动建议。这里不创建演示数据，也不把缺失证据补成假结论。
"""

from __future__ import annotations

from typing import Any

from aegisqa.api.actions import action_descriptor
from aegisqa.reports.aggregator import RunReport, aggregate_run_report


ACTION_TARGETS = {
    "open_trace_flow": "/tasks/{task_id}/trace",
    "open_trace_tree": "/tasks/{task_id}/trace-tree",
    "open_report": "/reports?task_id={task_id}",
    "create_repair_tasks": "/reports?task_id={task_id}&action=create_repair_tasks",
    "seed_annotation_queue": "/annotation-queue?source_task_id={task_id}",
    "review_badcases": "/reports?task_id={task_id}&panel=badcases",
    "open_parameter_governance": "/reports?task_id={task_id}&panel=parameter-governance",
    "retry_failed_items": "/runs?task_id={task_id}&action=retry_failed",
}


TASK_CONTROL_ACTIONS = {
    "execute": {"label": "执行", "permission": "run:create", "method": "POST"},
    "pause": {"label": "暂停", "permission": "run:control", "method": "POST"},
    "resume": {"label": "恢复", "permission": "run:control", "method": "POST"},
    "cancel": {"label": "取消", "permission": "run:control", "method": "POST"},
    "retry": {"label": "重试失败项", "permission": "run:control", "method": "POST"},
    "attempt": {"label": "新建 Attempt", "permission": "run:create", "method": "POST"},
}


def build_workbench_payload(ctx: Any) -> dict[str, Any]:
    """构建 Overview 工作台的轻量聚合数据。"""

    tasks = sorted(
        ctx.store.list_json(["tasks"]),
        key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""),
        reverse=True,
    )
    run_summaries = ctx.runner.list_run_summaries()
    badcases = [record.model_dump(mode="json") for record in ctx.badcases.list_badcases()]
    report_cards: list[dict[str, Any]] = []
    gate_failures: list[dict[str, Any]] = []
    derived_pending_badcases: list[dict[str, Any]] = []

    for task in tasks[:20]:
        run, report = _safe_task_run_report(ctx, task)
        task_with_summary = enrich_task_detail(ctx, task, run=run, report=report)
        gate_summary = task_with_summary.get("gate_summary") or {}
        if gate_summary.get("status") in {"warning", "blocked"}:
            gate_failures.append(
                {
                    "task_id": task.get("task_id"),
                    "task_name": task.get("name"),
                    "run_id": task.get("run_id"),
                    "status": gate_summary.get("status"),
                    "message": gate_summary.get("message"),
                    "evidence": gate_summary.get("evidence", []),
                    "target_url": _task_target("open_report", str(task.get("task_id"))),
                }
            )
        if report is not None:
            report_cards.append(_report_card(task, report, gate_summary))
            derived_pending_badcases.extend(_derived_badcase_cards(task, report))

    pending_badcases = [
        record
        for record in badcases
        if str(record.get("status") or "") in {"detected", "pending_review", "reopened"}
    ]
    if not pending_badcases:
        pending_badcases = derived_pending_badcases[:10]
    failed_runs = [
        run
        for run in run_summaries
        if str(run.get("status")) == "failed" or int(run.get("failed_items") or 0) > 0
    ][:8]
    continue_actions = _dedupe_actions(
        _workbench_task_actions(tasks)
        + _workbench_report_actions(report_cards)
        + _workbench_badcase_actions(pending_badcases)
        + _workbench_gate_actions(gate_failures)
    )
    return {
        "source": "real_store",
        "summary": {
            "task_count": len(tasks),
            "run_count": len(run_summaries),
            "failed_run_count": len(failed_runs),
            "pending_badcase_count": len(pending_badcases),
            "gate_failure_count": len(gate_failures),
            "report_count": len(report_cards),
        },
        "recent_tasks": [enrich_task_detail(ctx, task) for task in tasks[:8]],
        "failed_runs": failed_runs,
        "pending_badcases": pending_badcases[:8],
        "gate_failures": gate_failures[:8],
        "recent_reports": report_cards[:8],
        "continue_actions": continue_actions[:12],
        "empty_state": {
            "message": "当前没有真实任务数据。请先上传 Dataset、发布 Workflow，再创建 Task。"
            if not tasks
            else "",
            "next_actions": [
                action_descriptor("open_datasets", "上传 Dataset", target_url="/datasets", priority="high"),
                action_descriptor("open_workflows", "发布 Workflow", target_url="/workflows", priority="high"),
                action_descriptor("create_task", "创建 Task", target_url="/runs", priority="high"),
            ]
            if not tasks
            else [],
        },
    }


def enrich_task_detail(ctx: Any, task: dict[str, Any], *, run: Any | None = None, report: RunReport | None = None) -> dict[str, Any]:
    """给 Task 响应补充详情页直接可用的摘要字段。"""

    enriched = dict(task)
    run, report = (run, report) if run is not None else _safe_task_run_report(ctx, task)
    enriched["latest_run_summary"] = _latest_run_summary(run, task)
    enriched["preflight_summary"] = build_preflight_summary(task)
    enriched["gate_summary"] = build_gate_summary(task, run, report)
    enriched["available_actions"] = build_task_available_actions(task)
    return enriched


def build_preflight_summary(task: dict[str, Any]) -> dict[str, Any]:
    preflight = task.get("preflight_result")
    if not isinstance(preflight, dict):
        return {
            "status": "unavailable",
            "message": "当前任务没有保存创建前 Preflight 证据。",
            "blocking_check_count": 0,
            "warning_check_count": 0,
            "checks": [],
        }
    checks = [check for check in preflight.get("checks", []) if isinstance(check, dict)]
    blocked = [check for check in checks if check.get("status") == "blocked"]
    warnings = [check for check in checks if check.get("status") == "warning"]
    return {
        "status": preflight.get("status", "unknown"),
        "message": preflight.get("summary") or preflight.get("message") or "",
        "preflight_id": preflight.get("preflight_id") or task.get("execution_config", {}).get("preflight_id"),
        "blocking_check_count": len(blocked),
        "warning_check_count": len(warnings),
        "checks": checks,
    }


def build_gate_summary(task: dict[str, Any], run: Any | None, report: RunReport | None) -> dict[str, Any]:
    gate = task.get("quality_gate") if isinstance(task.get("quality_gate"), dict) else {}
    if not gate:
        return {
            "status": "not_configured",
            "message": "当前任务未配置质量门禁。",
            "evidence": [],
            "metrics": _task_gate_metrics(task, report),
        }
    metrics = _task_gate_metrics(task, report)
    failures: list[str] = []
    pass_threshold = _number_or_none(gate.get("pass_rate"))
    max_badcase_count = _number_or_none(gate.get("max_badcase_count"))
    max_failed_items = _number_or_none(gate.get("max_failed_items"))
    if pass_threshold is not None and metrics["pass_rate"] < pass_threshold:
        failures.append(f"pass_rate={metrics['pass_rate']} < {pass_threshold}")
    if max_badcase_count is not None and metrics["badcase_count"] > max_badcase_count:
        failures.append(f"badcase_count={metrics['badcase_count']} > {max_badcase_count}")
    if max_failed_items is not None and metrics["failed_items"] > max_failed_items:
        failures.append(f"failed_items={metrics['failed_items']} > {max_failed_items}")
    status = "blocked" if failures else "passed"
    if status == "passed" and run is not None and str(getattr(run, "status", task.get("status"))) not in {"completed", "succeeded"}:
        status = "warning"
        failures.append(f"run_status={getattr(run, 'status', task.get('status'))}")
    return {
        "status": status,
        "message": "质量门禁存在阻断项。" if status == "blocked" else ("质量门禁已通过。" if status == "passed" else "任务尚未完成，门禁结论仅可参考。"),
        "evidence": failures or [f"pass_rate={metrics['pass_rate']}", f"badcase_count={metrics['badcase_count']}"],
        "metrics": metrics,
        "thresholds": gate,
    }


def build_task_available_actions(task: dict[str, Any]) -> list[dict[str, Any]]:
    task_id = str(task.get("task_id") or "")
    actions = []
    for action, meta in TASK_CONTROL_ACTIONS.items():
        disabled_reason = _task_action_disabled_reason(task, action)
        actions.append(
            action_descriptor(
                action,
                meta["label"],
                enabled=disabled_reason is None,
                disabled_reason=disabled_reason,
                permission=meta["permission"],
                method=meta["method"],
                target_url=f"/tasks/{task_id}/{_task_action_endpoint(action)}" if task_id else None,
                payload={"task_id": task_id} if task_id else {},
            )
        )
    for action, label in (
        ("open_trace_flow", "查看 Trace Flow"),
        ("open_trace_tree", "查看 Trace Tree"),
        ("open_report", "查看 Report"),
    ):
        actions.append(
            action_descriptor(
                action,
                label,
                enabled=bool(task_id),
                disabled_reason=None if task_id else "缺少 task_id。",
                permission="report:read" if action == "open_report" else "run:read",
                target_url=_task_target(action, task_id) if task_id else None,
                payload={"task_id": task_id} if task_id else {},
            )
        )
    return actions


def enrich_step_flow(step_payload: dict[str, Any], *, task_id: str, item_id: str) -> dict[str, Any]:
    """给 Trace Flow 的 Step 增加详情抽屉所需字段。"""

    enriched = dict(step_payload)
    status = str(enriched.get("status") or "unknown")
    output = enriched.get("output") if isinstance(enriched.get("output"), dict) else {}
    enriched["resolved_input"] = enriched.get("input") if isinstance(enriched.get("input"), dict) else {}
    enriched["raw_output"] = output
    enriched["validated_output"] = output if status in {"succeeded", "completed"} else {}
    enriched["schema_errors"] = _schema_errors_from_error(enriched.get("error"))
    enriched["prompt_calls"] = _prompt_calls_from_metrics(enriched.get("metrics"))
    enriched["diagnostic_tags"] = _step_diagnostic_tags(enriched)
    enriched["error_explanation"] = explain_step_error(enriched.get("error"), status=status)
    enriched["available_actions"] = build_step_available_actions(task_id=task_id, item_id=item_id, step_id=str(enriched.get("step_id") or ""))
    return enriched


def build_step_available_actions(*, task_id: str, item_id: str, step_id: str) -> list[dict[str, Any]]:
    base = f"/runs?task_id={task_id}&item_id={item_id}&step_id={step_id}"
    return [
        action_descriptor("view_step_detail", "查看 Step 详情", target_url=base, priority="medium", payload={"task_id": task_id, "item_id": item_id, "step_id": step_id}),
        action_descriptor("replay_step", "Replay Step", method="POST", target_url=f"{base}&action=replay_step", priority="high", payload={"task_id": task_id, "item_id": item_id, "step_id": step_id}),
        action_descriptor("prompt_debug", "Prompt Debug", method="POST", target_url=f"{base}&action=prompt_debug", priority="medium", payload={"task_id": task_id, "item_id": item_id, "step_id": step_id}),
        action_descriptor("open_repro_bundle", "导出 Repro Bundle", target_url=f"{base}&action=repro_bundle", priority="medium", payload={"task_id": task_id, "item_id": item_id, "step_id": step_id}),
    ]


def explain_step_error(error: Any, *, status: str) -> dict[str, Any] | None:
    if not error and status in {"succeeded", "completed"}:
        return None
    error_payload = error if isinstance(error, dict) else {}
    code = str(error_payload.get("code") or error_payload.get("error_code") or ("STEP_FAILED" if status == "failed" else "UNKNOWN"))
    messages = {
        "OUTPUT_SCHEMA_INVALID": "Step 输出没有通过 output_schema 校验，raw_output 会保留，validated_output 为空。",
        "LLM_PERMISSION_DENIED": "Skill 没有当前 Prompt 或模型调用权限。",
        "MODEL_ALIAS_NOT_ALLOWED": "当前 Skill 不允许使用该模型 alias。",
        "PROMPT_VARIABLE_MISSING": "Prompt 渲染缺少必要变量。",
        "JSON_PARSE_ERROR": "模型响应无法解析为要求的 JSON 结构。",
        "TOKEN_BUDGET_EXCEEDED": "本次运行超出 Token 预算。",
        "STEP_FAILED": "Step 执行失败，请查看 raw output、错误详情和 Repro Bundle。",
        "UNKNOWN": "Step 状态异常，但没有结构化错误码。",
    }
    return {
        "code": code,
        "message": messages.get(code, "Step 执行异常，请查看错误详情和原始输出。"),
        "raw_error": error_payload or error,
    }


def build_report_experience(task: dict[str, Any], report: RunReport, diagnostics: dict[str, Any], quality_decision: dict[str, Any], budget_status: dict[str, Any]) -> dict[str, Any]:
    task_id = str(task.get("task_id") or "")
    primary_findings = _primary_findings(task, report, diagnostics, quality_decision, budget_status)
    recommended_actions = _recommended_report_actions(task_id, report, diagnostics, quality_decision, primary_findings)
    return {
        "primary_findings": primary_findings,
        "recommended_actions": recommended_actions,
        "action_targets": {action: target.format(task_id=task_id) for action, target in ACTION_TARGETS.items()},
    }


def _primary_findings(
    task: dict[str, Any],
    report: RunReport,
    diagnostics: dict[str, Any],
    quality_decision: dict[str, Any],
    budget_status: dict[str, Any],
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for cause in diagnostics.get("root_causes") or []:
        if not isinstance(cause, dict):
            continue
        evidence = [str(item) for item in cause.get("evidence", []) if item]
        findings.append(
            {
                "type": cause.get("cause_type") or "diagnostic",
                "status": "failed" if cause.get("severity") in {"critical", "high"} else "warning",
                "severity": cause.get("severity", "warning"),
                "title": _finding_title(str(cause.get("cause_type") or "diagnostic")),
                "message": cause.get("recommendation") or "请查看诊断证据。",
                "evidence": evidence,
                "source": "diagnostics.root_causes",
            }
        )
    gate_status = quality_decision.get("status") if isinstance(quality_decision, dict) else None
    if gate_status in {"blocked", "warning"}:
        findings.append(
            {
                "type": "quality_gate",
                "status": gate_status,
                "severity": "high" if gate_status == "blocked" else "medium",
                "title": "质量门禁未完全通过",
                "message": "请优先处理质量门禁风险后再发布。",
                "evidence": [risk.get("message") for risk in quality_decision.get("top_risks", []) if isinstance(risk, dict) and risk.get("message")],
                "source": "quality_decision",
            }
        )
    if budget_status.get("status") in {"warning", "exceeded"}:
        findings.append(
            {
                "type": "cost_budget",
                "status": budget_status.get("status"),
                "severity": "high" if budget_status.get("status") == "exceeded" else "medium",
                "title": "成本预算风险",
                "message": budget_status.get("message") or "成本预算需要复核。",
                "evidence": [f"cost_used={budget_status.get('cost_used')}", f"cost_budget={budget_status.get('cost_budget')}"],
                "source": "budget_status",
            }
        )
    if not findings:
        findings.append(
            {
                "type": "quality_summary",
                "status": "passed" if report.failed_items == 0 else "warning",
                "severity": "info",
                "title": "评测汇总",
                "message": "当前报告没有发现需要优先处理的结构化根因。" if report.failed_items == 0 else "存在失败样本，请查看 Trace 和 Badcase。",
                "evidence": [f"pass_rate={report.pass_rate}", f"failed_items={report.failed_items}", f"badcase_count={len(report.badcases)}"],
                "source": "run_report",
            }
        )
    return _dedupe_findings(findings)[:5]


def _recommended_report_actions(
    task_id: str,
    report: RunReport,
    diagnostics: dict[str, Any],
    quality_decision: dict[str, Any],
    primary_findings: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    if report.failed_items or report.badcases:
        actions.extend(
            [
                _report_action("open_trace_flow", "进入 Trace Flow 定位失败 Step", "high", task_id, evidence=[f"failed_items={report.failed_items}"]),
                _report_action("create_repair_tasks", "生成修复任务", "high", task_id, evidence=[f"badcase_count={len(report.badcases)}"]),
                _report_action("review_badcases", "复盘 Badcase 明细", "medium", task_id, evidence=[f"badcase_count={len(report.badcases)}"]),
            ]
        )
    for cause in diagnostics.get("root_causes") or []:
        if not isinstance(cause, dict):
            continue
        for action in cause.get("next_actions") or []:
            if action in ACTION_TARGETS:
                actions.append(_report_action(str(action), _action_label(str(action)), "medium", task_id, evidence=cause.get("evidence") or []))
    for action in quality_decision.get("next_actions", []) if isinstance(quality_decision, dict) else []:
        if isinstance(action, dict) and action.get("action") in ACTION_TARGETS:
            actions.append(_report_action(str(action["action"]), str(action.get("label") or _action_label(str(action["action"]))), "medium", task_id, evidence=[finding["title"] for finding in primary_findings]))
    if not actions:
        actions.append(_report_action("open_report", "继续查看完整报告", "low", task_id, evidence=["report_available"]))
    return _dedupe_actions(actions)


def _report_action(action: str, label: str, priority: str, task_id: str, *, evidence: list[Any]) -> dict[str, Any]:
    return action_descriptor(
        action,
        label,
        target_url=_task_target(action, task_id),
        priority=priority,
        evidence=evidence,
        payload={"task_id": task_id},
    )


def _safe_task_run_report(ctx: Any, task: dict[str, Any]) -> tuple[Any | None, RunReport | None]:
    run_id = task.get("run_id")
    if not run_id:
        return None, None
    try:
        run = ctx.runner.get_run(str(run_id))
    except Exception:  # noqa: BLE001 - 工作台不应因单个历史任务缺失 Run 而整体不可用。
        return None, None
    try:
        return run, aggregate_run_report(run)
    except Exception:  # noqa: BLE001 - 报告聚合失败时保留 Task/Run 摘要并降级展示。
        return run, None


def _latest_run_summary(run: Any | None, task: dict[str, Any]) -> dict[str, Any]:
    if run is None:
        return {
            "run_id": task.get("run_id"),
            "status": task.get("status", "unknown"),
            "total_items": task.get("total_items", 0),
            "completed_items": task.get("completed_items", 0),
            "failed_items": task.get("failed_items", 0),
            "message": "Run 快照不可用，仅展示 Task 聚合字段。",
        }
    return {
        "run_id": run.run_id,
        "status": run.status,
        "workflow_version_id": run.workflow.version_id,
        "dataset_id": run.dataset_id,
        "dataset_version": run.dataset_version,
        "total_items": run.total_items,
        "completed_items": int(task.get("completed_items") or 0),
        "failed_items": int(task.get("failed_items") or 0),
        "created_at": run.created_at,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
    }


def _task_gate_metrics(task: dict[str, Any], report: RunReport | None) -> dict[str, float]:
    return {
        "pass_rate": float(task.get("pass_rate") if task.get("pass_rate") is not None else (report.pass_rate if report else 0.0)),
        "badcase_count": float(task.get("badcase_count") if task.get("badcase_count") is not None else (len(report.badcases) if report else 0)),
        "failed_items": float(task.get("failed_items") if task.get("failed_items") is not None else (report.failed_items if report else 0)),
        "completed_items": float(task.get("completed_items") if task.get("completed_items") is not None else (report.completed_items if report else 0)),
        "total_items": float(task.get("total_items") if task.get("total_items") is not None else (report.total_items if report else 0)),
    }


def _task_action_disabled_reason(task: dict[str, Any], action: str) -> str | None:
    status = str(task.get("status") or "unknown")
    if action == "execute":
        if status in {"completed", "succeeded"}:
            return "任务已完成，请复制任务或创建新任务后重新执行。"
        if status == "running":
            return "任务正在执行中。"
        if status in {"canceled", "cancelled"}:
            return "任务已取消，不能执行。"
        return None if status in {"queued", "failed", "paused"} else "当前任务状态不允许执行。"
    if action == "pause":
        return None if status in {"queued", "running"} else "只有 queued/running 任务可以暂停。"
    if action == "resume":
        return None if status == "paused" else "只有 paused 任务可以恢复。"
    if action == "cancel":
        return None if status in {"queued", "running", "paused", "failed"} else "当前状态不能取消。"
    if action == "retry":
        return None if status == "failed" else "只有 failed 任务可以重试失败项。"
    if action == "attempt":
        return "当前任务仍有活动执行实例，结束后才能新建 Attempt。" if status in {"queued", "running", "paused"} else None
    return None


def _task_action_endpoint(action: str) -> str:
    return "retry-failed" if action == "retry" else ("attempts" if action == "attempt" else action)


def _step_diagnostic_tags(step: dict[str, Any]) -> list[str]:
    tags: list[str] = []
    status = str(step.get("status") or "")
    if status not in {"succeeded", "completed"}:
        tags.append("failed_step")
    if step.get("cache_hit"):
        tags.append("cache_hit")
    if str(step.get("skill_ref") or "").startswith("llm."):
        tags.append("llm_step")
    if step.get("schema_errors"):
        tags.append("schema_invalid")
    if step.get("prompt_calls"):
        tags.append("prompt_call")
    return tags


def _schema_errors_from_error(error: Any) -> list[dict[str, Any]]:
    if not isinstance(error, dict):
        return []
    details = error.get("details")
    if isinstance(details, dict) and isinstance(details.get("schema_errors"), list):
        return [item for item in details["schema_errors"] if isinstance(item, dict)]
    if error.get("code") == "OUTPUT_SCHEMA_INVALID":
        return [{"message": error.get("message") or "输出不符合 schema", "code": "OUTPUT_SCHEMA_INVALID"}]
    return []


def _prompt_calls_from_metrics(metrics: Any) -> list[dict[str, Any]]:
    if not isinstance(metrics, dict):
        return []
    prompt_calls = metrics.get("prompt_calls")
    if isinstance(prompt_calls, list):
        return [item for item in prompt_calls if isinstance(item, dict)]
    if any(key in metrics for key in ("prompt_tokens", "completion_tokens", "total_tokens")):
        return [
            {
                "token_usage": {
                    "prompt_tokens": metrics.get("prompt_tokens"),
                    "completion_tokens": metrics.get("completion_tokens"),
                    "total_tokens": metrics.get("total_tokens"),
                }
            }
        ]
    return []


def _report_card(task: dict[str, Any], report: RunReport, gate_summary: dict[str, Any]) -> dict[str, Any]:
    task_id = str(task.get("task_id"))
    return {
        "task_id": task_id,
        "task_name": task.get("name"),
        "run_id": task.get("run_id"),
        "status": task.get("status"),
        "pass_rate": report.pass_rate,
        "failed_items": report.failed_items,
        "badcase_count": len(report.badcases),
        "gate_status": gate_summary.get("status"),
        "target_url": _task_target("open_report", task_id),
        "updated_at": task.get("updated_at"),
    }


def _derived_badcase_cards(task: dict[str, Any], report: RunReport) -> list[dict[str, Any]]:
    cards = []
    for badcase in report.badcases[:5]:
        cards.append(
            {
                "badcase_id": getattr(badcase, "badcase_id", None),
                "run_id": task.get("run_id"),
                "item_id": badcase.item_id,
                "status": "pending_review",
                "reason": badcase.reason,
                "payload": badcase.payload,
                "source": "run_report",
                "task_id": task.get("task_id"),
                "target_url": _task_target("open_report", str(task.get("task_id"))),
            }
        )
    return cards


def _workbench_task_actions(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    actions = []
    for task in tasks[:5]:
        task_id = str(task.get("task_id"))
        if str(task.get("status")) in {"queued", "failed", "paused"}:
            actions.append(
                action_descriptor(
                    "open_task",
                    f"继续处理 {task.get('name')}",
                    target_url=f"/runs?task_id={task_id}",
                    priority="high",
                    payload={"task_id": task_id, "status": task.get("status")},
                )
            )
    return actions


def _workbench_report_actions(report_cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        action_descriptor(
            "open_report",
            f"查看报告 {card.get('task_name')}",
            target_url=card["target_url"],
            priority="medium",
            payload={"task_id": card.get("task_id"), "run_id": card.get("run_id")},
        )
        for card in report_cards[:5]
    ]


def _workbench_badcase_actions(badcases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    actions = []
    for badcase in badcases[:5]:
        task_id = badcase.get("task_id")
        if task_id:
            actions.append(
                action_descriptor(
                    "open_trace_flow",
                    f"定位 Badcase {badcase.get('item_id')}",
                    target_url=_task_target("open_trace_flow", str(task_id)),
                    priority="high",
                    payload={"task_id": task_id, "item_id": badcase.get("item_id")},
                    evidence=[badcase.get("reason")],
                )
            )
    return actions


def _workbench_gate_actions(gate_failures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        action_descriptor(
            "open_report",
            f"处理 Gate 风险 {item.get('task_name')}",
            target_url=item["target_url"],
            priority="high",
            payload={"task_id": item.get("task_id"), "run_id": item.get("run_id")},
            evidence=item.get("evidence") if isinstance(item.get("evidence"), list) else [],
        )
        for item in gate_failures[:5]
    ]


def _task_target(action: str, task_id: str) -> str:
    return ACTION_TARGETS.get(action, "/runs?task_id={task_id}").format(task_id=task_id)


def _number_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _finding_title(cause_type: str) -> str:
    return {
        "runtime_error": "运行时失败",
        "data_quality": "数据质量风险",
        "weak_segment": "弱分层风险",
        "judge_or_answer_quality": "Judge 或回答质量风险",
        "parameter_risk": "参数治理风险",
        "quality_gate": "质量门禁风险",
    }.get(cause_type, "诊断发现")


def _action_label(action: str) -> str:
    return {
        "open_trace_flow": "查看 Trace Flow",
        "open_report": "查看 Report",
        "create_repair_tasks": "生成修复任务",
        "seed_annotation_queue": "加入人工审核",
        "review_badcases": "复盘 Badcase",
        "open_parameter_governance": "查看参数治理",
        "retry_failed_items": "重试失败项",
    }.get(action, action)


def _dedupe_actions(actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    result: list[dict[str, Any]] = []
    for action in actions:
        key = (str(action.get("id") or action.get("action")), str(action.get("target_url") or action.get("target")))
        if key in seen:
            continue
        seen.add(key)
        result.append(action)
    return result


def _dedupe_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    result: list[dict[str, Any]] = []
    for finding in findings:
        key = (str(finding.get("type")), str(finding.get("message")))
        if key in seen:
            continue
        seen.add(key)
        result.append(finding)
    return result
