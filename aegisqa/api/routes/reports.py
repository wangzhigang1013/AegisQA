from __future__ import annotations

from html import escape
from math import ceil
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request

from aegisqa.api.app import (
    BadcaseBulkCorrectionRequest,
    BadcaseCorrectionRequest,
    BadcaseCreateRequest,
    _build_trace_tree,
    json_dumps,
)
from aegisqa.api.routes.context import RouteContext
from aegisqa.reports.aggregator import RunReport, aggregate_run_report


def register_report_routes(app: FastAPI, ctx: RouteContext) -> None:
    @app.get("/runs/{run_id}/report", response_model=RunReport)
    def get_report(run_id: str) -> RunReport:
        return aggregate_run_report(ctx.runner.get_run(run_id))

    @app.get("/runs/{run_id}/report/export")
    def export_report(run_id: str, file_format: str = "json") -> dict[str, Any]:
        report = aggregate_run_report(ctx.runner.get_run(run_id))
        payload = report.model_dump(mode="json")
        if file_format == "json":
            return {"run_id": run_id, "file_format": "json", "content": payload}
        if file_format == "csv":
            rows = ["metric,value"]
            for key, value in payload.items():
                if isinstance(value, (str, int, float)):
                    rows.append(f"{key},{value}")
            return {"run_id": run_id, "file_format": "csv", "content": "\n".join(rows)}
        if file_format == "html":
            # Run 级导出是 legacy 入口，但仍可能被老脚本或前端兼容入口使用。
            # payload 中包含 row/context/badcase 等用户输入，必须先序列化再 HTML 转义。
            safe_payload = escape(json_dumps(payload))
            return {"run_id": run_id, "file_format": "html", "content": f"<html><body><h1>{escape(run_id)}</h1><pre>{safe_payload}</pre></body></html>"}
        raise HTTPException(status_code=400, detail={"message": "file_format 仅支持 json/csv/html"})

    @app.get("/runs/{run_id}/trace")
    def get_run_trace(
        run_id: str,
        request: Request,
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=100),
    ) -> dict[str, Any]:
        run = ctx.runner.get_run(run_id)
        queue_shape = sorted(run.queue_messages[0].keys()) if run.queue_messages else []
        pagination_requested = "page" in request.query_params or "page_size" in request.query_params
        total_items = len(run.items)
        safe_page_size = min(max(page_size, 1), 100)
        start = (max(page, 1) - 1) * safe_page_size
        page_items = run.items[start : start + safe_page_size] if pagination_requested else run.items
        payload = {
            "run_id": run.run_id,
            "status": run.status,
            "workflow_version": run.workflow.version_id,
            "dataset_id": run.dataset_id,
            "dataset_version": run.dataset_version,
            "queue_message_shape": queue_shape,
            "items": [_run_trace_item_payload(item) for item in page_items],
        }
        if pagination_requested:
            payload["pagination"] = {
                "page": max(page, 1),
                "page_size": safe_page_size,
                "total_items": total_items,
                "total_pages": ceil(total_items / safe_page_size) if total_items else 0,
            }
        return payload

    @app.get("/runs/{run_id}/trace-tree")
    def get_run_trace_tree(
        run_id: str,
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=100),
    ) -> dict[str, Any]:
        return _build_trace_tree(ctx.runner.get_run(run_id), page=page, page_size=page_size)

    @app.post("/badcases")
    def create_badcase(request: BadcaseCreateRequest) -> dict[str, Any]:
        record = ctx.badcases.create_badcase(request.run_id, request.item_id, request.reason, request.payload)
        return record.model_dump(mode="json")

    @app.get("/badcases")
    def list_badcases(
        request: Request,
        status: str | None = None,
        problem_type: str | None = None,
        reason: str | None = None,
        skill: str | None = None,
        query: str | None = None,
        min_score: float | None = Query(default=None, ge=0.0, le=1.0),
        max_score: float | None = Query(default=None, ge=0.0, le=1.0),
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=100),
    ) -> list[dict[str, Any]] | dict[str, Any]:
        records = ctx.badcases.filter_badcases(
            status=status,
            problem_type=problem_type,
            reason=reason,
            skill=skill,
            query=query,
            min_score=min_score,
            max_score=max_score,
        )
        payloads = [record.model_dump(mode="json") for record in records]
        pagination_requested = "page" in request.query_params or "page_size" in request.query_params
        if not pagination_requested:
            return payloads
        return _paginate_payloads(payloads, page=page, page_size=page_size)

    @app.get("/badcases/clusters")
    def cluster_badcases(method: str = "rule", text_field: str = "question", similarity_threshold: float = 0.35) -> list[dict[str, Any]]:
        return ctx.badcases.cluster_badcases(method=method, text_field=text_field, similarity_threshold=similarity_threshold)

    @app.get("/badcases/export")
    def export_badcases(file_format: str = "jsonl") -> dict[str, Any]:
        if file_format != "jsonl":
            raise HTTPException(status_code=400, detail={"message": "Badcase 导出当前仅支持 jsonl"})
        records = [record.model_dump(mode="json") for record in ctx.badcases.list_badcases()]
        content = "\n".join(json_dumps(record) for record in records)
        return {"file_format": "jsonl", "row_count": len(records), "content": content}

    @app.post("/badcases/bulk-correct")
    def bulk_correct_badcases(request: BadcaseBulkCorrectionRequest) -> list[dict[str, Any]]:
        records = ctx.badcases.bulk_correct(
            request.badcase_ids,
            human_label=request.human_label,
            problem_type=request.problem_type,
            note=request.note,
            add_to_golden=request.add_to_golden,
            ignore=request.ignore,
        )
        return [record.model_dump(mode="json") for record in records]


    @app.post("/badcases/{badcase_id}/correct")
    def correct_badcase(badcase_id: str, request: BadcaseCorrectionRequest) -> dict[str, Any]:
        record = ctx.badcases.correct_badcase(
            badcase_id,
            human_label=request.human_label,
            problem_type=request.problem_type,
            note=request.note,
            add_to_golden=request.add_to_golden,
            ignore=request.ignore,
        )
        return record.model_dump(mode="json")

    @app.post("/badcases/{badcase_id}/reopen")
    def reopen_badcase(badcase_id: str) -> dict[str, Any]:
        return ctx.badcases.reopen(badcase_id).model_dump(mode="json")


def _run_trace_item_payload(item: Any) -> dict[str, Any]:
    """生成 Run Trace 单条样本响应，分页前后共用同一份 wire shape。"""

    return {
        "item_id": item.item_id,
        "row_id": item.row_id,
        "row_index": item.row_index,
        "repeat_index": item.repeat_index,
        "status": item.status,
        "error": item.error,
        "metrics": item.metrics,
        "context_snapshot": item.context_snapshot,
        "steps": [step.model_dump(mode="json") for step in item.steps],
    }


def _paginate_payloads(records: list[dict[str, Any]], *, page: int, page_size: int) -> dict[str, Any]:
    """兼容式分页结构；未请求分页的旧接口仍直接返回数组。"""

    total_items = len(records)
    safe_page = max(page, 1)
    safe_page_size = min(max(page_size, 1), 100)
    start = (safe_page - 1) * safe_page_size
    return {
        "items": records[start : start + safe_page_size],
        "pagination": {
            "page": safe_page,
            "page_size": safe_page_size,
            "total_items": total_items,
            "total_pages": ceil(total_items / safe_page_size) if total_items else 0,
        },
    }
