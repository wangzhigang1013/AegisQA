export type WorkflowGraphNode = {
  node_id: string;
  node_type: 'source' | 'skill' | 'branch' | 'join' | 'aggregator' | 'output';
  label?: string;
  skill_ref?: string;
  condition?: string;
  // source/output/branch 等节点没有输入映射；只有 skill 等消费节点才会填 input_mapping，
  // 所以这里设为可选，避免类型系统强迫所有节点都带空对象。
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
  metadata?: Record<string, unknown>;
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

