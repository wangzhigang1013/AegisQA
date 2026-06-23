"""API 请求模型定义。

从 app.py 提取的 Pydantic Request Models，便于维护和复用。
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from aegisqa.workflows.graph import WorkflowGraph
from aegisqa.workflows.models import WorkflowVersion


# ── Dataset ───────────────────────────────────────────────────

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


# ── Run ───────────────────────────────────────────────────────

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


# ── Badcase ───────────────────────────────────────────────────

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


class BadcaseBulkCorrectionRequest(BaseModel):
    badcase_ids: list[str]
    human_label: str
    problem_type: str
    note: str = ""
    add_to_golden: bool = False
    ignore: bool = False


# ── Judge ─────────────────────────────────────────────────────

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


class JudgeProfileCreateRequest(BaseModel):
    name: str
    model: str
    prompt: str
    rubric: dict[str, Any]
    threshold: float
    output_schema: dict[str, Any]
    actor: str = "api"
    role: str = "Reviewer"


# ── Workflow ──────────────────────────────────────────────────

class WorkflowCopyRequest(BaseModel):
    name: str | None = None
    actor: str = "api"
    role: str = "Evaluator"


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


# ── Skill ─────────────────────────────────────────────────────

class SkillGovernanceRequest(BaseModel):
    reason: str = ""
    actor: str = "api"
    role: str = "Skill Developer"


class SkillPackageUploadRequest(BaseModel):
    filename: str
    content_base64: str
    conflict_strategy: str = "error"  # error | replace | new_version
    actor: str = "api"
    role: str = "Skill Developer"


# ── Task ──────────────────────────────────────────────────────

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


# ── Report ────────────────────────────────────────────────────

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


# ── Repair Task ───────────────────────────────────────────────

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


# ── Experiment ────────────────────────────────────────────────

class ExperimentFromRunRequest(BaseModel):
    run_id: str
    name: str
    baseline_run_id: str | None = None
    tags: list[str] = Field(default_factory=list)
    actor: str = "api"
    role: str = "Evaluator"


# ── Assertion & CI Gate ──────────────────────────────────────

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


# ── Annotation ────────────────────────────────────────────────

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


# ── Red Team ──────────────────────────────────────────────────

class RedTeamScanRequest(BaseModel):
    task_id: str | None = None
    run_id: str | None = None
    actor: str = "api"
    role: str = "Evaluator"


# ── Field Type ────────────────────────────────────────────────

class FieldTypeCorrectionRequest(BaseModel):
    field_type: str
    actor: str = "api"
    role: str = "Evaluator"
