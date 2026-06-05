from __future__ import annotations

from dataclasses import asdict
import io
import json
from typing import Any
import zipfile

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse

from aegisqa.api.app import ReportExportApprovalRequest, ReportExportRequestCreate, ReportExportRevokeRequest, _now
from aegisqa.api.routes.context import RouteContext
from aegisqa.api.routes.tasks import (
    TASK_RESULT_EXPORT_MEDIA_TYPES,
    _approve_report_export_request,
    _build_task_report_export_csv,
    _build_task_report_export_html,
    _build_task_report_payload,
    _create_report_export_request,
    _ensure_report_export_approval,
    _ensure_report_export_format,
    _ensure_task_result_export_format,
    _get_record,
    _iter_task_result_export_content,
    _list_records,
    _refresh_report_export_request_status,
    _reject_report_export_request,
    _revoke_report_export_request,
    _task_result_export_shape,
)
from aegisqa.core.security import redact_secrets
from aegisqa.security.access import require_permission


def register_task_report_routes(app: FastAPI, ctx: RouteContext) -> None:
    """注册任务报告、报告导出审批和样本结果导出路由。"""

    @app.get("/tasks/{task_id}/report")
    def get_task_report(
        task_id: str,
        badcase_page: int = Query(1, ge=1),
        badcase_page_size: int = Query(20, ge=1, le=100),
        step_page: int = Query(1, ge=1),
        step_page_size: int = Query(20, ge=1, le=100),
        step_query: str | None = None,
        segment_page: int = Query(1, ge=1),
        segment_page_size: int = Query(20, ge=1, le=100),
        segment_query: str | None = None,
        root_cause_page: int = Query(1, ge=1),
        root_cause_page_size: int = Query(20, ge=1, le=100),
        root_cause_query: str | None = None,
        diagnostic_step_page: int = Query(1, ge=1),
        diagnostic_step_page_size: int = Query(20, ge=1, le=100),
    ) -> dict[str, Any]:
        return _build_task_report_payload(
            ctx,
            task_id,
            badcase_page=badcase_page,
            badcase_page_size=badcase_page_size,
            step_page=step_page,
            step_page_size=step_page_size,
            step_query=step_query,
            segment_page=segment_page,
            segment_page_size=segment_page_size,
            segment_query=segment_query,
            root_cause_page=root_cause_page,
            root_cause_page_size=root_cause_page_size,
            root_cause_query=root_cause_query,
            diagnostic_step_page=diagnostic_step_page,
            diagnostic_step_page_size=diagnostic_step_page_size,
        )

    @app.post("/tasks/{task_id}/report/export-requests")
    def create_report_export_request(task_id: str, request: ReportExportRequestCreate) -> dict[str, Any]:
        return _create_report_export_request(ctx, task_id, request)

    @app.get("/report-export-requests")
    def list_report_export_requests(task_id: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
        records = [_refresh_report_export_request_status(ctx, record) for record in _list_records(ctx.store, "report_export_requests")]
        if task_id:
            records = [record for record in records if record.get("task_id") == task_id]
        if status:
            records = [record for record in records if record.get("status") == status]
        return sorted(records, key=lambda record: str(record.get("created_at", "")), reverse=True)

    @app.post("/report-export-requests/{request_id}/approve")
    def approve_report_export_request(request_id: str, request: ReportExportApprovalRequest) -> dict[str, Any]:
        return _approve_report_export_request(ctx, request_id, request)

    @app.post("/report-export-requests/{request_id}/reject")
    def reject_report_export_request(request_id: str, request: ReportExportApprovalRequest) -> dict[str, Any]:
        return _reject_report_export_request(ctx, request_id, request)

    @app.post("/report-export-requests/{request_id}/revoke")
    def revoke_report_export_request(request_id: str, request: ReportExportRevokeRequest) -> dict[str, Any]:
        return _revoke_report_export_request(ctx, request_id, request)

    @app.get("/tasks/{task_id}/report/export")
    def export_task_report(task_id: str, file_format: str = "json", role: str = "Evaluator", actor: str = "api", approval_request_id: str | None = None) -> dict[str, Any]:
        _ensure_report_export_format(file_format)
        approval_request: dict[str, Any] | None = None
        if not ctx.access_control.can(role, "report:export"):
            approval_request = _ensure_report_export_approval(ctx, task_id, file_format, role, approval_request_id, actor=actor)
        payload = _build_task_report_payload(ctx, task_id, include_all_badcases=True)
        task = payload["task"]
        preflight = payload.get("preflight_evidence") or {}
        if file_format == "json":
            content = payload
        elif file_format == "csv":
            content = _build_task_report_export_csv(payload)
        elif file_format == "html":
            content = _build_task_report_export_html(payload)
        else:
            raise HTTPException(status_code=400, detail={"message": "file_format 仅支持 json/csv/html"})
        artifact = _persist_task_report_export_artifact(
            ctx,
            task_id=task_id,
            run_id=task.get("run_id"),
            file_format=file_format,
            content=content,
            approval_request_id=approval_request.get("request_id") if approval_request else None,
        )
        ctx.audit_service.record(
            actor=actor,
            role=role,
            action="task.report.export",
            target=task_id,
            detail={
                "run_id": task.get("run_id"),
                "file_format": file_format,
                "preflight_id": preflight.get("preflight_id"),
                "role": role,
                "approval_request_id": approval_request.get("request_id") if approval_request else None,
                "artifact_id": artifact["artifact_id"],
            },
        )
        return {
            "task_id": task_id,
            "run_id": task.get("run_id"),
            "file_format": file_format,
            "approval_request_id": approval_request.get("request_id") if approval_request else None,
            "artifact": artifact,
            "content": content,
        }

    @app.get("/tasks/{task_id}/report/offline-package")
    def export_task_report_offline_package(task_id: str, role: str = "Evaluator", actor: str = "api", approval_request_id: str | None = None) -> StreamingResponse:
        file_format = "offline_zip"
        approval_request: dict[str, Any] | None = None
        if not ctx.access_control.can(role, "report:export"):
            approval_request = _ensure_report_export_approval(ctx, task_id, file_format, role, approval_request_id, actor=actor)
        payload = _build_task_report_payload(ctx, task_id, include_all_badcases=True)
        package_bytes, manifest = _build_task_report_offline_package(ctx, task_id, payload)
        ctx.audit_service.record(
            actor=actor,
            role=role,
            action="task.report.export",
            target=task_id,
            detail={
                "run_id": manifest.get("run_id"),
                "file_format": file_format,
                "preflight_id": manifest.get("preflight_id"),
                "role": role,
                "approval_request_id": approval_request.get("request_id") if approval_request else None,
                "package_files": manifest.get("files"),
            },
        )
        filename = f"{task_id}_offline_audit.zip"
        return StreamingResponse(
            io.BytesIO(package_bytes),
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "X-AegisQA-File-Format": file_format,
                "X-AegisQA-Package-File-Count": str(len(manifest.get("files") or [])),
            },
        )

    @app.get("/tasks/{task_id}/results/export")
    def export_task_results(
        task_id: str,
        file_format: str = "csv",
        include_steps: bool = Query(default=False),
        role: str = "Evaluator",
        actor: str = "api",
    ) -> StreamingResponse:
        """导出任务的样本级执行结果。"""

        _ensure_task_result_export_format(file_format)
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=role,
            permission="report:export",
            action="task.results.export",
            target=task_id,
            actor=actor,
        )
        task = _get_record(ctx.store, "tasks", task_id)
        run = ctx.runner.get_run(task["run_id"])
        row_count, columns = _task_result_export_shape(run, include_steps=include_steps)
        ctx.audit_service.record(
            actor=actor,
            role=role,
            action="task.results.export",
            target=task_id,
            detail={
                "run_id": task.get("run_id"),
                "file_format": file_format,
                "include_steps": include_steps,
                "row_count": row_count,
                "streaming": True,
                "content_type": TASK_RESULT_EXPORT_MEDIA_TYPES[file_format],
                "role": role,
            },
        )
        filename = f"{task_id}_results.{file_format}"
        return StreamingResponse(
            _iter_task_result_export_content(run, file_format=file_format, include_steps=include_steps, columns=columns),
            media_type=TASK_RESULT_EXPORT_MEDIA_TYPES[file_format],
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "X-AegisQA-Row-Count": str(row_count),
                "X-AegisQA-File-Format": file_format,
                "X-AegisQA-Include-Steps": str(include_steps).lower(),
                "X-AegisQA-Streaming": "true",
            },
        )


def _persist_task_report_export_artifact(
    ctx: RouteContext,
    *,
    task_id: str,
    run_id: str | None,
    file_format: str,
    content: Any,
    approval_request_id: str | None,
) -> dict[str, Any]:
    artifact_id = f"tasks/{task_id}/reports/report.{file_format}"
    artifact = ctx.artifact_store.put_bytes(
        "reports",
        artifact_id,
        _encode_task_report_export_content(content, file_format),
        content_type=_task_report_export_content_type(file_format),
        metadata={
            "task_id": task_id,
            "run_id": run_id,
            "file_format": file_format,
            "approval_request_id": approval_request_id,
        },
    )
    return asdict(artifact)


def _encode_task_report_export_content(content: Any, file_format: str) -> bytes:
    if file_format == "json":
        return json.dumps(content, ensure_ascii=False, indent=2).encode("utf-8")
    return str(content).encode("utf-8")


def _task_report_export_content_type(file_format: str) -> str:
    return {
        "json": "application/json",
        "csv": "text/csv; charset=utf-8",
        "html": "text/html; charset=utf-8",
    }.get(file_format, "application/octet-stream")


def _build_task_report_offline_package(ctx: RouteContext, task_id: str, payload: dict[str, Any]) -> tuple[bytes, dict[str, Any]]:
    task = payload["task"]
    run = ctx.runner.get_run(task["run_id"])
    dataset = ctx.dataset_service.get_version(run.dataset_id, run.dataset_version)
    workflow_snapshot = run.workflow.model_dump(mode="json")
    skill_manifests = []
    for step in run.workflow.steps:
        try:
            skill_manifests.append(ctx.registry.get_manifest(step.skill_ref).model_dump(mode="json"))
        except KeyError:
            skill_manifests.append({"skill_ref": step.skill_ref, "missing": True})
    preflight = payload.get("preflight_evidence") or {}
    manifest = {
        "package_version": 1,
        "task_id": task_id,
        "run_id": task.get("run_id"),
        "workflow_version_id": run.workflow.version_id,
        "dataset_id": run.dataset_id,
        "dataset_version": run.dataset_version,
        "preflight_id": preflight.get("preflight_id"),
        "created_at": _now(),
        "files": [
            "report.html",
            "report.csv",
            "preflight.json",
            "workflow_snapshot.json",
            "skill_manifests.json",
            "dataset_schema.json",
        ],
    }
    dataset_schema = {
        "dataset_id": dataset.dataset_id,
        "version": dataset.version,
        "version_id": dataset.version_id,
        "name": dataset.name,
        "row_count": dataset.row_count,
        "field_schema": dataset.field_schema,
        "field_paths": [f"row.{field}" for field in sorted(dataset.field_schema)],
        "golden": dataset.golden,
        "label_field": dataset.label_field,
    }
    files = {
        "manifest.json": manifest,
        "report.html": _build_task_report_export_html(payload),
        "report.csv": _build_task_report_export_csv(payload),
        "preflight.json": preflight,
        "workflow_snapshot.json": workflow_snapshot,
        "skill_manifests.json": skill_manifests,
        "dataset_schema.json": dataset_schema,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for filename, content in files.items():
            if isinstance(content, str):
                archive.writestr(filename, redact_secrets(content))
            else:
                archive.writestr(filename, json.dumps(redact_secrets(content), ensure_ascii=False, indent=2))
    return buffer.getvalue(), manifest
