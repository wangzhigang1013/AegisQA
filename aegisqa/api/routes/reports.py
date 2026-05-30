from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Query

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
            return {"run_id": run_id, "file_format": "html", "content": f"<html><body><h1>{run_id}</h1><pre>{payload}</pre></body></html>"}
        raise HTTPException(status_code=400, detail={"message": "file_format 仅支持 json/csv/html"})

    @app.get("/runs/{run_id}/trace")
    def get_run_trace(run_id: str) -> dict[str, Any]:
        run = ctx.runner.get_run(run_id)
        queue_shape = sorted(run.queue_messages[0].keys()) if run.queue_messages else []
        return {
            "run_id": run.run_id,
            "status": run.status,
            "workflow_version": run.workflow.version_id,
            "dataset_id": run.dataset_id,
            "dataset_version": run.dataset_version,
            "queue_message_shape": queue_shape,
            "items": [
                {
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
                for item in run.items
            ],
        }

    @app.get("/runs/{run_id}/trace-tree")
    def get_run_trace_tree(run_id: str) -> dict[str, Any]:
        return _build_trace_tree(ctx.runner.get_run(run_id))

    @app.post("/badcases")
    def create_badcase(request: BadcaseCreateRequest) -> dict[str, Any]:
        record = ctx.badcases.create_badcase(request.run_id, request.item_id, request.reason, request.payload)
        return record.model_dump(mode="json")

    @app.get("/badcases")
    def list_badcases(
        status: str | None = None,
        problem_type: str | None = None,
        reason: str | None = None,
        skill: str | None = None,
        query: str | None = None,
        min_score: float | None = Query(default=None),
        max_score: float | None = Query(default=None),
    ) -> list[dict[str, Any]]:
        records = ctx.badcases.filter_badcases(
            status=status,
            problem_type=problem_type,
            reason=reason,
            skill=skill,
            query=query,
            min_score=min_score,
            max_score=max_score,
        )
        return [record.model_dump(mode="json") for record in records]

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
