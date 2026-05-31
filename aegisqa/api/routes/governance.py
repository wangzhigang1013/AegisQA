"""治理、健康检查与全局概览路由。"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI

from aegisqa.api.routes.context import RouteContext
from aegisqa.reports.aggregator import aggregate_run_report


def register_governance_routes(app: FastAPI, ctx: RouteContext) -> None:
    """注册不隶属于单一业务资源的治理类接口。"""

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "aegisqa"}

    @app.get("/dashboard/summary")
    def dashboard_summary() -> dict[str, Any]:
        runs = ctx.runner.list_runs()
        completed = [run for run in runs if run.status == "completed"]
        latest_run = runs[-1].model_dump(mode="json") if runs else None
        latest_report = aggregate_run_report(completed[-1]).model_dump(mode="json") if completed else None
        datasets = ctx.dataset_service.list_datasets()
        pass_rate = float(latest_report.get("pass_rate", 0.0)) if latest_report else 0.0
        badcase_count = len(ctx.badcases.list_badcases())
        return {
            "dataset_count": len(datasets),
            "skill_count": len(ctx.registry.list_skills()),
            "workflow_count": len(ctx.workflow_service.list_versions()),
            "run_count": len(runs),
            "latest_run": latest_run,
            "pass_rate": pass_rate,
            "badcase_count": badcase_count,
            "runs": {"total": len(runs), "completed": len(completed), "running": len([run for run in runs if run.status == "running"])},
            "datasets": {"total": len(datasets)},
            "skills": {"total": len(ctx.registry.list_skills())},
            "workflows": {"total": len(ctx.workflow_service.list_versions())},
            "badcases": {"total": badcase_count},
            "latest_report": latest_report,
        }

    @app.get("/access/check")
    def access_check(role: str, permission: str) -> dict[str, bool]:
        return {"allowed": ctx.access_control.can(role, permission)}

    @app.get("/audit-events")
    def list_audit_events(actor: str | None = None, action: str | None = None, target: str | None = None) -> list[dict[str, Any]]:
        events = ctx.audit_service.list_events(actor=actor, action=action, target=target)
        return [event.model_dump(mode="json") for event in events]
