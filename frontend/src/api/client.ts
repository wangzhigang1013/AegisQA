import type {
  AnnotationTask,
  AnnotationDispatchResult,
  AgentSkillDiscoveryResult,
  AgentSkillRecord,
  AnnotationQueuePageResult,
  AuditEvent,
  AnnotationCandidate,
  AssertionEvaluationResult,
  BadcaseRecord,
  CIGateConfigRecord,
  CIGateEvaluationRecord,
  CIGateEvaluationPageResult,
  CIGateRule,
  CIGateEvaluationResult,
  DashboardSummary,
  DatasetLineage,
  DatasetQualityDiagnosis,
  DatasetSummary,
  DatasetVersion,
  BaselineChangeNotification,
  ExperimentBaselineActionResult,
  ExperimentBaselineImpact,
  ExperimentRecord,
  GraphValidationResult,
  JudgeProfile,
  JudgeCrossValidationResult,
  JudgeAuditTrends,
  PromptSkillCandidate,
  PromptSkillCandidatePageResult,
  PromptSkillCandidateBulkArchiveResult,
  PromptSkillCandidateBulkAssignResult,
  PromptSkillCandidateBulkRetestResult,
  PromptSkillCandidateBulkReviewResult,
  PromptSkillCandidateEscalationResult,
  PromptSkillCandidateRetestPlan,
  PromptSkillCandidateRetestResult,
  PromptSkillCandidateWorkload,
  WorkflowPromotionReviewResult,
  RedTeamScanResult,
  RepairTaskRecord,
  RepairTaskPageResult,
  RepairTaskTree,
  ReportOfflinePackageDownload,
  ReportExportRequest,
  RuntimeStatus,
  RunPageResult,
  RunRecord,
  RunReport,
  ScoreAnalytics,
  SkillContractResult,
  SkillManifest,
  SkillPackageRecord,
  SkillVersionHistory,
  ModelGatewayStatus,
  ModelGatewayConfig,
  ModelGatewayConnection,
  ModelGatewayTestResult,
  OverviewWorkbench,
  StoredJudgeAudit,
  TaskRecord,
  TaskReport,
  TaskDiagnostics,
  TaskExecutionTemplate,
  TaskPageResult,
  TaskParameterGovernance,
  TaskPreflightResult,
  TaskResultsExportDownload,
  TaskTraceFlow,
  StepDebugPayload,
  StepPromptDebugRequest,
  StepReplayRequest,
  TraceTree,
  WorkflowDraftRecord,
  WorkflowGraph,
  WorkflowParameterPreview,
  WorkflowVersion,
} from '../types';
import type { FeatureFlagsResponse } from '../features';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

export class ApiError extends Error {
  code: string;
  details: Record<string, unknown>;
  traceId?: string;
  status: number;

  constructor(message: string, options: { code?: string; details?: Record<string, unknown>; trace_id?: string; status: number }) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code ?? 'HTTP_ERROR';
    this.details = options.details ?? {};
    this.traceId = options.trace_id;
    this.status = options.status;
  }
}

export function formatApiError(error: unknown): string {
  if (error instanceof ApiError) {
    const trace = error.traceId ? `，trace_id=${error.traceId}` : '';
    return `${error.message}（${error.code}${trace}）`;
  }
  return error instanceof Error ? error.message : '未知错误';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    cache: init?.cache ?? 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  const responseTraceId = responseHeader(response, 'X-AegisQA-Request-ID');
  if (!response.ok) {
    if (response.status >= 500 && !payload?.code && !payload?.message && !payload?.detail && API_BASE === '/api') {
      // Vite 代理连不上 FastAPI 时通常只返回空 500；这里给用户一个可操作的启动提示。
      throw new ApiError('后端服务不可用，请确认 FastAPI 已启动在 http://127.0.0.1:8000。', {
        code: 'BACKEND_UNAVAILABLE',
        details: { api_base: API_BASE, status: response.status, request_id: responseTraceId },
        trace_id: responseTraceId,
        status: response.status,
      });
    }
    const message = payload?.message ?? payload?.detail ?? `请求失败：${response.status}`;
    throw new ApiError(message, {
      code: payload?.code,
      details: payload?.details,
      trace_id: payload?.trace_id ?? responseTraceId,
      status: response.status,
    });
  }
  return payload as T;
}

async function requestDownload(path: string, init?: RequestInit): Promise<TaskResultsExportDownload> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    cache: init?.cache ?? 'no-store',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const responseTraceId = responseHeader(response, 'X-AegisQA-Request-ID');
    const message = payload?.message ?? payload?.detail ?? `请求失败：${response.status}`;
    throw new ApiError(message, {
      code: payload?.code,
      details: payload?.details,
      trace_id: payload?.trace_id ?? responseTraceId,
      status: response.status,
    });
  }
  const blob = await response.blob();
  const fileFormat = (response.headers.get('X-AegisQA-File-Format') || 'csv') as TaskResultsExportDownload['file_format'];
  const rowCount = Number(response.headers.get('X-AegisQA-Row-Count') ?? '');
  return {
    blob,
    file_format: fileFormat,
    filename: parseContentDispositionFilename(response.headers.get('Content-Disposition')),
    row_count: Number.isFinite(rowCount) ? rowCount : undefined,
    include_steps: response.headers.get('X-AegisQA-Include-Steps') === 'true',
  };
}

async function requestOfflinePackageDownload(path: string, init?: RequestInit): Promise<ReportOfflinePackageDownload> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    cache: init?.cache ?? 'no-store',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const responseTraceId = responseHeader(response, 'X-AegisQA-Request-ID');
    const message = payload?.message ?? payload?.detail ?? `请求失败：${response.status}`;
    throw new ApiError(message, {
      code: payload?.code,
      details: payload?.details,
      trace_id: payload?.trace_id ?? responseTraceId,
      status: response.status,
    });
  }
  const fileCount = Number(response.headers.get('X-AegisQA-Package-File-Count') ?? '');
  return {
    blob: await response.blob(),
    file_format: 'offline_zip',
    filename: parseContentDispositionFilename(response.headers.get('Content-Disposition')),
    file_count: Number.isFinite(fileCount) ? fileCount : undefined,
  };
}

function responseHeader(response: Response, name: string): string | undefined {
  return response.headers?.get?.(name) ?? undefined;
}

function parseContentDispositionFilename(value: string | null): string | undefined {
  if (!value) return undefined;
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }
  const plainMatch = value.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1];
}

export const api = {
  health: () => request<{ status: string; service: string }>('/health'),
  features: () => request<FeatureFlagsResponse>('/features'),
  dashboard: () => request<DashboardSummary>('/dashboard/summary'),
  workbench: () => request<OverviewWorkbench>('/overview/workbench'),
  redTeamScan: (body: { task_id?: string; run_id?: string }) =>
    request<RedTeamScanResult>('/red-team/scans', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  scoreAnalytics: (filters: { dataset_id?: string; workflow_id?: string; status?: string; page?: number; pageSize?: number } = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      query.set(key === 'pageSize' ? 'page_size' : key, String(value));
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<ScoreAnalytics>(`/score-analytics${suffix}`);
  },
  experiments: (filters: { dataset_id?: string; workflow_id?: string } = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<ExperimentRecord[]>(`/experiments${suffix}`);
  },
  createExperimentFromRun: (body: { run_id: string; name: string; baseline_run_id?: string | null; tags?: string[] }) =>
    request<ExperimentRecord>('/experiments/from-run', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  evaluateAssertions: (body: {
    payload: Record<string, unknown>;
    assertions: { assertion_id: string; type: string; field_path: string; expected?: unknown; pattern?: string; min?: number; max?: number; schema?: Record<string, unknown>; severity?: string }[];
  }) =>
    request<AssertionEvaluationResult>('/assertions/evaluate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  ciGateConfigs: () => request<CIGateConfigRecord[]>('/ci-gates'),
  createCIGateConfig: (body: { name: string; description?: string; gates: CIGateRule[]; status?: string }) =>
    request<CIGateConfigRecord>('/ci-gates', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  evaluateCIGates: (body: { metrics?: Record<string, number>; gates?: CIGateRule[]; config_id?: string; run_id?: string; task_id?: string }) =>
    request<CIGateEvaluationResult>('/ci-gates/evaluate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  ciGateEvaluations: (filters: { config_id?: string; task_id?: string; run_id?: string } = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<CIGateEvaluationRecord[]>(`/ci-gates/evaluations${suffix}`);
  },
  ciGateEvaluationsPage: (filters: { config_id?: string; task_id?: string; run_id?: string; page?: number; pageSize?: number } = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (!value) return;
      query.set(key === 'pageSize' ? 'page_size' : key, String(value));
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<CIGateEvaluationPageResult>(`/ci-gates/evaluations${suffix}`);
  },
  annotationQueue: (filters: { status?: string; assignee?: string; source_task_id?: string } = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<AnnotationTask[]>(`/annotation-queue${suffix}`);
  },
  annotationQueuePage: (filters: { status?: string; assignee?: string; source_task_id?: string; page?: number; pageSize?: number } = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (!value) return;
      query.set(key === 'pageSize' ? 'page_size' : key, String(value));
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<AnnotationQueuePageResult>(`/annotation-queue${suffix}`);
  },
  seedAnnotationQueue: (body: { run_id: string; strategy?: string; limit?: number; assignee?: string | null }) =>
    request<{ run_id: string; created_count: number; tasks: AnnotationTask[] }>('/annotation-queue/seed-from-run', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  dispatchAnnotationQueue: (body: {
    label_field?: string | null;
    sla_hours?: number;
    overdue_strategy?: string;
    assignees: { assignee: string; capacity?: number; labels?: string[] }[];
  }) =>
    request<AnnotationDispatchResult>('/annotation-queue/dispatch', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  assignAnnotationTask: (taskId: string, body: { assignee: string }) =>
    request<AnnotationTask>(`/annotation-queue/${taskId}/assign`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  reviewAnnotationTask: (taskId: string, body: { human_label: string; note?: string; add_to_golden?: boolean }) =>
    request<AnnotationTask>(`/annotation-queue/${taskId}/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  bulkReviewAnnotationTasks: (body: { task_ids: string[]; human_label: string; note?: string; add_to_golden?: boolean }) =>
    request<{ reviewed_count: number; tasks: AnnotationTask[]; candidate_summary: { golden: number; assertion: number }; candidates: AnnotationCandidate[] }>('/annotation-queue/bulk-review', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  annotationCandidates: (filters: { source_task_id?: string; kind?: string } = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<AnnotationCandidate[]>(`/annotation-candidates${suffix}`);
  },
  promptSkillCandidates: (filters: { source_task_id?: string; status?: string; baseline_experiment_id?: string } = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<PromptSkillCandidate[]>(`/prompt-skill-candidates${suffix}`);
  },
  promptSkillCandidatesPage: (filters: { source_task_id?: string; status?: string; baseline_experiment_id?: string; page?: number; pageSize?: number } = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (!value) return;
      query.set(key === 'pageSize' ? 'page_size' : key, String(value));
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<PromptSkillCandidatePageResult>(`/prompt-skill-candidates${suffix}`);
  },
  promptSkillCandidateWorkload: () => request<PromptSkillCandidateWorkload>('/prompt-skill-candidates/workload'),
  promptSkillCandidateRetestPlan: (filters: { status?: string } = {}) => {
    const search = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    const suffix = search.toString();
    return request<PromptSkillCandidateRetestPlan>(`/prompt-skill-candidates/retest-plan${suffix ? `?${suffix}` : ''}`);
  },
  reviewPromptSkillCandidate: (candidateId: string, body: { decision: 'approved' | 'rejected'; reviewer?: string; note?: string }) =>
    request<PromptSkillCandidate>(`/prompt-skill-candidates/${encodeURIComponent(candidateId)}/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  bulkReviewPromptSkillCandidates: (body: { candidate_ids: string[]; decision: 'approved' | 'rejected'; reviewer?: string; note?: string }) =>
    request<PromptSkillCandidateBulkReviewResult>('/prompt-skill-candidates/bulk-review', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  bulkRetestPromptSkillCandidates: (body: { candidate_ids?: string[]; max_count?: number; actor?: string } = {}) =>
    request<PromptSkillCandidateBulkRetestResult>('/prompt-skill-candidates/bulk-retest', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  bulkAssignPromptSkillCandidates: (body: { candidate_ids: string[]; owner: string; due_at?: string | null; actor?: string; max_open_per_owner?: number | null }) =>
    request<PromptSkillCandidateBulkAssignResult>('/prompt-skill-candidates/bulk-assign', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  bulkArchivePromptSkillCandidates: (body: { candidate_ids?: string[]; statuses?: string[]; stale_before?: string | null; actor?: string; note?: string }) =>
    request<PromptSkillCandidateBulkArchiveResult>('/prompt-skill-candidates/bulk-archive', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  escalateOverduePromptSkillCandidates: (body: { actor?: string } = {}) =>
    request<PromptSkillCandidateEscalationResult>('/prompt-skill-candidates/escalate-overdue', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createPromptSkillCandidateDraft: (candidateId: string) =>
    request<{ status: string; candidate: PromptSkillCandidate; draft: WorkflowDraftRecord; target_url: string }>(
      `/prompt-skill-candidates/${encodeURIComponent(candidateId)}/workflow-draft`,
      { method: 'POST' },
    ),
  retestPromptSkillCandidate: (candidateId: string) =>
    request<PromptSkillCandidateRetestResult>(`/prompt-skill-candidates/${encodeURIComponent(candidateId)}/retest`, {
      method: 'POST',
    }),
  createWorkflowPromotionReview: (candidateId: string, body: { requester?: string; note?: string } = {}) =>
    request<WorkflowPromotionReviewResult>(`/prompt-skill-candidates/${encodeURIComponent(candidateId)}/promotion-review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  approveWorkflowPromotionReview: (reviewId: string, body: { reviewer?: string; note?: string } = {}) =>
    request<WorkflowPromotionReviewResult>(`/workflow-promotion-reviews/${encodeURIComponent(reviewId)}/approve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  rejectWorkflowPromotionReview: (reviewId: string, body: { reviewer?: string; note?: string } = {}) =>
    request<WorkflowPromotionReviewResult>(`/workflow-promotion-reviews/${encodeURIComponent(reviewId)}/reject`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  applyExperimentBaselineSuggestion: (suggestionId: string, body: { actor?: string; note?: string } = {}) =>
    request<ExperimentBaselineActionResult>(`/experiment-baseline-suggestions/${encodeURIComponent(suggestionId)}/apply`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  experimentBaselineImpact: (suggestionId: string) =>
    request<ExperimentBaselineImpact>(`/experiment-baseline-suggestions/${encodeURIComponent(suggestionId)}/impact`),
  rollbackExperimentBaselineSuggestion: (suggestionId: string, body: { actor?: string; note?: string; force?: boolean } = {}) =>
    request<ExperimentBaselineActionResult>(`/experiment-baseline-suggestions/${encodeURIComponent(suggestionId)}/rollback`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  baselineChangeNotifications: (filters: { suggestion_id?: string; baseline_id?: string; workflow_id?: string; status?: string } = {}) => {
    const search = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) search.set(key, value);
    });
    const suffix = search.toString();
    return request<BaselineChangeNotification[]>(`/baseline-change-notifications${suffix ? `?${suffix}` : ''}`);
  },
  acknowledgeBaselineChangeNotification: (notificationId: string, body: { actor?: string; note?: string } = {}) =>
    request<BaselineChangeNotification>(`/baseline-change-notifications/${encodeURIComponent(notificationId)}/ack`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  skills: () => request<SkillManifest[]>('/skills'),
  skillPackages: () => request<SkillPackageRecord[]>('/skills/packages'),
  skillVersionHistory: (skillId: string) => request<SkillVersionHistory>(`/skills/${skillId}/versions`),
  agentSkills: () => request<AgentSkillRecord[]>('/agent-skills'),
  discoverAgentSkills: () => request<AgentSkillDiscoveryResult>('/agent-skills/discover'),
  importAgentSkill: (body: { source_dir: string; skill_id?: string; name?: string }) =>
    request<AgentSkillRecord>('/agent-skills/import', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  runtimeStatus: () => request<RuntimeStatus>('/governance/runtime-status'),
  modelGatewayStatus: () => request<ModelGatewayStatus>('/model-gateway/status'),
  modelGatewayConfig: () => request<ModelGatewayConfig>('/model-gateway/config'),
  modelGatewayConnections: () => request<ModelGatewayConnection[]>('/model-gateway/connections'),
  createModelGatewayConnection: (body: {
    connection_id: string;
    name?: string | null;
    provider: string;
    base_url?: string | null;
    secret_ref?: string | null;
    api_key?: string | null;
    default_model: string;
    timeout_seconds: number;
    enabled?: boolean;
  }) =>
    request<ModelGatewayConnection>('/model-gateway/connections', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateModelGatewayConnection: (
    connectionId: string,
    body: {
      name?: string | null;
      provider?: string;
      base_url?: string | null;
      secret_ref?: string | null;
      api_key?: string | null;
      default_model?: string;
      timeout_seconds?: number;
      enabled?: boolean;
      clear_api_key?: boolean;
    },
  ) =>
    request<ModelGatewayConnection>(`/model-gateway/connections/${encodeURIComponent(connectionId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteModelGatewayConnection: (connectionId: string) =>
    request<{ deleted: boolean; connection_id: string }>(`/model-gateway/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' }),
  updateModelGatewayConfig: (body: {
    provider: string;
    base_url?: string | null;
    secret_ref?: string | null;
    default_model: string;
    timeout_seconds: number;
    clear_api_key?: boolean;
  }) =>
    request<ModelGatewayConfig>('/model-gateway/config', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  testModelGateway: (body: {
    prompt: string;
    model_connection_id?: string | null;
    model?: string | null;
    temperature?: number | null;
    max_tokens?: number | null;
    api_key?: string | null;
    secret_ref?: string | null;
  }) =>
    request<ModelGatewayTestResult>('/model-gateway/test', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  uploadSkillPackage: (body: { filename: string; content_base64: string }) =>
    request<SkillPackageRecord>('/skills/packages/upload', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  contractTest: (skillId: string) => request<SkillContractResult>(`/skills/${skillId}/contract-test`, { method: 'POST' }),
  updateSkillStatus: (skillId: string, action: 'approve' | 'disable' | 'deprecate', reason = '') =>
    request<SkillManifest>(`/skills/${skillId}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  rollbackSkillVersion: (skillId: string, targetSkillId: string, reason = '') =>
    request<SkillVersionHistory>(`/skills/${skillId}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ target_skill_id: targetSkillId, reason }),
    }),
  datasets: () => request<DatasetSummary[]>('/datasets'),
  datasetLineage: (datasetId: string, version: number) => request<DatasetLineage>(`/datasets/${datasetId}/versions/${version}/lineage`),
  datasetQuality: (datasetId: string, version: number) => request<DatasetQualityDiagnosis>(`/datasets/${datasetId}/versions/${version}/quality`),
  repairDatasetVersion: (datasetId: string, version: number, body: { drop_duplicate_rows?: boolean; fill_missing?: Record<string, unknown>; reason?: string }) =>
    request<DatasetVersion>(`/datasets/${datasetId}/versions/${version}/repair-version`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  uploadDataset: (body: { name: string; filename: string; content: string; golden?: boolean; label_field?: string; answer_field?: string }) =>
    request<DatasetVersion>('/datasets/upload', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  correctFieldType: (datasetId: string, version: number, fieldName: string, field_type: string) =>
    request<DatasetVersion>(`/datasets/${datasetId}/versions/${version}/fields/${fieldName}`, {
      method: 'POST',
      body: JSON.stringify({ field_type }),
    }),
  templates: () => request<Record<string, unknown>[]>('/workflow-templates'),
  workflows: () => request<WorkflowVersion[]>('/workflows'),
  workflowDrafts: (status?: string) => request<WorkflowDraftRecord[]>(`/workflow-drafts${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  workflowDraft: (draftId: string) => request<WorkflowDraftRecord>(`/workflow-drafts/${encodeURIComponent(draftId)}`),
  createWorkflowDraft: (body: { name: string; graph: WorkflowGraph }) =>
    request<WorkflowDraftRecord>('/workflow-drafts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateWorkflowDraft: (draftId: string, body: { name?: string; graph?: WorkflowGraph }) =>
    request<WorkflowDraftRecord>(`/workflow-drafts/${draftId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteWorkflowDraft: (draftId: string) => request<WorkflowDraftRecord>(`/workflow-drafts/${draftId}`, { method: 'DELETE' }),
  publishWorkflowDraft: (draftId: string) => request<WorkflowVersion>(`/workflow-drafts/${draftId}/publish`, { method: 'POST' }),
  copyWorkflow: (versionId: string, name: string) =>
    request<WorkflowVersion>(`/workflows/${encodeURIComponent(versionId)}/copy`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  archiveWorkflow: (versionId: string) => request<WorkflowVersion>(`/workflows/${encodeURIComponent(versionId)}/archive`, { method: 'POST' }),
  materializeSource: (body: { name: string; rows: Record<string, unknown>[]; golden?: boolean; label_field?: string }) =>
    request<DatasetVersion>('/datasets/source-materialize', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  validateGraph: (graph: WorkflowGraph, sample_row?: Record<string, unknown>) =>
    request<GraphValidationResult>('/workflow-graphs/validate', {
      method: 'POST',
      body: JSON.stringify({ graph, sample_row }),
    }),
  publishGraph: (graph: WorkflowGraph) =>
    request<WorkflowVersion>('/workflow-graphs/publish', {
      method: 'POST',
      body: JSON.stringify({ graph }),
    }),
  dryRunGraph: (body: { graph: WorkflowGraph; dataset_id: string; dataset_version: number; sample_size: number }) =>
    request<RunRecord>('/workflow-graphs/dry-run', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  previewWorkflowParameters: (body: { graph: WorkflowGraph; sample_row: Record<string, unknown>; task_overrides?: Record<string, Record<string, unknown>> }) =>
    request<WorkflowParameterPreview>('/workflow-graphs/parameter-preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createRun: (body: { workflow: WorkflowVersion; dataset_id: string; dataset_version: number; chunk_size?: number; concurrency?: number; sample_repeat_times?: number }) =>
    request<RunRecord>('/runs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  runs: () => request<RunRecord[]>('/runs'),
  runsPage: (filters: { status?: string; dataset_id?: string; workflow_version_id?: string; page?: number; pageSize?: number } = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (!value) return;
      query.set(key === 'pageSize' ? 'page_size' : key, String(value));
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<RunPageResult>(`/runs${suffix}`);
  },
  tasks: () => request<TaskRecord[]>('/tasks'),
  task: (taskId: string) => request<TaskRecord>(`/tasks/${encodeURIComponent(taskId)}`),
  tasksPage: (filters: { status?: string; dataset_id?: string; workflow_id?: string; q?: string; page?: number; pageSize?: number } = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      query.set(key === 'pageSize' ? 'page_size' : key, String(value));
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<TaskPageResult>(`/tasks${suffix}`);
  },
  taskExecutionTemplates: () => request<TaskExecutionTemplate[]>('/task-execution-templates'),
  createTaskExecutionTemplate: (body: {
    name: string;
    description?: string;
    evaluation_goal?: string | null;
    quality_gate?: Record<string, unknown>;
    execution_config?: Record<string, unknown>;
    tags?: string[];
  }) =>
    request<TaskExecutionTemplate>('/task-execution-templates', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createTask: (body: {
    name: string;
    dataset_id: string;
    dataset_version: number;
    workflow_version_id: string;
    execution_template_id?: string | null;
    evaluation_goal?: string | null;
    quality_gate?: Record<string, unknown>;
    preflight_id?: string | null;
    preflight_result?: TaskPreflightResult | null;
    chunk_size?: number;
    concurrency?: number;
    sample_repeat_times?: number;
    max_retries?: number;
    retry_backoff_seconds?: number;
    cost_budget?: number;
    skill_overrides?: Record<string, Record<string, unknown>>;
    allow_blocked_preflight?: boolean;
  }) =>
    request<TaskRecord>('/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  taskPreflight: (body: {
    dataset_id: string;
    dataset_version: number;
    workflow_version_id: string;
    execution_template_id?: string | null;
    evaluation_goal?: string | null;
    quality_gate?: Record<string, unknown>;
    cost_budget?: number;
    sample_repeat_times?: number;
    skill_overrides?: Record<string, Record<string, unknown>>;
  }) =>
    request<TaskPreflightResult>('/tasks/preflight', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  repairTasks: (filters: { source_task_id?: string } = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<RepairTaskRecord[]>(`/repair-tasks${suffix}`);
  },
  repairTasksPage: (filters: { source_task_id?: string; status?: string; page?: number; pageSize?: number } = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (!value) return;
      query.set(key === 'pageSize' ? 'page_size' : key, String(value));
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<RepairTaskPageResult>(`/repair-tasks${suffix}`);
  },
  repairTaskTree: (repairTaskId: string) => request<RepairTaskTree>(`/repair-tasks/${encodeURIComponent(repairTaskId)}/tree`),
  createRepairTasksFromDiagnostics: (taskId: string) =>
    request<{ source_task_id: string; created_count: number; reused_count: number; repair_tasks: RepairTaskRecord[] }>(`/tasks/${taskId}/repair-tasks/from-diagnostics`, { method: 'POST' }),
  startRepairTask: (repairTaskId: string, body: { owner: string }) =>
    request<RepairTaskRecord>(`/repair-tasks/${encodeURIComponent(repairTaskId)}/start`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  assignRepairTask: (repairTaskId: string, body: { owner: string; due_at?: string | null }) =>
    request<RepairTaskRecord>(`/repair-tasks/${encodeURIComponent(repairTaskId)}/assign`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resolveRepairTask: (repairTaskId: string, body: { resolution_note: string }) =>
    request<RepairTaskRecord>(`/repair-tasks/${encodeURIComponent(repairTaskId)}/resolve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  reopenRepairTask: (repairTaskId: string, body: { reason: string }) =>
    request<RepairTaskRecord>(`/repair-tasks/${encodeURIComponent(repairTaskId)}/reopen`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  runRepairTaskAction: (repairTaskId: string, body: { action: string; assignee?: string | null; limit?: number }) =>
    request<{ action: string; result: Record<string, unknown>; repair_task: RepairTaskRecord }>(`/repair-tasks/${encodeURIComponent(repairTaskId)}/actions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  executeTask: (taskId: string) => request<TaskRecord>(`/tasks/${taskId}/execute?background=true`, { method: 'POST' }),
  createTaskAttempt: (taskId: string) => request<TaskRecord>(`/tasks/${taskId}/attempts`, { method: 'POST' }),
  pauseTask: (taskId: string) => request<TaskRecord>(`/tasks/${taskId}/pause`, { method: 'POST' }),
  resumeTask: (taskId: string) => request<TaskRecord>(`/tasks/${taskId}/resume`, { method: 'POST' }),
  cancelTask: (taskId: string) => request<TaskRecord>(`/tasks/${taskId}/cancel`, { method: 'POST' }),
  retryFailedTask: (taskId: string) => request<TaskRecord>(`/tasks/${taskId}/retry-failed`, { method: 'POST' }),
  taskReport: (
    taskId: string,
    pagination: {
      badcasePage?: number;
      badcasePageSize?: number;
      stepPage?: number;
      stepPageSize?: number;
      stepQuery?: string;
      segmentPage?: number;
      segmentPageSize?: number;
      segmentQuery?: string;
      rootCausePage?: number;
      rootCausePageSize?: number;
      rootCauseQuery?: string;
      diagnosticStepPage?: number;
      diagnosticStepPageSize?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    if (pagination.badcasePage) query.set('badcase_page', String(pagination.badcasePage));
    if (pagination.badcasePageSize) query.set('badcase_page_size', String(pagination.badcasePageSize));
    if (pagination.stepPage) query.set('step_page', String(pagination.stepPage));
    if (pagination.stepPageSize) query.set('step_page_size', String(pagination.stepPageSize));
    if (pagination.stepQuery) query.set('step_query', pagination.stepQuery);
    if (pagination.segmentPage) query.set('segment_page', String(pagination.segmentPage));
    if (pagination.segmentPageSize) query.set('segment_page_size', String(pagination.segmentPageSize));
    if (pagination.segmentQuery) query.set('segment_query', pagination.segmentQuery);
    if (pagination.rootCausePage) query.set('root_cause_page', String(pagination.rootCausePage));
    if (pagination.rootCausePageSize) query.set('root_cause_page_size', String(pagination.rootCausePageSize));
    if (pagination.rootCauseQuery) query.set('root_cause_query', pagination.rootCauseQuery);
    if (pagination.diagnosticStepPage) query.set('diagnostic_step_page', String(pagination.diagnosticStepPage));
    if (pagination.diagnosticStepPageSize) query.set('diagnostic_step_page_size', String(pagination.diagnosticStepPageSize));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<TaskReport>(`/tasks/${taskId}/report${suffix}`);
  },
  exportTaskReport: (taskId: string, file_format: 'json' | 'csv' | 'html', role = 'Evaluator', approvalRequestId?: string) => {
    const query = new URLSearchParams({ file_format, role });
    if (approvalRequestId) query.set('approval_request_id', approvalRequestId);
    return request<Record<string, unknown>>(`/tasks/${taskId}/report/export?${query.toString()}`);
  },
  exportTaskReportOfflinePackage: (taskId: string, role = 'Evaluator', approvalRequestId?: string) => {
    const query = new URLSearchParams({ role });
    if (approvalRequestId) query.set('approval_request_id', approvalRequestId);
    return requestOfflinePackageDownload(`/tasks/${taskId}/report/offline-package?${query.toString()}`);
  },
  exportTaskResults: (taskId: string, file_format: 'json' | 'jsonl' | 'csv', includeSteps = false) => {
    const query = new URLSearchParams({ file_format });
    if (includeSteps) query.set('include_steps', 'true');
    return requestDownload(`/tasks/${taskId}/results/export?${query.toString()}`);
  },
  reportExportRequests: (filters: { task_id?: string; status?: string } = {}) => {
    const query = new URLSearchParams();
    if (filters.task_id) query.set('task_id', filters.task_id);
    if (filters.status) query.set('status', filters.status);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<ReportExportRequest[]>(`/report-export-requests${suffix}`);
  },
  createReportExportRequest: (taskId: string, body: { file_format: 'json' | 'csv' | 'html' | 'offline_zip'; requester_role: string; reason?: string }) =>
    request<ReportExportRequest>(`/tasks/${taskId}/report/export-requests`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  approveReportExportRequest: (requestId: string, body: { approver_role?: string; note?: string } = {}) =>
    request<ReportExportRequest>(`/report-export-requests/${encodeURIComponent(requestId)}/approve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  rejectReportExportRequest: (requestId: string, body: { approver_role?: string; note?: string } = {}) =>
    request<ReportExportRequest>(`/report-export-requests/${encodeURIComponent(requestId)}/reject`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  revokeReportExportRequest: (requestId: string, body: { requester_role?: string; reason?: string } = {}) =>
    request<ReportExportRequest>(`/report-export-requests/${encodeURIComponent(requestId)}/revoke`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  taskDiagnostics: (taskId: string) => request<TaskDiagnostics>(`/tasks/${taskId}/diagnostics`),
  taskParameterGovernance: (taskId: string) => request<TaskParameterGovernance>(`/tasks/${taskId}/parameter-governance`),
  taskTraceTree: (taskId: string, pagination: { page?: number; pageSize?: number } = {}) => {
    const query = new URLSearchParams();
    if (pagination.page) query.set('page', String(pagination.page));
    if (pagination.pageSize) query.set('page_size', String(pagination.pageSize));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<TraceTree>(`/tasks/${taskId}/trace-tree${suffix}`);
  },
  taskTraceFlow: (taskId: string, pagination: { page?: number; pageSize?: number } = {}) => {
    const query = new URLSearchParams();
    if (pagination.page) query.set('page', String(pagination.page));
    if (pagination.pageSize) query.set('page_size', String(pagination.pageSize));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<TaskTraceFlow>(`/tasks/${taskId}/trace-flow${suffix}`);
  },
  replayRunItemStep: (runId: string, itemId: string, stepId: string, body: StepReplayRequest = {}) =>
    request<StepDebugPayload>(`/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/steps/${encodeURIComponent(stepId)}/replay`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  debugRunItemStepPrompt: (runId: string, itemId: string, stepId: string, body: StepPromptDebugRequest = {}) =>
    request<StepDebugPayload>(`/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/steps/${encodeURIComponent(stepId)}/prompt-debug`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  runItemStepReproBundle: (runId: string, itemId: string, stepId: string) =>
    request<StepDebugPayload>(`/runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/steps/${encodeURIComponent(stepId)}/repro-bundle`),
  executeRun: (runId: string) => request<RunRecord>(`/runs/${runId}/execute`, { method: 'POST' }),
  pauseRun: (runId: string) => request<RunRecord>(`/runs/${runId}/pause`, { method: 'POST' }),
  resumeRun: (runId: string) => request<RunRecord>(`/runs/${runId}/resume`, { method: 'POST' }),
  cancelRun: (runId: string) => request<RunRecord>(`/runs/${runId}/cancel`, { method: 'POST' }),
  retryFailedRun: (runId: string) => request<RunRecord>(`/runs/${runId}/retry-failed`, { method: 'POST' }),
  runTrace: (runId: string) => request<Record<string, unknown>>(`/runs/${runId}/trace`),
  traceTree: (runId: string, pagination: { page?: number; pageSize?: number } = {}) => {
    const query = new URLSearchParams();
    if (pagination.page) query.set('page', String(pagination.page));
    if (pagination.pageSize) query.set('page_size', String(pagination.pageSize));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<TraceTree>(`/runs/${runId}/trace-tree${suffix}`);
  },
  report: (runId: string) => request<RunReport>(`/runs/${runId}/report`),
  exportReport: (runId: string, file_format: 'json' | 'csv' | 'html') => request<Record<string, unknown>>(`/runs/${runId}/report/export?file_format=${file_format}`),
  badcases: (query = '') => request<BadcaseRecord[]>(`/badcases${query}`),
  correctBadcase: (badcaseId: string, body: { human_label: string; problem_type: string; note?: string; add_to_golden?: boolean; ignore?: boolean }) =>
    request<BadcaseRecord>(`/badcases/${badcaseId}/correct`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  reopenBadcase: (badcaseId: string) => request<BadcaseRecord>(`/badcases/${badcaseId}/reopen`, { method: 'POST' }),
  bulkCorrectBadcases: (body: { badcase_ids: string[]; human_label: string; problem_type: string; note?: string; add_to_golden?: boolean; ignore?: boolean }) =>
    request<BadcaseRecord[]>('/badcases/bulk-correct', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  badcaseClusters: () => request<Record<string, unknown>[]>('/badcases/clusters'),
  exportBadcases: () => request<Record<string, unknown>>('/badcases/export?file_format=jsonl'),
  createBadcase: (body: { run_id: string; item_id: string; reason: string; payload: Record<string, unknown> }) =>
    request<BadcaseRecord>('/badcases', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  judgeProfiles: () => request<JudgeProfile[]>('/judge-profiles'),
  judgeAudits: () => request<StoredJudgeAudit[]>('/judge-audits'),
  judgeAuditTrends: () => request<JudgeAuditTrends>('/judge-audits/trends'),
  createJudgeProfile: (body: { name: string; model: string; prompt: string; rubric: Record<string, unknown>; threshold: number; output_schema: Record<string, unknown> }) =>
    request<JudgeProfile>('/judge-profiles', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createJudgeAudit: (profileId: string, body: { dataset_version_id: string; human_labels: string[]; judge_labels: string[]; positive_label?: string }) =>
    request<StoredJudgeAudit>(`/judge-profiles/${profileId}/audits`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  crossValidateJudges: (body: { dataset_version_id: string; human_labels: string[]; judge_outputs_by_profile: Record<string, string[]> }) =>
    request<JudgeCrossValidationResult>('/judge-cross-validation', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  auditEvents: (filters: { actor?: string; action?: string; target?: string } = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<AuditEvent[]>(`/audit-events${suffix}`);
  },
};
