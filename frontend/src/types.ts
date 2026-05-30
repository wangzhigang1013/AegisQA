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
  created_at: string;
  updated_at: string;
};

export type TaskRecord = {
  task_id: string;
  name: string;
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
    chunk_size?: number | null;
    concurrency?: number | null;
    sample_repeat_times?: number | null;
    retry?: {
      max_retries?: number | null;
      backoff_seconds?: number | null;
    };
    cost_budget?: number | null;
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

export type TaskReport = {
  task: TaskRecord;
  report: RunReport;
  badcases: Record<string, unknown>[];
  export_links: {
    json: string;
    csv: string;
    html: string;
  };
};

export type ExperimentRecord = {
  experiment_id: string;
  name: string;
  run_id: string;
  baseline_run_id?: string | null;
  status: string;
  tags: string[];
  snapshot: Record<string, unknown>;
  metrics: Record<string, number>;
  baseline_metrics?: Record<string, number> | null;
  diff?: Record<string, number> | null;
  created_at: string;
};

export type AnnotationTask = {
  task_id: string;
  run_id: string;
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

export type CIGateEvaluationResult = {
  status: 'passed' | 'blocked';
  blocking_failures: number;
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
