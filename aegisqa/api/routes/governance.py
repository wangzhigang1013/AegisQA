"""治理、健康检查与全局概览路由。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field

from aegisqa.api.routes.context import RouteContext
from aegisqa.core.errors import AegisQAError
from aegisqa.core.features import resolve_feature_flags
from aegisqa.llm.models import ModelAlias
from aegisqa.reports.aggregator import aggregate_run_report


class ModelAliasRequest(BaseModel):
    alias: str
    provider: str
    model: str
    enabled: bool = True
    allowed_skill_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


def register_governance_routes(app: FastAPI, ctx: RouteContext) -> None:
    """注册不隶属于单一业务资源的治理类接口。"""

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "aegisqa"}

    @app.get("/features")
    def features() -> dict[str, Any]:
        return {"features": resolve_feature_flags()}

    @app.get("/model-aliases")
    def list_model_aliases() -> list[dict[str, Any]]:
        return sorted(ctx.store.list_json(["model_aliases"]), key=lambda item: item.get("alias", ""))

    @app.post("/model-aliases")
    def upsert_model_alias(request: ModelAliasRequest) -> dict[str, Any]:
        if "/" in request.alias or "\\" in request.alias:
            raise AegisQAError("MODEL_ALIAS_INVALID", "Model alias 不能包含路径分隔符。", details={"alias": request.alias})
        alias = ModelAlias(**request.model_dump())
        payload = alias.model_dump(mode="json")
        payload["created_at"] = _alias_created_at(ctx, alias.alias)
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        ctx.store.write_json(["model_aliases", f"{alias.alias}.json"], payload)
        ctx.audit_service.record(
            actor="api",
            action="model_alias.upsert",
            target=alias.alias,
            detail={"provider": alias.provider, "model": alias.model, "enabled": alias.enabled},
        )
        return payload

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


def _alias_created_at(ctx: RouteContext, alias: str) -> str:
    existing = ctx.store.read_json(["model_aliases", f"{alias}.json"])
    if existing and existing.get("created_at"):
        return str(existing["created_at"])
    return datetime.now(timezone.utc).isoformat()
