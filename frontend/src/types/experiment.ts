import type { CIGateEvaluationRecord } from './ci';
import type { TaskRecord } from './task';
export type ExperimentRecord = {
  experiment_id: string;
  name: string;
  run_id: string;
  baseline_run_id?: string | null;
  dataset_id?: string;
  dataset_version?: number;
  dataset_version_id?: string | null;
  workflow_id?: string;
  workflow_name?: string;
  workflow_version_id?: string;
  status: string;
  tags: string[];
  snapshot: Record<string, unknown>;
  metrics: Record<string, number>;
  baseline_metrics?: Record<string, number> | null;
  diff?: Record<string, number> | null;
  failure_distribution?: Record<string, number>;
  created_at: string;
};

export type ExperimentBaselineSuggestion = {
  suggestion_id: string;
  candidate_id: string;
  review_id: string;
  status: string;
  suggested_experiment_id?: string | null;
  suggested_run_id?: string | null;
  previous_baseline_experiment_id?: string | null;
  previous_baseline_run_id?: string | null;
  workflow_version_id?: string | null;
  metrics?: Record<string, number>;
  baseline_metrics?: Record<string, number> | null;
  reason?: string;
  target_url?: string;
  applied_by?: string;
  applied_at?: string;
  apply_ci_gate_guard_status?: string;
  apply_ci_gate_evaluation_ids?: string[];
  apply_impact?: ExperimentBaselineImpact;
  rolled_back_by?: string;
  rolled_back_at?: string;
  created_at: string;
  updated_at?: string;
};

export type ExperimentBaselineRecord = {
  baseline_id: string;
  scope: { dataset_id?: string | null; workflow_id?: string | null };
  current_experiment_id?: string | null;
  previous_experiment_id?: string | null;
  status: string;
  history: Array<{
    action: string;
    suggestion_id?: string;
    from_experiment_id?: string | null;
    to_experiment_id?: string | null;
    actor?: string;
    note?: string;
    ci_gate_guard_status?: string;
    ci_gate_evaluation_ids?: string[];
    created_at?: string;
  }>;
  created_at: string;
  updated_at?: string;
};

export type BaselineChangeNotification = {
  notification_id: string;
  baseline_id: string;
  suggestion_id: string;
  action: 'apply' | 'rollback' | string;
  status: 'unread' | 'acknowledged' | string;
  actor?: string;
  note?: string;
  scope?: { dataset_id?: string | null; workflow_id?: string | null };
  from_experiment_id?: string | null;
  to_experiment_id?: string | null;
  recipients?: string[];
  affected_task_ids?: string[];
  summary?: {
    affected_tasks?: number;
    affected_reports?: number;
    ci_gate_configs?: number;
    rollback_guard_status?: string;
    rollback_blocking_failures?: number;
    metric_delta?: Record<string, unknown>;
  };
  message?: string;
  acknowledged_by?: string;
  acknowledged_at?: string;
  ack_note?: string;
  created_at: string;
  updated_at?: string;
};

export type ExperimentBaselineActionResult = {
  status: string;
  suggestion: ExperimentBaselineSuggestion;
  baseline: ExperimentBaselineRecord;
  notifications?: BaselineChangeNotification[];
  ci_gate_guard?: {
    status: string;
    ci_gate_evaluations: CIGateEvaluationRecord[];
    blocking_failures?: number;
  };
  rollback_guard?: {
    status: string;
    ci_gate_evaluations: CIGateEvaluationRecord[];
    blocking_failures?: number;
  };
};

export type ExperimentBaselineImpact = {
  suggestion_id: string;
  status?: string;
  scope: { dataset_id?: string | null; workflow_id?: string | null };
  suggested_experiment_id?: string | null;
  previous_baseline_experiment_id?: string | null;
  metric_delta: Record<string, unknown>;
  summary: {
    affected_tasks: number;
    affected_reports: number;
    ci_gate_configs: number;
  };
  affected_tasks: Partial<TaskRecord>[];
  recommendations: Array<{ action: string; label: string; message?: string }>;
  generated_at?: string;
};

export type WorkflowReleaseRecord = {
  record_id: string;
  candidate_id: string;
  review_id: string;
  workflow_version_id?: string | null;
  candidate_experiment_id?: string | null;
  source_task_id?: string | null;
  retest_task_id?: string | null;
  status: string;
  ci_gate_config_ids: string[];
  ci_gate_evaluation_ids: string[];
  blocking_failures: number;
  approved_by?: string | null;
  approval_note?: string | null;
  approved_at?: string | null;
  target_url?: string;
  created_at: string;
  updated_at?: string;
};

export type WorkflowPromotionReleaseArtifacts = {
  baseline_suggestion?: ExperimentBaselineSuggestion | null;
  release_record?: WorkflowReleaseRecord | null;
  ci_gate_evaluations?: CIGateEvaluationRecord[];
};

