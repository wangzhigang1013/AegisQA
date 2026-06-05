from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException

from aegisqa.api.app import (
    DatasetFromPathRequest,
    DatasetRepairVersionRequest,
    DatasetUploadRequest,
    FieldTypeCorrectionRequest,
    SourceMaterializeRequest,
    _list_records,
)
from aegisqa.api.routes.context import RouteContext
from aegisqa.core.errors import AegisQAError
from aegisqa.security.access import require_permission


def register_dataset_routes(app: FastAPI, ctx: RouteContext) -> None:
    @app.get("/datasets")
    def list_datasets() -> list[dict[str, Any]]:
        return ctx.dataset_service.list_datasets()

    @app.post("/datasets/from-path")
    def create_dataset_from_path(request: DatasetFromPathRequest) -> dict[str, Any]:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            permission="dataset:create",
            action="dataset.create",
            target=request.name,
            actor=request.actor,
        )
        path = Path(request.path)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"文件不存在：{request.path}")
        dataset = ctx.dataset_service.upload_dataset(
            request.name,
            path,
            golden=request.golden,
            label_field=request.label_field,
            answer_field=request.answer_field,
        )
        return dataset.model_dump(mode="json")

    @app.post("/datasets/upload")
    def upload_dataset(request: DatasetUploadRequest) -> dict[str, Any]:
        """上传 CSV/JSONL 文本内容。

        这里不用 multipart，是为了让 MVP 在缺少 `python-multipart` 依赖时仍可运行。
        前端 Streamlit 已支持真实文件上传；HTTP API 则用文本内容表达同一能力。
        """

        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            permission="dataset:create",
            action="dataset.create",
            target=request.name,
            actor=request.actor,
        )
        if not request.content.strip():
            raise AegisQAError(
                "DATASET_EMPTY",
                "数据集没有可执行样本，请上传至少一行有效数据。",
                details={"filename": Path(request.filename).name, "file_format": (Path(request.filename).suffix or ".jsonl").lstrip(".")},
            )
        suffix = Path(request.filename).suffix or ".jsonl"
        upload_path = ctx.store.path("uploads", f"{request.name}{suffix}")
        upload_path.write_text(request.content, encoding="utf-8")
        dataset = ctx.dataset_service.upload_dataset(
            request.name,
            upload_path,
            golden=request.golden,
            label_field=request.label_field,
            answer_field=request.answer_field,
        )
        return dataset.model_dump(mode="json")

    @app.post("/datasets/source-materialize")
    def materialize_source_dataset(request: SourceMaterializeRequest) -> dict[str, Any]:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            permission="dataset:create",
            action="dataset.source_materialize",
            target=request.name,
            actor=request.actor,
        )
        dataset = ctx.dataset_service.materialize_source_rows(
            request.name,
            request.rows,
            golden=request.golden,
            label_field=request.label_field,
            answer_field=request.answer_field,
        )
        ctx.audit_service.record(
            actor=request.actor,
            role=request.role,
            action="dataset.source_materialize",
            target=dataset.version_id,
            result="success",
            detail={"row_count": dataset.row_count, "role": request.role},
        )
        payload = dataset.model_dump(mode="json")
        payload["field_paths"] = [f"row.{field}" for field in sorted(dataset.field_schema)]
        return payload

    @app.get("/datasets/{dataset_id}/versions/{version}/lineage")
    def get_dataset_lineage(dataset_id: str, version: int) -> dict[str, Any]:
        """返回 Dataset Version 的来源、字段和下游任务血缘。"""

        return ctx.dataset_service.build_lineage(dataset_id, version, _list_records(ctx.store, "tasks"))

    @app.get("/datasets/{dataset_id}/versions/{version}/quality")
    def get_dataset_quality(dataset_id: str, version: int) -> dict[str, Any]:
        """返回 Dataset Version 的字段覆盖率、缺失率和重复样本诊断。"""

        try:
            return ctx.dataset_service.build_quality_diagnosis(dataset_id, version)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/datasets/{dataset_id}/versions/{version}/repair-version")
    def create_dataset_repair_version(dataset_id: str, version: int, request: DatasetRepairVersionRequest) -> dict[str, Any]:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            permission="dataset:create",
            action="dataset.repair_version.create",
            target=f"{dataset_id}:v{version}",
            actor=request.actor,
        )
        try:
            dataset = ctx.dataset_service.create_repaired_version(
                dataset_id,
                version,
                drop_duplicate_rows=request.drop_duplicate_rows,
                fill_missing=request.fill_missing,
                reason=request.reason,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        ctx.audit_service.record(
            actor=request.actor,
            role=request.role,
            action="dataset.repair_version.create",
            target=dataset.version_id,
            result="success",
            detail={
                "parent_dataset_id": dataset_id,
                "parent_version": version,
                "drop_duplicate_rows": request.drop_duplicate_rows,
                "fill_missing_fields": sorted(request.fill_missing),
            },
        )
        return dataset.model_dump(mode="json")

    @app.get("/datasets/{dataset_id}/versions/{version}")
    def get_dataset(dataset_id: str, version: int) -> dict[str, Any]:
        try:
            return ctx.dataset_service.get_version(dataset_id, version).model_dump(mode="json")
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/datasets/{dataset_id}/versions/{version}/fields/{field_name}")
    def correct_field_type(dataset_id: str, version: int, field_name: str, request: FieldTypeCorrectionRequest) -> dict[str, Any]:
        require_permission(
            ctx.access_control,
            ctx.audit_service,
            role=request.role,
            permission="dataset:create",
            action="dataset.field_type.correct",
            target=f"{dataset_id}:v{version}:{field_name}",
            actor=request.actor,
        )
        dataset = ctx.dataset_service.correct_field_type(dataset_id, version, field_name, request.field_type)
        ctx.audit_service.record(
            actor=request.actor,
            role=request.role,
            action="dataset.field_type.correct",
            target=f"{dataset_id}:v{version}:{field_name}",
            result="success",
            detail={"field_type": request.field_type, "role": request.role},
        )
        return dataset.model_dump(mode="json")
