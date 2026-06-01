from __future__ import annotations

from typing import Any

from fastapi import FastAPI

from aegisqa.api.app import (
    SkillGovernanceRequest,
    SkillPackageUploadRequest,
    _find_skill_package,
    _install_skill_package,
    _mark_skill_package_approved,
    _now,
    _save_record,
    _update_skill_package_status,
)
from aegisqa.api.routes.context import RouteContext
from aegisqa.skills.base import SkillManifest


def register_skill_routes(app: FastAPI, ctx: RouteContext) -> None:
    @app.get("/skills", response_model=list[SkillManifest])
    def list_skills() -> list[SkillManifest]:
        skills = ctx.registry.list_skills()
        settings = ctx.store.read_json(["settings", "skill_market.json"], default={}) or {}
        if not settings.get("hide_builtin_skills"):
            return skills

        # 清空本地 Skill 市场时不能删除代码里的内置 Skill，否则测试和历史 Workflow
        # 回放都会受影响；这里仅按当前 store 的上传插件记录过滤展示层。
        from aegisqa.api.app import _list_records

        package_skill_ids = {
            str(record.get("manifest", {}).get("skill_id"))
            for record in _list_records(ctx.store, "skill_packages")
            if record.get("manifest", {}).get("skill_id")
        }
        return [skill for skill in skills if skill.skill_id in package_skill_ids]

    @app.get("/skills/packages")
    def list_skill_packages() -> list[dict[str, Any]]:
        from aegisqa.api.app import _list_records

        return _list_records(ctx.store, "skill_packages")

    @app.post("/skills/packages/upload")
    def upload_skill_package(request: SkillPackageUploadRequest) -> dict[str, Any]:
        record = _install_skill_package(ctx.store, ctx.registry, request)
        ctx.audit_service.record(actor="api", action="skill_package.upload", target=record["manifest"]["skill_id"])
        return record

    @app.post("/skills/{skill_id:path}/contract-test")
    def run_skill_contract_test(skill_id: str) -> dict[str, Any]:
        result = ctx.registry.get(skill_id).contract_test()
        package = _find_skill_package(ctx.store, skill_id)
        if package:
            package["last_contract_ok"] = bool(result.get("ok"))
            package["last_contract_result"] = result
            package["last_contract_at"] = _now()
            package["updated_at"] = _now()
            _save_record(ctx.store, "skill_packages", "package_id", package)
        return {"skill_id": skill_id, **result}

    @app.post("/skills/{skill_id:path}/disable", response_model=SkillManifest)
    def disable_skill(skill_id: str, request: SkillGovernanceRequest) -> SkillManifest:
        manifest = ctx.registry.disable(skill_id, reason=request.reason)
        _update_skill_package_status(ctx.store, manifest)
        ctx.audit_service.record(actor="api", action="skill.disable", target=skill_id, detail={"reason": request.reason})
        return manifest

    @app.post("/skills/{skill_id:path}/approve", response_model=SkillManifest)
    def approve_skill(skill_id: str, request: SkillGovernanceRequest | None = None) -> SkillManifest:
        package = _find_skill_package(ctx.store, skill_id)
        if package and not package.get("last_contract_ok"):
            raise ValueError("插件包必须先通过合约测试，才能审批启用。")
        manifest = ctx.registry.approve(skill_id)
        _update_skill_package_status(ctx.store, manifest)
        _mark_skill_package_approved(ctx.store, manifest.skill_id, request.reason if request else "")
        ctx.audit_service.record(actor="api", action="skill.approve", target=skill_id)
        return manifest

    @app.post("/skills/{skill_id:path}/deprecate", response_model=SkillManifest)
    def deprecate_skill(skill_id: str, request: SkillGovernanceRequest) -> SkillManifest:
        manifest = ctx.registry.deprecate(skill_id, reason=request.reason)
        _update_skill_package_status(ctx.store, manifest)
        ctx.audit_service.record(actor="api", action="skill.deprecate", target=skill_id, detail={"reason": request.reason})
        return manifest
