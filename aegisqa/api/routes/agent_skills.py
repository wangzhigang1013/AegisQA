from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

from aegisqa.api.routes.context import RouteContext
from aegisqa.skills.agent_skills import (
    discover_agent_skills,
    import_agent_skill,
    imported_agent_skill_source_dirs,
)


class AgentSkillImportRequest(BaseModel):
    """导入本机 Agent Skill 目录的请求。"""

    source_dir: str
    skill_id: str | None = None
    name: str | None = None


def register_agent_skill_routes(app: FastAPI, ctx: RouteContext) -> None:
    @app.get("/agent-skills/discover")
    def discover() -> dict[str, Any]:
        """扫描配置根目录下的 `SKILL.md`，不自动导入。"""

        items = discover_agent_skills(imported_source_dirs=imported_agent_skill_source_dirs(ctx.store))
        return {"count": len(items), "items": items}

    @app.get("/agent-skills")
    def list_agent_skills() -> list[dict[str, Any]]:
        from aegisqa.api.app import _list_records

        return _list_records(ctx.store, "agent_skills")

    @app.post("/agent-skills/import")
    def import_agent_skill_route(request: AgentSkillImportRequest) -> dict[str, Any]:
        record = import_agent_skill(
            ctx.store,
            ctx.registry,
            source_dir=request.source_dir,
            skill_id=request.skill_id,
            name=request.name,
        )
        ctx.audit_service.record(actor="api", action="agent_skill.import", target=record["manifest"]["skill_id"])
        return record
