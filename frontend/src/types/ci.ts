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

export type CIGateEvaluationPageResult = {
  items: CIGateEvaluationRecord[];
  pagination: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
  summary: {
    total_evaluations: number;
    blocked: number;
    passed: number;
    latest_status: string;
  };
};

