export type ApiError = {
  code: string;
  message: string;
  details: Record<string, unknown>;
  trace_id: string;
};

export type SkillManifest = {
  skill_id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  scenarios: string[];
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  config_schema: Record<string, unknown>;
  cacheable: boolean;
  permissions: string[];
  enabled: boolean;
  status: string;
  example_input: Record<string, unknown>;
  example_config: Record<string, unknown>;
};

export type DatasetVersion = {
  dataset_id: string;
  name: string;
  version: number;
  version_id: string;
  row_count: number;
  field_schema: Record<string, string>;
  preview: Record<string, unknown>[];
  golden: boolean;
  label_field?: string | null;
  answer_field?: string | null;
  field_paths?: string[];
};

export type DatasetSummary = {
  dataset_id: string;
  name: string;
  latest_version: number;
  latest_version_id: string;
  row_count: number;
  golden: boolean;
  versions: DatasetVersion[];
};

export type DatasetLineage = {
  dataset_id: string;
  dataset_version: number;
  dataset_version_id: string;
  name: string;
  row_count: number;
  golden: boolean;
  label_field?: string | null;
  answer_field?: string | null;
  created_at?: string;
  source: {
    type: string;
    ref: Record<string, unknown>;
  };
  field_count: number;
  fields: Record<string, string>;
  field_paths: string[];
  preview: Record<string, unknown>[];
  downstream_tasks: {
    task_id: string;
    name: string;
    status: string;
    workflow_id?: string;
    workflow_name?: string;
    workflow_version_id?: string;
    run_id?: string;
    created_at?: string;
    updated_at?: string;
  }[];
};

export type WorkflowGraphNode = {
  node_id: string;
  node_type: 'source' | 'skill' | 'branch' | 'join' | 'aggregator' | 'output';
  label?: string;
  skill_ref?: string;
  condition?: string;
  input_mapping?: Record<string, string>;
  output_mapping?: Record<string, string>;
  config?: Record<string, unknown>;
  cacheable?: boolean;
  metadata?: Record<string, unknown>;
};

export type WorkflowGraphEdge = {
  source: string;
  target: string;
  condition?: string;
};

export type WorkflowGraph = {
  name: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
};

export type GraphIssue = {
  code: string;
  message: string;
  node_id?: string;
  details: Record<string, unknown>;
};

export type GraphValidationResult = {
  ok: boolean;
  errors: GraphIssue[];
  warnings: GraphIssue[];
  execution_levels: string[][];
  graph_tips: { title: string; message: string; node_id?: string }[];
  node_count: number;
  edge_count: number;
};

export type WorkflowVersion = {
  workflow_id: string;
  name: string;
  version: number;
  version_id: string;
  status: string;
  graph?: WorkflowGraph;
  steps: {
    step_id: string;
    skill_ref: string;
    input_mapping: Record<string, string>;
    output_mapping: Record<string, string>;
    config: Record<string, unknown>;
    cacheable: boolean;
  }[];
};

export type WorkflowDraftRecord = {
  draft_id: string;
  name: string;
  status: string;
  graph: WorkflowGraph;
  created_at: string;
  updated_at: string;
  published_version_id?: string;
};

export type RunRecord = {
  run_id: string;
  status: string;
  total_items: number;
  queue_messages: { item_id: string }[];
  items: {
    item_id: string;
    row_id: string;
    status: string;
    steps: Record<string, unknown>[];
  }[];
};

export type RunReport = {
  run_id: string;
  total_items: number;
  completed_items: number;
  failed_items: number;
  pass_rate: number;
  error_rate: number;
  average_latency_ms: number;
  p95_latency_ms: number;
  metrics: Record<string, number>;
  error_distribution: Record<string, number>;
  badcases: Record<string, unknown>[];
};

export type DashboardSummary = {
  dataset_count: number;
  skill_count: number;
  workflow_count: number;
  run_count: number;
  badcase_count: number;
  pass_rate: number;
  latest_run: RunRecord | null;
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

export type JudgeProfile = {
  profile_id: string;
  name: string;
  version: number;
  model: string;
  prompt: string;
  rubric: Record<string, unknown>;
  threshold: number;
  output_schema: Record<string, unknown>;
  status: string;
  created_at: string;
};

export type StoredJudgeAudit = {
  audit_id: string;
  judge_profile_id: string;
  dataset_version_id: string;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  cohen_kappa: number;
  confusion_matrix: Record<string, Record<string, number>>;
  misclassified_items: Record<string, unknown>[];
  created_at: string;
};

export type JudgeCrossValidationResult = {
  dataset_version_id: string;
  profile_count: number;
  pairwise_agreement: Record<string, number>;
  audits: Record<string, Partial<StoredJudgeAudit>>;
};

export type SkillContractResult = {
  skill_id: string;
  ok: boolean;
  latency_ms?: number;
  output?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  error?: string;
  message?: string;
};

export type SkillPackageRecord = {
  package_id: string;
  filename: string;
  status: string;
  manifest: SkillManifest;
  package_dir?: string;
  handler_path?: string;
  last_contract_ok: boolean;
  last_contract_result?: Record<string, unknown> | null;
  last_contract_at?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  approval_note?: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskRecord = {
  task_id: string;
  name: string;
  evaluation_goal?: string | null;
  quality_gate?: Record<string, unknown>;
  preflight_result?: TaskPreflightResult | null;
  dataset_id: string;
  dataset_name: string;
  dataset_version: number;
  dataset_version_id?: string | null;
  workflow_id: string;
  workflow_name: string;
  workflow_version_id: string;
  run_id: string;
  status: string;
  total_items: number;
  completed_items: number;
  failed_items: number;
  pass_rate: number;
  badcase_count: number;
  execution_config?: {
    execution_template_id?: string | null;
    evaluation_goal?: string | null;
    quality_gate?: Record<string, unknown>;
    chunk_size?: number | null;
    concurrency?: number | null;
    sample_repeat_times?: number | null;
    retry?: {
      max_retries?: number | null;
      backoff_seconds?: number | null;
    };
    cost_budget?: number | null;
    skill_overrides?: Record<string, Record<string, unknown>>;
    allow_blocked_preflight?: boolean;
  };
  current_attempt?: number;
  attempts?: {
    attempt_index: number;
    run_id: string;
    status: string;
    total_items: number;
    completed_items: number;
    failed_items: number;
    pass_rate: number;
    badcase_count: number;
    report?: Partial<RunReport>;
    created_at: string;
    started_at?: string | null;
    finished_at?: string | null;
  }[];
  created_at: string;
  updated_at: string;
};

export type TaskExecutionTemplate = {
  template_id: string;
  name: string;
  description?: string;
  evaluation_goal?: string | null;
  quality_gate?: Record<string, unknown>;
  execution_config?: {
    chunk_size?: number | null;
    concurrency?: number | null;
    sample_repeat_times?: number | null;
    retry?: {
      max_retries?: number | null;
      backoff_seconds?: number | null;
    };
    cost_budget?: number | null;
    skill_overrides?: Record<string, Record<string, unknown>>;
  };
  tags?: string[];
  source?: string;
  created_at?: string;
  updated_at?: string;
};

export type TaskPreflightCheck = {
  check_id: string;
  title: string;
  status: 'passed' | 'warning' | 'blocked' | string;
  message: string;
  details: Record<string, unknown>;
  recommendation?: string;
};

export type TaskPreflightResult = {
  status: 'passed' | 'warning' | 'blocked' | string;
  summary: string;
  dataset_id: string;
  dataset_version: number;
  workflow_version_id: string;
  execution_template_id?: string | null;
  evaluation_goal?: string | null;
  quality_gate?: Record<string, unknown>;
  sample_repeat_times?: number | null;
  cost_budget?: number | null;
  skill_overrides?: Record<string, Record<string, unknown>>;
  checks: TaskPreflightCheck[];
  created_at?: string;
};

export type RepairTaskRecord = {
  repair_task_id: string;
  parent_repair_task_id?: string | null;
  source_task_id: string;
  source_run_id?: string | null;
  cause_type: string;
  severity: string;
  title: string;
  status: string;
  affected_items: number;
  evidence: string[];
  recommendation: string;
  next_actions: string[];
  recommended_action?: string | null;
  target_url?: string | null;
  remediation_area?: string | null;
  due_at?: string | null;
  assigned_at?: string | null;
  overdue?: boolean;
  action_history?: {
    action: string;
    status: string;
    result_summary?: string;
    created_at?: string;
  }[];
  last_action_result?: {
    action: string;
    result: Record<string, unknown>;
    created_at?: string;
  } | null;
  version_compare_plan?: {
    candidate_actions?: Record<string, unknown>[];
    baseline_candidates?: Record<string, unknown>[];
    current_versions?: Record<string, unknown>[];
    updated_at?: string;
    [key: string]: unknown;
  } | null;
  owner?: string | null;
  started_at?: string | null;
  resolved_at?: string | null;
  reopened_at?: string | null;
  resolution_note?: string | null;
  reopen_reason?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type RepairTaskTreeNextAction = {
  repair_task_id: string;
  title: string;
  status: string;
  recommended_action?: string | null;
  target_url?: string | null;
  owner?: string | null;
  due_at?: string | null;
  overdue?: boolean;
};

export type RepairTaskTreeSummary = {
  total_children: number;
  open_children: number;
  in_progress_children: number;
  resolved_children: number;
  completion_rate: number;
  overall_status: string;
  blocking_children: string[];
  overdue_children?: number;
  overdue_task_ids?: string[];
  next_actions: RepairTaskTreeNextAction[];
  selected_repair_task_id?: string;
};

export type RepairTaskTree = {
  repair_task: RepairTaskRecord;
  selected_repair_task_id?: string;
  children: RepairTaskRecord[];
  summary: RepairTaskTreeSummary;
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
  diagnostics?: TaskDiagnostics;
  report: RunReport;
  badcases: Record<string, unknown>[];
  export_links: {
    json: string;
    csv: string;
    html: string;
  };
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
};

export type JudgeAuditTrends = {
  summary: {
    audit_count: number;
    profile_count: number;
    low_consistency_count: number;
  };
  profiles: {
    profile_id: string;
    audit_count: number;
    latest_accuracy: number;
    latest_kappa: number;
    series: {
      audit_id: string;
      dataset_version_id: string;
      accuracy: number;
      precision: number;
      recall: number;
      f1: number;
      cohen_kappa: number;
      misclassified_count: number;
      created_at: string;
    }[];
  }[];
  low_consistency_profiles: {
    profile_id: string;
    accuracy: number;
    cohen_kappa: number;
    message: string;
  }[];
};

export type TaskParameterGovernance = {
  task_id: string;
  run_id: string;
  workflow_version_id: string;
  execution_config: Record<string, unknown>;
  prompt_skill_versions: {
    step_id: string;
    skill_ref: string;
    prompt_version: string;
    model?: unknown;
    model_params: Record<string, unknown>;
    cacheable: boolean;
  }[];
  parameter_sources: {
    step_id: string;
    skill_ref: string;
    parameters: Record<string, { source: string; value_preview: unknown; redacted: boolean; expression_path?: string; secret_ref?: string }>;
  }[];
  secret_policy: {
    redacted: boolean;
    message: string;
  };
};

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
  payload: Record<string, unknown>;
  review?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
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
  target_url?: string;
  created_at: string;
  updated_at?: string;
};

export type WorkflowPromotionReleaseArtifacts = {
  baseline_suggestion?: ExperimentBaselineSuggestion | null;
  release_record?: WorkflowReleaseRecord | null;
  ci_gate_evaluations?: CIGateEvaluationRecord[];
};

export type WorkflowPromotionReviewResult = {
  status: string;
  candidate: PromptSkillCandidate;
  review: WorkflowPromotionReview;
  release_artifacts?: WorkflowPromotionReleaseArtifacts;
  target_url?: string;
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

export type CIGateRule = {
  gate_id: string;
  metric: string;
  operator: string;
  threshold: number;
  blocking: boolean;
};

export type CIGateConfigRecord = {
  config_id: string;
  name: string;
  description: string;
  status: string;
  gates: CIGateRule[];
  created_at: string;
  updated_at: string;
};

export type CIGateEvaluationResult = {
  evaluation_id?: string;
  config_id?: string | null;
  status: 'passed' | 'blocked';
  blocking_failures: number;
  target?: { kind: 'run' | 'task'; id: string } | null;
  metrics?: Record<string, number>;
  results: {
    gate_id: string;
    metric: string;
    operator: string;
    threshold: number;
    actual: number;
    blocking: boolean;
    status: string;
    message: string;
  }[];
  created_at?: string;
};

export type CIGateEvaluationRecord = CIGateEvaluationResult & {
  evaluation_id: string;
  config_id?: string | null;
  created_at: string;
};

export type TraceTree = {
  run_id: string;
  status: string;
  workflow_version: string;
  dataset_version?: string;
  items: {
    item_id: string;
    row_id: string;
    status: string;
    metrics: Record<string, unknown>;
    error?: Record<string, unknown> | null;
    children: Record<string, unknown>[];
  }[];
};

export type TaskTraceFlow = {
  task: TaskRecord;
  dataset: {
    dataset_id: string;
    name: string;
    version: number;
    version_id: string;
  };
  workflow: {
    workflow_id: string;
    name: string;
    version_id: string;
    snapshot_hash: string;
  };
  attempt: {
    run_id: string;
    status: string;
    current_attempt: number;
    started_at?: string | null;
    finished_at?: string | null;
  };
  queue_message_shape: string[];
  data_edges: { source: string; target: string }[];
  items: {
    item_id: string;
    row_id: string;
    row_index: number;
    repeat_index: number;
    status: string;
    row: Record<string, unknown>;
    context: Record<string, unknown>;
    metrics: Record<string, unknown>;
    error?: Record<string, unknown> | null;
    steps: {
      step_id: string;
      skill_ref: string;
      status: string;
      input: Record<string, unknown>;
      resolved_config: Record<string, unknown>;
      parameter_trace: Record<string, { source: string; value_preview: unknown; redacted: boolean; expression_path?: string; secret_ref?: string }>;
      output: Record<string, unknown>;
      metrics: Record<string, unknown>;
      latency_ms: number;
      cache_hit: boolean;
      error?: Record<string, unknown> | null;
    }[];
    badcase: {
      is_badcase: boolean;
      reason?: string;
      score?: number;
      label?: string;
      payload?: Record<string, unknown>;
    };
  }[];
};

export type WorkflowParameterPreview = {
  workflow_name: string;
  nodes: {
    node_id: string;
    skill_ref: string;
    resolved_config: Record<string, unknown>;
    parameter_trace: Record<
      string,
      {
        source: string;
        value_preview: unknown;
        redacted: boolean;
        expression_path?: string;
        secret_ref?: string;
      }
    >;
  }[];
};
