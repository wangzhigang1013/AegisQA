"""Judge Profile 与审计路由。"""

from __future__ import annotations

from fastapi import FastAPI

from aegisqa.api.app import JudgeAuditRequest, JudgeProfileCreateRequest, ProfileAuditRequest
from aegisqa.api.routes.context import RouteContext
from aegisqa.judge.audit import JudgeAuditResult, audit_judge_profile
from aegisqa.judge.profiles import JudgeProfile, StoredJudgeAudit


def register_judge_routes(app: FastAPI, ctx: RouteContext) -> None:
    """注册 Judge 可信度审计相关接口。"""

    @app.post("/judge-audits", response_model=JudgeAuditResult)
    def run_judge_audit(request: JudgeAuditRequest) -> JudgeAuditResult:
        result = audit_judge_profile(
            judge_profile_id=request.judge_profile_id,
            dataset_version_id=request.dataset_version_id,
            human_labels=request.human_labels,
            judge_labels=request.judge_labels,
            positive_label=request.positive_label,
        )
        ctx.audit_service.record(actor="api", action="judge.audit", target=result.judge_profile_id, detail=result.model_dump(mode="json"))
        return result

    @app.post("/judge-profiles", response_model=JudgeProfile)
    def create_judge_profile(request: JudgeProfileCreateRequest) -> JudgeProfile:
        profile = ctx.judge_profiles.create_profile(
            name=request.name,
            model=request.model,
            prompt=request.prompt,
            rubric=request.rubric,
            threshold=request.threshold,
            output_schema=request.output_schema,
        )
        ctx.audit_service.record(actor="api", action="judge_profile.create", target=profile.profile_id)
        return profile

    @app.get("/judge-profiles", response_model=list[JudgeProfile])
    def list_judge_profiles() -> list[JudgeProfile]:
        return ctx.judge_profiles.list_profiles()

    @app.get("/judge-profiles/{profile_id}", response_model=JudgeProfile)
    def get_judge_profile(profile_id: str) -> JudgeProfile:
        return ctx.judge_profiles.get_profile(profile_id)

    @app.post("/judge-profiles/{profile_id}/audits", response_model=StoredJudgeAudit)
    def run_profile_audit(profile_id: str, request: ProfileAuditRequest) -> StoredJudgeAudit:
        audit = ctx.judge_profiles.audit_and_store(
            profile_id,
            dataset_version_id=request.dataset_version_id,
            human_labels=request.human_labels,
            judge_labels=request.judge_labels,
            positive_label=request.positive_label,
        )
        ctx.audit_service.record(actor="api", action="judge_profile.audit", target=profile_id, detail={"audit_id": audit.audit_id})
        return audit

    @app.get("/judge-audits/{audit_id}/bias")
    def get_judge_audit_bias(audit_id: str) -> dict[str, object]:
        return ctx.judge_profiles.bias_analysis(audit_id)

    @app.get("/judge-audits", response_model=list[StoredJudgeAudit])
    def list_judge_audits(profile_id: str | None = None) -> list[StoredJudgeAudit]:
        if profile_id:
            return ctx.judge_profiles.list_audits(profile_id)
        return ctx.judge_profiles.list_all_audits()
