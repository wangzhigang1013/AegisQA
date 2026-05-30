"""AegisQA FastAPI 应用。

接口覆盖 PRD 的 REST 草案核心路径：Skill、Dataset、Workflow、Run、Report、
Badcase 和 Judge Audit。为了本地 MVP 简洁，上传接口同时提供 `from-path`
版本，便于在 Windows 桌面环境直接演示本地文件。
"""

from __future__ import annotations

import base64
from datetime import datetime, timezone
import json
from pathlib import Path, PurePosixPath
import re
from typing import Any
from uuid import uuid4
import zipfile

from fastapi import FastAPI, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
import yaml

from aegisqa.badcases.service import BadcaseService
from aegisqa.audit.service import AuditService
from aegisqa.core.errors import AegisQAError
from aegisqa.datasets.service import DatasetService
from aegisqa.engine.runner import RunRecord, RunRequest, WorkflowRunner
from aegisqa.judge.audit import JudgeAuditResult, audit_judge_profile
from aegisqa.judge.profiles import JudgeProfile, JudgeProfileService, StoredJudgeAudit
from aegisqa.reports.aggregator import RunReport, aggregate_run_report
from aegisqa.security.access import AccessControl
from aegisqa.skills.base import SkillManifest
from aegisqa.skills.packages import SubprocessPackageSkill
from aegisqa.skills.registry import SkillRegistry
from aegisqa.storage.json_store import JsonStore
from aegisqa.workflows.graph import WorkflowGraph, WorkflowGraphService, WorkflowGraphValidationResult
from aegisqa.workflows.models import WorkflowDraft, WorkflowVersion
from aegisqa.workflows.service import WorkflowService
from aegisqa.workflows.templates import WorkflowTemplate, WorkflowTemplateService


class DatasetFromPathRequest(BaseModel):
    name: str
    path: str
    golden: bool = False
    label_field: str | None = None
    answer_field: str | None = None


class DatasetUploadRequest(BaseModel):
    name: str
    filename: str
    content: str
    golden: bool = False
    label_field: str | None = None
    answer_field: str | None = None


class SourceMaterializeRequest(BaseModel):
    name: str
    rows: list[dict[str, Any]]
    golden: bool = False
    label_field: str | None = None
    answer_field: str | None = None


class RunCreateRequest(BaseModel):
    workflow: WorkflowVersion
    dataset_id: str
    dataset_version: int
    chunk_size: int | None = None
    concurrency: int | None = None
    sample_repeat_times: int | None = None
    rate_limits: dict[str, float] = Field(default_factory=dict)


class BadcaseCreateRequest(BaseModel):
    run_id: str
    item_id: str
    reason: str
    payload: dict[str, Any] = Field(default_factory=dict)


class BadcaseCorrectionRequest(BaseModel):
    human_label: str
    problem_type: str
    note: str = ""
    add_to_golden: bool = False
    ignore: bool = False


class JudgeAuditRequest(BaseModel):
    judge_profile_id: str
    dataset_version_id: str
    human_labels: list[str]
    judge_labels: list[str]
    positive_label: str = "pass"


class ProfileAuditRequest(BaseModel):
    dataset_version_id: str
    human_labels: list[str]
    judge_labels: list[str]
    positive_label: str = "pass"


class FieldTypeCorrectionRequest(BaseModel):
    field_type: str


class WorkflowCopyRequest(BaseModel):
    name: str | None = None


class JudgeProfileCreateRequest(BaseModel):
    name: str
    model: str
    prompt: str
    rubric: dict[str, Any]
    threshold: float
    output_schema: dict[str, Any]


class WorkflowGraphValidateRequest(BaseModel):
    graph: WorkflowGraph
    sample_row: dict[str, Any] | None = None


class WorkflowGraphPublishRequest(BaseModel):
    graph: WorkflowGraph


class WorkflowGraphDryRunRequest(BaseModel):
    graph: WorkflowGraph
    dataset_id: str
    dataset_version: int
    sample_size: int = 1


class WorkflowDraftCreateRequest(BaseModel):
    name: str
    graph: WorkflowGraph


class WorkflowDraftUpdateRequest(BaseModel):
    name: str | None = None
    graph: WorkflowGraph | None = None


class BadcaseBulkCorrectionRequest(BaseModel):
    badcase_ids: list[str]
    human_label: str
    problem_type: str
    note: str = ""
    add_to_golden: bool = False
    ignore: bool = False


class SkillGovernanceRequest(BaseModel):
    reason: str = ""


class SkillPackageUploadRequest(BaseModel):
    filename: str
    content_base64: str


class TaskCreateRequest(BaseModel):
    name: str
    dataset_id: str
    dataset_version: int
    workflow_version_id: str
    chunk_size: int | None = None
    concurrency: int | None = None
    sample_repeat_times: int | None = None
    max_retries: int | None = None
    retry_backoff_seconds: int | None = None
    cost_budget: float | None = None


class ExperimentFromRunRequest(BaseModel):
    run_id: str
    name: str
    baseline_run_id: str | None = None
    tags: list[str] = Field(default_factory=list)


class AssertionRuleRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    assertion_id: str
    type: str
    field_path: str
    expected: Any = None
    pattern: str | None = None
    min: float | None = None
    max: float | None = None
    json_schema: dict[str, Any] | None = Field(default=None, alias="schema")
    severity: str = "error"


class AssertionEvaluateRequest(BaseModel):
    payload: dict[str, Any]
    assertions: list[AssertionRuleRequest]


class CIGateRuleRequest(BaseModel):
    gate_id: str
    metric: str
    operator: str
    threshold: float
    blocking: bool = True


class CIGateEvaluateRequest(BaseModel):
    metrics: dict[str, float]
    gates: list[CIGateRuleRequest]


class AnnotationSeedRequest(BaseModel):
    run_id: str
    strategy: str = "failed_or_low_score"
    limit: int = 50
    assignee: str | None = None


class AnnotationAssignRequest(BaseModel):
    assignee: str


class AnnotationReviewRequest(BaseModel):
    human_label: str
    note: str = ""
    add_to_golden: bool = False


def create_app(store_root: Path | str = "data/aegisqa_store") -> FastAPI:
    """创建可测试、可嵌入的 FastAPI 应用。"""

    store = JsonStore(store_root)
    registry = SkillRegistry.with_builtin_skills()
    _load_skill_packages(store, registry)
    dataset_service = DatasetService(store)
    runner = WorkflowRunner(store, dataset_service, registry)
    badcases = BadcaseService(store)
    workflow_service = WorkflowService(store, registry)
    graph_service = WorkflowGraphService(registry)
    template_service = WorkflowTemplateService(registry)
    judge_profiles = JudgeProfileService(store)
    audit_service = AuditService(store)
    access_control = AccessControl()
    workflows: dict[str, WorkflowVersion] = {}

    app = FastAPI(title="AegisQA", version="0.1.0")
    app.state.store = store
    app.state.registry = registry
    app.state.dataset_service = dataset_service
    app.state.runner = runner
    app.state.badcases = badcases
    app.state.workflow_service = workflow_service
    app.state.graph_service = graph_service
    app.state.template_service = template_service
    app.state.judge_profiles = judge_profiles
    app.state.audit_service = audit_service
    app.state.access_control = access_control
    app.state.workflows = workflows

    @app.exception_handler(HTTPException)
    def http_error_handler(_: Any, exc: HTTPException) -> JSONResponse:
        code = "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR"
        details = exc.detail if isinstance(exc.detail, dict) else {}
        if isinstance(exc.detail, dict):
            code = str(exc.detail.get("code") or code)
            message = str(exc.detail.get("message") or code)
            details = exc.detail.get("details") if isinstance(exc.detail.get("details"), dict) else {key: value for key, value in exc.detail.items() if key not in {"code", "message"}}
        else:
            message = str(exc.detail)
        return JSONResponse(status_code=exc.status_code, content=_api_error(code, message, details))

    @app.exception_handler(AegisQAError)
    def aegisqa_error_handler(_: Any, exc: AegisQAError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=_api_error(exc.code, exc.message, exc.details))

    @app.exception_handler(KeyError)
    def key_error_handler(_: Any, exc: KeyError) -> JSONResponse:
        # KeyError 的 str(exc) 会额外包一层引号，API 响应要给前端稳定可展示的中文消息。
        message = str(exc.args[0]) if exc.args else "资源不存在"
        return JSONResponse(status_code=404, content=_api_error("NOT_FOUND", message))

    @app.exception_handler(ValueError)
    def value_error_handler(_: Any, exc: ValueError) -> JSONResponse:
        return JSONResponse(status_code=400, content=_api_error("BAD_REQUEST", str(exc)))

    @app.exception_handler(RequestValidationError)
    def validation_error_handler(_: Any, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content=_api_error("VALIDATION_ERROR", "请求参数校验失败", {"errors": exc.errors()}))

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "aegisqa"}

    @app.get("/dashboard/summary")
    def dashboard_summary() -> dict[str, Any]:
        runs = runner.list_runs()
        latest_run = runs[0] if runs else None
        latest_report = aggregate_run_report(latest_run) if latest_run else None
        return {
            "dataset_count": len(dataset_service.list_datasets()),
            "skill_count": len(registry.list_skills()),
            "workflow_count": len(workflow_service.list_versions()),
            "run_count": len(runs),
            "badcase_count": len(badcases.list_badcases()),
            "pass_rate": latest_report.pass_rate if latest_report else 0,
            "latest_run": latest_run.model_dump(mode="json") if latest_run else None,
        }

    @app.get("/skills", response_model=list[SkillManifest])
    def list_skills() -> list[SkillManifest]:
        return registry.list_skills()

    @app.get("/skills/packages")
    def list_skill_packages() -> list[dict[str, Any]]:
        return _list_records(store, "skill_packages")

    @app.post("/skills/packages/upload")
    def upload_skill_package(request: SkillPackageUploadRequest) -> dict[str, Any]:
        record = _install_skill_package(store, registry, request)
        audit_service.record(actor="api", action="skill_package.upload", target=record["manifest"]["skill_id"])
        return record

    @app.post("/skills/{skill_id:path}/contract-test")
    def run_skill_contract_test(skill_id: str) -> dict[str, Any]:
        result = registry.get(skill_id).contract_test()
        package = _find_skill_package(store, skill_id)
        if package:
            package["last_contract_ok"] = bool(result.get("ok"))
            package["last_contract_result"] = result
            package["updated_at"] = _now()
            _save_record(store, "skill_packages", "package_id", package)
        return {"skill_id": skill_id, **result}

    @app.post("/skills/{skill_id:path}/disable", response_model=SkillManifest)
    def disable_skill(skill_id: str, request: SkillGovernanceRequest) -> SkillManifest:
        manifest = registry.disable(skill_id, reason=request.reason)
        _update_skill_package_status(store, manifest)
        audit_service.record(actor="api", action="skill.disable", target=skill_id, detail={"reason": request.reason})
        return manifest

    @app.post("/skills/{skill_id:path}/approve", response_model=SkillManifest)
    def approve_skill(skill_id: str) -> SkillManifest:
        package = _find_skill_package(store, skill_id)
        if package and not package.get("last_contract_ok"):
            raise ValueError("插件包必须先通过合约测试，才能审批启用。")
        manifest = registry.approve(skill_id)
        _update_skill_package_status(store, manifest)
        audit_service.record(actor="api", action="skill.approve", target=skill_id)
        return manifest

    @app.post("/skills/{skill_id:path}/deprecate", response_model=SkillManifest)
    def deprecate_skill(skill_id: str, request: SkillGovernanceRequest) -> SkillManifest:
        manifest = registry.deprecate(skill_id, reason=request.reason)
        _update_skill_package_status(store, manifest)
        audit_service.record(actor="api", action="skill.deprecate", target=skill_id, detail={"reason": request.reason})
        return manifest

    @app.get("/datasets")
    def list_datasets() -> list[dict[str, Any]]:
        return dataset_service.list_datasets()

    @app.post("/datasets/from-path")
    def create_dataset_from_path(request: DatasetFromPathRequest) -> dict[str, Any]:
        path = Path(request.path)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"文件不存在：{request.path}")
        dataset = dataset_service.upload_dataset(
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
        upload_path = store.path("uploads", f"{request.name}{suffix}")
        upload_path.write_text(request.content, encoding="utf-8")
        dataset = dataset_service.upload_dataset(
            request.name,
            upload_path,
            golden=request.golden,
            label_field=request.label_field,
            answer_field=request.answer_field,
        )
        return dataset.model_dump(mode="json")

    @app.post("/datasets/source-materialize")
    def materialize_source_dataset(request: SourceMaterializeRequest) -> dict[str, Any]:
        dataset = dataset_service.materialize_source_rows(
            request.name,
            request.rows,
            golden=request.golden,
            label_field=request.label_field,
            answer_field=request.answer_field,
        )
        audit_service.record(actor="api", action="dataset.source_materialize", target=dataset.version_id, detail={"row_count": dataset.row_count})
        payload = dataset.model_dump(mode="json")
        payload["field_paths"] = [f"row.{field}" for field in sorted(dataset.field_schema)]
        return payload

    @app.get("/datasets/{dataset_id}/versions/{version}")
    def get_dataset(dataset_id: str, version: int) -> dict[str, Any]:
        try:
            return dataset_service.get_version(dataset_id, version).model_dump(mode="json")
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/datasets/{dataset_id}/versions/{version}/fields/{field_name}")
    def correct_field_type(dataset_id: str, version: int, field_name: str, request: FieldTypeCorrectionRequest) -> dict[str, Any]:
        dataset = dataset_service.correct_field_type(dataset_id, version, field_name, request.field_type)
        audit_service.record(actor="api", action="dataset.field_type.correct", target=f"{dataset_id}:v{version}:{field_name}", detail={"field_type": request.field_type})
        return dataset.model_dump(mode="json")

    @app.get("/workflow-templates", response_model=list[WorkflowTemplate])
    def list_workflow_templates() -> list[WorkflowTemplate]:
        return template_service.list_templates()

    @app.get("/workflows", response_model=list[WorkflowVersion])
    def list_workflows() -> list[WorkflowVersion]:
        return workflow_service.list_versions()

    @app.get("/workflow-drafts")
    def list_workflow_drafts() -> list[dict[str, Any]]:
        return _list_workflow_drafts(store)

    @app.post("/workflow-drafts")
    def create_workflow_draft(request: WorkflowDraftCreateRequest) -> dict[str, Any]:
        draft = {
            "draft_id": f"draft-{uuid4().hex[:12]}",
            "name": request.name,
            "status": "draft",
            "graph": request.graph.model_dump(mode="json"),
            "created_at": _now(),
            "updated_at": _now(),
        }
        _save_workflow_draft(store, draft)
        audit_service.record(actor="api", action="workflow_draft.create", target=draft["draft_id"])
        return draft

    @app.get("/workflow-drafts/{draft_id}")
    def get_workflow_draft(draft_id: str) -> dict[str, Any]:
        return _get_workflow_draft(store, draft_id)

    @app.put("/workflow-drafts/{draft_id}")
    def update_workflow_draft(draft_id: str, request: WorkflowDraftUpdateRequest) -> dict[str, Any]:
        draft = _get_workflow_draft(store, draft_id)
        if request.name is not None:
            draft["name"] = request.name
        if request.graph is not None:
            draft["graph"] = request.graph.model_dump(mode="json")
        draft["updated_at"] = _now()
        _save_workflow_draft(store, draft)
        audit_service.record(actor="api", action="workflow_draft.update", target=draft_id)
        return draft

    @app.delete("/workflow-drafts/{draft_id}")
    def delete_workflow_draft(draft_id: str) -> dict[str, Any]:
        draft = _get_workflow_draft(store, draft_id)
        draft["status"] = "deleted"
        draft["updated_at"] = _now()
        _save_workflow_draft(store, draft)
        audit_service.record(actor="api", action="workflow_draft.delete", target=draft_id)
        return draft

    @app.post("/workflow-drafts/{draft_id}/publish", response_model=WorkflowVersion)
    def publish_workflow_draft(draft_id: str) -> WorkflowVersion:
        draft = _get_workflow_draft(store, draft_id)
        graph = WorkflowGraph(**draft["graph"])
        graph.name = draft["name"]
        validation = graph_service.validate(graph)
        if not validation.ok:
            raise HTTPException(status_code=400, detail={"message": "Workflow Graph 校验失败", "errors": [error.model_dump(mode="json") for error in validation.errors]})
        version = workflow_service.publish(graph_service.to_workflow_draft(graph))
        workflows[version.version_id] = version
        draft["status"] = "published"
        draft["published_version_id"] = version.version_id
        draft["updated_at"] = _now()
        _save_workflow_draft(store, draft)
        audit_service.record(actor="api", action="workflow_draft.publish", target=draft_id, detail={"version_id": version.version_id})
        return version

    @app.post("/workflow-graphs/validate", response_model=WorkflowGraphValidationResult)
    def validate_workflow_graph(request: WorkflowGraphValidateRequest) -> WorkflowGraphValidationResult:
        return graph_service.validate(request.graph, sample_row=request.sample_row)

    @app.post("/workflow-graphs/publish", response_model=WorkflowVersion)
    def publish_workflow_graph(request: WorkflowGraphPublishRequest) -> WorkflowVersion:
        validation = graph_service.validate(request.graph)
        if not validation.ok:
            raise HTTPException(status_code=400, detail={"message": "Workflow Graph 校验失败", "errors": [error.model_dump(mode="json") for error in validation.errors]})
        version = workflow_service.publish(graph_service.to_workflow_draft(request.graph))
        workflows[version.version_id] = version
        audit_service.record(actor="api", action="workflow_graph.publish", target=version.version_id)
        return version

    @app.post("/workflow-graphs/dry-run", response_model=RunRecord)
    def dry_run_workflow_graph(request: WorkflowGraphDryRunRequest) -> RunRecord:
        validation = graph_service.validate(request.graph)
        if not validation.ok:
            raise HTTPException(status_code=400, detail={"message": "Workflow Graph 校验失败", "errors": [error.model_dump(mode="json") for error in validation.errors]})
        workflow = graph_service.to_workflow_draft(request.graph).publish()
        return runner.dry_run(workflow, request.dataset_id, request.dataset_version, sample_size=request.sample_size)

    @app.post("/workflows/publish", response_model=WorkflowVersion)
    def publish_workflow(draft: WorkflowDraft) -> WorkflowVersion:
        version = workflow_service.publish(draft)
        workflows[version.version_id] = version
        audit_service.record(actor="api", action="workflow.publish", target=version.version_id)
        return version

    @app.post("/workflows/{version_id:path}/copy")
    def copy_workflow(version_id: str, request: WorkflowCopyRequest) -> dict[str, Any]:
        draft = workflow_service.copy_workflow(version_id, name=request.name)
        audit_service.record(actor="api", action="workflow.copy", target=version_id, detail={"new_name": draft.name})
        return draft.model_dump(mode="json")

    @app.post("/workflows/{version_id:path}/archive", response_model=WorkflowVersion)
    def archive_workflow(version_id: str) -> WorkflowVersion:
        archived = workflow_service.archive(version_id)
        audit_service.record(actor="api", action="workflow.archive", target=version_id)
        return archived

    @app.get("/tasks")
    def list_tasks() -> list[dict[str, Any]]:
        return _list_records(store, "tasks")

    @app.post("/tasks")
    def create_task(request: TaskCreateRequest) -> dict[str, Any]:
        workflow = workflow_service.get(request.workflow_version_id)
        dataset = dataset_service.get_version(request.dataset_id, request.dataset_version)
        run = runner.create_run(
            RunRequest(
                workflow=workflow,
                dataset_id=dataset.dataset_id,
                dataset_version=dataset.version,
                chunk_size=request.chunk_size,
                concurrency=request.concurrency,
                sample_repeat_times=request.sample_repeat_times,
            )
        )
        execution_config = {
            "chunk_size": request.chunk_size,
            "concurrency": request.concurrency,
            "sample_repeat_times": request.sample_repeat_times,
            "retry": {
                "max_retries": request.max_retries,
                "backoff_seconds": request.retry_backoff_seconds,
            },
            "cost_budget": request.cost_budget,
        }
        task = _build_task_record(request.name, dataset.model_dump(mode="json"), workflow, run, execution_config=execution_config)
        _save_record(store, "tasks", "task_id", task)
        audit_service.record(actor="api", action="task.create", target=task["task_id"], detail={"run_id": run.run_id})
        return task

    @app.get("/tasks/{task_id}")
    def get_task(task_id: str) -> dict[str, Any]:
        return _get_record(store, "tasks", task_id)

    @app.post("/tasks/{task_id}/execute")
    def execute_task(task_id: str) -> dict[str, Any]:
        task = _get_record(store, "tasks", task_id)
        _ensure_task_action_allowed(task, "execute")
        run = runner.execute_run(task["run_id"])
        return _refresh_task_from_run(store, task, run)

    @app.post("/tasks/{task_id}/attempts")
    def create_task_attempt(task_id: str) -> dict[str, Any]:
        task = _get_record(store, "tasks", task_id)
        _ensure_task_can_create_attempt(task)
        workflow = workflow_service.get(task["workflow_version_id"])
        execution_config = task.get("execution_config", {})
        run = runner.create_run(
            RunRequest(
                workflow=workflow,
                dataset_id=task["dataset_id"],
                dataset_version=task["dataset_version"],
                chunk_size=execution_config.get("chunk_size"),
                concurrency=execution_config.get("concurrency"),
                sample_repeat_times=execution_config.get("sample_repeat_times"),
            )
        )
        attempts = _task_attempts(task)
        attempt_index = len(attempts) + 1
        task.update(
            {
                "run_id": run.run_id,
                "status": run.status,
                "total_items": run.total_items,
                "completed_items": 0,
                "failed_items": 0,
                "pass_rate": 0.0,
                "badcase_count": 0,
                "current_attempt": attempt_index,
                "attempts": attempts + [_build_attempt_record(run, attempt_index)],
                "updated_at": _now(),
            }
        )
        _save_record(store, "tasks", "task_id", task)
        audit_service.record(actor="api", action="task.attempt.create", target=task["task_id"], detail={"run_id": run.run_id, "attempt": attempt_index})
        return task

    @app.post("/tasks/{task_id}/pause")
    def pause_task(task_id: str) -> dict[str, Any]:
        task = _get_record(store, "tasks", task_id)
        _ensure_task_action_allowed(task, "pause")
        run = runner.pause_run(task["run_id"])
        return _refresh_task_from_run(store, task, run)

    @app.post("/tasks/{task_id}/resume")
    def resume_task(task_id: str) -> dict[str, Any]:
        task = _get_record(store, "tasks", task_id)
        _ensure_task_action_allowed(task, "resume")
        run = runner.resume_run(task["run_id"])
        return _refresh_task_from_run(store, task, run)

    @app.post("/tasks/{task_id}/cancel")
    def cancel_task(task_id: str) -> dict[str, Any]:
        task = _get_record(store, "tasks", task_id)
        _ensure_task_action_allowed(task, "cancel")
        run = runner.cancel_run(task["run_id"])
        return _refresh_task_from_run(store, task, run)

    @app.post("/tasks/{task_id}/retry-failed")
    def retry_failed_task(task_id: str) -> dict[str, Any]:
        task = _get_record(store, "tasks", task_id)
        _ensure_task_action_allowed(task, "retry")
        run = runner.retry_failed_items(task["run_id"])
        return _refresh_task_from_run(store, task, run)

    @app.get("/tasks/{task_id}/report")
    def get_task_report(task_id: str) -> dict[str, Any]:
        task = _get_record(store, "tasks", task_id)
        run = runner.get_run(task["run_id"])
        report = aggregate_run_report(run)
        return {
            "task": task,
            "task_summary": _build_task_report_summary(task, run),
            "version_snapshot": _build_task_report_version_snapshot(task, run),
            "step_distribution": _build_step_distribution(run),
            "judge_score_distribution": _build_judge_score_distribution(run),
            "report": report.model_dump(mode="json"),
            "badcases": [badcase.model_dump(mode="json") for badcase in report.badcases],
            "export_links": {
                "json": f"/runs/{task['run_id']}/report/export?file_format=json",
                "csv": f"/runs/{task['run_id']}/report/export?file_format=csv",
                "html": f"/runs/{task['run_id']}/report/export?file_format=html",
            },
        }

    @app.get("/tasks/{task_id}/trace-tree")
    def get_task_trace_tree(task_id: str) -> dict[str, Any]:
        task = _get_record(store, "tasks", task_id)
        return _build_trace_tree(runner.get_run(task["run_id"]))

    @app.post("/runs", response_model=RunRecord)
    def create_run(request: RunCreateRequest) -> RunRecord:
        return runner.create_run(
            RunRequest(
                workflow=request.workflow,
                dataset_id=request.dataset_id,
                dataset_version=request.dataset_version,
                chunk_size=request.chunk_size,
                concurrency=request.concurrency,
                sample_repeat_times=request.sample_repeat_times,
                rate_limits=request.rate_limits,
            )
        )

    @app.get("/runs", response_model=list[RunRecord])
    def list_runs() -> list[RunRecord]:
        return runner.list_runs()

    @app.post("/runs/{run_id}/execute", response_model=RunRecord)
    def execute_run(run_id: str) -> RunRecord:
        try:
            return runner.execute_run(run_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/runs/{run_id}/retry-failed", response_model=RunRecord)
    def retry_failed(run_id: str) -> RunRecord:
        return runner.retry_failed_items(run_id)

    @app.post("/runs/{run_id}/cancel", response_model=RunRecord)
    def cancel_run(run_id: str) -> RunRecord:
        return runner.cancel_run(run_id)

    @app.post("/runs/{run_id}/pause", response_model=RunRecord)
    def pause_run(run_id: str) -> RunRecord:
        audit_service.record(actor="api", action="run.pause", target=run_id)
        return runner.pause_run(run_id)

    @app.post("/runs/{run_id}/resume", response_model=RunRecord)
    def resume_run(run_id: str) -> RunRecord:
        audit_service.record(actor="api", action="run.resume", target=run_id)
        return runner.resume_run(run_id)

    @app.get("/runs/{run_id}", response_model=RunRecord)
    def get_run(run_id: str) -> RunRecord:
        return runner.get_run(run_id)

    @app.get("/runs/{run_id}/report", response_model=RunReport)
    def get_report(run_id: str) -> RunReport:
        return aggregate_run_report(runner.get_run(run_id))

    @app.get("/runs/{run_id}/report/export")
    def export_report(run_id: str, file_format: str = "json") -> dict[str, Any]:
        report = aggregate_run_report(runner.get_run(run_id))
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
        run = runner.get_run(run_id)
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
        return _build_trace_tree(runner.get_run(run_id))

    @app.post("/experiments/from-run")
    def create_experiment_from_run(request: ExperimentFromRunRequest) -> dict[str, Any]:
        run = runner.get_run(request.run_id)
        baseline = runner.get_run(request.baseline_run_id) if request.baseline_run_id else None
        experiment = _build_experiment_snapshot(run, name=request.name, baseline_run=baseline, tags=request.tags)
        _save_record(store, "experiments", "experiment_id", experiment)
        audit_service.record(actor="api", action="experiment.create", target=experiment["experiment_id"], detail={"run_id": run.run_id})
        return experiment

    @app.get("/experiments")
    def list_experiments() -> list[dict[str, Any]]:
        return _list_records(store, "experiments")

    @app.post("/assertions/evaluate")
    def evaluate_assertions(request: AssertionEvaluateRequest) -> dict[str, Any]:
        results = [_evaluate_assertion(request.payload, assertion) for assertion in request.assertions]
        return {
            "ok": all(item["status"] == "passed" for item in results),
            "summary": {"passed": sum(1 for item in results if item["status"] == "passed"), "failed": sum(1 for item in results if item["status"] == "failed")},
            "results": results,
        }

    @app.post("/ci-gates/evaluate")
    def evaluate_ci_gates(request: CIGateEvaluateRequest) -> dict[str, Any]:
        results = [_evaluate_gate(request.metrics, gate) for gate in request.gates]
        blocking_failures = [item for item in results if item["status"] == "failed" and item["blocking"]]
        return {
            "status": "blocked" if blocking_failures else "passed",
            "blocking_failures": len(blocking_failures),
            "results": results,
        }

    @app.post("/annotation-queue/seed-from-run")
    def seed_annotation_queue(request: AnnotationSeedRequest) -> dict[str, Any]:
        run = runner.get_run(request.run_id)
        created: list[dict[str, Any]] = []
        existing = {task.get("item_id") for task in _list_records(store, "annotation_tasks") if task.get("run_id") == run.run_id}
        for item in run.items:
            if len(created) >= request.limit:
                break
            if item.item_id in existing or not _needs_annotation(item.model_dump(mode="json"), strategy=request.strategy):
                continue
            task = _build_annotation_task(run.run_id, item.model_dump(mode="json"), assignee=request.assignee)
            _save_record(store, "annotation_tasks", "task_id", task)
            created.append(task)
        audit_service.record(actor="api", action="annotation_queue.seed", target=run.run_id, detail={"created_count": len(created)})
        return {"run_id": run.run_id, "created_count": len(created), "tasks": created}

    @app.get("/annotation-queue")
    def list_annotation_queue(status: str | None = None, assignee: str | None = None) -> list[dict[str, Any]]:
        tasks = _list_records(store, "annotation_tasks")
        if status:
            tasks = [task for task in tasks if task.get("status") == status]
        if assignee:
            tasks = [task for task in tasks if task.get("assignee") == assignee]
        return tasks

    @app.post("/annotation-queue/{task_id}/assign")
    def assign_annotation_task(task_id: str, request: AnnotationAssignRequest) -> dict[str, Any]:
        task = _get_record(store, "annotation_tasks", task_id)
        task["assignee"] = request.assignee
        task["status"] = "assigned"
        task["updated_at"] = _now()
        _save_record(store, "annotation_tasks", "task_id", task)
        audit_service.record(actor="api", action="annotation_task.assign", target=task_id, detail={"assignee": request.assignee})
        return task

    @app.post("/annotation-queue/{task_id}/review")
    def review_annotation_task(task_id: str, request: AnnotationReviewRequest) -> dict[str, Any]:
        task = _get_record(store, "annotation_tasks", task_id)
        task["status"] = "reviewed"
        task["review"] = {"human_label": request.human_label, "note": request.note, "add_to_golden": request.add_to_golden, "reviewed_at": _now()}
        task["updated_at"] = _now()
        _save_record(store, "annotation_tasks", "task_id", task)
        audit_service.record(actor="api", action="annotation_task.review", target=task_id, detail={"add_to_golden": request.add_to_golden})
        return task

    @app.post("/badcases")
    def create_badcase(request: BadcaseCreateRequest) -> dict[str, Any]:
        record = badcases.create_badcase(request.run_id, request.item_id, request.reason, request.payload)
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
        records = badcases.filter_badcases(
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
        return badcases.cluster_badcases(method=method, text_field=text_field, similarity_threshold=similarity_threshold)

    @app.get("/badcases/export")
    def export_badcases(file_format: str = "jsonl") -> dict[str, Any]:
        if file_format != "jsonl":
            raise HTTPException(status_code=400, detail={"message": "Badcase 导出当前仅支持 jsonl"})
        records = [record.model_dump(mode="json") for record in badcases.list_badcases()]
        content = "\n".join(json_dumps(record) for record in records)
        return {"file_format": "jsonl", "row_count": len(records), "content": content}

    @app.post("/badcases/bulk-correct")
    def bulk_correct_badcases(request: BadcaseBulkCorrectionRequest) -> list[dict[str, Any]]:
        records = badcases.bulk_correct(
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
        record = badcases.correct_badcase(
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
        return badcases.reopen(badcase_id).model_dump(mode="json")

    @app.post("/judge-audits", response_model=JudgeAuditResult)
    def create_judge_audit(request: JudgeAuditRequest) -> JudgeAuditResult:
        return audit_judge_profile(
            judge_profile_id=request.judge_profile_id,
            dataset_version_id=request.dataset_version_id,
            human_labels=request.human_labels,
            judge_labels=request.judge_labels,
            positive_label=request.positive_label,
        )

    @app.post("/judge-profiles", response_model=JudgeProfile)
    def create_judge_profile(request: JudgeProfileCreateRequest) -> JudgeProfile:
        profile = judge_profiles.create_profile(
            name=request.name,
            model=request.model,
            prompt=request.prompt,
            rubric=request.rubric,
            threshold=request.threshold,
            output_schema=request.output_schema,
        )
        audit_service.record(actor="api", action="judge_profile.create", target=profile.profile_id)
        return profile

    @app.get("/judge-profiles", response_model=list[JudgeProfile])
    def list_judge_profiles() -> list[JudgeProfile]:
        return judge_profiles.list_profiles()

    @app.get("/judge-profiles/{profile_id}", response_model=JudgeProfile)
    def get_judge_profile(profile_id: str) -> JudgeProfile:
        return judge_profiles.get_profile(profile_id)

    @app.post("/judge-profiles/{profile_id}/audits", response_model=StoredJudgeAudit)
    def audit_judge_profile_endpoint(profile_id: str, request: ProfileAuditRequest) -> StoredJudgeAudit:
        return judge_profiles.audit_and_store(
            profile_id,
            dataset_version_id=request.dataset_version_id,
            human_labels=request.human_labels,
            judge_labels=request.judge_labels,
            positive_label=request.positive_label,
        )

    @app.get("/judge-audits/{audit_id}/bias")
    def get_judge_bias(audit_id: str) -> dict[str, Any]:
        return judge_profiles.bias_analysis(audit_id)

    @app.get("/judge-audits", response_model=list[StoredJudgeAudit])
    def list_judge_audits() -> list[StoredJudgeAudit]:
        return judge_profiles.list_all_audits()

    @app.get("/access/check")
    def check_access(role: str, permission: str) -> dict[str, Any]:
        return {"role": role, "permission": permission, "allowed": access_control.can(role, permission)}

    @app.get("/audit-events")
    def list_audit_events() -> list[dict[str, Any]]:
        return [event.model_dump(mode="json") for event in audit_service.list_events()]

    return app


def _api_error(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "details": details or {},
        "trace_id": f"trace_{uuid4().hex[:12]}",
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _save_workflow_draft(store: JsonStore, draft: dict[str, Any]) -> None:
    store.write_json(["workflow_drafts", f"{draft['draft_id']}.json"], draft)


def _get_workflow_draft(store: JsonStore, draft_id: str) -> dict[str, Any]:
    payload = store.read_json(["workflow_drafts", f"{draft_id}.json"])
    if not payload:
        raise KeyError(f"Workflow 草稿不存在：{draft_id}")
    return payload


def _list_workflow_drafts(store: JsonStore) -> list[dict[str, Any]]:
    root = store.root / "workflow_drafts"
    if not root.exists():
        return []
    drafts = [json.loads(path.read_text(encoding="utf-8")) for path in sorted(root.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)]
    return [draft for draft in drafts if draft.get("status") != "deleted"]


def _save_record(store: JsonStore, collection: str, id_key: str, record: dict[str, Any]) -> None:
    store.write_json([collection, f"{record[id_key]}.json"], record)


def _get_record(store: JsonStore, collection: str, record_id: str) -> dict[str, Any]:
    payload = store.read_json([collection, f"{record_id}.json"])
    if not payload:
        raise KeyError(f"{collection} 记录不存在：{record_id}")
    return payload


def _list_records(store: JsonStore, collection: str) -> list[dict[str, Any]]:
    root = store.root / collection
    if not root.exists():
        return []
    return [json.loads(path.read_text(encoding="utf-8")) for path in sorted(root.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)]


def _install_skill_package(store: JsonStore, registry: SkillRegistry, request: SkillPackageUploadRequest) -> dict[str, Any]:
    try:
        raw = base64.b64decode(request.content_base64)
    except Exception as exc:  # noqa: BLE001 - API 边界需要返回稳定错误。
        raise AegisQAError("SKILL_PACKAGE_INVALID", "插件包内容不是合法 base64。") from exc
    package_id = f"pkg-{uuid4().hex[:12]}"
    package_dir = store.path("uploaded_skill_packages", package_id, "package")
    package_dir.mkdir(parents=True, exist_ok=True)
    zip_path = store.path("uploaded_skill_packages", package_id, request.filename)
    zip_path.write_bytes(raw)

    try:
        with zipfile.ZipFile(zip_path) as archive:
            _safe_extract_zip(archive, package_dir)
    except zipfile.BadZipFile as exc:
        raise AegisQAError("SKILL_PACKAGE_INVALID", "插件包必须是合法 zip 文件。") from exc

    manifest_path = _first_existing(package_dir, ["skill.yaml", "skill.yml", "skill.json"])
    handler_path = package_dir / "handler.py"
    if not manifest_path:
        raise AegisQAError("SKILL_PACKAGE_MANIFEST_MISSING", "插件包缺少 skill.yaml 或 skill.json。")
    if not handler_path.exists():
        raise AegisQAError("SKILL_PACKAGE_HANDLER_MISSING", "插件包缺少 handler.py。")

    manifest_payload = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
    manifest = SkillManifest(**manifest_payload)
    manifest.enabled = False
    manifest.status = "pending_review"
    registry.register(SubprocessPackageSkill(manifest, handler_path))
    record = {
        "package_id": package_id,
        "filename": request.filename,
        "status": manifest.status,
        "manifest": manifest.model_dump(mode="json"),
        "package_dir": str(package_dir),
        "handler_path": str(handler_path),
        "last_contract_ok": False,
        "last_contract_result": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    _save_record(store, "skill_packages", "package_id", record)
    return record


def _load_skill_packages(store: JsonStore, registry: SkillRegistry) -> None:
    for record in _list_records(store, "skill_packages"):
        handler_path = Path(record.get("handler_path", ""))
        if not handler_path.exists():
            continue
        manifest = SkillManifest(**record["manifest"])
        registry.register(SubprocessPackageSkill(manifest, handler_path))


def _find_skill_package(store: JsonStore, skill_id: str) -> dict[str, Any] | None:
    for record in _list_records(store, "skill_packages"):
        if record.get("manifest", {}).get("skill_id") == skill_id:
            return record
    return None


def _update_skill_package_status(store: JsonStore, manifest: SkillManifest) -> None:
    package = _find_skill_package(store, manifest.skill_id)
    if not package:
        return
    package["status"] = manifest.status
    package["manifest"] = manifest.model_dump(mode="json")
    package["updated_at"] = _now()
    _save_record(store, "skill_packages", "package_id", package)


def _safe_extract_zip(archive: zipfile.ZipFile, destination: Path) -> None:
    destination = destination.resolve()
    for member in archive.infolist():
        filename = member.filename.replace("\\", "/")
        parts = PurePosixPath(filename).parts
        if filename.startswith("/") or re.match(r"^[a-zA-Z]:", filename) or ".." in parts:
            raise AegisQAError(
                "SKILL_PACKAGE_INVALID_PATH",
                "插件包包含非法路径，禁止绝对路径或跨目录文件。",
                details={"filename": member.filename},
            )
        target = (destination / member.filename).resolve()
        if destination not in target.parents and target != destination:
            raise AegisQAError(
                "SKILL_PACKAGE_INVALID_PATH",
                "插件包包含非法路径，禁止绝对路径或跨目录文件。",
                details={"filename": member.filename},
            )
    archive.extractall(destination)


def _first_existing(root: Path, names: list[str]) -> Path | None:
    for name in names:
        candidate = root / name
        if candidate.exists():
            return candidate
    return None


def _build_task_record(name: str, dataset: dict[str, Any], workflow: WorkflowVersion, run: RunRecord, *, execution_config: dict[str, Any] | None = None) -> dict[str, Any]:
    now = _now()
    return {
        "task_id": f"task-{uuid4().hex[:12]}",
        "name": name,
        "dataset_id": dataset["dataset_id"],
        "dataset_name": dataset.get("name", dataset["dataset_id"]),
        "dataset_version": dataset["version"],
        "dataset_version_id": dataset.get("version_id"),
        "workflow_id": workflow.workflow_id,
        "workflow_name": workflow.name,
        "workflow_version_id": workflow.version_id,
        "run_id": run.run_id,
        "status": run.status,
        "total_items": run.total_items,
        "completed_items": 0,
        "failed_items": 0,
        "pass_rate": 0.0,
        "badcase_count": 0,
        "execution_config": execution_config or {},
        "current_attempt": 1,
        "attempts": [_build_attempt_record(run, 1)],
        "created_at": now,
        "updated_at": now,
    }


def _refresh_task_from_run(store: JsonStore, task: dict[str, Any], run: RunRecord) -> dict[str, Any]:
    report = aggregate_run_report(run)
    task.update(
        {
            "status": run.status,
            "total_items": run.total_items,
            "completed_items": report.completed_items,
            "failed_items": report.failed_items,
            "pass_rate": report.pass_rate,
            "badcase_count": len(report.badcases),
            "attempts": _replace_attempt_record(task, run, report),
            "updated_at": _now(),
        }
    )
    _save_record(store, "tasks", "task_id", task)
    return task


def _build_attempt_record(run: RunRecord, attempt_index: int, report: RunReport | None = None) -> dict[str, Any]:
    report = report or aggregate_run_report(run)
    return {
        "attempt_index": attempt_index,
        "run_id": run.run_id,
        "status": run.status,
        "total_items": run.total_items,
        "completed_items": report.completed_items,
        "failed_items": report.failed_items,
        "pass_rate": report.pass_rate,
        "badcase_count": len(report.badcases),
        "report": report.model_dump(mode="json"),
        "created_at": run.created_at,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
    }


def _task_attempts(task: dict[str, Any]) -> list[dict[str, Any]]:
    attempts = task.get("attempts")
    if isinstance(attempts, list) and attempts:
        return attempts
    return []


def _replace_attempt_record(task: dict[str, Any], run: RunRecord, report: RunReport) -> list[dict[str, Any]]:
    attempts = _task_attempts(task)
    attempt_index = int(task.get("current_attempt") or len(attempts) or 1)
    replacement = _build_attempt_record(run, attempt_index, report)
    replaced = False
    next_attempts: list[dict[str, Any]] = []
    for attempt in attempts:
        if attempt.get("run_id") == run.run_id:
            next_attempts.append(replacement)
            replaced = True
        else:
            next_attempts.append(attempt)
    if not replaced:
        next_attempts.append(replacement)
    return next_attempts


def _ensure_task_can_create_attempt(task: dict[str, Any]) -> None:
    """新建 Attempt 必须等当前执行实例结束，避免同一任务同时拥有两个活动 Run。"""

    status = str(task.get("status", "unknown"))
    if status in {"queued", "running", "paused"}:
        raise AegisQAError(
            "TASK_ATTEMPT_ACTIVE",
            "当前任务仍有活动执行实例，结束后才能创建新的 Attempt。",
            status_code=409,
            details={"task_id": task.get("task_id"), "current_status": status},
        )


def _build_task_report_summary(task: dict[str, Any], run: RunRecord) -> dict[str, Any]:
    return {
        "task_id": task["task_id"],
        "task_name": task["name"],
        "run_id": run.run_id,
        "status": task["status"],
        "dataset_name": task.get("dataset_name"),
        "workflow_name": task.get("workflow_name"),
        "sample_count": run.total_items,
        "current_attempt": task.get("current_attempt", 1),
        "created_at": task.get("created_at"),
        "updated_at": task.get("updated_at"),
    }


def _build_task_report_version_snapshot(task: dict[str, Any], run: RunRecord) -> dict[str, Any]:
    return {
        "dataset": {
            "dataset_id": task["dataset_id"],
            "version": task["dataset_version"],
            "version_id": task.get("dataset_version_id") or f"{task['dataset_id']}:v{task['dataset_version']}",
            "name": task.get("dataset_name"),
        },
        "workflow": {
            "workflow_id": task["workflow_id"],
            "version_id": task["workflow_version_id"],
            "name": task.get("workflow_name"),
            "step_count": len(run.workflow.steps),
        },
        "execution_config": task.get("execution_config", {}),
    }


def _build_step_distribution(run: RunRecord) -> list[dict[str, Any]]:
    by_step: dict[str, dict[str, Any]] = {}
    for item in run.items:
        for step in item.steps:
            bucket = by_step.setdefault(
                step.step_id,
                {
                    "step_id": step.step_id,
                    "skill_ref": step.skill_ref,
                    "total_calls": 0,
                    "succeeded": 0,
                    "failed": 0,
                    "cache_hits": 0,
                    "total_latency_ms": 0.0,
                },
            )
            bucket["total_calls"] += 1
            if step.status == "succeeded":
                bucket["succeeded"] += 1
            if step.status == "failed":
                bucket["failed"] += 1
            if step.cache_hit:
                bucket["cache_hits"] += 1
            bucket["total_latency_ms"] += step.latency_ms

    result = []
    for bucket in by_step.values():
        total_calls = bucket["total_calls"] or 1
        result.append(
            {
                **bucket,
                "average_latency_ms": bucket["total_latency_ms"] / total_calls,
            }
        )
    return sorted(result, key=lambda item: item["step_id"])


def _build_judge_score_distribution(run: RunRecord) -> list[dict[str, Any]]:
    buckets = {"0-0.6": 0, "0.6-0.8": 0, "0.8-1.0": 0}
    for item in run.items:
        score = item.metrics.get("judge_score")
        if not isinstance(score, (int, float)):
            continue
        if score < 0.6:
            buckets["0-0.6"] += 1
        elif score < 0.8:
            buckets["0.6-0.8"] += 1
        else:
            buckets["0.8-1.0"] += 1
    return [{"bucket": bucket, "count": count} for bucket, count in buckets.items()]


def _ensure_task_action_allowed(task: dict[str, Any], action: str) -> None:
    """保护 Task 状态机，避免重复执行或对终态任务做无意义动作。"""

    status = str(task.get("status", "unknown"))
    if action == "execute" and status == "completed":
        raise AegisQAError(
            "TASK_ALREADY_COMPLETED",
            "任务已经完成。请复制任务或创建新任务后重新执行，避免覆盖历史报告。",
            status_code=409,
            details={"task_id": task.get("task_id"), "current_status": status},
        )
    if action == "execute" and status == "running":
        raise AegisQAError(
            "TASK_ALREADY_RUNNING",
            "任务正在执行中，请等待当前执行结束。",
            status_code=409,
            details={"task_id": task.get("task_id"), "current_status": status},
        )

    allowed_statuses = {
        "execute": {"queued", "failed", "paused"},
        "pause": {"queued", "running"},
        "resume": {"paused"},
        "cancel": {"queued", "running", "paused", "failed"},
        "retry": {"failed"},
    }
    if status not in allowed_statuses.get(action, set()):
        raise AegisQAError(
            "TASK_ACTION_INVALID",
            "当前任务状态不允许执行该操作。",
            status_code=409,
            details={"task_id": task.get("task_id"), "action": action, "current_status": status},
        )


def _build_experiment_snapshot(run: RunRecord, *, name: str, baseline_run: RunRecord | None, tags: list[str]) -> dict[str, Any]:
    report = aggregate_run_report(run)
    baseline_report = aggregate_run_report(baseline_run) if baseline_run else None
    # Experiment 要保存不可变上下文，后续对 Workflow/Skill/Prompt 的修改不能改变历史结论。
    prompt_skill_versions = [
        {
            "step_id": step.step_id,
            "skill_ref": step.skill_ref,
            "prompt_version": step.config.get("prompt_version") or step.config.get("prompt") or "inline-config",
            "model": step.config.get("model"),
            "model_params": {key: step.config.get(key) for key in ("temperature", "threshold", "top_p") if key in step.config},
        }
        for step in run.workflow.steps
    ]
    metrics = report.metrics | {"pass_rate": report.pass_rate, "error_rate": report.error_rate, "badcase_count": len(report.badcases)}
    baseline_metrics = None
    diff = None
    if baseline_report:
        baseline_metrics = baseline_report.metrics | {"pass_rate": baseline_report.pass_rate, "error_rate": baseline_report.error_rate, "badcase_count": len(baseline_report.badcases)}
        diff = {key: metrics.get(key, 0) - baseline_metrics.get(key, 0) for key in sorted(set(metrics) | set(baseline_metrics))}
    return {
        "experiment_id": f"exp-{uuid4().hex[:12]}",
        "name": name,
        "run_id": run.run_id,
        "baseline_run_id": baseline_run.run_id if baseline_run else None,
        "status": "snapshotted",
        "tags": tags,
        "snapshot": {
            "workflow_version": run.workflow.version_id,
            "workflow_hash": run.snapshot.get("workflow_hash"),
            "dataset_version": run.snapshot.get("dataset_version"),
            "skill_versions": run.snapshot.get("skill_versions", []),
            "prompt_skill_versions": prompt_skill_versions,
            "runtime": run.snapshot.get("runtime", {}),
        },
        "metrics": metrics,
        "baseline_metrics": baseline_metrics,
        "diff": diff,
        "created_at": _now(),
    }


def _build_trace_tree(run: RunRecord) -> dict[str, Any]:
    return {
        "run_id": run.run_id,
        "status": run.status,
        "workflow_version": run.workflow.version_id,
        "dataset_version": run.snapshot.get("dataset_version"),
        "items": [
            {
                "item_id": item.item_id,
                "row_id": item.row_id,
                "status": item.status,
                "metrics": item.metrics,
                "error": item.error,
                "children": [
                    {
                        "step_id": step.step_id,
                        "skill_ref": step.skill_ref,
                        "status": step.status,
                        "latency_ms": step.latency_ms,
                        "cache_hit": step.cache_hit,
                        "rate_limit_wait_ms": step.rate_limit_wait_ms,
                        "input": step.input_snapshot,
                        "output": step.output_snapshot,
                        "metrics": step.metrics,
                        "error": step.error,
                    }
                    for step in item.steps
                ],
            }
            for item in run.items
        ],
    }


def _evaluate_assertion(payload: dict[str, Any], assertion: AssertionRuleRequest) -> dict[str, Any]:
    value = _get_by_path(payload, assertion.field_path)
    passed = False
    message = ""
    if assertion.type == "contains":
        passed = str(assertion.expected) in str(value)
        message = f"字段 {assertion.field_path} {'包含' if passed else '未包含'} {assertion.expected}"
    elif assertion.type == "regex":
        passed = bool(re.search(assertion.pattern or "", str(value)))
        message = f"字段 {assertion.field_path} {'匹配' if passed else '未匹配'} 正则 {assertion.pattern}"
    elif assertion.type in {"latency", "cost", "similarity"}:
        passed = _check_numeric_range(value, min_value=assertion.min, max_value=assertion.max)
        message = f"字段 {assertion.field_path} 数值 {value} {'满足' if passed else '不满足'}范围约束"
    elif assertion.type == "json_schema":
        schema_type = (assertion.json_schema or {}).get("type")
        passed = schema_type is None or _json_type(value) == schema_type
        message = f"字段 {assertion.field_path} {'符合' if passed else '不符合'} JSON Schema 基础类型"
    elif assertion.type == "safety":
        banned = [str(item) for item in (assertion.expected or [])]
        passed = not any(word in str(value) for word in banned)
        message = f"字段 {assertion.field_path} {'未命中' if passed else '命中'}安全拦截词"
    else:
        message = f"未知断言类型：{assertion.type}"
    return {
        "assertion_id": assertion.assertion_id,
        "type": assertion.type,
        "field_path": assertion.field_path,
        "status": "passed" if passed else "failed",
        "actual": value,
        "message": message,
        "severity": assertion.severity,
    }


def _evaluate_gate(metrics: dict[str, float], gate: CIGateRuleRequest) -> dict[str, Any]:
    actual = float(metrics.get(gate.metric, 0))
    passed = _compare(actual, gate.operator, gate.threshold)
    return {
        "gate_id": gate.gate_id,
        "metric": gate.metric,
        "operator": gate.operator,
        "threshold": gate.threshold,
        "actual": actual,
        "blocking": gate.blocking,
        "status": "passed" if passed else "failed",
        "message": (
            f"质量门禁通过：{gate.metric}={actual} {gate.operator} {gate.threshold}"
            if passed
            else f"质量门禁未通过：{gate.metric}={actual} 不满足 {gate.operator} {gate.threshold}"
        ),
    }


def _needs_annotation(item: dict[str, Any], *, strategy: str) -> bool:
    if strategy == "all":
        return True
    metrics = item.get("metrics", {})
    judge_score = metrics.get("judge_score")
    label = item.get("context_snapshot", {}).get("context", {}).get("judge_label")
    return item.get("status") == "failed" or label == "fail" or (isinstance(judge_score, (int, float)) and judge_score < 0.6)


def _build_annotation_task(run_id: str, item: dict[str, Any], *, assignee: str | None) -> dict[str, Any]:
    return {
        "task_id": f"anno-{uuid4().hex[:12]}",
        "run_id": run_id,
        "item_id": item["item_id"],
        "row_id": item["row_id"],
        "status": "assigned" if assignee else "pending",
        "assignee": assignee,
        "priority": "high" if item.get("status") == "failed" else "normal",
        "reason": item.get("error", {}).get("message") if item.get("error") else "低分或失败样本需要人工复核",
        "payload": {
            "metrics": item.get("metrics", {}),
            "context_snapshot": item.get("context_snapshot", {}),
            "steps": item.get("steps", []),
        },
        "review": None,
        "created_at": _now(),
        "updated_at": _now(),
    }


def _get_by_path(payload: dict[str, Any], field_path: str) -> Any:
    current: Any = payload
    for part in field_path.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return None
    return current


def _check_numeric_range(value: Any, *, min_value: float | None, max_value: float | None) -> bool:
    if not isinstance(value, (int, float)):
        return False
    if min_value is not None and value < min_value:
        return False
    if max_value is not None and value > max_value:
        return False
    return True


def _compare(actual: float, operator: str, threshold: float) -> bool:
    if operator == ">=":
        return actual >= threshold
    if operator == ">":
        return actual > threshold
    if operator == "<=":
        return actual <= threshold
    if operator == "<":
        return actual < threshold
    if operator == "==":
        return actual == threshold
    raise ValueError(f"不支持的质量门禁操作符：{operator}")


def _json_type(value: Any) -> str:
    if isinstance(value, dict):
        return "object"
    if isinstance(value, list):
        return "array"
    if isinstance(value, str):
        return "string"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if value is None:
        return "null"
    return "unknown"


def json_dumps(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


app = create_app()
