from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

from aegisqa.api.app import (
    SkillGovernanceRequest,
    SkillPackageUploadRequest,
    _find_skill_package,
    _install_skill_package,
    _mark_skill_package_approved,
    _now,
    _list_records,
    _record_skill_package_contract_result,
    _record_skill_package_lifecycle_event,
    _save_record,
    _skill_base_id,
    _update_skill_package_status,
)
from aegisqa.api.routes.context import RouteContext
from aegisqa.security.access import require_permission
from aegisqa.skills.agent_skills import (
    agent_skill_ids_from_store,
    find_agent_skill_record,
    mark_agent_skill_approved,
    update_agent_skill_contract_result,
    update_agent_skill_status,
)
from aegisqa.skills.base import SkillManifest
from aegisqa.skills.export_import import export_skill_package, import_skill_package, extract_zip_to_directory


class SkillRollbackRequest(BaseModel):
    target_skill_id: str
    reason: str = ""
    role: str = "Skill Developer"
    actor: str = "api"


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
        visible_skill_ids = package_skill_ids | agent_skill_ids_from_store(ctx.store)
        return [skill for skill in skills if skill.skill_id in visible_skill_ids]

    @app.get("/skills/packages")
    def list_skill_packages() -> list[dict[str, Any]]:
        return _list_records(ctx.store, "skill_packages")

    @app.post("/skills/packages/upload")
    def upload_skill_package(request: SkillPackageUploadRequest) -> dict[str, Any]:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            permission="skill:register",
            action="skill_package.upload",
            target=request.filename,
            actor=request.actor,
        )
        record = _install_skill_package(ctx.store, ctx.registry, request)
        ctx.audit_service.record(
            actor=request.actor,
            role=request.role,
            action="skill_package.upload",
            target=record["manifest"]["skill_id"],
            detail={"filename": request.filename, "role": request.role},
        )
        return record

    @app.post("/skills/{skill_id:path}/contract-test")
    def run_skill_contract_test(skill_id: str, role: str = "Skill Developer", actor: str = "api") -> dict[str, Any]:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=role,
            permission="skill:contract_test",
            action="skill.contract_test",
            target=skill_id,
            actor=actor,
        )
        result = ctx.registry.get(skill_id).contract_test()
        _record_skill_package_contract_result(ctx.store, skill_id, result, actor=actor)
        update_agent_skill_contract_result(ctx.store, skill_id, result)
        return {"skill_id": skill_id, **result}

    @app.get("/skills/{skill_id:path}/versions")
    def get_skill_versions(skill_id: str) -> dict[str, Any]:
        return _build_skill_version_history(ctx, skill_id)

    @app.post("/skills/{skill_id:path}/rollback")
    def rollback_skill_version(skill_id: str, request: SkillRollbackRequest) -> dict[str, Any]:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            permission="skill:approve",
            action="skill.rollback",
            target=skill_id,
            actor=request.actor,
        )
        source_package = _find_skill_package(ctx.store, skill_id)
        target_package = _find_skill_package(ctx.store, request.target_skill_id)
        if not source_package or not target_package:
            raise ValueError("回滚只能在已上传的 Skill 包版本之间执行。")
        if _skill_base_id(skill_id) != _skill_base_id(request.target_skill_id):
            raise ValueError("只能回滚到同一 Skill 版本族。")
        if not target_package.get("last_contract_ok"):
            raise ValueError("目标版本必须先通过合约测试。")
        target_manifest = ctx.registry.approve(request.target_skill_id)
        _update_skill_package_status(ctx.store, target_manifest)
        _record_skill_package_lifecycle_event(
            ctx.store,
            request.target_skill_id,
            action="rollback_target",
            actor=request.actor,
            role=request.role,
            reason=request.reason,
            target_skill_id=skill_id,
        )
        source_manifest = ctx.registry.deprecate(skill_id, reason=request.reason)
        _update_skill_package_status(ctx.store, source_manifest)
        _record_skill_package_lifecycle_event(
            ctx.store,
            skill_id,
            action="rollback_source",
            actor=request.actor,
            role=request.role,
            reason=request.reason,
            target_skill_id=request.target_skill_id,
        )
        ctx.audit_service.record(
            actor=request.actor,
            role=request.role,
            action="skill.rollback",
            target=skill_id,
            detail={"target_skill_id": request.target_skill_id, "reason": request.reason, "role": request.role},
        )
        return _build_skill_version_history(ctx, request.target_skill_id)

    @app.post("/skills/{skill_id:path}/disable", response_model=SkillManifest)
    def disable_skill(skill_id: str, request: SkillGovernanceRequest) -> SkillManifest:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            permission="skill:approve",
            action="skill.disable",
            target=skill_id,
            actor=request.actor,
        )
        manifest = ctx.registry.disable(skill_id, reason=request.reason)
        _update_skill_package_status(ctx.store, manifest)
        _record_skill_package_lifecycle_event(ctx.store, manifest.skill_id, action="disable", actor=request.actor, role=request.role, reason=request.reason)
        update_agent_skill_status(ctx.store, manifest)
        ctx.audit_service.record(
            actor=request.actor,
            role=request.role,
            action="skill.disable",
            target=skill_id,
            detail={"reason": request.reason, "role": request.role},
        )
        return manifest

    @app.post("/skills/{skill_id:path}/approve", response_model=SkillManifest)
    def approve_skill(skill_id: str, request: SkillGovernanceRequest | None = None) -> SkillManifest:
        actor = request.actor if request else "api"
        role = request.role if request else "Skill Developer"
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=role,
            permission="skill:approve",
            action="skill.approve",
            target=skill_id,
            actor=actor,
        )
        package = _find_skill_package(ctx.store, skill_id)
        if package and not package.get("last_contract_ok"):
            raise ValueError("插件包必须先通过合约测试，才能审批启用。")
        agent_skill = find_agent_skill_record(ctx.store, skill_id)
        if agent_skill and not agent_skill.get("last_contract_ok"):
            raise ValueError("Agent Skill 必须先通过合约测试，才能审批启用。")
        manifest = ctx.registry.approve(skill_id)
        _update_skill_package_status(ctx.store, manifest)
        update_agent_skill_status(ctx.store, manifest)
        _mark_skill_package_approved(ctx.store, manifest.skill_id, request.reason if request else "", actor=actor, role=role)
        mark_agent_skill_approved(ctx.store, manifest.skill_id, request.reason if request else "")
        ctx.audit_service.record(
            actor=actor,
            role=role,
            action="skill.approve",
            target=skill_id,
            detail={"reason": request.reason if request else "", "role": role},
        )
        return manifest

    @app.post("/skills/{skill_id:path}/deprecate", response_model=SkillManifest)
    def deprecate_skill(skill_id: str, request: SkillGovernanceRequest) -> SkillManifest:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            permission="skill:approve",
            action="skill.deprecate",
            target=skill_id,
            actor=request.actor,
        )
        manifest = ctx.registry.deprecate(skill_id, reason=request.reason)
        _update_skill_package_status(ctx.store, manifest)
        _record_skill_package_lifecycle_event(ctx.store, manifest.skill_id, action="deprecate", actor=request.actor, role=request.role, reason=request.reason)
        update_agent_skill_status(ctx.store, manifest)
        ctx.audit_service.record(
            actor=request.actor,
            role=request.role,
            action="skill.deprecate",
            target=skill_id,
            detail={"reason": request.reason, "role": request.role},
        )
        return manifest

    @app.get("/skills/{skill_id:path}/export")
    def export_skill(skill_id: str, include_tests: bool = False, include_history: bool = False) -> dict[str, Any]:
        """导出 Skill 包为标准 zip 格式。"""
        manifest = ctx.registry.get(skill_id)
        if not manifest:
            raise ValueError(f"Skill {skill_id} 不存在。")

        # 查找包根目录
        package_root = None
        package_record = _find_skill_package(ctx.store, skill_id)
        if package_record and package_record.get("package_dir"):
            from pathlib import Path
            package_root = Path(package_record["package_dir"])

        # 获取版本历史
        history_records = None
        if include_history:
            version_history = _build_skill_version_history(ctx, skill_id)
            history_records = version_history.get("versions", [])

        result = export_skill_package(
            skill_id=skill_id,
            manifest=manifest,
            package_root=package_root,
            include_tests=include_tests,
            include_history=include_history,
            history_records=history_records,
        )

        import base64
        return {
            "skill_id": result.skill_id,
            "filename": result.filename,
            "zip_base64": base64.b64encode(result.zip_bytes).decode('ascii'),
            "metadata": result.metadata,
        }

    class SkillImportRequest(BaseModel):
        zip_base64: str
        validate_compatibility: bool = True
        role: str = "Skill Developer"
        actor: str = "api"

    @app.post("/skills/import")
    def import_skill(request: SkillImportRequest) -> dict[str, Any]:
        """从标准 zip 格式导入 Skill 包。"""
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            permission="skill:register",
            action="skill.import",
            target="skill_import",
            actor=request.actor,
        )

        import base64
        try:
            zip_bytes = base64.b64decode(request.zip_base64)
        except Exception as e:
            raise ValueError(f"无效的 base64 编码：{e}")

        result = import_skill_package(
            zip_bytes=zip_bytes,
            validate_compatibility=request.validate_compatibility,
        )

        # 保存导入的包
        from pathlib import Path
        import tempfile
        import os

        # 创建临时目录并解压
        with tempfile.TemporaryDirectory(prefix="aegisqa_import_") as tmp_dir:
            tmp_path = Path(tmp_dir)
            extract_zip_to_directory(zip_bytes, tmp_path)

            # 查找 handler.py 或 SKILL.md
            handler_path = None
            skill_md_path = None
            for f in tmp_path.rglob('*'):
                if f.name == 'handler.py':
                    handler_path = f
                elif f.name == 'SKILL.md':
                    skill_md_path = f

            # 构建上传请求
            upload_request = SkillPackageUploadRequest(
                filename=result.filename,
                zip_base64=request.zip_base64,
                role=request.role,
                actor=request.actor,
            )

            # 安装包
            record = _install_skill_package(ctx.store, ctx.registry, upload_request)

        ctx.audit_service.record(
            actor=request.actor,
            role=request.role,
            action="skill.import",
            target=result.skill_id,
            detail={"filename": result.filename, "warnings": result.warnings, "role": request.role},
        )

        return {
            "skill_id": result.skill_id,
            "filename": result.filename,
            "manifest": result.manifest,
            "metadata": result.metadata,
            "warnings": result.warnings,
            "package_record": record,
        }

    class SkillBatchExportRequest(BaseModel):
        skill_ids: list[str]
        include_tests: bool = False
        include_history: bool = False

    @app.post("/skills/batch-export")
    def batch_export_skills(request: SkillBatchExportRequest) -> dict[str, Any]:
        """批量导出 Skill 包。"""
        results = []
        for skill_id in request.skill_ids:
            try:
                manifest = ctx.registry.get(skill_id)
                if not manifest:
                    results.append({"skill_id": skill_id, "error": "不存在"})
                    continue

                package_root = None
                package_record = _find_skill_package(ctx.store, skill_id)
                if package_record and package_record.get("package_dir"):
                    from pathlib import Path
                    package_root = Path(package_record["package_dir"])

                history_records = None
                if request.include_history:
                    version_history = _build_skill_version_history(ctx, skill_id)
                    history_records = version_history.get("versions", [])

                result = export_skill_package(
                    skill_id=skill_id,
                    manifest=manifest,
                    package_root=package_root,
                    include_tests=request.include_tests,
                    include_history=request.include_history,
                    history_records=history_records,
                )

                import base64
                results.append({
                    "skill_id": result.skill_id,
                    "filename": result.filename,
                    "zip_base64": base64.b64encode(result.zip_bytes).decode('ascii'),
                    "metadata": result.metadata,
                })
            except Exception as e:
                results.append({"skill_id": skill_id, "error": str(e)})

        return {"exported": len([r for r in results if "error" not in r]), "results": results}

    class SkillBatchImportRequest(BaseModel):
        packages: list[SkillImportRequest]

    @app.post("/skills/batch-import")
    def batch_import_skills(request: SkillBatchImportRequest) -> dict[str, Any]:
        """批量导入 Skill 包。"""
        results = []
        for pkg in request.packages:
            try:
                import base64
                zip_bytes = base64.b64decode(pkg.zip_base64)
                result = import_skill_package(
                    zip_bytes=zip_bytes,
                    validate_compatibility=pkg.validate_compatibility,
                )

                # 保存包
                upload_request = SkillPackageUploadRequest(
                    filename=result.filename,
                    zip_base64=pkg.zip_base64,
                    role=pkg.role,
                    actor=pkg.actor,
                )
                record = _install_skill_package(ctx.store, ctx.registry, upload_request)

                ctx.audit_service.record(
                    actor=pkg.actor,
                    role=pkg.role,
                    action="skill.import",
                    target=result.skill_id,
                    detail={"filename": result.filename, "warnings": result.warnings},
                )

                results.append({
                    "skill_id": result.skill_id,
                    "filename": result.filename,
                    "manifest": result.manifest,
                    "warnings": result.warnings,
                })
            except Exception as e:
                results.append({"error": str(e)})

        return {"imported": len([r for r in results if "error" not in r]), "results": results}


def _build_skill_version_history(ctx: RouteContext, skill_id: str) -> dict[str, Any]:
    base_skill_id = _skill_base_id(skill_id)
    records = [
        _normalise_skill_version_record(record)
        for record in _list_records(ctx.store, "skill_packages")
        if _skill_base_id(str(record.get("manifest", {}).get("skill_id") or "")) == base_skill_id
    ]
    records.sort(key=lambda item: _version_sort_key(str(item.get("version") or item.get("skill_version") or "")))
    previous_manifest: dict[str, Any] | None = None
    versions: list[dict[str, Any]] = []
    for record in records:
        manifest = record.get("manifest") if isinstance(record.get("manifest"), dict) else {}
        versions.append(
            {
                "skill_id": manifest.get("skill_id"),
                "version": manifest.get("version") or record.get("skill_version"),
                "status": record.get("status") or manifest.get("status"),
                "enabled": bool(manifest.get("enabled")),
                "package_id": record.get("package_id"),
                "filename": record.get("filename"),
                "runtime_mode": record.get("runtime_mode"),
                "created_at": record.get("created_at"),
                "updated_at": record.get("updated_at"),
                "manifest": manifest,
                "contract_history": record.get("contract_history") if isinstance(record.get("contract_history"), list) else [],
                "approval_history": record.get("approval_history") if isinstance(record.get("approval_history"), list) else [],
                "diff_from_previous": _diff_manifests(previous_manifest, manifest) if previous_manifest is not None else [],
            }
        )
        previous_manifest = manifest
    approved_versions = [item for item in versions if item.get("status") == "approved" and item.get("enabled")]
    latest_approved = approved_versions[-1]["skill_id"] if approved_versions else None
    return {
        "base_skill_id": base_skill_id,
        "requested_skill_id": skill_id,
        "latest_approved_skill_id": latest_approved,
        "versions": versions,
    }


def _normalise_skill_version_record(record: dict[str, Any]) -> dict[str, Any]:
    manifest = record.get("manifest") if isinstance(record.get("manifest"), dict) else {}
    if "base_skill_id" not in record:
        record["base_skill_id"] = _skill_base_id(str(manifest.get("skill_id") or ""))
    if "skill_version" not in record:
        record["skill_version"] = str(manifest.get("version") or "")
    record.setdefault("contract_history", [])
    record.setdefault("approval_history", [])
    return record


def _diff_manifests(previous: dict[str, Any] | None, current: dict[str, Any]) -> list[dict[str, Any]]:
    if not previous:
        return []
    fields = ["name", "version", "description", "tags", "scenarios", "input_schema", "output_schema", "config_schema", "permissions"]
    diffs: list[dict[str, Any]] = []
    for field in fields:
        before = previous.get(field)
        after = current.get(field)
        if before != after:
            diffs.append({"field": f"manifest.{field}", "from": before, "to": after})
    return diffs


def _version_sort_key(version: str) -> tuple[Any, ...]:
    parts: list[Any] = []
    for token in version.replace("-", ".").split("."):
        parts.append(int(token) if token.isdigit() else token)
    return tuple(parts)
