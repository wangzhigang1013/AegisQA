from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException

from aegisqa.api.app import (
    DatasetFromPathRequest,
    DatasetUploadRequest,
    FieldTypeCorrectionRequest,
    SourceMaterializeRequest,
    _list_records,
)
from aegisqa.api.routes.context import RouteContext
from aegisqa.core.errors import AegisQAError


def register_dataset_routes(app: FastAPI, ctx: RouteContext) -> None:
    @app.get("/datasets")
    def list_datasets() -> list[dict[str, Any]]:
        return ctx.dataset_service.list_datasets()

    @app.post("/datasets/from-path")
    def create_dataset_from_path(request: DatasetFromPathRequest) -> dict[str, Any]:
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
        dataset = ctx.dataset_service.materialize_source_rows(
            request.name,
            request.rows,
            golden=request.golden,
            label_field=request.label_field,
            answer_field=request.answer_field,
        )
        ctx.audit_service.record(actor="api", action="dataset.source_materialize", target=dataset.version_id, detail={"row_count": dataset.row_count})
        payload = dataset.model_dump(mode="json")
        payload["field_paths"] = [f"row.{field}" for field in sorted(dataset.field_schema)]
        return payload

    @app.get("/datasets/{dataset_id}/versions/{version}/lineage")
    def get_dataset_lineage(dataset_id: str, version: int) -> dict[str, Any]:
        """返回 Dataset Version 的来源、字段和下游任务血缘。"""

        return ctx.dataset_service.build_lineage(dataset_id, version, _list_records(ctx.store, "tasks"))

    @app.get("/datasets/{dataset_id}/versions/{version}")
    def get_dataset(dataset_id: str, version: int) -> dict[str, Any]:
        try:
            return ctx.dataset_service.get_version(dataset_id, version).model_dump(mode="json")
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/datasets/{dataset_id}/versions/{version}/fields/{field_name}")
    def correct_field_type(dataset_id: str, version: int, field_name: str, request: FieldTypeCorrectionRequest) -> dict[str, Any]:
        dataset = ctx.dataset_service.correct_field_type(dataset_id, version, field_name, request.field_type)
        ctx.audit_service.record(actor="api", action="dataset.field_type.correct", target=f"{dataset_id}:v{version}:{field_name}", detail={"field_type": request.field_type})
        return dataset.model_dump(mode="json")
