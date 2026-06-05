import type { ExperimentRecord, WorkflowPromotionReleaseArtifacts } from './experiment';
import type { TaskRecord } from './task';
export type AnnotationTask = {
  task_id: string;
  run_id: string;
  source_task_id?: string | null;
  source_task_name?: string | null;
  item_id: string;
  row_id: string;
  status: string;
  assignee?: string | null;
  priority: string;
  reason: string;
  business_label?: string | null;
  due_at?: string | null;
  sla_status?: string | null;
  overdue?: boolean;
  payload: Record<string, unknown>;
  review?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type AnnotationQueueSummary = {
  total_open: number;
  total_assigned: number;
  total_pending?: number;
  total_overdue: number;
  owners: {
    assignee: string;
    backlog: number;
    overdue_count: number;
    next_due_at?: string | null;
    status_counts?: Record<string, number>;
  }[];
};

export type AnnotationQueuePageResult = {
  items: AnnotationTask[];
  pagination: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
  summary?: AnnotationQueueSummary;
};

export type AnnotationDispatchResult = {
  assigned_count: number;
  skipped_count: number;
  tasks: AnnotationTask[];
  skipped: { task_id?: string; item_id?: string; business_label?: string | null; reason: string }[];
  owners: {
    assignee: string;
    capacity: number;
    labels?: string[];
    backlog_before: number;
    backlog_after: number;
    assigned_count: number;
    overdue_count: number;
  }[];
};

export type AnnotationCandidate = {
  candidate_id: string;
  kind: 'golden' | 'assertion' | string;
  source: string;
  annotation_task_id: string;
  source_task_id?: string | null;
  source_task_name?: string | null;
  run_id?: string | null;
  item_id: string;
  row_id?: string | null;
  human_label: string;
  note?: string;
  reviewer?: string;
  status: string;
  created_at: string;
  updated_at?: string;
};

export type PromptSkillCandidate = {
  candidate_id: string;
  kind: string;
  status: string;
  previous_status?: string | null;
  owner?: string | null;
  due_at?: string | null;
  assigned_by?: string | null;
  assigned_at?: string | null;
  archived_by?: string | null;
  archived_at?: string | null;
  archive_note?: string | null;
  overdue?: boolean;
  escalation_status?: string | null;
  escalated_by?: string | null;
  escalated_at?: string | null;
  action_history?: Record<string, unknown>[];
  source_repair_task_id?: string | null;
  source_task_id?: string | null;
  source_run_id?: string | null;
  baseline_experiment_id?: string | null;
  baseline_run_id?: string | null;
  baseline_metrics?: Record<string, number>;
  current_versions: Record<string, unknown>[];
  version_diffs: {
    step_id?: string;
    field?: string;
    baseline_value?: unknown;
    current_value?: unknown;
    recommended_action?: string;
  }[];
  recommended_actions?: string[];
  review?: Record<string, unknown> | null;
  review_history?: Record<string, unknown>[];
  workflow_draft_id?: string | null;
  retest_task_id?: string | null;
  candidate_run_id?: string | null;
  candidate_experiment_id?: string | null;
  scorecard?: PromptSkillCandidateScorecard;
  comparisons?: PromptSkillCandidateComparisons;
  promotion_recommendation?: PromptSkillPromotionRecommendation;
  created_at: string;
  updated_at?: string;
};

export type PromptSkillCandidatePageResult = {
  items: PromptSkillCandidate[];
  pagination: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
};

export type PromptSkillCandidateWorkload = {
  summary: {
    total_candidates: number;
    total_open: number;
    total_overdue: number;
    escalated: number;
  };
  owners: {
    owner: string;
    total: number;
    open_count: number;
    overdue_count: number;
    escalated_count: number;
    status_counts: Record<string, number>;
  }[];
};

export type PromptSkillCandidateRetestPlanItem = {
  rank: number;
  candidate_id: string;
  status?: string | null;
  owner?: string | null;
  due_at?: string | null;
  overdue?: boolean;
  escalation_status?: string | null;
  workflow_draft_id?: string | null;
  retest_task_id?: string | null;
  next_action: string;
  priority_score: number;
  reasons: string[];
  target_url?: string | null;
  updated_at?: string | null;
};

export type PromptSkillCandidateRetestPlan = {
  summary: {
    total_candidates: number;
    ready_for_retest: number;
    needs_publish: number;
    needs_draft: number;
    already_retested: number;
    overdue: number;
    escalated: number;
  };
  items: PromptSkillCandidateRetestPlanItem[];
  generated_at?: string | null;
};

export type PromptSkillCandidateBulkRetestResult = {
  status: string;
  requested_count: number;
  retested_count: number;
  skipped_count: number;
  results: {
    candidate_id: string;
    status: string;
    task_id: string;
    run_id?: string | null;
    candidate_experiment_id?: string | null;
    target_url?: string | null;
  }[];
  skipped: {
    candidate_id: string;
    next_action: string;
    reason: string;
    code?: string;
    target_url?: string | null;
  }[];
  plan_summary?: PromptSkillCandidateRetestPlan['summary'];
};

export type PromptSkillCandidateBulkReviewResult = {
  reviewed_count: number;
  skipped_count: number;
  candidates: PromptSkillCandidate[];
  skipped: { candidate_id: string; reason: string }[];
};

export type PromptSkillCandidateBulkAssignResult = {
  assigned_count: number;
  skipped_count?: number;
  candidates: PromptSkillCandidate[];
  skipped?: {
    candidate_id: string;
    reason: string;
    owner?: string;
    open_count?: number;
    max_open_per_owner?: number;
  }[];
  capacity?: {
    owner: string;
    max_open_per_owner?: number | null;
    open_before: number;
    open_after: number;
  };
};

export type PromptSkillCandidateBulkArchiveResult = {
  archived_count: number;
  skipped_count: number;
  candidates: PromptSkillCandidate[];
  skipped: {
    candidate_id: string;
    reason: string;
    status?: string;
    stale_before?: string | null;
  }[];
};

export type PromptSkillCandidateEscalationResult = {
  escalated_count: number;
  candidates: PromptSkillCandidate[];
  workload?: PromptSkillCandidateWorkload;
};

export type PromptSkillMetricCard = {
  label: string;
  task_id?: string | null;
  experiment_id?: string | null;
  run_id?: string | null;
  workflow_version_id?: string | null;
  dataset_id?: string | null;
  dataset_version?: number | null;
  status?: string;
  total_items?: number;
  completed_items?: number;
  failed_items?: number;
  pass_rate?: number;
  error_rate?: number;
  badcase_count?: number;
  p95_latency_ms?: number;
};

export type PromptSkillCandidateScorecard = {
  baseline?: PromptSkillMetricCard;
  current?: PromptSkillMetricCard;
  candidate?: PromptSkillMetricCard;
};

export type PromptSkillCandidateComparisons = {
  current_to_candidate?: Record<string, unknown>;
  baseline_to_candidate?: Record<string, unknown> | null;
};

export type PromptSkillPromotionCheck = {
  check_id: string;
  status: 'passed' | 'warning' | 'failed' | 'skipped' | string;
  message: string;
  details?: Record<string, unknown>;
};

export type PromptSkillPromotionRecommendation = {
  decision: 'promote' | 'review' | 'hold' | string;
  summary: string;
  thresholds: Record<string, unknown>;
  checks: PromptSkillPromotionCheck[];
  next_actions: Array<{ action: string; label: string }>;
};

export type PromptSkillCandidateRetestResult = {
  status: string;
  candidate: PromptSkillCandidate;
  task: TaskRecord;
  candidate_experiment: ExperimentRecord;
  scorecard: PromptSkillCandidateScorecard;
  comparisons: PromptSkillCandidateComparisons;
  promotion_recommendation?: PromptSkillPromotionRecommendation;
  target_url: string;
};

export type WorkflowPromotionReview = {
  review_id: string;
  candidate_id: string;
  status: string;
  source_task_id?: string | null;
  retest_task_id?: string | null;
  candidate_run_id?: string | null;
  candidate_experiment_id?: string | null;
  candidate_workflow_version_id?: string | null;
  current_workflow_version_id?: string | null;
  baseline_experiment_id?: string | null;
  requester?: string;
  reviewer?: string;
  note?: string;
  review_note?: string;
  baseline_suggestion_id?: string | null;
  release_record_id?: string | null;
  promotion_recommendation?: PromptSkillPromotionRecommendation;
  target_url?: string;
  created_at: string;
  updated_at?: string;
};

export type WorkflowPromotionReviewResult = {
  status: string;
  candidate: PromptSkillCandidate;
  review: WorkflowPromotionReview;
  release_artifacts?: WorkflowPromotionReleaseArtifacts;
  target_url?: string;
};

