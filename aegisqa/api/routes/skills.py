from __future__ import annotations

import base64
from typing import Any
from uuid import uuid4

from fastapi import FastAPI
from pydantic import BaseModel, Field

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
from aegisqa.core.errors import AegisQAError
from aegisqa.llm.gateway import LLMGateway
from aegisqa.llm.models import ModelAlias, PromptAsset
from aegisqa.llm.providers import TestLLMProvider
from aegisqa.skills.base import SkillManifest


class PromptDebugRequest(BaseModel):
    variables: dict[str, Any] = Field(default_factory=dict)
    trigger_reason: str = "prompt_debug"
    model_alias: str | None = None


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
        artifact_uri = ctx.artifact_store.put_bytes(
            "/".join(["skill-packages", _artifact_key_part(record["package_id"]), request.filename]),
            base64.b64decode(request.content_base64),
            content_type="application/zip",
        )
        record["artifact_uri"] = artifact_uri
        record["artifact_metadata"] = ctx.artifact_store.describe(artifact_uri)
        _save_record(ctx.store, "skill_packages", "package_id", record)
        ctx.audit_service.record(actor="api", action="skill_package.upload", target=record["manifest"]["skill_id"])
        return record

    @app.post("/skills/{skill_id}/versions/{version}/prompts/{prompt_name}/debug")
    def debug_skill_prompt(skill_id: str, version: str, prompt_name: str, request: PromptDebugRequest) -> dict[str, Any]:
        package = _find_skill_package(ctx.store, skill_id)
        if not package:
            raise AegisQAError("SKILL_PACKAGE_NOT_FOUND", "Skill 包不存在，无法调试 Prompt。", status_code=404, details={"skill_id": skill_id})
        manifest = package.get("manifest", {})
        if str(manifest.get("version")) != version:
            raise AegisQAError(
                "SKILL_VERSION_NOT_FOUND",
                "Skill 版本不存在。",
                status_code=404,
                details={"skill_id": skill_id, "version": version, "available_version": manifest.get("version")},
            )
        prompt_assets = {
            asset["name"]: PromptAsset.model_validate(asset)
            for asset in package.get("prompt_assets", [])
            if isinstance(asset, dict) and asset.get("name")
        }
        model_aliases = {
            alias["alias"]: ModelAlias.model_validate(alias)
            for alias in ctx.store.list_json(["model_aliases"])
            if isinstance(alias, dict) and alias.get("enabled", True) and alias.get("alias")
        }
        gateway = LLMGateway(prompt_assets=prompt_assets, model_aliases=model_aliases, providers={"test": TestLLMProvider()})
        call = gateway.call(
            prompt_name,
            request.variables,
            trigger_reason=request.trigger_reason,
            model_alias=request.model_alias,
            permissions=manifest.get("llm_permissions", {}),
        )
        payload = call.model_dump(mode="json")
        artifact_uris, artifact_metadata = _persist_prompt_debug_artifacts(ctx, skill_id, version, prompt_name, payload)
        payload["artifact_uris"] = artifact_uris
        payload["artifact_metadata"] = artifact_metadata
        ctx.audit_service.record(
            actor="api",
            action="prompt.debug",
            target=f"{skill_id}:{prompt_name}",
            detail={"version": version, "artifact_uris": artifact_uris},
        )
        return payload

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


def _persist_prompt_debug_artifacts(
    ctx: RouteContext,
    skill_id: str,
    version: str,
    prompt_name: str,
    payload: dict[str, Any],
) -> tuple[dict[str, str], dict[str, dict[str, Any]]]:
    base_key = "/".join(
        [
            "prompt-debug",
            _artifact_key_part(skill_id),
            _artifact_key_part(version),
            _artifact_key_part(prompt_name),
            f"debug-{uuid4().hex[:12]}",
        ]
    )
    artifact_uris: dict[str, str] = {}
    artifact_metadata: dict[str, dict[str, Any]] = {}
    rendered_prompt = payload.get("rendered_prompt")
    if isinstance(rendered_prompt, str):
        uri = ctx.artifact_store.put_bytes(f"{base_key}/rendered_prompt.txt", rendered_prompt.encode("utf-8"), content_type="text/plain;charset=utf-8")
        artifact_uris["rendered_prompt"] = uri
        artifact_metadata["rendered_prompt"] = ctx.artifact_store.describe(uri)
    raw_response = payload.get("raw_response")
    if isinstance(raw_response, str):
        uri = ctx.artifact_store.put_bytes(f"{base_key}/raw_response.txt", raw_response.encode("utf-8"), content_type="text/plain;charset=utf-8")
        artifact_uris["raw_response"] = uri
        artifact_metadata["raw_response"] = ctx.artifact_store.describe(uri)
    uri = ctx.artifact_store.put_json(f"{base_key}/debug_result.json", payload)
    artifact_uris["debug_result"] = uri
    artifact_metadata["debug_result"] = ctx.artifact_store.describe(uri)
    return artifact_uris, artifact_metadata


def _artifact_key_part(value: str) -> str:
    safe = "".join(char if char.isalnum() or char in {"-", "_", "."} else "_" for char in value)
    return safe or "unknown"
