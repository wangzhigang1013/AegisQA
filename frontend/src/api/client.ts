import type {
  AnnotationTask,
  AnnotationCandidate,
  AssertionEvaluationResult,
  BadcaseRecord,
  CIGateConfigRecord,
  CIGateRule,
  CIGateEvaluationResult,
  DashboardSummary,
  DatasetSummary,
  DatasetVersion,
  ExperimentRecord,
  GraphValidationResult,
  JudgeProfile,
  RunRecord,
  RunReport,
  SkillContractResult,
  SkillManifest,
  SkillPackageRecord,
  StoredJudgeAudit,
  TaskRecord,
  TaskReport,
  TaskTraceFlow,
  TraceTree,
  WorkflowDraftRecord,
  WorkflowGraph,
  WorkflowParameterPreview,
  WorkflowVersion,
} from '../types';

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
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message ?? payload?.detail ?? `请求失败：${response.status}`;
    throw new ApiError(message, {
      code: payload?.code,
      details: payload?.details,
      trace_id: payload?.trace_id,
      status: response.status,
    });
  }
  return payload as T;
}

export const api = {
  health: () => request<{ status: string; service: string }>('/health'),
  dashboard: () => request<DashboardSummary>('/dashboard/summary'),
  experiments: () => request<ExperimentRecord[]>('/experiments'),
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
  annotationQueue: (filters: { status?: string; assignee?: string; source_task_id?: string } = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<AnnotationTask[]>(`/annotation-queue${suffix}`);
  },
  seedAnnotationQueue: (body: { run_id: string; strategy?: string; limit?: number; assignee?: string | null }) =>
    request<{ run_id: string; created_count: number; tasks: AnnotationTask[] }>('/annotation-queue/seed-from-run', {
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
  skills: () => request<SkillManifest[]>('/skills'),
  skillPackages: () => request<SkillPackageRecord[]>('/skills/packages'),
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
  datasets: () => request<DatasetSummary[]>('/datasets'),
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
  workflowDrafts: () => request<WorkflowDraftRecord[]>('/workflow-drafts'),
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
  tasks: () => request<TaskRecord[]>('/tasks'),
  createTask: (body: {
    name: string;
    dataset_id: string;
    dataset_version: number;
    workflow_version_id: string;
    chunk_size?: number;
    concurrency?: number;
    sample_repeat_times?: number;
    max_retries?: number;
    retry_backoff_seconds?: number;
    cost_budget?: number;
    skill_overrides?: Record<string, Record<string, unknown>>;
  }) =>
    request<TaskRecord>('/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  executeTask: (taskId: string) => request<TaskRecord>(`/tasks/${taskId}/execute`, { method: 'POST' }),
  createTaskAttempt: (taskId: string) => request<TaskRecord>(`/tasks/${taskId}/attempts`, { method: 'POST' }),
  pauseTask: (taskId: string) => request<TaskRecord>(`/tasks/${taskId}/pause`, { method: 'POST' }),
  resumeTask: (taskId: string) => request<TaskRecord>(`/tasks/${taskId}/resume`, { method: 'POST' }),
  cancelTask: (taskId: string) => request<TaskRecord>(`/tasks/${taskId}/cancel`, { method: 'POST' }),
  retryFailedTask: (taskId: string) => request<TaskRecord>(`/tasks/${taskId}/retry-failed`, { method: 'POST' }),
  taskReport: (taskId: string) => request<TaskReport>(`/tasks/${taskId}/report`),
  taskTraceTree: (taskId: string) => request<TraceTree>(`/tasks/${taskId}/trace-tree`),
  taskTraceFlow: (taskId: string) => request<TaskTraceFlow>(`/tasks/${taskId}/trace-flow`),
  executeRun: (runId: string) => request<RunRecord>(`/runs/${runId}/execute`, { method: 'POST' }),
  pauseRun: (runId: string) => request<RunRecord>(`/runs/${runId}/pause`, { method: 'POST' }),
  resumeRun: (runId: string) => request<RunRecord>(`/runs/${runId}/resume`, { method: 'POST' }),
  cancelRun: (runId: string) => request<RunRecord>(`/runs/${runId}/cancel`, { method: 'POST' }),
  retryFailedRun: (runId: string) => request<RunRecord>(`/runs/${runId}/retry-failed`, { method: 'POST' }),
  runTrace: (runId: string) => request<Record<string, unknown>>(`/runs/${runId}/trace`),
  traceTree: (runId: string) => request<TraceTree>(`/runs/${runId}/trace-tree`),
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
  auditEvents: () => request<Record<string, unknown>[]>('/audit-events'),
};
