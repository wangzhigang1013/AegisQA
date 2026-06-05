import type { ExperimentBaselineRecord, WorkflowReleaseRecord } from './experiment';
import type { RunReport, TaskParameterGovernance, TaskPreflightResult, TaskRecord } from './task';
import type { WorkbenchAction } from './actions';

export type ReportPagination = {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
};

export type BadcaseRecord = {
  badcase_id: string;
  run_id: string;
  item_id: string;
  status: string;
  reason: string;
  payload: Record<string, unknown>;
  human_label?: string | null;
  problem_type?: string | null;
  note?: string | null;
  golden_candidate: boolean;
  created_at: string;
  updated_at: string;
};

export type TaskReport = {
  task: TaskRecord;
  task_summary?: {
    task_id: string;
    task_name: string;
    run_id: string;
    status: string;
    dataset_name?: string;
    workflow_name?: string;
    sample_count: number;
    current_attempt?: number;
    created_at?: string;
    updated_at?: string;
  };
  version_snapshot?: {
    dataset: Record<string, unknown>;
    workflow: Record<string, unknown>;
    execution_config?: Record<string, unknown>;
  };
  preflight_evidence?: TaskPreflightResult | null;
  step_distribution?: {
    step_id: string;
    skill_ref: string;
    total_calls: number;
    succeeded: number;
    failed: number;
    cache_hits: number;
    total_latency_ms: number;
    average_latency_ms: number;
  }[];
  step_distribution_pagination?: ReportPagination;
  judge_score_distribution?: { bucket: string; count: number }[];
  segments?: {
    segment_key: string;
    segment_value: string;
    sample_count: number;
    pass_count: number;
    fail_count: number;
    badcase_count: number;
    pass_rate: number;
    average_score?: number | null;
  }[];
  segments_pagination?: ReportPagination;
  recommendations?: {
    type: string;
    title: string;
    message: string;
    action: string;
    severity: string;
    segment_key?: string | null;
    segment_value?: string | null;
  }[];
  quality_decision?: QualityDecision;
  parameter_governance?: TaskParameterGovernance;
  budget_status?: BudgetStatus;
  release_context?: {
    baselines: ExperimentBaselineRecord[];
    release_records: WorkflowReleaseRecord[];
  };
  diagnostics?: TaskDiagnostics;
  diagnostics_pagination?: {
    root_causes?: ReportPagination;
    step_health?: ReportPagination;
    weak_segments?: ReportPagination;
  };
  primary_findings?: {
    type: string;
    status: string;
    severity: string;
    title: string;
    message: string;
    evidence: string[];
    source: string;
  }[];
  recommended_actions?: WorkbenchAction[];
  action_targets?: Record<string, string>;
  report: RunReport;
  badcases: Record<string, unknown>[];
  badcase_pagination?: ReportPagination;
  export_links: {
    json: string;
    csv: string;
    html: string;
    offline_package?: string;
  };
};

export type TaskResultsExportDownload = {
  blob: Blob;
  file_format: 'json' | 'jsonl' | 'csv';
  filename?: string;
  row_count?: number;
  include_steps?: boolean;
};

export type ReportOfflinePackageDownload = {
  blob: Blob;
  file_format: 'offline_zip';
  filename?: string;
  file_count?: number;
};

export type ReportExportRequest = {
  request_id: string;
  task_id: string;
  task_name?: string;
  run_id?: string;
  file_format: 'json' | 'csv' | 'html' | 'offline_zip';
  requester_role: string;
  requested_permission: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired' | string;
  expires_at?: string;
  approved_by?: string;
  approval_note?: string;
  approved_at?: string;
  rejected_by?: string;
  rejection_note?: string;
  rejected_at?: string;
  revoked_by?: string;
  revoke_reason?: string;
  revoked_at?: string;
  expired_at?: string;
  created_at: string;
  updated_at: string;
};

export type TaskDiagnostics = {
  task_id?: string;
  run_id?: string;
  summary: {
    status: string;
    primary_cause: string;
    confidence: number;
    evidence_count: number;
  };
  root_causes: {
    cause_type: string;
    severity: string;
    confidence: number;
    affected_items: number;
    evidence: string[];
    recommendation: string;
    next_actions: string[];
  }[];
  weak_segments: {
    segment_key: string;
    segment_value: string;
    sample_count: number;
    badcase_count: number;
    pass_rate: number;
    severity: string;
  }[];
  step_health: {
    step_id: string;
    skill_ref: string;
    total_calls: number;
    failed_calls: number;
    cache_hits: number;
    total_latency_ms: number;
    average_latency_ms: number;
    cache_hit_rate: number;
    status: string;
    signals: string[];
  }[];
  data_quality: {
    row_count: number;
    duplicate_row_count: number;
    field_coverage: {
      field: string;
      present_count: number;
      missing_count: number;
      coverage: number;
      required_by_workflow: boolean;
    }[];
    warnings: string[];
  };
  parameter_risks: {
    override_count: number;
    expression_count: number;
    secret_ref_count: number;
    redacted_count: number;
    sources: Record<string, number>;
    warnings: string[];
  };
};

export type BudgetStatus = {
  status: 'ok' | 'warning' | 'exceeded' | 'not_set' | string;
  cost_budget?: number | null;
  cost_used: number;
  budget_remaining?: number | null;
  usage_ratio?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  cost_source?: string | null;
  cost_currency?: string | null;
  message: string;
};

export type QualityDecision = {
  status: 'passed' | 'warning' | 'blocked' | string;
  task_id?: string;
  run_id?: string;
  risk_summary: {
    pass_rate: number;
    error_rate: number;
    badcase_count: number;
    weak_segment_count: number;
  };
  top_risks: {
    type: string;
    severity: string;
    message: string;
    segment_key?: string;
    segment_value?: string;
  }[];
  next_actions: {
    action: string;
    label: string;
  }[];
};

export type RedTeamScanResult = {
  scan_id: string;
  target: { kind: 'task' | 'run'; id: string };
  run_id: string;
  summary: {
    status: string;
    risk_count: number;
    critical_count: number;
    warning_count: number;
    scanned_items: number;
  };
  risks: {
    risk_id: string;
    risk_type: string;
    severity: string;
    item_id: string;
    row_id: string;
    field_path: string;
    evidence: string;
    message: string;
    recommendation: string;
  }[];
  recommendations: {
    action: string;
    label: string;
    message: string;
  }[];
  created_at: string;
};

export type ScoreAnalytics = {
  summary: {
    task_count: number;
    average_pass_rate: number;
    latest_pass_rate: number;
    badcase_count: number;
    regression_count: number;
  };
  trend: {
    task_id: string;
    task_name?: string;
    dataset_id?: string;
    dataset_name?: string;
    workflow_id?: string;
    workflow_name?: string;
    workflow_version_id?: string;
    status?: string;
    pass_rate: number;
    error_rate: number;
    badcase_count: number;
    p95_latency_ms: number;
    average_latency_ms: number;
    cost_used: number;
    created_at?: string;
    updated_at?: string;
  }[];
  regressions: {
    task_id?: string;
    task_name?: string;
    baseline_task_id?: string;
    dataset_id?: string;
    workflow_id?: string;
    pass_rate_delta: number;
    message: string;
  }[];
  pagination?: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
};

export type AssertionEvaluationResult = {
  ok: boolean;
  summary: { passed: number; failed: number };
  results: {
    assertion_id: string;
    type: string;
    field_path: string;
    status: string;
    actual: unknown;
    message: string;
    severity: string;
  }[];
};

