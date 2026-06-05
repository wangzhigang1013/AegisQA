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

export type RunSummary = {
  run_id: string;
  status: string;
  workflow_version_id?: string | null;
  workflow_name?: string | null;
  dataset_id: string;
  dataset_version: number;
  total_items: number;
  completed_items: number;
  failed_items: number;
  queue_message_count: number;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  canceled: boolean;
  paused: boolean;
};

export type RunPageResult = {
  items: RunSummary[];
  pagination: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
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
  latest_run: RunSummary | null;
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
  execution_state?: {
    executor_backend?: string | null;
    executor_job_id?: string | null;
    run_id?: string | null;
    submitted_at?: string | null;
    submit_error?: string | null;
    failed_at?: string | null;
  };
  total_items: number;
  completed_items: number;
  failed_items: number;
  pass_rate: number;
  badcase_count: number;
  execution_config?: {
    preflight_id?: string | null;
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

export type TaskPageResult = {
  items: TaskRecord[];
  pagination: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
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
  preflight_id?: string;
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

export type RepairTaskPageResult = {
  items: RepairTaskRecord[];
  pagination: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
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

export type TraceTree = {
  run_id: string;
  status: string;
  workflow_version: string;
  dataset_version?: string;
  pagination?: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
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
  pagination?: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
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

