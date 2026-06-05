"""AegisQA FastAPI 应用。

接口覆盖 PRD 的 REST 草案核心路径：Skill、Dataset、Workflow、Run、Report、
Badcase 和 Judge Audit。为了本地 MVP 简洁，上传接口同时提供 `from-path`
版本，便于在 Windows 桌面环境直接演示本地文件。
"""

from __future__ import annotations

import base64
from datetime import datetime, timezone
import json
from math import ceil
import os
from pathlib import Path, PurePosixPath
import re
from typing import Any
from uuid import uuid4
import zipfile

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
import yaml

from aegisqa.badcases.service import BadcaseService
from aegisqa.audit.service import AuditService
from aegisqa.core.errors import AegisQAError
from aegisqa.core.features import FEATURE_ENV_PREFIX, FEATURE_FLAG_DEFAULTS, load_feature_flags
from aegisqa.datasets.service import DatasetService
from aegisqa.engine.runner import RunRecord, RunRequest, WorkflowRunner
from aegisqa.engine.task_executor import TaskExecutor, create_task_executor
from aegisqa.judge.audit import JudgeAuditResult, audit_judge_profile
from aegisqa.judge.profiles import JudgeProfile, JudgeProfileService, StoredJudgeAudit
from aegisqa.models.gateway import load_model_gateway_config_from_store
from aegisqa.reports.aggregator import RunReport, aggregate_run_report
from aegisqa.security.access import AccessControl
from aegisqa.skills.base import SkillManifest
from aegisqa.skills.agent_skills import load_agent_skills_from_store
from aegisqa.skills.packages import (
    InstructionPackageSkill,
    SubprocessPackageSkill,
    build_instruction_manifest_from_skill_md,
    resolve_package_entrypoint,
)
from aegisqa.skills.registry import SkillRegistry
from aegisqa.storage.artifacts import LocalArtifactStore
from aegisqa.storage.json_store import JsonStore
from aegisqa.storage.mysql_store import ConnectionFactory, MySQLStore
from aegisqa.storage.repositories import RepositoryRegistry
from aegisqa.storage.sqlite_store import SQLiteStore
from aegisqa.workflows.graph import WorkflowGraph, WorkflowGraphService, WorkflowGraphValidationResult
from aegisqa.workflows.models import WorkflowDraft, WorkflowVersion
from aegisqa.workflows.service import WorkflowService
from aegisqa.workflows.templates import WorkflowTemplate, WorkflowTemplateService


MAX_SKILL_PACKAGE_FILES = 200
MAX_SKILL_PACKAGE_FILE_BYTES = 1_000_000
MAX_SKILL_PACKAGE_TOTAL_BYTES = 1_500_000
SKILL_PACKAGE_DEPENDENCY_FILES = {"requirements.txt", "pyproject.toml"}
SKILL_PACKAGE_EXECUTABLE_SUFFIXES = {".bat", ".bin", ".cmd", ".dll", ".dylib", ".exe", ".sh", ".so"}
SKILL_PACKAGE_TEXT_SUFFIXES = {".json", ".md", ".py", ".txt", ".yaml", ".yml"}
SKILL_PACKAGE_DIRECT_MODEL_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bimport\s+(openai|anthropic|cohere|boto3)\b",
        r"\bfrom\s+(openai|anthropic|cohere|boto3)\s+import\b",
        r"\bimport\s+google\.generativeai\b",
        r"\b(OpenAI|Anthropic)\s*\(",
    )
]
SKILL_PACKAGE_API_KEY_PATTERN = re.compile(r"(?<![A-Za-z0-9])sk-[A-Za-z0-9_\-]{12,}")


class DatasetFromPathRequest(BaseModel):
    name: str
    path: str
    golden: bool = False
    label_field: str | None = None
    answer_field: str | None = None
    actor: str = "api"
    role: str = "Evaluator"


class DatasetUploadRequest(BaseModel):
    name: str
    filename: str
    content: str
    golden: bool = False
    label_field: str | None = None
    answer_field: str | None = None
    actor: str = "api"
    role: str = "Evaluator"


class SourceMaterializeRequest(BaseModel):
    name: str
    rows: list[dict[str, Any]]
    golden: bool = False
    label_field: str | None = None
    answer_field: str | None = None
    actor: str = "api"
    role: str = "Evaluator"


class DatasetRepairVersionRequest(BaseModel):
    drop_duplicate_rows: bool = True
    fill_missing: dict[str, Any] = Field(default_factory=dict)
    reason: str = ""
    actor: str = "api"
    role: str = "Evaluator"


class RunCreateRequest(BaseModel):
    workflow: WorkflowVersion
    dataset_id: str
    dataset_version: int
    chunk_size: int | None = None
    concurrency: int | None = None
    sample_repeat_times: int | None = None
    rate_limits: dict[str, float] = Field(default_factory=dict)
    actor: str = "api"
    role: str = "Evaluator"


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
    actor: str = "api"
    role: str = "Reviewer"


class ProfileAuditRequest(BaseModel):
    dataset_version_id: str
    human_labels: list[str]
    judge_labels: list[str]
    positive_label: str = "pass"
    actor: str = "api"
    role: str = "Reviewer"


class JudgeCrossValidationRequest(BaseModel):
    dataset_version_id: str
    human_labels: list[str]
    judge_outputs_by_profile: dict[str, list[str]]


class FieldTypeCorrectionRequest(BaseModel):
    field_type: str
    actor: str = "api"
    role: str = "Evaluator"


class WorkflowCopyRequest(BaseModel):
    name: str | None = None
    actor: str = "api"
    role: str = "Evaluator"


class JudgeProfileCreateRequest(BaseModel):
    name: str
    model: str
    prompt: str
    rubric: dict[str, Any]
    threshold: float
    output_schema: dict[str, Any]
    actor: str = "api"
    role: str = "Reviewer"


class WorkflowGraphValidateRequest(BaseModel):
    graph: WorkflowGraph
    sample_row: dict[str, Any] | None = None


class WorkflowGraphPublishRequest(BaseModel):
    graph: WorkflowGraph
    actor: str = "api"
    role: str = "Evaluator"


class WorkflowGraphDryRunRequest(BaseModel):
    graph: WorkflowGraph
    dataset_id: str
    dataset_version: int
    sample_size: int = 1


class WorkflowParameterPreviewRequest(BaseModel):
    graph: WorkflowGraph
    sample_row: dict[str, Any]
    task_overrides: dict[str, dict[str, Any]] = Field(default_factory=dict)


class WorkflowDraftCreateRequest(BaseModel):
    name: str
    graph: WorkflowGraph
    actor: str = "api"
    role: str = "Evaluator"


class WorkflowDraftUpdateRequest(BaseModel):
    name: str | None = None
    graph: WorkflowGraph | None = None
    actor: str = "api"
    role: str = "Evaluator"


class BadcaseBulkCorrectionRequest(BaseModel):
    badcase_ids: list[str]
    human_label: str
    problem_type: str
    note: str = ""
    add_to_golden: bool = False
    ignore: bool = False


class SkillGovernanceRequest(BaseModel):
    reason: str = ""
    actor: str = "api"
    role: str = "Skill Developer"


class SkillPackageUploadRequest(BaseModel):
    filename: str
    content_base64: str
    actor: str = "api"
    role: str = "Skill Developer"


class TaskCreateRequest(BaseModel):
    name: str
    dataset_id: str
    dataset_version: int
    workflow_version_id: str
    execution_template_id: str | None = None
    evaluation_goal: str | None = None
    quality_gate: dict[str, Any] = Field(default_factory=dict)
    preflight_id: str | None = None
    preflight_result: dict[str, Any] | None = None
    chunk_size: int | None = None
    concurrency: int | None = None
    sample_repeat_times: int | None = None
    max_retries: int | None = None
    retry_backoff_seconds: int | None = None
    cost_budget: float | None = None
    skill_overrides: dict[str, dict[str, Any]] = Field(default_factory=dict)
    allow_blocked_preflight: bool = False
    actor: str = "api"
    role: str = "Evaluator"


class TaskExecutionTemplateCreateRequest(BaseModel):
    name: str
    description: str = ""
    evaluation_goal: str | None = None
    quality_gate: dict[str, Any] = Field(default_factory=dict)
    execution_config: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    actor: str = "api"
    role: str = "Evaluator"


class TaskPreflightRequest(BaseModel):
    dataset_id: str
    dataset_version: int
    workflow_version_id: str
    execution_template_id: str | None = None
    evaluation_goal: str | None = None
    quality_gate: dict[str, Any] = Field(default_factory=dict)
    cost_budget: float | None = None
    sample_repeat_times: int | None = None
    skill_overrides: dict[str, dict[str, Any]] = Field(default_factory=dict)
    actor: str = "api"
    role: str = "Evaluator"


class ReportExportRequestCreate(BaseModel):
    file_format: str = "json"
    requester_role: str = "Viewer"
    actor: str = "api"
    reason: str = ""
    expires_at: str | None = None


class ReportExportApprovalRequest(BaseModel):
    approver_role: str = "Admin"
    actor: str = "api"
    note: str = ""


class ReportExportRevokeRequest(BaseModel):
    requester_role: str = "Viewer"
    actor: str = "api"
    reason: str = ""


class RepairTaskStartRequest(BaseModel):
    owner: str
    role: str = "Evaluator"
    actor: str = "api"


class RepairTaskAssignRequest(BaseModel):
    owner: str
    due_at: str | None = None
    role: str = "Evaluator"
    actor: str = "api"


class RepairTaskResolveRequest(BaseModel):
    resolution_note: str
    role: str = "Evaluator"
    actor: str = "api"


class RepairTaskReopenRequest(BaseModel):
    reason: str
    role: str = "Evaluator"
    actor: str = "api"


class RepairTaskActionRequest(BaseModel):
    action: str
    assignee: str | None = None
    limit: int = 20
    role: str = "Evaluator"
    actor: str = "api"


class ExperimentFromRunRequest(BaseModel):
    run_id: str
    name: str
    baseline_run_id: str | None = None
    tags: list[str] = Field(default_factory=list)
    actor: str = "api"
    role: str = "Evaluator"


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


class CIGateConfigRequest(BaseModel):
    name: str
    description: str = ""
    gates: list[CIGateRuleRequest]
    status: str = "active"
    actor: str = "api"
    role: str = "Evaluator"


class CIGateEvaluateRequest(BaseModel):
    metrics: dict[str, float] = Field(default_factory=dict)
    gates: list[CIGateRuleRequest] = Field(default_factory=list)
    config_id: str | None = None
    run_id: str | None = None
    task_id: str | None = None
    actor: str = "api"
    role: str = "Evaluator"


class AnnotationSeedRequest(BaseModel):
    run_id: str
    strategy: str = "failed_or_low_score"
    limit: int = 50
    assignee: str | None = None
    actor: str = "api"
    role: str = "Evaluator"


class AnnotationDispatchAssigneeRequest(BaseModel):
    assignee: str
    capacity: int = Field(default=5, ge=1)
    labels: list[str] = Field(default_factory=list)


class AnnotationDispatchRequest(BaseModel):
    assignees: list[AnnotationDispatchAssigneeRequest]
    label_field: str | None = "scene"
    sla_hours: int = Field(default=48, ge=1, le=720)
    overdue_strategy: str = "oldest_first"
    actor: str = "api"
    role: str = "Evaluator"


class AnnotationAssignRequest(BaseModel):
    assignee: str
    actor: str = "api"
    role: str = "Evaluator"


class AnnotationReviewRequest(BaseModel):
    human_label: str
    note: str = ""
    add_to_golden: bool = False
    actor: str = "api"
    role: str = "Evaluator"


class AnnotationBulkReviewRequest(AnnotationReviewRequest):
    task_ids: list[str]


class RedTeamScanRequest(BaseModel):
    task_id: str | None = None
    run_id: str | None = None
    actor: str = "api"
    role: str = "Evaluator"


def create_app(
    store_root: Path | str = "data/aegisqa_store",
    *,
    storage_backend: str | None = None,
    mysql_connection_factory: ConnectionFactory | None = None,
    task_executor: TaskExecutor | None = None,
    task_executor_backend: str | None = None,
) -> FastAPI:
    """创建可测试、可嵌入的 FastAPI 应用。"""

    if str(store_root) == "data/aegisqa_store":
        store_root = os.getenv("AEGISQA_STORE_ROOT", str(store_root))
    resolved_storage_backend = (storage_backend or os.getenv("AEGISQA_STORAGE_BACKEND") or "json").lower()
    store = _create_store(store_root, storage_backend=resolved_storage_backend, mysql_connection_factory=mysql_connection_factory)
    artifact_store = LocalArtifactStore(Path(store.root) / "artifacts")
    repositories = RepositoryRegistry(store)
    setattr(store, "repositories", repositories)
    # 模型网关配置允许通过前端保存，本地 store 中有记录时要在启动阶段恢复到运行期。
    load_model_gateway_config_from_store(store)
    registry = SkillRegistry.with_builtin_skills()
    _load_skill_packages(store, registry)
    load_agent_skills_from_store(store, registry)
    dataset_service = DatasetService(store)
    runner = WorkflowRunner(store, dataset_service, registry, run_repository=repositories.runs)
    task_executor = create_task_executor(
        task_executor=task_executor,
        backend=task_executor_backend,
        store_root=store.root,
        storage_backend=resolved_storage_backend,
    )
    badcases = BadcaseService(store)
    workflow_service = WorkflowService(store, registry, workflow_repository=repositories.workflows)
    graph_service = WorkflowGraphService(registry)
    template_service = WorkflowTemplateService(registry)
    judge_profiles = JudgeProfileService(store)
    audit_service = AuditService(store, audit_repository=repositories.audit_events)
    access_control = AccessControl()
    workflows: dict[str, WorkflowVersion] = {}

    app = FastAPI(title="AegisQA", version="0.1.0")
    app.state.store = store
    app.state.artifact_store = artifact_store
    app.state.repositories = repositories
    app.state.storage_backend = resolved_storage_backend
    app.state.registry = registry
    app.state.dataset_service = dataset_service
    app.state.runner = runner
    app.state.task_executor = task_executor
    app.state.badcases = badcases
    app.state.workflow_service = workflow_service
    app.state.graph_service = graph_service
    app.state.template_service = template_service
    app.state.judge_profiles = judge_profiles
    app.state.audit_service = audit_service
    app.state.access_control = access_control
    app.state.workflows = workflows

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next: Any) -> Any:
        trace_id = request.headers.get("X-AegisQA-Request-ID") or f"trace_{uuid4().hex[:12]}"
        request.state.request_id = trace_id
        response = await call_next(request)
        response.headers["X-AegisQA-Request-ID"] = trace_id
        return response

    @app.exception_handler(HTTPException)
    def http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
        code = "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR"
        details = exc.detail if isinstance(exc.detail, dict) else {}
        if isinstance(exc.detail, dict):
            code = str(exc.detail.get("code") or code)
            message = str(exc.detail.get("message") or code)
            details = exc.detail.get("details") if isinstance(exc.detail.get("details"), dict) else {key: value for key, value in exc.detail.items() if key not in {"code", "message"}}
        else:
            message = str(exc.detail)
        return _error_response(request, exc.status_code, code, message, details)

    @app.exception_handler(AegisQAError)
    def aegisqa_error_handler(request: Request, exc: AegisQAError) -> JSONResponse:
        return _error_response(request, exc.status_code, exc.code, exc.message, exc.details)

    @app.exception_handler(KeyError)
    def key_error_handler(request: Request, exc: KeyError) -> JSONResponse:
        # KeyError 的 str(exc) 会额外包一层引号，API 响应要给前端稳定可展示的中文消息。
        message = str(exc.args[0]) if exc.args else "资源不存在"
        return _error_response(request, 404, "NOT_FOUND", message)

    @app.exception_handler(ValueError)
    def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
        return _error_response(request, 400, "BAD_REQUEST", str(exc))

    @app.exception_handler(RequestValidationError)
    def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return _error_response(request, 422, "VALIDATION_ERROR", "请求参数校验失败", {"errors": exc.errors()})

    @app.get("/")
    def root() -> dict[str, Any]:
        """给误打开后端端口的用户一个明确入口说明。"""

        return {
            "name": "AegisQA",
            "status": "ok",
            "message": "后端 API 已启动。请打开前端工作台或 API 文档继续使用。",
            "frontend_url": "http://localhost:5173",
            "docs_url": "/docs",
            "health_url": "/health",
            "storage_backend": app.state.storage_backend,
        }

    @app.get("/features")
    def features() -> dict[str, Any]:
        return {
            "flags": load_feature_flags(),
            "defaults": FEATURE_FLAG_DEFAULTS,
            "env_prefix": FEATURE_ENV_PREFIX,
        }

    from aegisqa.api.routes import (
        register_agent_skill_routes,
        register_dataset_routes,
        register_governance_routes,
        register_judge_routes,
        register_model_routes,
        register_productization_routes,
        register_repair_task_routes,
        register_report_routes,
        register_skill_routes,
        register_task_lifecycle_routes,
        register_task_preflight_routes,
        register_task_report_routes,
        register_task_routes,
        register_workflow_routes,
    )
    from aegisqa.api.routes.context import RouteContext

    route_context = RouteContext(
        store=store,
        repositories=repositories,
        registry=registry,
        audit_service=audit_service,
        dataset_service=dataset_service,
        template_service=template_service,
        workflow_service=workflow_service,
        graph_service=graph_service,
        runner=runner,
        task_executor=task_executor,
        badcases=badcases,
        judge_profiles=judge_profiles,
        access_control=access_control,
        workflows=workflows,
    )
    # 先注册更具体的 Run Report/Trace 路由，再注册 /runs/{run_id}，避免路径匹配被泛化路由截获。
    register_governance_routes(app, route_context)
    register_model_routes(app, route_context)
    register_agent_skill_routes(app, route_context)
    register_skill_routes(app, route_context)
    register_dataset_routes(app, route_context)
    register_workflow_routes(app, route_context)
    register_report_routes(app, route_context)
    register_task_preflight_routes(app, route_context)
    register_task_lifecycle_routes(app, route_context)
    register_repair_task_routes(app, route_context)
    register_task_report_routes(app, route_context)
    register_task_routes(app, route_context)
    register_productization_routes(app, route_context)
    register_judge_routes(app, route_context)

    return app


def _create_store(store_root: Path | str, *, storage_backend: str | None = None, mysql_connection_factory: ConnectionFactory | None = None) -> JsonStore | SQLiteStore | MySQLStore:
    backend = (storage_backend or os.getenv("AEGISQA_STORAGE_BACKEND") or "json").lower()
    if backend == "json":
        return JsonStore(store_root)
    if backend == "sqlite":
        return SQLiteStore(store_root)
    if backend == "mysql":
        return MySQLStore(store_root, connection_factory=mysql_connection_factory)
    raise ValueError(f"不支持的存储后端：{backend}")


def _error_response(request: Request, status_code: int, code: str, message: str, details: dict[str, Any] | None = None) -> JSONResponse:
    trace_id = str(getattr(request.state, "request_id", "") or f"trace_{uuid4().hex[:12]}")
    response = JSONResponse(status_code=status_code, content=_api_error(code, message, details, trace_id=trace_id))
    response.headers["X-AegisQA-Request-ID"] = trace_id
    return response


def _api_error(code: str, message: str, details: dict[str, Any] | None = None, *, trace_id: str | None = None) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "details": details or {},
        "trace_id": trace_id or f"trace_{uuid4().hex[:12]}",
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


def _list_workflow_drafts(store: JsonStore, status: str | None = None) -> list[dict[str, Any]]:
    drafts = store.list_json(["workflow_drafts"])
    if status and status != "all":
        return [draft for draft in drafts if draft.get("status") == status]
    return [draft for draft in drafts if draft.get("status") != "deleted"]


def _save_record(store: JsonStore, collection: str, id_key: str, record: dict[str, Any]) -> None:
    _repositories_for_store(store).collection(collection, id_key).save(record)


def _get_record(store: JsonStore, collection: str, record_id: str) -> dict[str, Any]:
    return _repositories_for_store(store).collection(collection, _collection_id_key(collection)).get(record_id)


def _list_records(store: JsonStore, collection: str) -> list[dict[str, Any]]:
    return _repositories_for_store(store).collection(collection, _collection_id_key(collection)).list()


def _repositories_for_store(store: JsonStore) -> RepositoryRegistry:
    repositories = getattr(store, "repositories", None)
    if repositories is None:
        repositories = RepositoryRegistry(store)
        setattr(store, "repositories", repositories)
    return repositories


def _collection_id_key(collection: str) -> str:
    return {
        "tasks": "task_id",
        "runs": "run_id",
        "workflows": "version_id",
        "skill_packages": "package_id",
    }.get(collection, "id")


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
            package_security = _safe_extract_zip(archive, package_dir)
    except zipfile.BadZipFile as exc:
        raise AegisQAError("SKILL_PACKAGE_INVALID", "插件包必须是合法 zip 文件。") from exc

    package_dir = _detect_package_content_root(package_dir)
    manifest_path = _first_existing(package_dir, ["skill.yaml", "skill.yml", "skill.json"])
    skill_md_path = package_dir / "SKILL.md"
    handler_path = package_dir / "handler.py"
    if not manifest_path:
        if handler_path.exists() or (package_dir / "scripts").exists():
            raise AegisQAError(
                "SKILL_PACKAGE_MANIFEST_MISSING",
                "纯参数或脚本型 Agent Skill 必须提供 skill.yaml 或 skill.json，用来声明输入、输出、配置和 runtime.entrypoint。",
            )
        if not skill_md_path.exists():
            raise AegisQAError("SKILL_PACKAGE_MANIFEST_MISSING", "插件包缺少 skill.yaml、skill.json 或 SKILL.md。")
        manifest = build_instruction_manifest_from_skill_md(package_dir)
        runtime_payload: dict[str, Any] = {"mode": "instruction_model"}
    else:
        manifest_payload = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
        if not isinstance(manifest_payload, dict):
            raise AegisQAError("SKILL_PACKAGE_MANIFEST_INVALID", "skill.yaml 或 skill.json 必须是对象。")
        if "permissions" not in manifest_payload:
            raise AegisQAError(
                "SKILL_PACKAGE_PERMISSIONS_REQUIRED",
                "脚本型或参数型 Agent Skill 必须在 manifest 中显式声明 permissions，空列表表示无需额外权限。",
            )
        # runtime 是平台执行声明，不属于 Workflow 组件合约；从 manifest 中剥离后再交给 SkillManifest。
        runtime_payload = manifest_payload.pop("runtime", {}) or {}
        if not isinstance(runtime_payload, dict):
            raise AegisQAError("SKILL_PACKAGE_RUNTIME_INVALID", "runtime 必须是对象。")
        _reject_unsupported_skill_package_dependencies(package_dir, runtime_payload)
        manifest = SkillManifest(**manifest_payload)
    manifest.enabled = False
    manifest.status = "pending_review"
    runtime_mode = _resolve_skill_package_runtime_mode(runtime_payload, package_dir)
    entrypoint: str | None = None
    handler_record_path: str | None = None
    if runtime_mode == "script":
        entrypoint_path, function_name, entrypoint = resolve_package_entrypoint(
            package_dir,
            str(runtime_payload.get("entrypoint") or "handler.py:run"),
        )
        if handler_path.exists() and entrypoint_path == handler_path.resolve():
            handler_record_path = str(handler_path.resolve())
        registry.register(SubprocessPackageSkill(manifest, entrypoint_path, package_root=package_dir, function_name=function_name))
    elif runtime_mode == "instruction_model":
        if not skill_md_path.exists():
            raise AegisQAError("SKILL_PACKAGE_SKILL_MD_MISSING", "说明型 Agent Skill 包缺少 SKILL.md。")
        registry.register(InstructionPackageSkill(manifest, package_dir, runtime_mode=runtime_mode))
    else:
        raise AegisQAError(
            "SKILL_PACKAGE_RUNTIME_UNSUPPORTED",
            f"不支持的 Skill 包运行模式：{runtime_mode}",
            details={"supported": ["script", "instruction_model"]},
        )
    record = {
        "package_id": package_id,
        "filename": request.filename,
        "status": manifest.status,
        "manifest": manifest.model_dump(mode="json"),
        "package_dir": str(package_dir),
        "handler_path": handler_record_path,
        "skill_md_path": str(skill_md_path.resolve()) if skill_md_path.exists() else None,
        "runtime_mode": runtime_mode,
        "entrypoint": entrypoint,
        "package_security": package_security,
        "base_skill_id": _skill_base_id(manifest.skill_id),
        "skill_version": _skill_version_label(manifest),
        "last_contract_ok": False,
        "last_contract_result": None,
        "last_contract_at": None,
        "contract_history": [],
        "approval_history": [],
        "approved_by": None,
        "approved_at": None,
        "approval_note": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    _save_record(store, "skill_packages", "package_id", record)
    return record


def _load_skill_packages(store: JsonStore, registry: SkillRegistry) -> None:
    for record in _list_records(store, "skill_packages"):
        package_dir = Path(record.get("package_dir", ""))
        if not package_dir.exists():
            continue
        manifest = SkillManifest(**record["manifest"])
        runtime_mode = str(record.get("runtime_mode") or ("script" if record.get("handler_path") else "instruction_model"))
        if runtime_mode == "script":
            try:
                entrypoint_path, function_name, _ = resolve_package_entrypoint(package_dir, record.get("entrypoint") or "handler.py:run")
            except AegisQAError:
                continue
            registry.register(SubprocessPackageSkill(manifest, entrypoint_path, package_root=package_dir, function_name=function_name))
        elif runtime_mode == "instruction_model" and (package_dir / "SKILL.md").exists():
            registry.register(InstructionPackageSkill(manifest, package_dir, runtime_mode=runtime_mode))


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


def _mark_skill_package_approved(store: JsonStore, skill_id: str, approval_note: str, *, actor: str = "api", role: str | None = None) -> None:
    package = _find_skill_package(store, skill_id)
    if not package:
        return
    # 审批元数据写在插件包记录上，方便前端在市场和治理页同时展示生命周期证据。
    package["approved_by"] = actor
    if role:
        package["approved_by_role"] = role
    package["approved_at"] = _now()
    package["approval_note"] = approval_note
    _append_skill_package_lifecycle_event(package, action="approve", actor=actor, role=role, reason=approval_note)
    package["updated_at"] = _now()
    _save_record(store, "skill_packages", "package_id", package)


def _record_skill_package_contract_result(store: JsonStore, skill_id: str, result: dict[str, Any], *, actor: str = "api") -> dict[str, Any] | None:
    package = _find_skill_package(store, skill_id)
    if not package:
        return None
    package["last_contract_ok"] = bool(result.get("ok"))
    package["last_contract_result"] = result
    package["last_contract_at"] = _now()
    history = package.setdefault("contract_history", [])
    if isinstance(history, list):
        history.append(
            {
                "ok": bool(result.get("ok")),
                "actor": actor,
                "created_at": package["last_contract_at"],
                "latency_ms": result.get("latency_ms"),
                "error": result.get("error"),
                "code": result.get("code"),
                "message": result.get("message"),
            }
        )
    package["updated_at"] = _now()
    _save_record(store, "skill_packages", "package_id", package)
    return package


def _record_skill_package_lifecycle_event(
    store: JsonStore,
    skill_id: str,
    *,
    action: str,
    actor: str = "api",
    role: str | None = None,
    reason: str = "",
    target_skill_id: str | None = None,
) -> dict[str, Any] | None:
    package = _find_skill_package(store, skill_id)
    if not package:
        return None
    _append_skill_package_lifecycle_event(package, action=action, actor=actor, role=role, reason=reason, target_skill_id=target_skill_id)
    package["updated_at"] = _now()
    _save_record(store, "skill_packages", "package_id", package)
    return package


def _append_skill_package_lifecycle_event(
    package: dict[str, Any],
    *,
    action: str,
    actor: str = "api",
    role: str | None = None,
    reason: str = "",
    target_skill_id: str | None = None,
) -> None:
    history = package.setdefault("approval_history", [])
    if not isinstance(history, list):
        package["approval_history"] = history = []
    event = {"action": action, "actor": actor, "reason": reason, "created_at": _now()}
    if role:
        event["role"] = role
    if target_skill_id:
        event["target_skill_id"] = target_skill_id
    history.append(event)


def _skill_base_id(skill_id: str) -> str:
    return skill_id.rsplit("@", 1)[0] if "@" in skill_id else skill_id


def _skill_version_label(manifest: SkillManifest) -> str:
    if manifest.version:
        return manifest.version
    return manifest.skill_id.rsplit("@", 1)[1] if "@" in manifest.skill_id else "unversioned"


def _safe_extract_zip(archive: zipfile.ZipFile, destination: Path) -> dict[str, Any]:
    destination = destination.resolve()
    file_count = 0
    total_size = 0
    max_file_size = 0
    warnings: list[dict[str, Any]] = []
    for member in archive.infolist():
        filename = member.filename.replace("\\", "/")
        parts = PurePosixPath(filename).parts
        if filename.startswith("/") or re.match(r"^[a-zA-Z]:", filename) or ".." in parts:
            raise AegisQAError(
                "SKILL_PACKAGE_INVALID_PATH",
                "插件包包含非法路径，禁止绝对路径或跨目录文件。",
                details={"filename": member.filename},
            )
        if member.is_dir():
            continue
        file_count += 1
        if file_count > MAX_SKILL_PACKAGE_FILES:
            raise AegisQAError(
                "SKILL_PACKAGE_TOO_MANY_FILES",
                "插件包文件数量超过安全限制。",
                details={"file_count": file_count, "max_files": MAX_SKILL_PACKAGE_FILES},
            )
        max_file_size = max(max_file_size, member.file_size)
        if member.file_size > MAX_SKILL_PACKAGE_FILE_BYTES:
            raise AegisQAError(
                "SKILL_PACKAGE_FILE_TOO_LARGE",
                "插件包内单个文件超过安全限制。",
                details={
                    "filename": member.filename,
                    "file_size_bytes": member.file_size,
                    "max_file_size_bytes": MAX_SKILL_PACKAGE_FILE_BYTES,
                },
            )
        total_size += member.file_size
        if total_size > MAX_SKILL_PACKAGE_TOTAL_BYTES:
            raise AegisQAError(
                "SKILL_PACKAGE_TOO_LARGE",
                "插件包解压后的总大小超过安全限制。",
                details={"total_size_bytes": total_size, "max_total_size_bytes": MAX_SKILL_PACKAGE_TOTAL_BYTES},
            )
        member_payload = archive.read(member)
        warnings.extend(_skill_package_member_warnings(filename, member, member_payload))
        target = (destination / member.filename).resolve()
        if destination not in target.parents and target != destination:
            raise AegisQAError(
                "SKILL_PACKAGE_INVALID_PATH",
                "插件包包含非法路径，禁止绝对路径或跨目录文件。",
                details={"filename": member.filename},
            )
    archive.extractall(destination)
    return {
        "file_count": file_count,
        "total_size_bytes": total_size,
        "max_file_size_bytes": max_file_size,
        "warnings": warnings,
        "limits": {
            "max_files": MAX_SKILL_PACKAGE_FILES,
            "max_file_size_bytes": MAX_SKILL_PACKAGE_FILE_BYTES,
            "max_total_size_bytes": MAX_SKILL_PACKAGE_TOTAL_BYTES,
        },
    }


def _skill_package_member_warnings(filename: str, member: zipfile.ZipInfo, payload: bytes) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    suffix = Path(filename).suffix.lower()
    executable_bits = (member.external_attr >> 16) & 0o111
    if suffix in SKILL_PACKAGE_EXECUTABLE_SUFFIXES or executable_bits:
        warnings.append(
            {
                "code": "SKILL_PACKAGE_EXECUTABLE_FILE_WARNING",
                "message": "插件包包含可执行或二进制文件，审批时需要确认其必要性。",
                "filename": filename,
            }
        )
    elif b"\x00" in payload[:4096]:
        warnings.append(
            {
                "code": "SKILL_PACKAGE_BINARY_FILE_WARNING",
                "message": "插件包包含二进制内容，审批时需要确认来源和用途。",
                "filename": filename,
            }
        )
    text = _decode_skill_package_text(filename, payload)
    if text is None:
        return warnings
    if any(pattern.search(text) for pattern in SKILL_PACKAGE_DIRECT_MODEL_PATTERNS):
        warnings.append(
            {
                "code": "SKILL_PACKAGE_DIRECT_MODEL_SDK_WARNING",
                "message": "插件包源码疑似直接调用模型 SDK，应改用平台模型网关和 model alias。",
                "filename": filename,
            }
        )
    if SKILL_PACKAGE_API_KEY_PATTERN.search(text):
        warnings.append(
            {
                "code": "SKILL_PACKAGE_API_KEY_WARNING",
                "message": "插件包疑似包含硬编码 API key，审批前必须移除或改用平台 secret_ref。",
                "filename": filename,
            }
        )
    return warnings


def _decode_skill_package_text(filename: str, payload: bytes) -> str | None:
    suffix = Path(filename).suffix.lower()
    if suffix not in SKILL_PACKAGE_TEXT_SUFFIXES:
        return None
    try:
        return payload.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _reject_unsupported_skill_package_dependencies(package_dir: Path, runtime_payload: dict[str, Any]) -> None:
    """本地子进程运行时不安装第三方依赖，先在上传阶段给出稳定错误。"""

    dependencies = runtime_payload.get("dependencies")
    if dependencies:
        raise AegisQAError(
            "SKILL_PACKAGE_DEPENDENCIES_UNSUPPORTED",
            "当前本地 Skill 包运行模式不支持声明第三方依赖；请移除 runtime.dependencies 后再上传。",
            details={"field": "runtime.dependencies"},
        )
    dependency_files = sorted(name for name in SKILL_PACKAGE_DEPENDENCY_FILES if (package_dir / name).exists())
    if dependency_files:
        raise AegisQAError(
            "SKILL_PACKAGE_DEPENDENCIES_UNSUPPORTED",
            "当前本地 Skill 包运行模式不支持随包安装第三方依赖；请移除依赖文件后再上传。",
            details={"files": dependency_files},
        )


def _first_existing(root: Path, names: list[str]) -> Path | None:
    for name in names:
        candidate = root / name
        if candidate.exists():
            return candidate
    return None


def _detect_package_content_root(extraction_root: Path) -> Path:
    """兼容 zip 包外层多包了一层目录的常见情况。"""

    if any((extraction_root / name).exists() for name in ["SKILL.md", "skill.yaml", "skill.yml", "skill.json", "handler.py", "scripts"]):
        return extraction_root
    children = list(extraction_root.iterdir())
    directories = [item for item in children if item.is_dir()]
    files = [item for item in children if item.is_file()]
    if len(directories) == 1 and not files:
        return directories[0]
    return extraction_root


def _resolve_skill_package_runtime_mode(runtime_payload: dict[str, Any], package_dir: Path) -> str:
    """根据 manifest.runtime 和包内容推断 Skill 包执行模式。"""

    raw_mode = str(runtime_payload.get("mode") or "").strip().lower()
    aliases = {
        "python": "script",
        "subprocess": "script",
        "safe_model": "instruction_model",
        "model": "instruction_model",
        "instructions": "instruction_model",
    }
    if raw_mode:
        return aliases.get(raw_mode, raw_mode)
    if (package_dir / "handler.py").exists():
        return "script"
    if (package_dir / "SKILL.md").exists():
        return "instruction_model"
    return "script"


def _build_task_record(
    name: str,
    dataset: dict[str, Any],
    workflow: WorkflowVersion,
    run: RunRecord,
    *,
    execution_config: dict[str, Any] | None = None,
    evaluation_goal: str | None = None,
    quality_gate: dict[str, Any] | None = None,
    preflight_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = _now()
    return {
        "task_id": f"task-{uuid4().hex[:12]}",
        "name": name,
        "evaluation_goal": evaluation_goal,
        "quality_gate": quality_gate or {},
        "preflight_result": preflight_result,
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


def _build_parameter_governance(task: dict[str, Any], run: RunRecord) -> dict[str, Any]:
    """汇总一次任务里的 Skill/Prompt 版本和参数来源。

    Task 是用户看到的一次评测，Run Step 是真实执行证据；这里把两者合并，
    让报告能解释“这次到底用了哪个 prompt、哪个模型参数、哪些值来自任务覆盖”。
    """

    parameter_sources_by_step: dict[str, dict[str, Any]] = {}
    for item in run.items:
        for step in item.steps:
            if step.parameter_trace:
                parameter_sources_by_step.setdefault(step.step_id, step.parameter_trace)

    prompt_skill_versions = [
        {
            "step_id": step.step_id,
            "skill_ref": step.skill_ref,
            "prompt_version": step.config.get("prompt_version") or step.config.get("prompt") or "inline-config",
            "model": step.config.get("model"),
            "model_params": {key: step.config.get(key) for key in ("temperature", "threshold", "top_p") if key in step.config},
            "cacheable": step.cacheable,
        }
        for step in run.workflow.steps
    ]
    return {
        "task_id": task.get("task_id"),
        "run_id": run.run_id,
        "workflow_version_id": run.workflow.version_id,
        "execution_config": task.get("execution_config", {}),
        "prompt_skill_versions": prompt_skill_versions,
        "parameter_sources": [
            {
                "step_id": step.step_id,
                "skill_ref": step.skill_ref,
                "parameters": parameter_sources_by_step.get(step.step_id, {}),
            }
            for step in run.workflow.steps
        ],
        "secret_policy": {
            "redacted": True,
            "message": "Secret 参数只保留 secret_ref 与脱敏预览，不在报告或 Trace 中展示明文。",
        },
    }


def _build_quality_decision(task: dict[str, Any], run: RunRecord, report: RunReport, segments: list[Any]) -> dict[str, Any]:
    """把报告指标转换成产品决策语言。

    评测报告如果只给指标，用户还要自己判断能否发布；质量决策把通过率、错误率、
    Badcase 和低分层合并成风险摘要，给出下一步动作。
    """

    weak_segments = [segment for segment in segments if segment.sample_count > 0 and segment.pass_rate < 0.8]
    badcase_count = len(report.badcases)
    status = "passed"
    top_risks: list[dict[str, Any]] = []
    next_actions: list[dict[str, str]] = []

    if report.pass_rate < 0.6 or report.error_rate > 0.05:
        status = "blocked"
    elif report.pass_rate < 0.8 or badcase_count > 0 or weak_segments:
        status = "warning"

    if report.pass_rate < 0.8:
        top_risks.append({"type": "low_pass_rate", "severity": "critical" if report.pass_rate < 0.6 else "warning", "message": f"任务通过率为 {round(report.pass_rate * 100)}%。"})
        next_actions.append({"action": "create_ci_gate", "label": "为当前任务生成通过率门禁"})
    if badcase_count:
        top_risks.append({"type": "badcase_budget", "severity": "warning", "message": f"当前任务产生 {badcase_count} 条 Badcase。"})
        next_actions.append({"action": "add_to_annotation_queue", "label": "将 Badcase 加入人工审核队列"})
    if weak_segments:
        weakest = sorted(weak_segments, key=lambda item: item.pass_rate)[0]
        top_risks.append(
            {
                "type": "weak_segment",
                "severity": "warning",
                "message": f"{weakest.segment_key}={weakest.segment_value} 分组通过率为 {round(weakest.pass_rate * 100)}%。",
                "segment_key": weakest.segment_key,
                "segment_value": weakest.segment_value,
            }
        )
        next_actions.append({"action": "create_golden_candidates", "label": "把低通过率分组沉淀为 Golden 候选"})
    if not next_actions:
        next_actions.append({"action": "snapshot_experiment", "label": "生成 Experiment 快照作为新的 baseline"})

    return {
        "status": status,
        "task_id": task.get("task_id"),
        "run_id": run.run_id,
        "risk_summary": {
            "pass_rate": report.pass_rate,
            "error_rate": report.error_rate,
            "badcase_count": badcase_count,
            "weak_segment_count": len(weak_segments),
        },
        "top_risks": top_risks,
        "next_actions": next_actions,
    }


def _build_budget_status(task: dict[str, Any], report: RunReport) -> dict[str, Any]:
    """把任务预算转成报告级状态。

    预算只消费模型网关写入的 usage/cost 聚合结果；未返回价格时成本按 0
    入账，并通过 cost_source 明确暴露来源，避免把 token 粗估伪装成真实账单。
    """

    execution_config = task.get("execution_config", {})
    budget = execution_config.get("cost_budget") if isinstance(execution_config, dict) else None
    cost_used = _estimate_report_cost(report)
    cost_source = str(report.metrics.get("cost_source") or "provider_usage.missing")
    prompt_tokens = _metric_number(report.metrics.get("prompt_tokens"))
    completion_tokens = _metric_number(report.metrics.get("completion_tokens"))
    total_tokens = _metric_number(report.metrics.get("total_tokens"))
    cost_currency = report.metrics.get("cost_currency")
    basis_label = _budget_cost_basis_label(cost_source)
    if not isinstance(budget, (int, float)) or budget <= 0:
        return {
            "status": "not_set",
            "cost_budget": None,
            "cost_used": cost_used,
            "budget_remaining": None,
            "usage_ratio": None,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "cost_source": cost_source,
            "cost_currency": cost_currency,
            "message": f"{basis_label}：当前任务未设置成本预算。",
        }

    budget_value = float(budget)
    usage_ratio = cost_used / budget_value if budget_value else 0.0
    if cost_used > budget_value:
        status = "exceeded"
        message = f"{basis_label}已超过任务预算，建议降低样本量、并发或模型单价后重新执行。"
    elif usage_ratio >= 0.8:
        status = "warning"
        message = f"{basis_label}已接近任务预算，建议在正式批量执行前复核成本门禁。"
    else:
        status = "ok"
        message = f"{basis_label}仍在任务预算内。"
    return {
        "status": status,
        "cost_budget": budget_value,
        "cost_used": cost_used,
        "budget_remaining": max(0.0, budget_value - cost_used),
        "usage_ratio": usage_ratio,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
        "cost_source": cost_source,
        "cost_currency": cost_currency,
        "message": message,
    }


def _build_red_team_scan(task: dict[str, Any] | None, run: RunRecord) -> dict[str, Any]:
    """对一次任务或 Run 做规则化红队扫描。

    这里刻意采用透明规则而不是黑盒 LLM，让本地测试可复现；生产环境可以把
    risks 的生成替换为专门的安全模型，但输出结构保持不变。
    """

    rules = [
        {
            "risk_type": "prompt_injection",
            "severity": "critical",
            "pattern": re.compile(r"(忽略之前|ignore (all )?(previous|prior)|系统提示词|system prompt|越狱|jailbreak)", re.IGNORECASE),
            "message": "样本或输出包含提示词注入/越狱迹象。",
            "recommendation": "把该样本加入红队回归集，并为 Workflow 增加安全拒答或系统提示词保护断言。",
        },
        {
            "risk_type": "pii_leakage",
            "severity": "critical",
            "pattern": re.compile(r"(\b1[3-9]\d{9}\b|[\w.+-]+@[\w-]+\.[\w.-]+|身份证|手机号|银行卡)"),
            "message": "样本或输出包含疑似个人敏感信息。",
            "recommendation": "在数据集上传和报告导出前增加脱敏策略，并把该字段标记为敏感字段。",
        },
        {
            "risk_type": "unsafe_content",
            "severity": "warning",
            "pattern": re.compile(r"(暴力|仇恨|色情|自伤|weapon|hate|sexual|self-harm)", re.IGNORECASE),
            "message": "样本或输出包含疑似安全风险内容。",
            "recommendation": "把命中样本进入人工审核队列，确认是否需要安全分类 Skill 或拒答策略。",
        },
        {
            "risk_type": "secret_exposure",
            "severity": "critical",
            "pattern": re.compile(r"(api[_-]?key|secret|token|sk-[A-Za-z0-9]{12,})", re.IGNORECASE),
            "message": "样本或输出包含疑似密钥或访问令牌。",
            "recommendation": "立即轮换相关 Secret，并检查 Skill 参数是否绕过了脱敏策略。",
        },
    ]
    risks: list[dict[str, Any]] = []
    for item in run.items:
        for field_path, text in _scan_texts_for_item(item.model_dump(mode="json")).items():
            for rule in rules:
                match = rule["pattern"].search(text)
                if not match:
                    continue
                risks.append(
                    {
                        "risk_id": f"risk-{uuid4().hex[:12]}",
                        "risk_type": rule["risk_type"],
                        "severity": rule["severity"],
                        "item_id": item.item_id,
                        "row_id": item.row_id,
                        "field_path": field_path,
                        "evidence": _clip_text(match.group(0)),
                        "message": rule["message"],
                        "recommendation": rule["recommendation"],
                    }
                )

    critical_count = sum(1 for risk in risks if risk["severity"] == "critical")
    warning_count = sum(1 for risk in risks if risk["severity"] == "warning")
    status = "blocked" if critical_count else "warning" if warning_count else "passed"
    return {
        "scan_id": f"redscan-{uuid4().hex[:12]}",
        "target": {"kind": "task", "id": task["task_id"]} if task else {"kind": "run", "id": run.run_id},
        "run_id": run.run_id,
        "summary": {
            "status": status,
            "risk_count": len(risks),
            "critical_count": critical_count,
            "warning_count": warning_count,
            "scanned_items": len(run.items),
        },
        "risks": risks,
        "recommendations": _red_team_recommendations(risks),
        "created_at": _now(),
    }


def _build_score_analytics(
    tasks: list[dict[str, Any]],
    runner: WorkflowRunner,
    *,
    page: int | None = None,
    page_size: int = 20,
) -> dict[str, Any]:
    """构建跨任务质量趋势。

    Task 是用户主对象，因此趋势按 Task 聚合；Run 只作为底层执行证据读取。
    """

    trend: list[dict[str, Any]] = []
    for task in sorted(tasks, key=lambda item: str(item.get("created_at", ""))):
        try:
            run = runner.get_run(str(task["run_id"]))
            report = aggregate_run_report(run)
        except Exception:  # noqa: BLE001 - 趋势页不能因为单条历史损坏导致整体不可用。
            continue
        budget_status = _build_budget_status(task, report)
        trend.append(
            {
                "task_id": task.get("task_id"),
                "task_name": task.get("name"),
                "dataset_id": task.get("dataset_id"),
                "dataset_name": task.get("dataset_name"),
                "workflow_id": task.get("workflow_id"),
                "workflow_name": task.get("workflow_name"),
                "workflow_version_id": task.get("workflow_version_id"),
                "status": task.get("status"),
                "pass_rate": report.pass_rate,
                "error_rate": report.error_rate,
                "badcase_count": len(report.badcases),
                "p95_latency_ms": report.p95_latency_ms,
                "average_latency_ms": report.average_latency_ms,
                "cost_used": budget_status["cost_used"],
                "created_at": task.get("created_at"),
                "updated_at": task.get("updated_at"),
            }
        )

    regressions = _detect_score_regressions(trend)
    task_count = len(trend)
    average_pass_rate = sum(float(item["pass_rate"]) for item in trend) / task_count if task_count else 0.0
    visible_trend = list(reversed(trend))
    payload: dict[str, Any] = {
        "summary": {
            "task_count": task_count,
            "average_pass_rate": average_pass_rate,
            "latest_pass_rate": trend[-1]["pass_rate"] if trend else 0.0,
            "badcase_count": sum(int(item["badcase_count"]) for item in trend),
            "regression_count": len(regressions),
        },
        "trend": visible_trend,
        "regressions": regressions,
    }
    if page is not None:
        # summary 仍基于过滤后的全量趋势，trend 只返回当前页，避免前端为了分页拉取所有历史任务。
        total_items = len(visible_trend)
        safe_page = max(page, 1)
        safe_page_size = min(max(page_size, 1), 100)
        start = (safe_page - 1) * safe_page_size
        payload["trend"] = visible_trend[start : start + safe_page_size]
        payload["pagination"] = {
            "page": safe_page,
            "page_size": safe_page_size,
            "total_items": total_items,
            "total_pages": ceil(total_items / safe_page_size) if total_items else 0,
        }
    return payload


def _build_judge_audit_trends(audits: list[StoredJudgeAudit]) -> dict[str, Any]:
    """按 Judge Profile 聚合审计趋势和低一致性告警。"""

    grouped: dict[str, list[StoredJudgeAudit]] = {}
    for audit in sorted(audits, key=lambda item: item.created_at):
        grouped.setdefault(audit.judge_profile_id, []).append(audit)

    profiles: list[dict[str, Any]] = []
    low_consistency: list[dict[str, Any]] = []
    for profile_id, items in grouped.items():
        series = [
            {
                "audit_id": audit.audit_id,
                "dataset_version_id": audit.dataset_version_id,
                "accuracy": audit.accuracy,
                "precision": audit.precision,
                "recall": audit.recall,
                "f1": audit.f1,
                "cohen_kappa": audit.cohen_kappa,
                "misclassified_count": len(audit.misclassified_items),
                "created_at": audit.created_at,
            }
            for audit in items
        ]
        latest = series[-1]
        profile = {
            "profile_id": profile_id,
            "audit_count": len(series),
            "latest_accuracy": latest["accuracy"],
            "latest_kappa": latest["cohen_kappa"],
            "series": series,
        }
        profiles.append(profile)
        if latest["cohen_kappa"] < 0.6 or latest["accuracy"] < 0.8:
            low_consistency.append(
                {
                    "profile_id": profile_id,
                    "accuracy": latest["accuracy"],
                    "cohen_kappa": latest["cohen_kappa"],
                    "message": "该 Judge Profile 最近一次审计一致性偏低，建议复核 rubric、阈值和错判样本。",
                }
            )

    return {
        "summary": {
            "audit_count": len(audits),
            "profile_count": len(grouped),
            "low_consistency_count": len(low_consistency),
        },
        "profiles": sorted(profiles, key=lambda item: str(item["profile_id"])),
        "low_consistency_profiles": low_consistency,
    }


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
    metrics = report.metrics | {
        "pass_rate": report.pass_rate,
        "error_rate": report.error_rate,
        "badcase_count": len(report.badcases),
        "total_items": report.total_items,
        "completed_items": report.completed_items,
        "failed_items": report.failed_items,
        "average_latency_ms": report.average_latency_ms,
        "p95_latency_ms": report.p95_latency_ms,
        "cost": float(report.metrics.get("cost", 0) or 0),
    }
    baseline_metrics = None
    diff = None
    if baseline_report:
        baseline_metrics = baseline_report.metrics | {
            "pass_rate": baseline_report.pass_rate,
            "error_rate": baseline_report.error_rate,
            "badcase_count": len(baseline_report.badcases),
            "total_items": baseline_report.total_items,
            "completed_items": baseline_report.completed_items,
            "failed_items": baseline_report.failed_items,
            "average_latency_ms": baseline_report.average_latency_ms,
            "p95_latency_ms": baseline_report.p95_latency_ms,
            "cost": float(baseline_report.metrics.get("cost", 0) or 0),
        }
        diff = {
            key: _numeric_delta(metrics.get(key), baseline_metrics.get(key))
            for key in sorted(set(metrics) | set(baseline_metrics))
            if _is_number(metrics.get(key)) and _is_number(baseline_metrics.get(key))
        }
    return {
        "experiment_id": f"exp-{uuid4().hex[:12]}",
        "name": name,
        "run_id": run.run_id,
        "baseline_run_id": baseline_run.run_id if baseline_run else None,
        "dataset_id": run.dataset_id,
        "dataset_version": run.dataset_version,
        "dataset_version_id": run.snapshot.get("dataset_version"),
        "workflow_id": run.workflow.workflow_id,
        "workflow_name": run.workflow.name,
        "workflow_version_id": run.workflow.version_id,
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
        "failure_distribution": _badcase_reason_distribution(report),
        "created_at": _now(),
    }


def _badcase_reason_distribution(report: Any) -> dict[str, int]:
    distribution: dict[str, int] = {}
    for badcase in report.badcases:
        distribution[badcase.reason] = distribution.get(badcase.reason, 0) + 1
    for error_type, count in report.error_distribution.items():
        distribution[error_type] = distribution.get(error_type, 0) + count
    return distribution


def _estimate_report_cost(report: RunReport) -> float:
    cost = report.metrics.get("cost")
    if isinstance(cost, (int, float)):
        return float(cost)
    return 0.0


def _metric_number(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value) if float(value).is_integer() else float(value)
    return None


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _numeric_delta(current: Any, baseline: Any) -> float:
    return float(current) - float(baseline)


def _budget_cost_basis_label(cost_source: str) -> str:
    if cost_source.startswith("provider_usage.") and cost_source not in {"provider_usage.tokens_unpriced", "provider_usage.missing"}:
        return "模型网关 usage 成本"
    if cost_source == "provider_usage.tokens_unpriced":
        return "模型网关 token usage 未返回价格"
    return "模型网关未返回成本"


def _scan_texts_for_item(item: dict[str, Any]) -> dict[str, str]:
    context = item.get("context_snapshot", {})
    row = context.get("row", {}) if isinstance(context, dict) else {}
    texts: dict[str, str] = {}
    if isinstance(row, dict):
        for key, value in row.items():
            texts[f"row.{key}"] = json.dumps(value, ensure_ascii=False, default=str)
    if isinstance(context, dict):
        for key in ("context", "metrics", "errors"):
            if key in context:
                texts[key] = json.dumps(context[key], ensure_ascii=False, default=str)
    for step in item.get("steps", []):
        if not isinstance(step, dict):
            continue
        step_id = step.get("step_id", "step")
        for key in ("input_snapshot", "output_snapshot", "logs", "error"):
            value = step.get(key)
            if value:
                texts[f"steps.{step_id}.{key}"] = json.dumps(value, ensure_ascii=False, default=str)
    return texts


def _red_team_recommendations(risks: list[dict[str, Any]]) -> list[dict[str, str]]:
    if not risks:
        return [{"action": "snapshot_experiment", "label": "生成 Experiment 快照", "message": "当前扫描未发现规则命中的安全风险，可以沉淀为安全 baseline。"}]
    risk_types = {risk["risk_type"] for risk in risks}
    recommendations = []
    if "prompt_injection" in risk_types:
        recommendations.append({"action": "add_assertion", "label": "添加 Prompt Injection 断言", "message": "为 Workflow 增加提示词注入检测断言，并把命中样本加入红队回归集。"})
    if "pii_leakage" in risk_types or "secret_exposure" in risk_types:
        recommendations.append({"action": "enable_redaction", "label": "启用敏感信息脱敏", "message": "检查数据集字段和 Skill 输出，确保报告导出和 Trace 中不出现敏感明文。"})
    recommendations.append({"action": "seed_annotation_queue", "label": "进入人工审核", "message": "把高风险样本加入 Annotation Queue，由人工确认是否回流 Golden Dataset。"})
    return recommendations


def _detect_score_regressions(trend: list[dict[str, Any]]) -> list[dict[str, Any]]:
    regressions: list[dict[str, Any]] = []
    previous_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for item in trend:
        key = (str(item.get("dataset_id")), str(item.get("workflow_id")))
        previous = previous_by_key.get(key)
        if previous:
            delta = float(item["pass_rate"]) - float(previous["pass_rate"])
            if delta <= -0.05:
                regressions.append(
                    {
                        "task_id": item.get("task_id"),
                        "task_name": item.get("task_name"),
                        "baseline_task_id": previous.get("task_id"),
                        "dataset_id": item.get("dataset_id"),
                        "workflow_id": item.get("workflow_id"),
                        "pass_rate_delta": delta,
                        "message": "当前任务相对上一批同 Dataset/Workflow 任务通过率下降超过 5 个百分点。",
                    }
                )
        previous_by_key[key] = item
    return regressions


def _clip_text(value: str, limit: int = 80) -> str:
    text = value.strip()
    return text if len(text) <= limit else f"{text[:limit]}..."


def _build_ci_gate_config(request: CIGateConfigRequest) -> dict[str, Any]:
    now = _now()
    return {
        "config_id": f"gatecfg-{uuid4().hex[:12]}",
        "name": request.name,
        "description": request.description,
        "status": request.status,
        "gates": [gate.model_dump(mode="json") for gate in request.gates],
        "created_at": now,
        "updated_at": now,
    }


def _ci_gate_metrics_from_run(run: RunRecord) -> dict[str, float]:
    report = aggregate_run_report(run)
    metrics = {
        key: float(value)
        for key, value in report.metrics.items()
        if isinstance(value, (int, float))
    }
    metrics.update(
        {
            "pass_rate": float(report.pass_rate),
            "error_rate": float(report.error_rate),
            "badcase_count": float(len(report.badcases)),
            "failed_items": float(report.failed_items),
            "completed_items": float(report.completed_items),
            "total_items": float(report.total_items),
            "average_latency_ms": float(report.average_latency_ms),
            "p95_latency_ms": float(report.p95_latency_ms),
        }
    )
    return metrics


def _ci_gate_metrics_from_task(task: dict[str, Any], run: RunRecord) -> dict[str, float]:
    metrics = _ci_gate_metrics_from_run(run)
    # Task 记录可能由人工控制动作刷新过，优先暴露任务中心看到的聚合字段，确保 UI 与门禁判断一致。
    for key in ("pass_rate", "badcase_count", "failed_items", "completed_items", "total_items"):
        value = task.get(key)
        if isinstance(value, (int, float)):
            metrics[key] = float(value)
    return metrics


def _build_trace_tree(run: RunRecord, *, page: int = 1, page_size: int = 50) -> dict[str, Any]:
    total_items = len(run.items)
    safe_page = max(page, 1)
    safe_page_size = min(max(page_size, 1), 100)
    start = (safe_page - 1) * safe_page_size
    page_items = run.items[start : start + safe_page_size]
    return {
        "run_id": run.run_id,
        "status": run.status,
        "workflow_version": run.workflow.version_id,
        "dataset_version": run.snapshot.get("dataset_version"),
        "pagination": {
            "page": safe_page,
            "page_size": safe_page_size,
            "total_items": total_items,
            "total_pages": ceil(total_items / safe_page_size) if total_items else 0,
        },
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
            for item in page_items
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
    raw_actual = metrics.get(gate.metric)
    if not isinstance(raw_actual, (int, float)) or isinstance(raw_actual, bool):
        return {
            "gate_id": gate.gate_id,
            "metric": gate.metric,
            "operator": gate.operator,
            "threshold": gate.threshold,
            "actual": None,
            "blocking": gate.blocking,
            "status": "skipped",
            "message": f"质量门禁跳过：缺少真实指标 {gate.metric}。",
            "reason": "metric_unavailable",
        }
    actual = float(raw_actual)
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


def _gate_evaluation_status(results: list[dict[str, Any]]) -> str:
    blocking_failures = [item for item in results if item["status"] == "failed" and item["blocking"]]
    if blocking_failures:
        return "blocked"
    if results and all(item.get("status") == "skipped" for item in results):
        return "skipped"
    return "passed"


def _needs_annotation(item: dict[str, Any], *, strategy: str) -> bool:
    if strategy == "all":
        return True
    metrics = item.get("metrics", {})
    judge_score = metrics.get("judge_score")
    label = item.get("context_snapshot", {}).get("context", {}).get("judge_label")
    return item.get("status") == "failed" or label == "fail" or (isinstance(judge_score, (int, float)) and judge_score < 0.6)


def _find_task_by_run_id(store: JsonStore, run_id: str) -> dict[str, Any] | None:
    for task in _list_records(store, "tasks"):
        if task.get("run_id") == run_id:
            return task
        for attempt in task.get("attempts", []):
            if attempt.get("run_id") == run_id:
                return task
    return None


def _build_annotation_task(run_id: str, item: dict[str, Any], *, assignee: str | None, source_task: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "task_id": f"anno-{uuid4().hex[:12]}",
        "run_id": run_id,
        "source_task_id": source_task.get("task_id") if source_task else None,
        "source_task_name": source_task.get("name") if source_task else None,
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
