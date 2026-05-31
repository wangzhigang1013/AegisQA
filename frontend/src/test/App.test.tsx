import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '../App';
import { demoSkills, demoWorkflowGraph } from '../data/demo';

const demoWorkflowVersion = {
  workflow_id: 'wf-demo',
  name: 'RAG 回归评测',
  version: 1,
  version_id: 'wf-demo:v1',
  status: 'published',
  graph: demoWorkflowGraph,
  steps: [],
};

const demoTask = {
  task_id: 'task-demo',
  name: 'RAG 任务',
  evaluation_goal: 'release_gate',
  quality_gate: { pass_rate: 0.9, max_badcase_count: 0 },
  preflight_result: {
    preflight_id: 'preflight-demo',
    status: 'passed',
    summary: '预检通过，可以创建并执行任务。',
    checks: [
      { check_id: 'dataset_non_empty', title: '数据集非空', status: 'passed', message: '当前数据集包含 100 条样本。', details: {}, recommendation: '' },
      { check_id: 'field_mapping', title: 'Workflow 字段映射', status: 'passed', message: 'Workflow 需要的 row 字段均存在。', details: {}, recommendation: '' },
    ],
  },
  dataset_id: 'dataset-demo',
  dataset_name: '问答回归集',
  dataset_version: 1,
  dataset_version_id: 'dataset-demo:v1',
  workflow_id: 'wf-demo',
  workflow_name: 'RAG 回归评测',
  workflow_version_id: 'wf-demo:v1',
  run_id: 'run-demo',
  status: 'queued',
  total_items: 100,
  completed_items: 0,
  failed_items: 0,
  pass_rate: 0,
  badcase_count: 0,
  execution_config: {
    preflight_id: 'preflight-demo',
    concurrency: 2,
    sample_repeat_times: 1,
    retry: { max_retries: 1, backoff_seconds: 0 },
    cost_budget: 20,
  },
  current_attempt: 1,
  attempts: [
    {
      attempt_index: 1,
      run_id: 'run-demo',
      status: 'queued',
      total_items: 100,
      completed_items: 0,
      failed_items: 0,
      pass_rate: 0,
      badcase_count: 0,
      created_at: '2026-05-31T00:00:00Z',
    },
  ],
  created_at: '2026-05-31T00:00:00Z',
  updated_at: '2026-05-31T00:00:00Z',
};

const demoPreflightResult = {
  preflight_id: 'preflight-demo',
  status: 'passed',
  summary: 'Preflight 通过：可以创建并执行任务。',
  dataset_id: 'dataset-demo',
  dataset_version: 1,
  workflow_version_id: 'wf-demo:v1',
  execution_template_id: undefined,
  evaluation_goal: 'release_gate',
  quality_gate: { pass_rate: 0.9, max_badcase_count: 0 },
  sample_repeat_times: 1,
  cost_budget: undefined,
  checks: [
    { check_id: 'dataset_non_empty', title: '数据集非空', status: 'passed', message: '当前数据集包含 100 条样本。', details: {}, recommendation: '' },
    { check_id: 'field_mapping', title: 'Workflow 字段映射', status: 'passed', message: 'Workflow 需要的 row 字段均存在。', details: {}, recommendation: '' },
    { check_id: 'quality_gate', title: '质量门槛', status: 'passed', message: '已设置通过率门槛 90%。', details: {}, recommendation: '' },
  ],
};

const demoTaskExecutionTemplates = [
  {
    template_id: 'release_gate_safe',
    name: '上线门禁稳健模板',
    description: '适合正式发布前评测。',
    evaluation_goal: 'release_gate',
    quality_gate: { pass_rate: 0.9, max_badcase_count: 0 },
    execution_config: {
      chunk_size: 100,
      concurrency: 1,
      sample_repeat_times: 1,
      retry: { max_retries: 1, backoff_seconds: 0 },
      cost_budget: 20,
    },
    tags: ['release'],
    source: 'builtin',
  },
];

const demoBadcase = {
  badcase_id: 'badcase-demo',
  run_id: 'run-demo',
  item_id: 'item-demo',
  status: 'pending_review',
  reason: 'judge_label=fail',
  payload: { question: '坏例样本', score: 0.2 },
  golden_candidate: false,
  created_at: '2026-05-31T00:00:00Z',
  updated_at: '2026-05-31T00:00:00Z',
};

const demoReportExportAuditEvents = [
  {
    event_id: 'audit-export-html',
    actor: 'api',
    action: 'task.report.export',
    target: 'task-demo',
    detail: { run_id: 'run-demo', file_format: 'html', preflight_id: 'preflight-demo' },
    created_at: '2026-05-31T08:00:00Z',
  },
  {
    event_id: 'audit-export-csv',
    actor: 'api',
    action: 'task.report.export',
    target: 'task-demo',
    detail: { run_id: 'run-demo', file_format: 'csv', preflight_id: 'preflight-demo' },
    created_at: '2026-05-31T08:05:00Z',
  },
];

const demoReportExportRequest = {
  request_id: 'rex-export-demo',
  task_id: 'task-demo',
  task_name: 'RAG 任务',
  run_id: 'run-demo',
  file_format: 'html',
  requester_role: 'Viewer',
  requested_permission: 'report:export',
  reason: '业务复盘需要离线报告。',
  status: 'pending',
  created_at: '2026-05-31T08:10:00Z',
  updated_at: '2026-05-31T08:10:00Z',
};

const demoRepairTask = {
  repair_task_id: 'repair-demo',
  source_task_id: 'task-demo',
  source_run_id: 'run-demo',
  cause_type: 'weak_segment',
  severity: 'warning',
  title: '[warning] 复盘低通过率分层',
  status: 'open',
  affected_items: 12,
  evidence: ['scene=payment 通过率 40%，Badcase 12 条。'],
  recommendation: '优先复核 payment 场景的失败样本，补充 Golden 后再调整 Workflow。',
  next_actions: ['open_trace_flow', 'seed_annotation_queue', 'evaluate_ci_gate', 'open_parameter_governance', 'fix_dataset_fields', 'plan_workflow_parameter_changes', 'compare_prompt_skill_versions'],
  action_history: [],
  owner: null,
  created_at: '2026-05-31T00:00:00Z',
  updated_at: '2026-05-31T00:00:00Z',
};

const demoTraceFlow = {
  task: demoTask,
  dataset: { dataset_id: 'dataset-demo', name: '问答回归集', version: 1, version_id: 'dataset-demo:v1' },
  workflow: { workflow_id: 'wf-demo', name: 'RAG 回归评测', version_id: 'wf-demo:v1', snapshot_hash: 'abcdef1234567890' },
  attempt: { run_id: 'run-demo', status: 'completed', current_attempt: 1, started_at: null, finished_at: null },
  queue_message_shape: ['item_id'],
  data_edges: [{ source: 'dataset.row', target: 'answer.input' }],
  pagination: { page: 1, page_size: 8, total_items: 1, total_pages: 1 },
  items: [
    {
      item_id: 'item-demo',
      row_id: '1',
      row_index: 0,
      repeat_index: 0,
      status: 'succeeded',
      row: { question: '什么是 Trace?', reference: 'AegisQA' },
      context: { answer: '模型回答' },
      metrics: { tokens: 12 },
      error: null,
      steps: [
        {
          step_id: 'answer',
          skill_ref: 'llm.call@0.1.0',
          status: 'succeeded',
          input: { prompt: '什么是 Trace?' },
          resolved_config: { model: 'trace-model' },
          parameter_trace: { model: { source: 'workflow_config', value_preview: 'trace-model', redacted: false } },
          output: { answer: '模型回答' },
          metrics: { tokens: 12 },
          latency_ms: 1,
          cache_hit: false,
          error: null,
        },
      ],
      badcase: { is_badcase: false },
    },
  ],
};

const demoTraceTree = {
  run_id: 'run-demo',
  status: 'completed',
  workflow_version: 'wf-demo:v1',
  dataset_version: 'dataset-demo:v1',
  pagination: { page: 1, page_size: 8, total_items: 1, total_pages: 1 },
  items: [
    {
      item_id: 'item-demo',
      row_id: '1',
      status: 'succeeded',
      metrics: { judge_score: 0.9 },
      error: null,
      children: [
        {
          step_id: 'answer',
          skill_ref: 'llm.call@0.1.0',
          status: 'succeeded',
          latency_ms: 12,
          cache_hit: false,
          input: { prompt: '什么是 Trace?' },
          output: { answer: '模型回答' },
          metrics: { tokens: 12 },
          error: null,
        },
      ],
    },
  ],
};

const demoDataset = {
  dataset_id: 'dataset-demo',
  name: '问答回归集',
  latest_version: 1,
  latest_version_id: 'dataset-demo:v1',
  row_count: 100,
  golden: true,
  versions: [
    {
      dataset_id: 'dataset-demo',
      name: '问答回归集',
      version: 1,
      version_id: 'dataset-demo:v1',
      row_count: 100,
      field_schema: { question: 'string', reference: 'string', expected_label: 'string' },
      field_paths: ['row.question', 'row.reference', 'row.expected_label'],
      preview: [{ question: '什么是 AegisQA?', reference: 'AI 评测平台', expected_label: 'pass' }],
      golden: true,
      label_field: 'expected_label',
    },
  ],
};

const demoDatasetLineage = {
  dataset_id: 'dataset-demo',
  dataset_version: 1,
  dataset_version_id: 'dataset-demo:v1',
  name: '问答回归集',
  row_count: 100,
  golden: true,
  label_field: 'expected_label',
  source: { type: 'file_upload', ref: { filename: 'trusted.jsonl', file_format: 'jsonl' } },
  field_count: 3,
  fields: { question: 'text', reference: 'text', expected_label: 'text' },
  field_paths: ['row.question', 'row.reference', 'row.expected_label'],
  preview: [{ question: '什么是 AegisQA?', reference: 'AI 评测平台', expected_label: 'pass' }],
  downstream_tasks: [{ task_id: 'task-demo', name: '可信评测任务', status: 'completed', workflow_version_id: 'wf-demo:v1', run_id: 'run-demo' }],
};

const demoParameterGovernance = {
  task_id: 'task-demo',
  run_id: 'run-demo',
  workflow_version_id: 'wf-demo:v1',
  execution_config: demoTask.execution_config,
  prompt_skill_versions: [
    { step_id: 'answer', skill_ref: 'llm.call@0.1.0', prompt_version: 'prompt-v2', model: 'quality-model', model_params: { temperature: 0 }, cacheable: true },
  ],
  parameter_sources: [
    { step_id: 'answer', skill_ref: 'llm.call@0.1.0', parameters: { model: { source: 'task_override', value_preview: 'task-quality-model', redacted: false } } },
  ],
  secret_policy: { redacted: true, message: 'Secret 参数只展示脱敏预览。' },
};

const demoJudgeCrossValidation = {
  dataset_version_id: 'dataset-demo:v1',
  profile_count: 2,
  pairwise_agreement: { 'judge-a|judge-b': 0.5 },
  audits: {
    'judge-a': { accuracy: 1, precision: 1, recall: 1, f1: 1, cohen_kappa: 1 },
    'judge-b': { accuracy: 0.5, precision: 0.5, recall: 1, f1: 0.66, cohen_kappa: 0 },
  },
};

const demoScoreAnalytics = {
  summary: { task_count: 2, average_pass_rate: 0.75, latest_pass_rate: 0.8, badcase_count: 30, regression_count: 1 },
  trend: [
    {
      task_id: 'task-demo',
      task_name: 'RAG 任务',
      dataset_id: 'dataset-demo',
      dataset_name: '问答回归集',
      workflow_id: 'wf-demo',
      workflow_name: 'RAG 回归评测',
      workflow_version_id: 'wf-demo:v1',
      status: 'completed',
      pass_rate: 0.8,
      error_rate: 0,
      badcase_count: 20,
      p95_latency_ms: 12,
      average_latency_ms: 5,
      cost_used: 0.18,
      created_at: '2026-05-31T00:00:00Z',
    },
    {
      task_id: 'task-base',
      task_name: 'Baseline 任务',
      dataset_id: 'dataset-demo',
      dataset_name: '问答回归集',
      workflow_id: 'wf-demo',
      workflow_name: 'RAG 回归评测',
      workflow_version_id: 'wf-demo:v1',
      status: 'completed',
      pass_rate: 0.7,
      error_rate: 0,
      badcase_count: 10,
      p95_latency_ms: 20,
      average_latency_ms: 8,
      cost_used: 0.12,
      created_at: '2026-05-30T00:00:00Z',
    },
  ],
  regressions: [{ task_id: 'task-base', task_name: 'Baseline 任务', baseline_task_id: 'task-demo', pass_rate_delta: -0.1, message: '通过率下降超过 5 个百分点。' }],
};

const demoRedTeamScan = {
  scan_id: 'redscan-demo',
  target: { kind: 'task', id: 'task-demo' },
  run_id: 'run-demo',
  summary: { status: 'blocked', risk_count: 2, critical_count: 2, warning_count: 0, scanned_items: 2 },
  risks: [
    { risk_id: 'risk-prompt', risk_type: 'prompt_injection', severity: 'critical', item_id: 'item-demo', row_id: '1', field_path: 'row.question', evidence: '忽略之前', message: '样本包含提示词注入。', recommendation: '加入红队回归集。' },
    { risk_id: 'risk-pii', risk_type: 'pii_leakage', severity: 'critical', item_id: 'item-demo-2', row_id: '2', field_path: 'row.question', evidence: '13812345678', message: '样本包含敏感信息。', recommendation: '启用脱敏策略。' },
  ],
  recommendations: [{ action: 'add_assertion', label: '添加 Prompt Injection 断言', message: '为 Workflow 增加提示词注入检测断言。' }],
  created_at: '2026-05-31T00:00:00Z',
};

const demoJudgeAuditTrends = {
  summary: { audit_count: 2, profile_count: 1, low_consistency_count: 1 },
  profiles: [
    {
      profile_id: 'judge-demo',
      audit_count: 2,
      latest_accuracy: 0.75,
      latest_kappa: 0.5,
      series: [
        { audit_id: 'audit-1', dataset_version_id: 'golden:v1', accuracy: 0.9, precision: 0.9, recall: 1, f1: 0.94, cohen_kappa: 0.8, misclassified_count: 1, created_at: '2026-05-30T00:00:00Z' },
        { audit_id: 'audit-2', dataset_version_id: 'golden:v2', accuracy: 0.75, precision: 0.7, recall: 1, f1: 0.82, cohen_kappa: 0.5, misclassified_count: 3, created_at: '2026-05-31T00:00:00Z' },
      ],
    },
  ],
  low_consistency_profiles: [{ profile_id: 'judge-demo', accuracy: 0.75, cohen_kappa: 0.5, message: '一致性偏低。' }],
};

const demoExperiments = [
  {
    experiment_id: 'exp-main',
    name: '主链路实验',
    run_id: 'run-demo',
    baseline_run_id: 'run-base',
    status: 'snapshotted',
    tags: ['rag'],
    dataset_id: 'dataset-demo',
    dataset_version: 1,
    dataset_version_id: 'dataset-demo:v1',
    workflow_id: 'wf-demo',
    workflow_name: 'RAG 回归评测',
    workflow_version_id: 'wf-demo:v1',
    snapshot: { workflow_version: 'wf-demo:v1', dataset_version: 'dataset-demo:v1', skill_versions: ['llm.call@0.1.0'] },
    metrics: { pass_rate: 0.82, badcase_count: 18, cost: 12.5, p95_latency_ms: 820 },
    baseline_metrics: { pass_rate: 0.76, badcase_count: 24, cost: 10, p95_latency_ms: 900 },
    diff: { pass_rate: 0.06, badcase_count: -6, cost: 2.5, p95_latency_ms: -80 },
    failure_distribution: { 'judge_label=fail': 18 },
    created_at: '2026-05-31T00:00:00Z',
  },
  {
    experiment_id: 'exp-base',
    name: 'Baseline 实验',
    run_id: 'run-base',
    baseline_run_id: null,
    status: 'snapshotted',
    tags: ['baseline'],
    dataset_id: 'dataset-demo',
    dataset_version: 1,
    dataset_version_id: 'dataset-demo:v1',
    workflow_id: 'wf-demo',
    workflow_name: 'RAG 回归评测',
    workflow_version_id: 'wf-demo:v1',
    snapshot: { workflow_version: 'wf-demo:v1', dataset_version: 'dataset-demo:v1', skill_versions: ['llm.call@0.1.0'] },
    metrics: { pass_rate: 0.76, badcase_count: 24, cost: 10, p95_latency_ms: 900 },
    baseline_metrics: null,
    diff: null,
    failure_distribution: { 'judge_label=fail': 24 },
    created_at: '2026-05-30T00:00:00Z',
  },
];

const demoCIGates = [
  {
    config_id: 'gatecfg-demo',
    name: '发布质量门禁',
    description: '正式发布前阻断低通过率任务',
    status: 'active',
    gates: [
      { gate_id: 'pass-rate', metric: 'pass_rate', operator: '>=', threshold: 0.8, blocking: true },
      { gate_id: 'badcase-budget', metric: 'badcase_count', operator: '<=', threshold: 0, blocking: false },
    ],
    created_at: '2026-05-31T00:00:00Z',
    updated_at: '2026-05-31T00:00:00Z',
  },
];

const demoCIGateEvaluations = [
  {
    evaluation_id: 'gateeval-demo',
    config_id: 'gatecfg-demo',
    status: 'blocked',
    blocking_failures: 1,
    target: { kind: 'task', id: 'task-demo' },
    metrics: { pass_rate: 0.5, badcase_count: 1 },
    results: [
      {
        gate_id: 'pass-rate',
        metric: 'pass_rate',
        operator: '>=',
        threshold: 0.8,
        actual: 0.5,
        blocking: true,
        status: 'failed',
        message: '质量门禁未通过：pass_rate=0.5 不满足 >= 0.8',
      },
    ],
    created_at: '2026-05-31T01:00:00Z',
  },
];

const demoAnnotationTasks = [
  {
    task_id: 'anno-demo',
    run_id: 'run-demo',
    source_task_id: 'task-demo',
    source_task_name: 'RAG 任务',
    item_id: 'item-demo',
    row_id: 'row-demo',
    status: 'pending',
    assignee: null,
    priority: 'high',
    reason: '低分或失败样本需要人工复核',
    payload: { metrics: { judge_score: 0.2 }, context_snapshot: { context: { judge_label: 'fail' } }, steps: [] },
    review: null,
    created_at: '2026-05-31T00:00:00Z',
    updated_at: '2026-05-31T00:00:00Z',
  },
];

const demoAnnotationCandidates = [
  {
    candidate_id: 'cand-golden',
    kind: 'golden',
    source: 'annotation_queue',
    annotation_task_id: 'anno-demo',
    source_task_id: 'task-demo',
    source_task_name: 'RAG 任务',
    item_id: 'item-demo',
    human_label: 'fail',
    reviewer: 'qa_owner',
    status: 'candidate',
    created_at: '2026-05-31T00:00:00Z',
  },
  {
    candidate_id: 'cand-assertion',
    kind: 'assertion',
    source: 'annotation_queue',
    annotation_task_id: 'anno-demo',
    source_task_id: 'task-demo',
    source_task_name: 'RAG 任务',
    item_id: 'item-demo',
    human_label: 'fail',
    reviewer: 'qa_owner',
    status: 'candidate',
    created_at: '2026-05-31T00:00:00Z',
  },
];

const demoPromptSkillCandidate = {
  candidate_id: 'prompt-skill-candidate-demo',
  kind: 'prompt_skill_version_diff',
  status: 'candidate',
  source_repair_task_id: 'repair-demo',
  source_task_id: 'task-demo',
  source_run_id: 'run-demo',
  baseline_experiment_id: 'exp-baseline',
  baseline_run_id: 'run-baseline',
  baseline_metrics: { pass_rate: 0.9, badcase_count: 3 },
  current_versions: [{ step_id: 'answer', skill_ref: 'llm.call@0.1.0', prompt_version: 'prompt-flow-v1', model: 'quality-model' }],
  version_diffs: [
    {
      step_id: 'answer',
      field: 'prompt_version',
      baseline_value: 'prompt-flow-v0',
      current_value: 'prompt-flow-v1',
      recommended_action: 'compare_or_rollback_prompt_version',
    },
  ],
  recommended_actions: ['compare_or_rollback_prompt_version'],
  created_at: '2026-05-31T00:00:00Z',
  updated_at: '2026-05-31T00:00:00Z',
};

const demoPromptSkillRetestPayload = {
  status: 'retested',
  candidate: {
    ...demoPromptSkillCandidate,
    status: 'retested',
    workflow_draft_id: 'draft-candidate-demo',
    retest_task_id: 'task-candidate-demo',
    candidate_experiment_id: 'exp-candidate-demo',
  },
  task: { ...demoTask, task_id: 'task-candidate-demo', name: '候选资产复跑任务', status: 'completed', workflow_version_id: 'wf-demo:v2', pass_rate: 0.95 },
  candidate_experiment: { experiment_id: 'exp-candidate-demo', run_id: 'run-candidate-demo', name: '候选复跑' },
  scorecard: {
    baseline: { label: 'baseline', experiment_id: 'exp-baseline', run_id: 'run-baseline', pass_rate: 0.9, badcase_count: 3, p95_latency_ms: 120 },
    current: { label: 'current', task_id: 'task-demo', run_id: 'run-demo', pass_rate: 0.8, badcase_count: 5, p95_latency_ms: 180 },
    candidate: { label: 'candidate', task_id: 'task-candidate-demo', run_id: 'run-candidate-demo', pass_rate: 0.95, badcase_count: 1, p95_latency_ms: 100 },
  },
  comparisons: {
    current_to_candidate: { pass_rate_delta: 0.15, error_rate_delta: 0, badcase_delta: -4 },
    baseline_to_candidate: { pass_rate_delta: 0.05, error_rate_delta: 0, badcase_delta: -2 },
  },
  promotion_recommendation: {
    decision: 'promote',
    summary: '建议晋升：候选版本已达到质量门槛，并且相对当前版本有明确改善。',
    thresholds: { pass_rate: 0.9, max_badcase_count: 2 },
    checks: [
      { check_id: 'pass_rate_gate', status: 'passed', message: '候选通过率 95.0%，已达到 90.0% 门槛。' },
      { check_id: 'badcase_gate', status: 'passed', message: '候选 Badcase 1 条，未超过 2 条门槛。' },
      { check_id: 'current_improvement', status: 'passed', message: '相对当前版本通过率提升 15.0%，Badcase 减少 4 条。' },
    ],
    next_actions: [{ action: 'create_promotion_review', label: '创建 Workflow 晋升审批' }],
  },
  target_url: '/reports?task_id=task-candidate-demo',
};

const demoWorkflowPromotionReviewPayload = {
  status: 'pending_review',
  candidate: {
    ...demoPromptSkillRetestPayload.candidate,
    status: 'promotion_review_pending',
    promotion_review_id: 'promotion-review-demo',
  },
  review: {
    review_id: 'promotion-review-demo',
    candidate_id: 'prompt-skill-candidate-demo',
    status: 'pending_review',
    candidate_workflow_version_id: 'wf-demo:v2',
    current_workflow_version_id: 'wf-demo:v1',
    requester: 'qa_owner',
    note: '候选指标达标，提交晋升审批。',
    promotion_recommendation: demoPromptSkillRetestPayload.promotion_recommendation,
    target_url: '/workflows?workflow_version_id=wf-demo:v2',
    created_at: '2026-05-31T02:00:00Z',
    updated_at: '2026-05-31T02:00:00Z',
  },
};

const demoWorkflowPromotionApprovedPayload = {
  status: 'approved',
  candidate: {
    ...demoPromptSkillRetestPayload.candidate,
    status: 'promoted',
    promotion_review_id: 'promotion-review-demo',
    promoted_workflow_version_id: 'wf-demo:v2',
    baseline_suggestion_id: 'baseline-suggestion-demo',
    release_record_id: 'workflow-release-demo',
  },
  review: {
    ...demoWorkflowPromotionReviewPayload.review,
    status: 'approved',
    reviewer: 'release_owner',
    review_note: '同意晋升为推荐 Workflow 版本。',
    baseline_suggestion_id: 'baseline-suggestion-demo',
    release_record_id: 'workflow-release-demo',
  },
  release_artifacts: {
    baseline_suggestion: {
      suggestion_id: 'baseline-suggestion-demo',
      candidate_id: 'prompt-skill-candidate-demo',
      review_id: 'promotion-review-demo',
      status: 'pending_apply',
      suggested_experiment_id: 'exp-candidate-demo',
      previous_baseline_experiment_id: 'exp-baseline',
      target_url: '/experiments?baseline_suggestion_id=baseline-suggestion-demo',
      created_at: '2026-05-31T03:00:00Z',
      updated_at: '2026-05-31T03:00:00Z',
    },
    release_record: {
      record_id: 'workflow-release-demo',
      candidate_id: 'prompt-skill-candidate-demo',
      review_id: 'promotion-review-demo',
      workflow_version_id: 'wf-demo:v2',
      candidate_experiment_id: 'exp-candidate-demo',
      status: 'ready_to_release',
      ci_gate_config_ids: ['gatecfg-demo'],
      ci_gate_evaluation_ids: ['gateeval-promotion-demo'],
      blocking_failures: 0,
      target_url: '/ci-gates?release_record_id=workflow-release-demo',
      created_at: '2026-05-31T03:00:00Z',
      updated_at: '2026-05-31T03:00:00Z',
    },
    ci_gate_evaluations: [{ ...demoCIGateEvaluations[0], evaluation_id: 'gateeval-promotion-demo', status: 'passed', blocking_failures: 0, source: 'workflow_promotion_review' }],
  },
};

const demoBaselineApplyPayload = {
  status: 'applied',
  suggestion: {
    ...demoWorkflowPromotionApprovedPayload.release_artifacts.baseline_suggestion,
    status: 'applied',
    applied_by: 'release_owner',
    applied_at: '2026-05-31T04:00:00Z',
  },
  baseline: {
    baseline_id: 'baseline-demo',
    scope: { dataset_id: 'dataset-demo', workflow_id: 'wf-demo' },
    current_experiment_id: 'exp-candidate-demo',
    previous_experiment_id: 'exp-baseline',
    status: 'active',
    history: [{ action: 'apply', suggestion_id: 'baseline-suggestion-demo', from_experiment_id: 'exp-baseline', to_experiment_id: 'exp-candidate-demo', actor: 'release_owner', note: '应用为新 baseline。' }],
    created_at: '2026-05-31T04:00:00Z',
    updated_at: '2026-05-31T04:00:00Z',
  },
  notifications: [
    {
      notification_id: 'baseline-notification-demo',
      baseline_id: 'baseline-demo',
      suggestion_id: 'baseline-suggestion-demo',
      action: 'apply',
      status: 'unread',
      actor: 'release_owner',
      scope: { dataset_id: 'dataset-demo', workflow_id: 'wf-demo' },
      from_experiment_id: 'exp-baseline',
      to_experiment_id: 'exp-candidate-demo',
      recipients: ['release_owner', 'qa_owner'],
      affected_task_ids: ['task-demo'],
      summary: { affected_tasks: 1, affected_reports: 1, ci_gate_configs: 1, metric_delta: { pass_rate_delta: 0.05 } },
      message: 'Baseline 已从 exp-baseline 切换到 exp-candidate-demo，影响 1 个任务，请复核任务报告与 CI Gate。',
      created_at: '2026-05-31T04:00:00Z',
      updated_at: '2026-05-31T04:00:00Z',
    },
  ],
};

const demoBaselineImpactPayload = {
  suggestion_id: 'baseline-suggestion-demo',
  scope: { dataset_id: 'dataset-demo', workflow_id: 'wf-demo' },
  suggested_experiment_id: 'exp-candidate-demo',
  previous_baseline_experiment_id: 'exp-baseline',
  metric_delta: { pass_rate_delta: 0.05, badcase_delta: -2 },
  summary: { affected_tasks: 1, affected_reports: 1, ci_gate_configs: 1 },
  affected_tasks: [{ task_id: 'task-demo', name: 'RAG 任务', status: 'completed', pass_rate: 0.8 }],
  recommendations: [{ action: 'apply_baseline', label: '可以应用 baseline' }],
};

const demoBaselineRollbackPayload = {
  status: 'rolled_back',
  suggestion: {
    ...demoWorkflowPromotionApprovedPayload.release_artifacts.baseline_suggestion,
    status: 'rolled_back',
    rolled_back_by: 'release_owner',
    rolled_back_at: '2026-05-31T05:00:00Z',
  },
  baseline: {
    ...demoBaselineApplyPayload.baseline,
    current_experiment_id: 'exp-baseline',
    previous_experiment_id: 'exp-candidate-demo',
    history: [
      ...demoBaselineApplyPayload.baseline.history,
      { action: 'rollback', suggestion_id: 'baseline-suggestion-demo', from_experiment_id: 'exp-candidate-demo', to_experiment_id: 'exp-baseline', actor: 'release_owner', note: '回滚到原 baseline。' },
    ],
  },
  rollback_guard: {
    status: 'passed',
    ci_gate_evaluations: [{ ...demoCIGateEvaluations[0], evaluation_id: 'gateeval-rollback-demo', status: 'passed', blocking_failures: 0, source: 'experiment_baseline_rollback' }],
  },
  notifications: [
    {
      notification_id: 'baseline-notification-rollback-demo',
      baseline_id: 'baseline-demo',
      suggestion_id: 'baseline-suggestion-demo',
      action: 'rollback',
      status: 'unread',
      actor: 'release_owner',
      scope: { dataset_id: 'dataset-demo', workflow_id: 'wf-demo' },
      from_experiment_id: 'exp-candidate-demo',
      to_experiment_id: 'exp-baseline',
      recipients: ['release_owner', 'qa_owner'],
      affected_task_ids: ['task-demo'],
      summary: { affected_tasks: 1, affected_reports: 1, ci_gate_configs: 1, rollback_guard_status: 'passed' },
      message: 'Baseline 已从 exp-candidate-demo 回滚到 exp-baseline，回滚门禁状态 passed，影响 1 个任务。',
      created_at: '2026-05-31T05:00:00Z',
      updated_at: '2026-05-31T05:00:00Z',
    },
  ],
};

const demoBaselineNotificationAckPayload = {
  ...demoBaselineApplyPayload.notifications[0],
  status: 'acknowledged',
  acknowledged_by: 'qa_owner',
  acknowledged_at: '2026-05-31T04:30:00Z',
};

const demoCandidateWorkloadPayload = {
  summary: { total_candidates: 1, total_open: 1, total_overdue: 1, escalated: 0 },
  owners: [{ owner: '未指派', total: 1, open_count: 1, overdue_count: 1, escalated_count: 0, status_counts: { candidate: 1 } }],
};

const demoCandidateBulkAssignPayload = {
  assigned_count: 1,
  skipped_count: 1,
  candidates: [{ ...demoPromptSkillCandidate, owner: 'qa_owner', due_at: '2000-01-01T00:00:00+00:00', overdue: true }],
  skipped: [{ candidate_id: 'candidate-capacity-skipped', reason: 'owner_capacity_exceeded', owner: 'qa_owner', open_count: 5, max_open_per_owner: 5 }],
  capacity: { owner: 'qa_owner', max_open_per_owner: 5, open_before: 4, open_after: 5 },
};

const demoCandidateBulkArchivePayload = {
  archived_count: 1,
  skipped_count: 0,
  candidates: [{ ...demoPromptSkillCandidate, status: 'archived', previous_status: 'rejected', archived_by: 'ops' }],
  skipped: [],
};

const demoCandidateEscalatePayload = {
  escalated_count: 1,
  candidates: [{ ...demoPromptSkillCandidate, owner: 'qa_owner', due_at: '2000-01-01T00:00:00+00:00', overdue: true, escalation_status: 'escalated' }],
};

const demoCandidateBulkReviewPayload = {
  reviewed_count: 1,
  skipped_count: 0,
  candidates: [{ ...demoPromptSkillCandidate, status: 'approved', review_history: [{ decision: 'approved', reviewer: 'qa_owner' }] }],
  skipped: [],
};

const demoCandidateRetestPlanPayload = {
  summary: { total_candidates: 3, ready_for_retest: 1, needs_publish: 1, needs_draft: 1, already_retested: 0, overdue: 1, escalated: 1 },
  items: [
    {
      rank: 1,
      candidate_id: 'candidate-ready',
      status: 'draft_created',
      owner: 'qa_owner',
      overdue: true,
      escalation_status: 'escalated',
      next_action: 'retest_candidate',
      priority_score: 145,
      reasons: ['候选草稿已发布，可以直接复跑', '已逾期', '已升级'],
      target_url: '/candidate-assets?candidate_id=candidate-ready&action=retest',
      updated_at: '2026-05-31T01:00:00Z',
    },
    {
      rank: 2,
      candidate_id: 'candidate-needs-publish',
      status: 'draft_created',
      owner: 'workflow_owner',
      next_action: 'publish_workflow_draft',
      priority_score: 90,
      reasons: ['候选草稿尚未发布，需先进入画布校验并发布'],
      target_url: '/workflows/designer/draft-needs-publish',
      updated_at: '2026-05-31T02:00:00Z',
    },
  ],
  generated_at: '2026-05-31T06:00:00Z',
};

const demoCandidateBulkRetestPayload = {
  status: 'completed',
  requested_count: 2,
  retested_count: 1,
  skipped_count: 1,
  results: [
    {
      candidate_id: 'candidate-ready',
      status: 'retested',
      task_id: 'task-candidate-ready',
      run_id: 'run-candidate-ready',
      candidate_experiment_id: 'exp-candidate-ready',
      target_url: '/reports?task_id=task-candidate-ready',
    },
  ],
  skipped: [
    {
      candidate_id: 'candidate-needs-publish',
      next_action: 'publish_workflow_draft',
      reason: '当前候选还不满足批量复跑条件，请先完成对应下一步。',
      target_url: '/workflows/designer/draft-needs-publish',
    },
  ],
  plan_summary: { total_candidates: 2, ready_for_retest: 0, needs_publish: 1, needs_draft: 0, already_retested: 1, overdue: 1, escalated: 1 },
};

const pendingPackageSkill = {
  ...demoSkills[0],
  skill_id: 'plugin.echo@0.1.0',
  name: 'Echo 插件',
  status: 'pending_review',
  enabled: false,
};

const pendingSkillPackage = {
  package_id: 'pkg-demo',
  filename: 'echo.zip',
  status: 'pending_review',
  manifest: pendingPackageSkill,
  package_dir: 'hidden',
  handler_path: 'hidden',
  last_contract_ok: false,
  last_contract_result: { ok: false, message: '尚未运行' },
  last_contract_at: null,
  approved_by: null,
  approved_at: null,
  approval_note: null,
  created_at: '2026-05-31T00:00:00Z',
  updated_at: '2026-05-31T00:00:00Z',
};

async function renderWorkbench(path: string) {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppShell />
      </MemoryRouter>,
    );
  });
  await waitFor(() => expect(screen.queryByText('正在加载页面...')).not.toBeInTheDocument());
}

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  } as Response);
}

function errorResponse(status: number, payload: unknown) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(payload),
  } as Response);
}

function findComboboxByLabel(label: string) {
  const combobox = screen.getAllByLabelText(label).find((element) => element.getAttribute('role') === 'combobox');
  if (!combobox) {
    throw new Error(`找不到下拉输入框：${label}`);
  }
  return combobox;
}

describe('AegisQA 前端工作台', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:report-export') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/skills')) {
        return jsonResponse(demoSkills);
      }
      if (url.endsWith('/skills/packages')) {
        return jsonResponse([pendingSkillPackage]);
      }
      if (url.endsWith('/skills/packages/upload')) {
        return jsonResponse({ package_id: 'pkg-demo', status: 'pending_review', manifest: { ...demoSkills[0], skill_id: 'plugin.echo@0.1.0', status: 'pending_review', enabled: false } });
      }
      if (url.endsWith('/workflow-templates')) {
        return jsonResponse([{ template_id: 'rag_regression', name: 'RAG 回归评测', description: 'LLMCall + Judge', scenario: 'rag' }]);
      }
      if (url.endsWith('/workflow-drafts/draft-test')) {
        return jsonResponse({ draft_id: 'draft-test', status: 'draft', name: '测试草稿', graph: demoWorkflowGraph, created_at: '', updated_at: '' });
      }
      if (url.endsWith('/workflow-drafts')) {
        if (init?.method === 'POST') {
          return jsonResponse({ draft_id: 'draft-test', status: 'draft', name: '测试草稿', graph: demoWorkflowGraph, created_at: '', updated_at: '' });
        }
        return jsonResponse([{ draft_id: 'draft-test', status: 'draft', name: '测试草稿', graph: demoWorkflowGraph, created_at: '', updated_at: '' }]);
      }
      if (url.endsWith('/workflows')) {
        return jsonResponse([demoWorkflowVersion]);
      }
      if (url.endsWith('/tasks')) {
        if (init?.method === 'POST') {
          return jsonResponse(demoTask);
        }
        return jsonResponse([demoTask]);
      }
      if (url.endsWith('/task-execution-templates')) {
        return jsonResponse(demoTaskExecutionTemplates);
      }
      if (url.endsWith('/tasks/preflight')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        return jsonResponse({
          ...demoPreflightResult,
          execution_template_id: body.execution_template_id,
          evaluation_goal: body.evaluation_goal,
          quality_gate: body.quality_gate,
          sample_repeat_times: body.sample_repeat_times,
          cost_budget: body.cost_budget,
        });
      }
      if (url.endsWith('/tasks/task-demo/execute')) {
        return jsonResponse({ ...demoTask, status: 'completed', completed_items: 100, pass_rate: 0.8, badcase_count: 20 });
      }
      if (url.endsWith('/tasks/task-demo/repair-tasks/from-diagnostics')) {
        return jsonResponse({ source_task_id: 'task-demo', created_count: 1, reused_count: 0, repair_tasks: [{ repair_task_id: 'repair-demo', source_task_id: 'task-demo', cause_type: 'weak_segment', status: 'open' }] });
      }
      if (url.endsWith('/repair-tasks/repair-demo/start')) {
        return jsonResponse({ ...demoRepairTask, status: 'in_progress', owner: 'qa_owner', started_at: '2026-05-31T01:00:00Z' });
      }
      if (url.endsWith('/repair-tasks/repair-demo/resolve')) {
        return jsonResponse({ ...demoRepairTask, status: 'resolved', owner: 'qa_owner', resolution_note: '已补充 Golden 并调整 Prompt。', resolved_at: '2026-05-31T02:00:00Z' });
      }
      if (url.endsWith('/repair-tasks/repair-demo/reopen')) {
        return jsonResponse({ ...demoRepairTask, status: 'open', reopen_reason: '复测仍未通过。', reopened_at: '2026-05-31T03:00:00Z' });
      }
      if (url.endsWith('/repair-tasks/repair-demo/assign')) {
        return jsonResponse({
          ...demoRepairTask,
          owner: 'dataset_owner',
          due_at: '2000-01-01T00:00:00+00:00',
          overdue: true,
          assigned_at: '2026-05-31T04:00:00Z',
        });
      }
      if (url.endsWith('/repair-tasks/repair-demo/tree')) {
        return jsonResponse({
          repair_task: demoRepairTask,
          selected_repair_task_id: 'repair-demo',
          children: [
            {
              ...demoRepairTask,
              repair_task_id: 'repair-followup-annotation',
              parent_repair_task_id: 'repair-demo',
              title: '低通过率分层修复建议',
              status: 'resolved',
              recommendation: 'payment 分层仍未改善，需要抽样复核。',
              recommended_action: 'seed_annotation_queue',
              target_url: '/annotation-queue?source_task_id=task-demo',
            },
            {
              ...demoRepairTask,
              repair_task_id: 'repair-followup-parameters',
              parent_repair_task_id: 'repair-demo',
              cause_type: 'workflow_parameters',
              title: '确认修复是否进入当前 Attempt',
              status: 'open',
              owner: 'dataset_owner',
              due_at: '2000-01-01T00:00:00+00:00',
              overdue: true,
              recommendation: '检查 task_override 和 Prompt 参数是否进入新 Attempt。',
              recommended_action: 'plan_workflow_parameter_changes',
              target_url: '/reports?task_id=task-demo&panel=parameter-governance',
            },
          ],
          summary: {
            total_children: 2,
            open_children: 1,
            in_progress_children: 0,
            resolved_children: 1,
            completion_rate: 0.5,
            overall_status: 'open',
            blocking_children: ['repair-followup-parameters'],
            overdue_children: 1,
            overdue_task_ids: ['repair-followup-parameters'],
            next_actions: [
              {
                repair_task_id: 'repair-followup-parameters',
                title: '确认修复是否进入当前 Attempt',
                status: 'open',
                owner: 'dataset_owner',
                due_at: '2000-01-01T00:00:00+00:00',
                overdue: true,
                recommended_action: 'plan_workflow_parameter_changes',
                target_url: '/reports?task_id=task-demo&panel=parameter-governance',
              },
            ],
          },
        });
      }
      if (url.endsWith('/repair-tasks/repair-demo/actions')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string };
        if (body.action === 'seed_annotation_queue') {
          return jsonResponse({
            action: 'seed_annotation_queue',
            result: { status: 'created', created_count: 2, annotation_task_ids: ['anno-1', 'anno-2'] },
            repair_task: { ...demoRepairTask, action_history: [{ action: 'seed_annotation_queue', status: 'created', result_summary: '已创建 2 个审核样本。' }] },
          });
        }
        if (body.action === 'retest_and_compare') {
          return jsonResponse({
            action: 'retest_and_compare',
            result: {
              status: 'completed',
              previous_run_id: 'run-demo',
              new_run_id: 'run-demo-2',
              comparison_status: 'unchanged',
              comparison: { pass_rate_delta: 0, badcase_count_delta: 0 },
            },
            repair_task: { ...demoRepairTask, action_history: [{ action: 'retest_and_compare', status: 'completed', result_summary: '复跑完成，质量状态 unchanged。' }] },
          });
        }
        if (body.action === 'generate_remediation_plan') {
          return jsonResponse({
            action: 'generate_remediation_plan',
            result: {
              status: 'completed',
              comparison_status: 'unchanged',
              recommendations: [
                {
                  area: 'annotation',
                  title: '低通过率分层修复建议',
                  reason: 'payment 分层仍未改善，需要抽样复核。',
                  target_url: '/annotation-queue?source_task_id=task-demo',
                },
              ],
            },
            repair_task: {
              ...demoRepairTask,
              action_history: [{ action: 'generate_remediation_plan', status: 'completed', result_summary: '已生成 1 条修复建议。' }],
              last_action_result: {
                action: 'generate_remediation_plan',
                result: {
                  status: 'completed',
                  recommendations: [
                    {
                      area: 'annotation',
                      title: '低通过率分层修复建议',
                      reason: 'payment 分层仍未改善，需要抽样复核。',
                      target_url: '/annotation-queue?source_task_id=task-demo',
                    },
                  ],
                },
              },
            },
          });
        }
        if (body.action === 'create_followup_repair_tasks') {
          return jsonResponse({
            action: 'create_followup_repair_tasks',
            result: {
              status: 'completed',
              created_count: 2,
              reused_count: 0,
              repair_tasks: [
                {
                  ...demoRepairTask,
                  repair_task_id: 'repair-followup-annotation',
                  parent_repair_task_id: 'repair-demo',
                  title: '低通过率分层修复建议',
                  recommendation: 'payment 分层仍未改善，需要抽样复核。',
                  recommended_action: 'seed_annotation_queue',
                  target_url: '/annotation-queue?source_task_id=task-demo',
                },
                {
                  ...demoRepairTask,
                  repair_task_id: 'repair-followup-parameters',
                  parent_repair_task_id: 'repair-demo',
                  cause_type: 'workflow_parameters',
                  title: '确认修复是否进入当前 Attempt',
                  recommendation: '检查 task_override 和 Prompt 参数是否进入新 Attempt。',
                  recommended_action: 'plan_workflow_parameter_changes',
                  target_url: '/reports?task_id=task-demo&panel=parameter-governance',
                },
              ],
            },
            repair_task: {
              ...demoRepairTask,
              action_history: [{ action: 'create_followup_repair_tasks', status: 'completed', result_summary: '已创建 2 个后续修复任务，复用 0 个。' }],
            },
          });
        }
        if (body.action === 'fix_dataset_fields') {
          return jsonResponse({
            action: 'fix_dataset_fields',
            result: {
              status: 'planned',
              target_url: '/datasets?dataset_id=dataset-demo&version=1',
              missing_required_fields: ['reference'],
              duplicate_row_count: 0,
              field_actions: [
                {
                  field: 'reference',
                  action: 'add_or_map_field',
                  required_by_workflow: true,
                  missing_count: 100,
                  present_count: 0,
                  coverage: 0,
                  recommendation: '这是 Workflow 必需字段，请补充该列，或在 Workflow 画布把输入映射到已有等价字段。',
                },
              ],
            },
            repair_task: {
              ...demoRepairTask,
              action_history: [{ action: 'fix_dataset_fields', status: 'planned', result_summary: '已生成 1 条字段修复建议。' }],
              last_action_result: {
                action: 'fix_dataset_fields',
                result: {
                  status: 'planned',
                  target_url: '/datasets?dataset_id=dataset-demo&version=1',
                  missing_required_fields: ['reference'],
                  field_actions: [
                    {
                      field: 'reference',
                      action: 'add_or_map_field',
                      required_by_workflow: true,
                      missing_count: 100,
                      recommendation: '这是 Workflow 必需字段，请补充该列，或在 Workflow 画布把输入映射到已有等价字段。',
                    },
                  ],
                },
              },
            },
          });
        }
        if (body.action === 'plan_workflow_parameter_changes') {
          return jsonResponse({
            action: 'plan_workflow_parameter_changes',
            result: {
              status: 'planned',
              target_url: '/reports?task_id=task-demo&panel=parameter-governance',
              parameter_diffs: [
                {
                  step_id: 'answer',
                  skill_ref: 'llm.call@0.1.0',
                  parameter: 'model',
                  source: 'task_override',
                  workflow_value_preview: 'flow-model',
                  current_value_preview: 'task-quality-model',
                  recommended_action: 'remove_task_override_or_promote_to_workflow',
                  recommendation: '任务覆盖了 Workflow 默认值，请移除覆盖或将确认后的值发布到新 Workflow 版本。',
                },
              ],
              rollback_plan: { skill_overrides_remove: [{ step_id: 'answer', parameter: 'model' }] },
            },
            repair_task: {
              ...demoRepairTask,
              action_history: [{ action: 'plan_workflow_parameter_changes', status: 'planned', result_summary: '已生成 1 条参数 diff 和回滚建议。' }],
              last_action_result: {
                action: 'plan_workflow_parameter_changes',
                result: {
                  status: 'planned',
                  parameter_diffs: [
                    {
                      step_id: 'answer',
                      parameter: 'model',
                      source: 'task_override',
                      workflow_value_preview: 'flow-model',
                      current_value_preview: 'task-quality-model',
                      recommended_action: 'remove_task_override_or_promote_to_workflow',
                      recommendation: '任务覆盖了 Workflow 默认值，请移除覆盖或将确认后的值发布到新 Workflow 版本。',
                    },
                  ],
                },
              },
            },
          });
        }
        if (body.action === 'compare_prompt_skill_versions') {
          return jsonResponse({
            action: 'compare_prompt_skill_versions',
            result: {
              status: 'planned',
              current_versions: [
                { step_id: 'answer', skill_ref: 'llm.call@0.1.0', skill_version: '0.1.0', prompt_version: 'prompt-flow-v1', model: 'quality-model' },
              ],
              baseline_candidates: [
                {
                  experiment_id: 'exp-baseline',
                  name: 'baseline prompt v0',
                  run_id: 'run-baseline',
                  version_diffs: [
                    {
                      step_id: 'answer',
                      field: 'prompt_version',
                      baseline_value: 'prompt-flow-v0',
                      current_value: 'prompt-flow-v1',
                      recommended_action: 'compare_or_rollback_prompt_version',
                    },
                  ],
                },
              ],
              candidate_actions: [
                { action: 'create_prompt_skill_candidate', label: '沉淀 Prompt/Skill 候选配置' },
                { action: 'create_workflow_draft_from_version_diff', label: '从版本差异创建 Workflow 草稿' },
              ],
            },
            repair_task: {
              ...demoRepairTask,
              action_history: [{ action: 'compare_prompt_skill_versions', status: 'planned', result_summary: '已生成 1 个 Prompt/Skill 版本对比候选。' }],
              last_action_result: {
                action: 'compare_prompt_skill_versions',
                result: {
                  status: 'planned',
                  baseline_candidates: [
                    {
                      experiment_id: 'exp-baseline',
                      name: 'baseline prompt v0',
                      version_diffs: [
                        {
                          step_id: 'answer',
                          field: 'prompt_version',
                          baseline_value: 'prompt-flow-v0',
                          current_value: 'prompt-flow-v1',
                          recommended_action: 'compare_or_rollback_prompt_version',
                        },
                      ],
                    },
                  ],
                  candidate_actions: [
                    { action: 'create_prompt_skill_candidate', label: '沉淀 Prompt/Skill 候选配置' },
                    { action: 'create_workflow_draft_from_version_diff', label: '从版本差异创建 Workflow 草稿' },
                  ],
                },
              },
            },
          });
        }
        if (body.action === 'create_prompt_skill_candidate') {
          return jsonResponse({
            action: 'create_prompt_skill_candidate',
            result: {
              status: 'created',
              created_count: 1,
              candidates: [
                {
                  candidate_id: 'prompt-skill-candidate-demo',
                  source_task_id: 'task-demo',
                  baseline_experiment_id: 'exp-baseline',
                  version_diffs: [{ step_id: 'answer', field: 'prompt_version', baseline_value: 'prompt-flow-v0', current_value: 'prompt-flow-v1' }],
                },
              ],
            },
            repair_task: {
              ...demoRepairTask,
              action_history: [{ action: 'create_prompt_skill_candidate', status: 'created', result_summary: '已沉淀 1 个 Prompt/Skill 候选配置。' }],
              version_compare_plan: {
                candidate_actions: [
                  { action: 'create_prompt_skill_candidate', label: '沉淀 Prompt/Skill 候选配置' },
                  { action: 'create_workflow_draft_from_version_diff', label: '从版本差异创建 Workflow 草稿' },
                ],
              },
              last_action_result: {
                action: 'create_prompt_skill_candidate',
                result: {
                  status: 'created',
                  created_count: 1,
                  candidates: [{ candidate_id: 'prompt-skill-candidate-demo', baseline_experiment_id: 'exp-baseline' }],
                },
              },
            },
          });
        }
        if (body.action === 'create_workflow_draft_from_version_diff') {
          return jsonResponse({
            action: 'create_workflow_draft_from_version_diff',
            result: {
              status: 'created',
              target_url: '/workflows/designer/draft-version-diff',
              draft: {
                draft_id: 'draft-version-diff',
                status: 'draft',
                name: '可信评测流程_version_diff_candidate',
              },
            },
            repair_task: {
              ...demoRepairTask,
              action_history: [{ action: 'create_workflow_draft_from_version_diff', status: 'created', result_summary: '已创建 Workflow 草稿：draft-version-diff。' }],
              last_action_result: {
                action: 'create_workflow_draft_from_version_diff',
                result: { status: 'created', draft: { draft_id: 'draft-version-diff', status: 'draft' }, target_url: '/workflows/designer/draft-version-diff' },
              },
            },
          });
        }
        return jsonResponse({
          action: 'evaluate_ci_gate',
          result: { status: 'blocked', blocking_failures: 1, target: { kind: 'task', id: 'task-demo' } },
          repair_task: { ...demoRepairTask, action_history: [{ action: 'evaluate_ci_gate', status: 'blocked', result_summary: 'CI Gate 复测结果：blocked。' }] },
        });
      }
      if (url.endsWith('/repair-tasks')) {
        return jsonResponse([demoRepairTask]);
      }
      if (url.endsWith('/tasks/task-demo/report') || url.includes('/tasks/task-demo/report?')) {
        return jsonResponse({
          task: { ...demoTask, status: 'completed', completed_items: 100, pass_rate: 0.8, badcase_count: 20 },
          task_summary: { task_id: 'task-demo', task_name: 'RAG 任务', run_id: 'run-demo', status: 'completed', dataset_name: '问答回归集', workflow_name: 'RAG 回归评测', sample_count: 100, current_attempt: 1 },
          version_snapshot: {
            dataset: { dataset_id: 'dataset-demo', version: 1, version_id: 'dataset-demo:v1', name: '问答回归集' },
            workflow: { workflow_id: 'wf-demo', version_id: 'wf-demo:v1', name: 'RAG 回归评测', step_count: 2 },
            execution_config: demoTask.execution_config,
          },
          preflight_evidence: demoTask.preflight_result,
          step_distribution: [
            { step_id: 'answer', skill_ref: 'llm.call@0.1.0', total_calls: 100, succeeded: 100, failed: 0, cache_hits: 0, total_latency_ms: 100, average_latency_ms: 1 },
          ],
          judge_score_distribution: [{ bucket: '0.8-1.0', count: 80 }],
          segments: [
            { segment_key: 'scene', segment_value: 'payment', sample_count: 20, pass_count: 8, fail_count: 12, badcase_count: 12, pass_rate: 0.4 },
            { segment_key: 'expected_label', segment_value: 'fail', sample_count: 20, pass_count: 10, fail_count: 10, badcase_count: 10, pass_rate: 0.5 },
          ],
          recommendations: [
            {
              type: 'segment_low_pass_rate',
              title: '低通过率分组加入 Annotation',
              message: 'scene=payment 通过率 40%，建议抽样人工复核。',
              action: 'add_to_annotation_queue',
              segment_key: 'scene',
              segment_value: 'payment',
              severity: 'warning',
            },
            {
              type: 'golden_candidate',
              title: '生成 Golden 候选',
              message: '将失败样本沉淀为 Golden 候选。',
              action: 'create_golden_candidates',
              severity: 'info',
            },
            {
              type: 'ci_gate_suggestion',
              title: '生成 CI Gate 建议',
              message: '建议为 payment 场景设置通过率门禁。',
              action: 'create_ci_gate',
              severity: 'critical',
            },
          ],
          quality_decision: {
            status: 'warning',
            risk_summary: { pass_rate: 0.8, error_rate: 0, badcase_count: 1, weak_segment_count: 1 },
            top_risks: [{ type: 'badcase_budget', severity: 'warning', message: '当前任务产生 1 条 Badcase。' }],
            next_actions: [{ action: 'add_to_annotation_queue', label: '将 Badcase 加入人工审核队列' }],
          },
          parameter_governance: demoParameterGovernance,
          budget_status: { status: 'warning', cost_budget: 20, cost_used: 16.2, budget_remaining: 3.8, usage_ratio: 0.81, message: '估算成本已接近任务预算。' },
          diagnostics: {
            summary: { status: 'needs_attention', primary_cause: 'weak_segment', confidence: 0.82, evidence_count: 3 },
            root_causes: [
              {
                cause_type: 'weak_segment',
                severity: 'warning',
                confidence: 0.82,
                affected_items: 12,
                evidence: ['scene=payment 通过率 40%，Badcase 12 条。'],
                recommendation: '对低通过率分层抽样复核。',
                next_actions: ['seed_annotation_queue', 'create_segment_ci_gate', 'open_parameter_governance'],
              },
            ],
            weak_segments: [{ segment_key: 'scene', segment_value: 'payment', sample_count: 20, badcase_count: 12, pass_rate: 0.4, severity: 'critical' }],
            step_health: [{ step_id: 'answer', skill_ref: 'llm.call@0.1.0', total_calls: 100, failed_calls: 0, cache_hits: 0, total_latency_ms: 100, average_latency_ms: 1, cache_hit_rate: 0, status: 'healthy', signals: [] }],
            data_quality: {
              row_count: 100,
              duplicate_row_count: 0,
              field_coverage: [{ field: 'reference', present_count: 100, missing_count: 0, coverage: 1, required_by_workflow: true }],
              warnings: [],
            },
            parameter_risks: { override_count: 1, expression_count: 0, secret_ref_count: 0, redacted_count: 0, sources: { task_override: 1 }, warnings: ['检测到 1 个任务级参数覆盖。'] },
          },
          report: { run_id: 'run-demo', pass_rate: 0.8, error_rate: 0, p95_latency_ms: 12, metrics: {}, badcases: [demoBadcase] },
          badcases: [demoBadcase],
          badcase_pagination: { page: 1, page_size: 5, total_items: 1, total_pages: 1 },
          export_links: { html: '/runs/run-demo/report/export?file_format=html', csv: '/runs/run-demo/report/export?file_format=csv', json: '/runs/run-demo/report/export?file_format=json' },
        });
      }
      if (url.includes('/tasks/task-demo/report/export?file_format=html')) {
        return jsonResponse({ task_id: 'task-demo', file_format: 'html', content: '<html>preflight-demo</html>' });
      }
      if (url.includes('/tasks/task-demo/report/export?file_format=csv')) {
        return jsonResponse({ task_id: 'task-demo', file_format: 'csv', content: 'metric,value\npreflight_id,preflight-demo' });
      }
      if (url.includes('/tasks/task-demo/report/export?file_format=json')) {
        return jsonResponse({ task_id: 'task-demo', file_format: 'json', content: { preflight_evidence: { preflight_id: 'preflight-demo' } } });
      }
      if (url.includes('/audit-events?action=task.report.export') && url.includes('target=task-demo')) {
        return jsonResponse(demoReportExportAuditEvents);
      }
      if (url.endsWith('/tasks/task-demo/report/export-requests') && init?.method === 'POST') {
        return jsonResponse(demoReportExportRequest);
      }
      if (url.endsWith('/report-export-requests/rex-export-demo/approve') && init?.method === 'POST') {
        return jsonResponse({ ...demoReportExportRequest, status: 'approved', approved_by: 'Admin', approval_note: '允许本次离线复盘。' });
      }
      if (url.endsWith('/report-export-requests/rex-export-demo/reject') && init?.method === 'POST') {
        return jsonResponse({ ...demoReportExportRequest, status: 'rejected', rejected_by: 'Admin', rejection_note: 'CSV 明细包含敏感样本，暂不外发。' });
      }
      if (url.endsWith('/report-export-requests/rex-export-demo/revoke') && init?.method === 'POST') {
        return jsonResponse({ ...demoReportExportRequest, status: 'revoked', revoked_by: 'Viewer', revoke_reason: '已改用在线报告。' });
      }
      if (url.includes('/report-export-requests') && url.includes('task_id=task-demo')) {
        return jsonResponse([demoReportExportRequest]);
      }
      if (url.includes('/tasks/task-demo/trace-flow')) {
        return jsonResponse(demoTraceFlow);
      }
      if (url.includes('/tasks/task-demo/trace-tree')) {
        return jsonResponse(demoTraceTree);
      }
      if (url.endsWith('/tasks/task-demo/parameter-governance')) {
        return jsonResponse(demoParameterGovernance);
      }
      if (url.endsWith('/datasets/dataset-demo/versions/1/lineage')) {
        return jsonResponse(demoDatasetLineage);
      }
      if (url.endsWith('/judge-cross-validation')) {
        return jsonResponse(demoJudgeCrossValidation);
      }
      if (url.endsWith('/red-team/scans')) {
        return jsonResponse(demoRedTeamScan);
      }
      if (url.endsWith('/annotation-queue/seed-from-run')) {
        return jsonResponse({ run_id: 'run-demo', created_count: 1, tasks: demoAnnotationTasks });
      }
      if (url.endsWith('/ci-gates/evaluate')) {
        return jsonResponse({ status: 'blocking', blocking: true, reasons: ['payment 场景通过率低于门禁'], evaluated_at: '2026-05-31T00:00:00Z' });
      }
      if (url.endsWith('/score-analytics')) {
        return jsonResponse(demoScoreAnalytics);
      }
      if (url.endsWith('/judge-audits/trends')) {
        return jsonResponse(demoJudgeAuditTrends);
      }
      if (url.endsWith('/datasets')) {
        return jsonResponse([demoDataset]);
      }
      if (url.endsWith('/runs') || url.endsWith('/judge-profiles') || url.endsWith('/judge-audits')) {
        return jsonResponse([]);
      }
      if (url.endsWith('/badcases') || url.endsWith('/audit-events')) {
        return jsonResponse([]);
      }
      if (url.endsWith('/dashboard/summary')) {
        return jsonResponse({ dataset_count: 12, skill_count: 34, workflow_count: 5, run_count: 8, latest_run: null, pass_rate: 0.92, badcase_count: 7 });
      }
      if (url.includes('/annotation-queue?')) {
        return jsonResponse({
          items: demoAnnotationTasks,
          pagination: { page: 1, page_size: 8, total_items: demoAnnotationTasks.length, total_pages: 1 },
        });
      }
      if (url.includes('/experiments') || url.endsWith('/annotation-queue')) {
        if (url.endsWith('/annotation-queue')) return jsonResponse(demoAnnotationTasks);
        return jsonResponse(demoExperiments);
      }
      if (url.endsWith('/annotation-candidates')) {
        return jsonResponse(demoAnnotationCandidates);
      }
      if (url.endsWith('/prompt-skill-candidates/prompt-skill-candidate-demo/review')) {
        return jsonResponse({
          ...demoPromptSkillCandidate,
          status: 'approved',
          review: { decision: 'approved', reviewer: 'qa_owner', note: '允许生成草稿', reviewed_at: '2026-05-31T01:00:00Z' },
          review_history: [{ decision: 'approved', reviewer: 'qa_owner', note: '允许生成草稿', reviewed_at: '2026-05-31T01:00:00Z' }],
        });
      }
      if (url.endsWith('/prompt-skill-candidates/prompt-skill-candidate-demo/workflow-draft')) {
        return jsonResponse({
          status: 'draft_created',
          candidate: { ...demoPromptSkillCandidate, status: 'draft_created', workflow_draft_id: 'draft-candidate-demo' },
          draft: { draft_id: 'draft-candidate-demo', status: 'draft', name: '候选回滚草稿', graph: demoWorkflowGraph },
          target_url: '/workflows/designer/draft-candidate-demo',
        });
      }
      if (url.endsWith('/prompt-skill-candidates/prompt-skill-candidate-demo/retest')) {
        return jsonResponse(demoPromptSkillRetestPayload);
      }
      if (url.endsWith('/prompt-skill-candidates/prompt-skill-candidate-demo/promotion-review')) {
        return jsonResponse(demoWorkflowPromotionReviewPayload);
      }
      if (url.endsWith('/workflow-promotion-reviews/promotion-review-demo/approve')) {
        return jsonResponse(demoWorkflowPromotionApprovedPayload);
      }
      if (url.endsWith('/experiment-baseline-suggestions/baseline-suggestion-demo/apply')) {
        return jsonResponse(demoBaselineApplyPayload);
      }
      if (url.endsWith('/experiment-baseline-suggestions/baseline-suggestion-demo/impact')) {
        return jsonResponse(demoBaselineImpactPayload);
      }
      if (url.endsWith('/experiment-baseline-suggestions/baseline-suggestion-demo/rollback')) {
        return jsonResponse(demoBaselineRollbackPayload);
      }
      if (url.endsWith('/baseline-change-notifications/baseline-notification-demo/ack')) {
        return jsonResponse(demoBaselineNotificationAckPayload);
      }
      if (url.includes('/baseline-change-notifications')) {
        return jsonResponse([]);
      }
      if (url.endsWith('/prompt-skill-candidates/workload')) {
        return jsonResponse(demoCandidateWorkloadPayload);
      }
      if (url.endsWith('/prompt-skill-candidates/retest-plan')) {
        return jsonResponse(demoCandidateRetestPlanPayload);
      }
      if (url.endsWith('/prompt-skill-candidates/bulk-assign')) {
        return jsonResponse(demoCandidateBulkAssignPayload);
      }
      if (url.endsWith('/prompt-skill-candidates/bulk-archive')) {
        return jsonResponse(demoCandidateBulkArchivePayload);
      }
      if (url.endsWith('/prompt-skill-candidates/escalate-overdue')) {
        return jsonResponse(demoCandidateEscalatePayload);
      }
      if (url.endsWith('/prompt-skill-candidates/bulk-review')) {
        return jsonResponse(demoCandidateBulkReviewPayload);
      }
      if (url.endsWith('/prompt-skill-candidates/bulk-retest')) {
        return jsonResponse(demoCandidateBulkRetestPayload);
      }
      if (url.includes('/prompt-skill-candidates')) {
        const parsed = new URL(url, 'http://localhost');
        if (parsed.searchParams.has('page')) {
          return jsonResponse({
            items: [demoPromptSkillCandidate],
            pagination: { page: Number(parsed.searchParams.get('page') ?? 1), page_size: 8, total_items: 1, total_pages: 1 },
          });
        }
        return jsonResponse([demoPromptSkillCandidate]);
      }
      if (url.endsWith('/ci-gates')) {
        return jsonResponse(demoCIGates);
      }
      if (url.includes('/ci-gates/evaluations')) {
        const parsed = new URL(url, 'http://localhost');
        if (parsed.searchParams.has('page')) {
          return jsonResponse({
            items: demoCIGateEvaluations,
            pagination: { page: Number(parsed.searchParams.get('page') ?? 1), page_size: 6, total_items: demoCIGateEvaluations.length, total_pages: 1 },
            summary: { total_evaluations: demoCIGateEvaluations.length, blocked: 1, passed: 0, latest_status: 'blocked' },
          });
        }
        return jsonResponse(demoCIGateEvaluations);
      }
      if (url.endsWith('/workflow-graphs/validate')) {
        return jsonResponse({ ok: true, errors: [], warnings: [], execution_levels: [['answer'], ['judge']], graph_tips: [], node_count: 2, edge_count: 1 });
      }
      if (url.endsWith('/workflow-graphs/parameter-preview')) {
        return jsonResponse({
          workflow_name: 'RAG 回归评测',
          nodes: [
            {
              node_id: 'answer',
              skill_ref: 'llm.call@0.1.0',
              resolved_config: { model: 'mock-model' },
              parameter_trace: { model: { source: 'workflow_config', value_preview: 'mock-model', redacted: false } },
            },
          ],
        });
      }
      return jsonResponse({});
    });
  });

  it('展示主导航和开始评测入口', async () => {
    await renderWorkbench('/');

    expect(screen.getByText('AegisQA')).toBeInTheDocument();
    expect(screen.getByText('开始一次评测')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Workflow 市场/ })).toBeInTheDocument();
    expect(screen.getAllByText('最近任务').length).toBeGreaterThan(0);
  });

  it('概览页读取真实 Dashboard 并展示产品化增强入口', async () => {
    await renderWorkbench('/');

    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('34')).toBeInTheDocument();
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByText('Experiment 快照')).toBeInTheDocument();
    expect(screen.getByText('Assertion DSL')).toBeInTheDocument();
    expect(screen.getAllByText('CI Gate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Annotation Queue').length).toBeGreaterThan(0);
    expect(screen.getByText('Trace Tree')).toBeInTheDocument();
  });

  it('首页作为任务工作台展示待办队列和主流程入口', async () => {
    await renderWorkbench('/');

    expect(await screen.findByText('任务工作台')).toBeInTheDocument();
    expect(screen.getAllByText('最近任务').length).toBeGreaterThan(0);
    expect(screen.getByText('待审批 Skill')).toBeInTheDocument();
    expect(screen.getByText('待审核样本')).toBeInTheDocument();
    expect(screen.getByText('失败任务')).toBeInTheDocument();
    expect(screen.getByText(/CI Gate 阻断/)).toBeInTheDocument();
    expect(screen.getByText('RAG 任务')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /上传数据/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /选择 Workflow/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /创建任务/ })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /查看报告/ }).length).toBeGreaterThan(0);
  });

  it('Workflow 市场展示草稿、已发布版本、模板和新建入口', async () => {
    await renderWorkbench('/workflows');

    expect(await screen.findByText('Workflow 市场')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新建 Workflow/ })).toBeInTheDocument();
    expect(await screen.findByText('测试草稿')).toBeInTheDocument();
    expect(await screen.findByText('RAG 回归评测')).toBeInTheDocument();
    expect(screen.getByText(/模板/)).toBeInTheDocument();
  });

  it('Workflow 画布解释点对多和多对一流程', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    expect(await screen.findByText('Skill Palette')).toBeInTheDocument();
    expect(screen.getByText('点对多')).toBeInTheDocument();
    expect(screen.getByText('多对一')).toBeInTheDocument();
    expect(screen.getByText('校验与试运行 Console')).toBeInTheDocument();
  });

  it('数据集上传入口点击后打开上传弹窗', async () => {
    await renderWorkbench('/datasets');

    fireEvent.click(screen.getByRole('button', { name: /上传 CSV \/ JSONL/ }));

    expect(await screen.findByText('上传数据集文件')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交上传' })).toBeDisabled();
  });

  it('数据集页可以打开 Lineage 抽屉查看来源和下游任务', async () => {
    await renderWorkbench('/datasets');

    fireEvent.click(await screen.findByRole('button', { name: /查看 Lineage/ }));

    expect(await screen.findByText('数据血缘')).toBeInTheDocument();
    expect(await screen.findByText('file_upload')).toBeInTheDocument();
    expect(await screen.findByText('trusted.jsonl')).toBeInTheDocument();
    expect(await screen.findByText('可信评测任务')).toBeInTheDocument();
  });

  it('Workflow 设计器支持选择流程、删除节点和保存草稿入口', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    expect((await screen.findAllByLabelText('当前 Workflow'))[0]).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /保存草稿/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /删除选中/ })).toBeInTheDocument();

    const joinCountBefore = screen.getAllByText(/Join/).length;
    fireEvent.click(screen.getByRole('button', { name: /新增 Join/ }));
    await waitFor(() => expect(screen.getAllByText(/Join/).length).toBeGreaterThan(joinCountBefore));
  });

  it('Workflow 设计器支持撤销和重做节点操作', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    const joinCountBefore = screen.getAllByText(/Join/).length;
    fireEvent.click(screen.getByRole('button', { name: /新增 Join/ }));
    await waitFor(() => expect(screen.getAllByText(/Join/).length).toBeGreaterThan(joinCountBefore));
    await waitFor(() => expect(screen.getByRole('button', { name: /撤销/ })).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(await screen.findByText(/已撤销/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /重做/ }));
    expect(await screen.findByText(/已重做/)).toBeInTheDocument();
  }, 20_000);

  it('Workflow Inspector 支持查看并删除选中节点的下游连线', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.click(await screen.findByRole('button', { name: /删除连线 answer -> judge_a/ }));

    expect(await screen.findByText(/已删除连线：answer-judge_a/)).toBeInTheDocument();
  });

  it('Workflow Inspector 支持选择下游节点并新增连线', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.click(await screen.findByRole('button', { name: /删除连线 answer -> judge_a/ }));
    fireEvent.click(await screen.findByRole('button', { name: /连接到 judge_a/ }));

    expect(await screen.findByText(/已新增连线：answer-judge_a/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /删除连线 answer -> judge_a/ })).toBeInTheDocument();
  });

  it('Workflow Inspector 提供节点工具栏并支持键盘删除', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.click(await screen.findByRole('button', { name: /删除当前节点/ }));
    expect(await screen.findByText(/已删除节点：answer/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(await screen.findByText(/已撤销/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Delete' });
    expect(await screen.findByText(/已删除节点：answer/)).toBeInTheDocument();
  });

  it('Workflow 发布失败时展示后端校验错误和修复入口', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/workflow-graphs/publish')) {
        return errorResponse(400, {
          code: 'HTTP_ERROR',
          message: 'Workflow Graph 校验失败',
          details: {
            errors: [{ code: 'BRANCH_CONDITION_REQUIRED', message: '条件分支必须配置条件表达式。', node_id: 'branch_low_score' }],
          },
          trace_id: 'trace_test',
        });
      }
      if (url.endsWith('/skills')) return jsonResponse(demoSkills);
      if (url.endsWith('/workflow-drafts')) return jsonResponse([{ draft_id: 'draft-test', status: 'draft', name: '测试草稿', graph: demoWorkflowGraph, created_at: '', updated_at: '' }]);
      if (url.endsWith('/workflows')) return jsonResponse([demoWorkflowVersion]);
      if (url.endsWith('/workflow-templates') || url.endsWith('/datasets')) return jsonResponse([]);
      return jsonResponse({});
    });
    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.click(await screen.findByRole('button', { name: /发布/ }));
    expect(await screen.findByText(/发布失败：Workflow Graph 校验失败/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /错误与建议/ }));
    expect(await screen.findByText('BRANCH_CONDITION_REQUIRED')).toBeInTheDocument();
    expect(screen.getByText('条件分支必须配置条件表达式。')).toBeInTheDocument();
  });

  it('Workflow Aggregator 节点支持聚合策略配置', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    fireEvent.click(await screen.findByRole('button', { name: /新增 Aggregator/ }));
    expect(await screen.findByText('聚合策略')).toBeInTheDocument();

    fireEvent.click(screen.getByText('均值'));
    expect(await screen.findByText(/聚合策略已更新：mean/)).toBeInTheDocument();
  });

  it('Workflow Inspector 支持字段路径选择和参数预览', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    expect(await screen.findByText('字段映射')).toBeInTheDocument();
    expect(screen.getByText('row.question')).toBeInTheDocument();
    expect(screen.getByText('context.answer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '参数预览' }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '选择参数预览数据集' }));
    fireEvent.click(await screen.findByText('问答回归集 v1'));
    fireEvent.click(screen.getByRole('button', { name: /预览参数/ }));

    expect(await screen.findByText('mock-model')).toBeInTheDocument();
    expect(screen.getAllByText(/workflow_config/).length).toBeGreaterThan(0);
  });

  it('执行中心默认展示任务列表并可以创建任务', async () => {
    await renderWorkbench('/runs');

    expect(await screen.findByText('任务列表')).toBeInTheDocument();
    expect(screen.getByText('RAG 任务')).toBeInTheDocument();
    expect(screen.getByText('问答回归集')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /创建任务/ }));

    expect(await screen.findByText('创建任务')).toBeInTheDocument();
    expect(screen.getByText('评测目的')).toBeInTheDocument();
    expect(screen.getByText('质量门槛')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /运行 Preflight/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '确认创建任务' })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('例如：RAG 回归评测 2026-05-31'), { target: { value: '上线门禁任务' } });
    fireEvent.mouseDown(screen.getAllByLabelText('Dataset Version')[0]);
    fireEvent.click(await screen.findByText('问答回归集 v1 / 100 条'));
    fireEvent.mouseDown(screen.getAllByLabelText('Workflow Version')[0]);
    fireEvent.click(await screen.findByText('RAG 回归评测 v1'));
    expect(screen.getByRole('button', { name: /运行 Preflight/ })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /运行 Preflight/ }));
    expect((await screen.findAllByText(/Preflight 通过/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '确认创建任务' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '确认创建任务' }));
    expect(await screen.findByText(/任务已创建/)).toBeInTheDocument();
  });

  it('执行中心选择执行模板后创建任务会提交模板 ID', async () => {
    await renderWorkbench('/runs');

    fireEvent.click(await screen.findByRole('button', { name: /创建任务/ }));
    fireEvent.change(screen.getByPlaceholderText('例如：RAG 回归评测 2026-05-31'), { target: { value: '模板化上线门禁' } });
    fireEvent.mouseDown(findComboboxByLabel('执行参数模板'));
    fireEvent.click(await screen.findByText('上线门禁稳健模板 / 内置'));
    fireEvent.mouseDown(screen.getAllByLabelText('Dataset Version')[0]);
    fireEvent.click(await screen.findByText('问答回归集 v1 / 100 条'));
    fireEvent.mouseDown(screen.getAllByLabelText('Workflow Version')[0]);
    fireEvent.click(await screen.findByText('RAG 回归评测 v1'));

    fireEvent.click(screen.getByRole('button', { name: /运行 Preflight/ }));
    expect((await screen.findAllByText(/Preflight 通过/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '确认创建任务' }));
    expect(await screen.findByText(/任务已创建/)).toBeInTheDocument();

    const createTaskCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([input, init]) => String(input).endsWith('/tasks') && init?.method === 'POST');
    const body = JSON.parse(String(createTaskCall?.[1]?.body ?? '{}'));
    expect(body.execution_template_id).toBe('release_gate_safe');
    expect(body.preflight_id).toBe('preflight-demo');
    expect(body.preflight_result.execution_template_id).toBe('release_gate_safe');
  });

  it('Trace Flow 页面展示样本数据、参数来源和队列消息形状', async () => {
    await renderWorkbench('/tasks/task-demo/trace');

    expect(await screen.findByText('Trace Flow')).toBeInTheDocument();
    expect(screen.getByText('问答回归集')).toBeInTheDocument();
    expect(screen.getByText('item_id')).toBeInTheDocument();
    expect(screen.getByText('item-demo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Steps' }));
    fireEvent.click(await screen.findByRole('tab', { name: '参数' }));
    expect(screen.getByText(/workflow_config/)).toBeInTheDocument();
  });

  it('Trace Flow 样本列表使用服务端分页，避免大任务一次性传输全部样本', async () => {
    const manyTraceItems = Array.from({ length: 12 }, (_, index) => ({
      ...demoTraceFlow.items[0],
      item_id: `trace-item-${index}`,
      row_id: `row-${index}`,
      row_index: index,
      row: { question: `问题 ${index}`, reference: 'AegisQA' },
    }));
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    const traceRequests: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/tasks/task-demo/trace-flow')) {
        traceRequests.push(url);
        const parsed = new URL(url, 'http://localhost');
        const page = Number(parsed.searchParams.get('page') ?? 1);
        const pageSize = Number(parsed.searchParams.get('page_size') ?? 12);
        const start = (page - 1) * pageSize;
        return jsonResponse({
          ...demoTraceFlow,
          items: manyTraceItems.slice(start, start + pageSize),
          pagination: { page, page_size: pageSize, total_items: manyTraceItems.length, total_pages: Math.ceil(manyTraceItems.length / pageSize) },
        });
      }
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/tasks/task-demo/trace');

    expect(await screen.findByText('trace-item-0')).toBeInTheDocument();
    expect(screen.getByText('trace-item-7')).toBeInTheDocument();
    expect(screen.queryByText('trace-item-8')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => {
      expect(traceRequests.some((request) => request.includes('page=2') && request.includes('page_size=8'))).toBe(true);
    });
    expect(await screen.findByText('trace-item-8')).toBeInTheDocument();
  });

  it('Trace Tree 独立页面展示 Item 到 Skill Step 的调用树', async () => {
    await renderWorkbench('/tasks/task-demo/trace-tree');

    expect(await screen.findByText('Trace Tree')).toBeInTheDocument();
    expect(screen.getByText('run-demo')).toBeInTheDocument();
    expect(screen.getAllByText('answer').length).toBeGreaterThan(0);
    expect(screen.getByText('llm.call@0.1.0')).toBeInTheDocument();
  });

  it('Trace Tree 调用树使用服务端分页，避免一次性传输全部调用明细', async () => {
    const manyTraceTreeItems = Array.from({ length: 12 }, (_, index) => ({
      ...demoTraceTree.items[0],
      item_id: `tree-item-${index}`,
      row_id: `row-${index}`,
      metrics: { judge_score: index / 10 },
    }));
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    const traceTreeRequests: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/tasks/task-demo/trace-tree')) {
        traceTreeRequests.push(url);
        const parsed = new URL(url, 'http://localhost');
        const page = Number(parsed.searchParams.get('page') ?? 1);
        const pageSize = Number(parsed.searchParams.get('page_size') ?? 12);
        const start = (page - 1) * pageSize;
        return jsonResponse({
          ...demoTraceTree,
          items: manyTraceTreeItems.slice(start, start + pageSize),
          pagination: { page, page_size: pageSize, total_items: manyTraceTreeItems.length, total_pages: Math.ceil(manyTraceTreeItems.length / pageSize) },
        });
      }
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/tasks/task-demo/trace-tree');

    expect(await screen.findByText('tree-item-0')).toBeInTheDocument();
    expect(screen.getByText('tree-item-7')).toBeInTheDocument();
    expect(screen.queryByText('tree-item-8')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => {
      expect(traceTreeRequests.some((request) => request.includes('page=2') && request.includes('page_size=8'))).toBe(true);
    });
    expect(await screen.findByText('tree-item-8')).toBeInTheDocument();
  });

  it('任务列表执行按钮会刷新任务状态', async () => {
    await renderWorkbench('/runs');

    fireEvent.click(await screen.findByRole('button', { name: /执行/ }));

    expect(await screen.findByText(/任务状态已更新/)).toBeInTheDocument();
  });

  it('任务详情展示 Run Attempts 和执行参数', async () => {
    await renderWorkbench('/runs');

    fireEvent.click(await screen.findByRole('button', { name: 'RAG 任务' }));

    fireEvent.click(await screen.findByRole('tab', { name: 'Attempts' }));
    expect(await screen.findByText('Run Attempts')).toBeInTheDocument();
    expect(screen.getByText(/#1 \/ queued \/ run-demo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '参数' }));
    expect(screen.getAllByText(/并发 2 \/ repeat 1 \/ 重试 1/).length).toBeGreaterThan(0);
  });

  it('任务详情参数页展示创建前 Preflight 证据', async () => {
    await renderWorkbench('/runs');

    fireEvent.click(await screen.findByRole('button', { name: 'RAG 任务' }));
    fireEvent.click(await screen.findByRole('tab', { name: '参数' }));

    expect(await screen.findByText('创建前 Preflight 证据')).toBeInTheDocument();
    expect(screen.getAllByText('preflight-demo').length).toBeGreaterThan(0);
    expect(screen.getByText('预检通过，可以创建并执行任务。')).toBeInTheDocument();
    expect(screen.getByText('数据集非空')).toBeInTheDocument();
    expect(screen.getByText('Workflow 字段映射')).toBeInTheDocument();
  });

  it('任务详情驾驶舱按概览、样本、Trace、Badcase、Attempts 和参数组织', async () => {
    await renderWorkbench('/runs');

    fireEvent.click(await screen.findByRole('button', { name: 'RAG 任务' }));

    expect(await screen.findByRole('tab', { name: '概览' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '样本' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Trace' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Badcase' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Attempts' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '参数' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '参数' }));
    expect(await screen.findByText('任务冻结参数')).toBeInTheDocument();
    expect(screen.getByText('Skill 参数来源')).toBeInTheDocument();
    expect(screen.getByText(/cost_budget/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Trace' }));
    expect(await screen.findByText('Trace Tree')).toBeInTheDocument();
  });

  it('任务详情 Badcase 表分页，避免大任务一次性渲染全部坏例', async () => {
    const manyBadcases = Array.from({ length: 12 }, (_, index) => ({
      ...demoBadcase,
      badcase_id: `badcase-${index}`,
      item_id: `item-${index}`,
      reason: `reason-${index}`,
    }));
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/tasks/task-demo/report') || url.includes('/tasks/task-demo/report?')) {
        return jsonResponse({ badcases: manyBadcases });
      }
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/runs');

    fireEvent.click(await screen.findByRole('button', { name: 'RAG 任务' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Badcase' }));

    expect(await screen.findByText('item-0')).toBeInTheDocument();
    expect(screen.getByText('item-7')).toBeInTheDocument();
    expect(screen.queryByText('item-8')).not.toBeInTheDocument();
  });

  it('完成态任务不能重复执行', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/tasks')) {
        return jsonResponse([{ ...demoTask, status: 'completed', completed_items: 100, pass_rate: 0.8 }]);
      }
      if (url.endsWith('/workflows')) {
        return jsonResponse([demoWorkflowVersion]);
      }
      if (url.endsWith('/datasets')) {
        return jsonResponse([]);
      }
      if (url.endsWith('/task-trace-tree')) {
        return jsonResponse({ items: [] });
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/runs');

    expect(await screen.findByRole('button', { name: /执行/ })).toBeDisabled();
  });

  it('Skill 合约测试按钮会调用后端并展示结果', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/skills')) {
        return jsonResponse(demoSkills);
      }
      if (url.includes('/contract-test')) {
        return jsonResponse({ ok: true, skill_id: 'llm.call@0.1.0', latency_ms: 1, output: { answer: 'ok' }, metrics: {} });
      }
      return jsonResponse([]);
    });
    await renderWorkbench('/skills');

    fireEvent.click(screen.getByRole('button', { name: /上传 Skill 插件包/ }));
    expect(await screen.findByText('上传 Skill 插件包')).toBeInTheDocument();

    fireEvent.click((await screen.findAllByRole('button', { name: /查看详情/ }))[0]);
    fireEvent.click(screen.getByRole('button', { name: /运行合约测试/ }));

    expect(await screen.findByText(/合约测试通过/)).toBeInTheDocument();
  });

  it('Skill 市场展示插件包审批状态、合约测试状态和审批信息', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/skills')) {
        return jsonResponse([...demoSkills, pendingPackageSkill]);
      }
      if (url.endsWith('/skills/packages')) {
        return jsonResponse([pendingSkillPackage]);
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/skills');

    expect(await screen.findByText('Echo 插件')).toBeInTheDocument();
    expect(screen.getByText('待审批')).toBeInTheDocument();
    expect(screen.getByText('合约未通过')).toBeInTheDocument();
    expect(screen.getByText('未审批')).toBeInTheDocument();
  });

  it('治理页审批抽屉展示 manifest、schema 和未通过合约测试禁用原因', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/skills')) {
        return jsonResponse([pendingPackageSkill]);
      }
      if (url.endsWith('/skills/packages')) {
        return jsonResponse([pendingSkillPackage]);
      }
      if (url.endsWith('/audit-events')) {
        return jsonResponse([]);
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/governance');

    const approvalButtons = await screen.findAllByRole('button', { name: /审批详情/ });
    fireEvent.click(approvalButtons[approvalButtons.length - 1]);

    expect(await screen.findByText('Skill 审批详情')).toBeInTheDocument();
    expect(screen.getByText('Manifest')).toBeInTheDocument();
    expect(screen.getByText('输入 Schema')).toBeInTheDocument();
    expect(screen.getByText('未通过合约测试不能启用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /审批启用/ })).toBeDisabled();
  });

  it('Experiment 页面展示实验快照、baseline 对比和创建入口', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/experiments/from-run') && init?.method === 'POST') {
        return jsonResponse({ ...demoExperiments[0], experiment_id: 'exp-created', name: '新实验快照' });
      }
      if (url.includes('/experiments')) {
        return jsonResponse(demoExperiments);
      }
      if (url.endsWith('/runs')) {
        return jsonResponse([{ ...demoTask, run_id: 'run-demo', status: 'completed' }]);
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/experiments');

    expect(await screen.findByText('Experiment 实验中心')).toBeInTheDocument();
    expect(screen.getAllByText('主链路实验').length).toBeGreaterThan(0);
    expect(screen.getByText('Baseline 对比')).toBeInTheDocument();
    expect(screen.getByText('通过率变化')).toBeInTheDocument();
    expect(screen.getByText('失败样本变化')).toBeInTheDocument();
    expect(screen.getByText('P95 耗时变化')).toBeInTheDocument();
    expect(screen.getByText('成本变化')).toBeInTheDocument();
    expect(screen.getByText('Dataset 过滤')).toBeInTheDocument();
    expect(screen.getByText('Workflow 过滤')).toBeInTheDocument();
    expect(screen.getByText('失败分布对比')).toBeInTheDocument();
    expect(screen.getByText('judge_label=fail')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /生成实验快照/ }));
    expect(await screen.findByText('从 Run 生成实验快照')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认生成' })).toBeDisabled();
  });

  it('CI Gate 页面支持创建配置并对任务执行阻断评估', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/ci-gates') && init?.method === 'POST') {
        return jsonResponse({ ...demoCIGates[0], config_id: 'gatecfg-created', name: '新质量门禁' });
      }
      if (url.endsWith('/ci-gates')) {
        return jsonResponse(demoCIGates);
      }
      if (url.endsWith('/ci-gates/evaluate')) {
        return jsonResponse(demoCIGateEvaluations[0]);
      }
      if (url.includes('/ci-gates/evaluations')) {
        const parsed = new URL(url, 'http://localhost');
        return jsonResponse({
          items: demoCIGateEvaluations,
          pagination: { page: Number(parsed.searchParams.get('page') ?? 1), page_size: 6, total_items: demoCIGateEvaluations.length, total_pages: 1 },
          summary: { total_evaluations: demoCIGateEvaluations.length, blocked: 1, passed: 0, latest_status: 'blocked' },
        });
      }
      if (url.endsWith('/tasks')) {
        return jsonResponse([demoTask]);
      }
      if (url.endsWith('/runs')) {
        return jsonResponse([]);
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/ci-gates');

    expect(await screen.findByText('CI Gate 质量门禁')).toBeInTheDocument();
    expect(screen.getAllByText('发布质量门禁').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /创建质量门禁/ })).toBeInTheDocument();
    expect(screen.getByText('评估历史')).toBeInTheDocument();
    expect(screen.getByText('历史趋势')).toBeInTheDocument();
    expect(screen.getByText('gateeval-demo')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /创建质量门禁/ }));
    expect(await screen.findByText('新建质量门禁配置')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /执行 Gate 评估/ }));
    expect(await screen.findByText('阻断原因')).toBeInTheDocument();
    expect(screen.getAllByText(/质量门禁未通过/).length).toBeGreaterThan(0);
  });

  it('CI Gate 评估历史使用服务端分页并保留全量摘要', async () => {
    const manyEvaluations = Array.from({ length: 12 }, (_, index) => ({
      ...demoCIGateEvaluations[0],
      evaluation_id: `gateeval-page-${String(index).padStart(2, '0')}`,
      status: index % 4 === 0 ? 'blocked' : 'passed',
      blocking_failures: index % 4 === 0 ? 1 : 0,
      created_at: `2026-06-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    const evaluationRequests: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/ci-gates')) {
        return jsonResponse(demoCIGates);
      }
      if (url.includes('/ci-gates/evaluations')) {
        const parsed = new URL(url, 'http://localhost');
        evaluationRequests.push(url);
        if (!parsed.searchParams.has('page')) {
          return jsonResponse(manyEvaluations);
        }
        const page = Number(parsed.searchParams.get('page') ?? 1);
        const pageSize = Number(parsed.searchParams.get('page_size') ?? 6);
        const start = (page - 1) * pageSize;
        return jsonResponse({
          items: manyEvaluations.slice(start, start + pageSize),
          pagination: { page, page_size: pageSize, total_items: manyEvaluations.length, total_pages: Math.ceil(manyEvaluations.length / pageSize) },
          summary: { total_evaluations: manyEvaluations.length, blocked: 3, passed: 9, latest_status: 'blocked' },
        });
      }
      if (url.endsWith('/tasks')) {
        return jsonResponse([demoTask]);
      }
      if (url.endsWith('/runs')) {
        return jsonResponse([]);
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/ci-gates');

    expect(await screen.findByText('gateeval-page-00')).toBeInTheDocument();
    expect(screen.queryByText('gateeval-page-06')).not.toBeInTheDocument();
    expect(screen.getByText('历史评估')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => {
      expect(evaluationRequests.some((request) => request.includes('page=2') && request.includes('page_size=6'))).toBe(true);
    });
    expect(await screen.findByText('gateeval-page-06')).toBeInTheDocument();
  });

  it('Annotation Queue 页面支持来源任务筛选、领取和审核回流', async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/annotation-queue/anno-demo/assign')) {
        return jsonResponse({ ...demoAnnotationTasks[0], status: 'assigned', assignee: 'current_user' });
      }
      if (url.includes('/annotation-queue/anno-demo/review')) {
        return jsonResponse({ ...demoAnnotationTasks[0], status: 'reviewed', review: { human_label: 'fail', add_to_golden: true } });
      }
      if (url.includes('/annotation-queue/bulk-review')) {
        return jsonResponse({
          reviewed_count: 1,
          tasks: [{ ...demoAnnotationTasks[0], status: 'reviewed', review: { human_label: 'fail', add_to_golden: true } }],
          candidate_summary: { golden: 1, assertion: 1 },
          candidates: demoAnnotationCandidates,
        });
      }
      if (url.includes('/annotation-candidates')) {
        return jsonResponse(demoAnnotationCandidates);
      }
      if (url.includes('/annotation-queue')) {
        return jsonResponse({
          items: demoAnnotationTasks,
          pagination: { page: 1, page_size: 8, total_items: demoAnnotationTasks.length, total_pages: 1 },
        });
      }
      if (url.endsWith('/tasks')) {
        return jsonResponse([demoTask]);
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/annotation-queue');

    expect(await screen.findByText('Annotation Queue 人工审核')).toBeInTheDocument();
    expect(screen.getByText('RAG 任务')).toBeInTheDocument();
    expect(screen.getByText('低分或失败样本需要人工复核')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('按负责人筛选')).toBeInTheDocument();
    expect(screen.getByText(/候选资产来自已审核样本/)).toBeInTheDocument();
    expect(screen.getByText(/Golden 1 \/ Assertion 1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /领取/ }));
    expect(await screen.findByText(/样本已领取/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /audit 审核/ }));
    expect(await screen.findByText('审核样本')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /确认审核/ })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('例如：pass / fail'), { target: { value: 'fail' } });
    fireEvent.click(screen.getByLabelText('回流 Golden Dataset'));
    fireEvent.click(screen.getByRole('button', { name: /确认审核/ }));

    expect(await screen.findByText(/审核已提交，并回流 Golden/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: /批量审核/ }));
    expect(await screen.findByText('批量审核样本')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('批量标签，例如：pass / fail'), { target: { value: 'fail' } });
    fireEvent.click(screen.getByLabelText('批量回流 Golden Dataset'));
    fireEvent.click(screen.getByRole('button', { name: /确认批量审核/ }));
    expect(await screen.findByText(/批量审核完成/)).toBeInTheDocument();
  });

  it('Annotation Queue 审核队列使用服务端分页', async () => {
    const manyAnnotationTasks = Array.from({ length: 12 }, (_, index) => ({
      ...demoAnnotationTasks[0],
      task_id: `anno-page-${index}`,
      item_id: `anno-item-${index}`,
      reason: `需要复核 ${index}`,
    }));
    const queueRequests: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/annotation-candidates')) {
        return jsonResponse([]);
      }
      if (url.includes('/annotation-queue')) {
        const parsed = new URL(url, 'http://localhost');
        queueRequests.push(url);
        if (!parsed.searchParams.has('page')) {
          return jsonResponse(manyAnnotationTasks);
        }
        const page = Number(parsed.searchParams.get('page') ?? 1);
        const pageSize = Number(parsed.searchParams.get('page_size') ?? 8);
        const start = (page - 1) * pageSize;
        return jsonResponse({
          items: manyAnnotationTasks.slice(start, start + pageSize),
          pagination: { page, page_size: pageSize, total_items: manyAnnotationTasks.length, total_pages: Math.ceil(manyAnnotationTasks.length / pageSize) },
        });
      }
      if (url.endsWith('/tasks')) {
        return jsonResponse([demoTask]);
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/annotation-queue');

    expect(await screen.findByText('anno-item-0')).toBeInTheDocument();
    expect(screen.queryByText('anno-item-8')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => {
      expect(queueRequests.some((request) => request.includes('page=2') && request.includes('page_size=8'))).toBe(true);
    });
    expect(await screen.findByText('anno-item-8')).toBeInTheDocument();
  });

  it('候选资产中心支持审批 Prompt/Skill 候选并创建 Workflow 草稿', async () => {
    await renderWorkbench('/candidate-assets');

    expect(await screen.findByText('候选资产中心')).toBeInTheDocument();
    expect(await screen.findByText('负责人工作量')).toBeInTheDocument();
    expect(await screen.findByText('复跑优先级')).toBeInTheDocument();
    expect(screen.getByText('candidate-ready')).toBeInTheDocument();
    expect(screen.getByText(/候选草稿已发布，可以直接复跑/)).toBeInTheDocument();
    expect(screen.getByText('candidate-needs-publish')).toBeInTheDocument();
    expect(screen.getByText(/候选草稿尚未发布/)).toBeInTheDocument();
    expect(screen.getByText(/未指派：1/)).toBeInTheDocument();
    expect(screen.getAllByText(/逾期：1/).length).toBeGreaterThan(0);
    expect(screen.getByText('prompt-flow-v0')).toBeInTheDocument();
    expect(screen.getByText('prompt-flow-v1')).toBeInTheDocument();
  });

  it('候选资产中心支持批量复跑、指派、归档和逾期升级', async () => {
    await renderWorkbench('/candidate-assets');

    expect(await screen.findByText('候选资产中心')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /批量复跑可执行候选/ }));
    expect(await screen.findByText(/批量复跑完成：1 个，跳过 1 个/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('批量指派负责人'), { target: { value: 'prompt_owner' } });
    fireEvent.change(screen.getByLabelText('负责人开放候选容量'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /指派当前列表给 prompt_owner/ }));
    expect(await screen.findByText(/候选资产已指派：1 个，容量跳过 1 个/)).toBeInTheDocument();
    const bulkAssignCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([input]) => String(input).endsWith('/prompt-skill-candidates/bulk-assign'));
    expect(JSON.parse(String(bulkAssignCall?.[1]?.body ?? '{}'))).toMatchObject({
      owner: 'prompt_owner',
      max_open_per_owner: 3,
    });
    expect(screen.getAllByText(/qa_owner/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /归档终态候选/ }));
    expect(await screen.findByText(/已归档候选：1 个，跳过 0 个/)).toBeInTheDocument();
    const bulkArchiveCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([input]) => String(input).endsWith('/prompt-skill-candidates/bulk-archive'));
    expect(JSON.parse(String(bulkArchiveCall?.[1]?.body ?? '{}'))).toMatchObject({
      statuses: ['rejected', 'promoted', 'retested', 'promotion_rejected'],
    });

    fireEvent.click(screen.getByRole('button', { name: /升级逾期候选/ }));
    expect(await screen.findByText(/逾期候选已升级：1 个/)).toBeInTheDocument();
    expect(screen.getAllByText(/已升级/).length).toBeGreaterThan(0);
  });

  it('候选资产中心支持候选审批、生成草稿和复跑对比', async () => {
    await renderWorkbench('/candidate-assets');

    expect(await screen.findByText('候选资产中心')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /审批通过/ }));
    expect(await screen.findByText(/候选资产已审批/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /生成草稿/ }));
    expect(await screen.findByText(/Workflow 草稿已创建：draft-candidate-demo/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /复跑对比/ }));
    expect(await screen.findByText(/候选复跑已完成：task-candidate-demo/)).toBeInTheDocument();
    expect(screen.getByText('三方指标对比')).toBeInTheDocument();
    expect(screen.getByText('Baseline：90.0%')).toBeInTheDocument();
    expect(screen.getByText('Current：80.0%')).toBeInTheDocument();
    expect(screen.getByText('Candidate：95.0%')).toBeInTheDocument();
    expect(screen.getByText(/current_to_candidate pass_rate_delta=0.15/)).toBeInTheDocument();
    expect(screen.getByText('晋升建议')).toBeInTheDocument();
    expect(screen.getByText(/建议晋升：候选版本已达到质量门槛/)).toBeInTheDocument();
    expect(screen.getByText(/创建 Workflow 晋升审批/)).toBeInTheDocument();
  });

  it('候选资产中心支持晋升审批、Baseline 应用、影响分析和回滚', async () => {
    await renderWorkbench('/candidate-assets');

    expect(await screen.findByText('候选资产中心')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /审批通过/ }));
    expect(await screen.findByText(/候选资产已审批/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /生成草稿/ }));
    expect(await screen.findByText(/Workflow 草稿已创建：draft-candidate-demo/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /复跑对比/ }));
    expect(await screen.findByText(/候选复跑已完成：task-candidate-demo/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /创建 Workflow 晋升审批/ }));
    expect(await screen.findByText(/晋升审批已创建：promotion-review-demo/)).toBeInTheDocument();
    expect(screen.getByText('Workflow 晋升审批')).toBeInTheDocument();
    expect(screen.getByText(/候选版本：wf-demo:v2/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /通过晋升/ }));
    expect(await screen.findByText(/晋升审批已通过：promotion-review-demo/)).toBeInTheDocument();
    expect(screen.getByText('Baseline 替换建议')).toBeInTheDocument();
    expect(screen.getByText(/建议 baseline：exp-candidate-demo/)).toBeInTheDocument();
    expect(screen.getByText('CI Gate 发布记录')).toBeInTheDocument();
    expect(screen.getByText(/ready_to_release/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /应用 baseline/ }));
    expect(await screen.findByText(/Baseline 已应用：exp-candidate-demo/)).toBeInTheDocument();
    expect(screen.getByText(/当前 baseline：exp-candidate-demo/)).toBeInTheDocument();
    expect(screen.getByText('Baseline 变更提醒')).toBeInTheDocument();
    expect(screen.getByText(/Baseline 已从 exp-baseline 切换到 exp-candidate-demo/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /确认已读/ }));
    expect(await screen.findByText(/Baseline 提醒已确认：qa_owner/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /查看影响/ }));
    expect(await screen.findByText(/影响任务：1/)).toBeInTheDocument();
    expect(screen.getByText(/pass_rate_delta=0.05/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /回滚 baseline/ }));
    expect(await screen.findByText(/Baseline 已回滚：exp-baseline/)).toBeInTheDocument();
    expect(screen.getAllByText(/回滚门禁：passed/).length).toBeGreaterThan(0);
  });

  it('候选资产中心支持批量审批当前列表', async () => {
    await renderWorkbench('/candidate-assets');

    expect(await screen.findByText('候选资产中心')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /批量审批当前列表/ }));
    expect(await screen.findByText(/批量审批完成：1 个/)).toBeInTheDocument();
    expect(screen.getByText('已审批')).toBeInTheDocument();
  });

  it('候选资产中心列表使用服务端分页', async () => {
    const manyCandidates = Array.from({ length: 12 }, (_, index) => ({
      ...demoPromptSkillCandidate,
      candidate_id: `candidate-page-${String(index).padStart(2, '0')}`,
      status: 'candidate',
    }));
    const candidateRequests: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/prompt-skill-candidates/workload')) {
        return jsonResponse({ summary: { total_candidates: 12, total_open: 12, total_overdue: 0, escalated: 0 }, owners: [] });
      }
      if (url.includes('/prompt-skill-candidates/retest-plan')) {
        return jsonResponse({
          summary: { total_candidates: 0, ready_for_retest: 0, needs_publish: 0, needs_draft: 0, already_retested: 0, overdue: 0, escalated: 0 },
          items: [],
        });
      }
      if (url.includes('/baseline-change-notifications')) {
        return jsonResponse([]);
      }
      if (url.includes('/prompt-skill-candidates')) {
        const parsed = new URL(url, 'http://localhost');
        candidateRequests.push(url);
        if (!parsed.searchParams.has('page')) {
          return jsonResponse(manyCandidates);
        }
        const page = Number(parsed.searchParams.get('page') ?? 1);
        const pageSize = Number(parsed.searchParams.get('page_size') ?? 8);
        const start = (page - 1) * pageSize;
        return jsonResponse({
          items: manyCandidates.slice(start, start + pageSize),
          pagination: { page, page_size: pageSize, total_items: manyCandidates.length, total_pages: Math.ceil(manyCandidates.length / pageSize) },
        });
      }
      return jsonResponse([]);
    });

    await renderWorkbench('/candidate-assets');

    expect(await screen.findByText('candidate-page-00')).toBeInTheDocument();
    expect(screen.queryByText('candidate-page-08')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => {
      expect(candidateRequests.some((request) => request.includes('page=2') && request.includes('page_size=8'))).toBe(true);
    });
    expect(await screen.findByText('candidate-page-08')).toBeInTheDocument();
  });

  it('报告中心围绕任务展示报告、质量决策和导出入口', async () => {
    await renderWorkbench('/reports');

    expect(await screen.findByText('任务报告')).toBeInTheDocument();
    expect(screen.getAllByText('RAG 任务').length).toBeGreaterThan(0);
    expect(screen.getByText('任务摘要与版本快照')).toBeInTheDocument();
    expect(screen.getByText('创建前 Preflight 证据')).toBeInTheDocument();
    expect(screen.getAllByText('preflight-demo').length).toBeGreaterThan(0);
    expect(screen.getByText('Step 分布与耗时')).toBeInTheDocument();
    expect(screen.getByText('分层分析')).toBeInTheDocument();
    expect(screen.getByText('质量决策中心')).toBeInTheDocument();
    expect(await screen.findByText('报告导出历史')).toBeInTheDocument();
    expect(screen.getByText('audit-export-html')).toBeInTheDocument();
    expect(screen.getAllByText('html').length).toBeGreaterThan(0);
    expect(screen.getAllByText('preflight-demo').length).toBeGreaterThan(0);
    expect(findComboboxByLabel('报告导出角色')).toBeInTheDocument();
    expect(screen.getByText('评测结论')).toBeInTheDocument();
    expect(screen.getByText('能否发布')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /生成修复任务/ })).toBeInTheDocument();
    expect(screen.getByText('根因诊断')).toBeInTheDocument();
    expect(screen.getByText('主要根因')).toBeInTheDocument();
    expect(screen.getAllByText('弱分层风险').length).toBeGreaterThan(0);
    expect(screen.getByText('数据质量')).toBeInTheDocument();
    expect(screen.getByText('将 Badcase 加入人工审核队列')).toBeInTheDocument();
    expect(screen.getByText('scene=payment')).toBeInTheDocument();
    expect(screen.getByText('低通过率分组加入 Annotation')).toBeInTheDocument();
    expect(screen.getAllByText('answer').length).toBeGreaterThan(0);
    expect(screen.getByText('80')).toBeInTheDocument();
  });

  it('报告中心支持诊断动作、修复任务和分层门禁', async () => {
    await renderWorkbench('/reports');

    expect(await screen.findByText('根因诊断')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '加入人工审核' }));
    expect(await screen.findByText(/诊断动作完成：已创建 1 条人工审核任务/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /生成修复任务/ }));
    expect(await screen.findByText(/已生成 1 个修复任务/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '生成分层门禁' }));
    expect(await screen.findByText(/CI Gate 即时评估完成：blocking/)).toBeInTheDocument();
  });

  it('报告中心支持任务报告 HTML/CSV/JSON 导出', async () => {
    await renderWorkbench('/reports');

    expect(await screen.findByText('任务报告')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /导出 HTML/ }));
    expect(await screen.findByText(/报告导出成功：RAG_任务.html 已开始下载/)).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining('/tasks/task-demo/report/export?file_format=html'), expect.anything());
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining('/audit-events?action=task.report.export&target=task-demo'), expect.anything());

    fireEvent.click(screen.getByRole('button', { name: /导出 CSV/ }));
    expect(await screen.findByText(/报告导出成功：RAG_任务.csv 已开始下载/)).toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining('/tasks/task-demo/report/export?file_format=csv'), expect.anything());

    fireEvent.click(screen.getByRole('button', { name: /导出 JSON/ }));
    expect(await screen.findByText(/报告导出成功：RAG_任务.json 已开始下载/)).toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining('/tasks/task-demo/report/export?file_format=json'), expect.anything());
  });

  it('报告中心支持导出审批生命周期', async () => {
    await renderWorkbench('/reports');

    expect(await screen.findByText('任务报告')).toBeInTheDocument();

    fireEvent.mouseDown(findComboboxByLabel('报告导出角色'));
    fireEvent.click(await screen.findByText('Viewer（只读）'));
    expect(await screen.findByText(/当前角色只有报告查看权限，不能导出或外发报告/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /导出 HTML/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /申请 HTML 导出审批/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Admin 拒绝/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Admin 拒绝/ }));
    expect(await screen.findByText(/导出审批已拒绝：rex-export-demo/)).toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining('/report-export-requests/rex-export-demo/reject'), expect.anything());

    fireEvent.click(screen.getByRole('button', { name: /申请 HTML 导出审批/ }));
    expect(await screen.findByText(/导出审批已提交：rex-export-demo/)).toBeInTheDocument();
    expect(screen.getByText('导出审批请求')).toBeInTheDocument();
    expect(screen.getByText('rex-export-demo')).toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining('/tasks/task-demo/report/export-requests'), expect.anything());

    fireEvent.click(screen.getByRole('button', { name: /Admin 审批/ }));
    expect(await screen.findByText(/导出审批已通过：rex-export-demo/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /导出 HTML/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /导出 HTML/ }));
    expect(await screen.findByText(/报告导出成功：RAG_任务.html 已开始下载/)).toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/tasks/task-demo/report/export?file_format=html&role=Viewer&approval_request_id=rex-export-demo'),
      expect.anything(),
    );
    expect(screen.getByRole('button', { name: /撤销申请/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /撤销申请/ }));
    expect(await screen.findByText(/导出审批已撤销：rex-export-demo/)).toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(expect.stringContaining('/report-export-requests/rex-export-demo/revoke'), expect.anything());
  });

  it('报告中心支持 Badcase 操作并跳转 Trace Flow', async () => {
    await renderWorkbench('/reports');

    expect(await screen.findByText('任务报告')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /忽略/ }));
    expect(await screen.findByText(/Badcase 已忽略/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重开/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /加入审阅队列/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看参数治理' }));
    expect(await screen.findByText('Trace Flow')).toBeInTheDocument();
    expect(await screen.findByText('问答回归集')).toBeInTheDocument();
  });

  it('报告中心 Badcase 明细使用服务端分页，导出不受页面分页影响', async () => {
    const manyBadcases = Array.from({ length: 12 }, (_, index) => ({
      ...demoBadcase,
      badcase_id: `badcase-page-${index}`,
      item_id: `badcase-item-${index}`,
      reason: `judge_label=fail-${index}`,
    }));
    const defaultFetch = vi.mocked(globalThis.fetch).getMockImplementation();
    const reportRequests: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes('/tasks/task-demo/report') && !url.includes('/export')) {
        reportRequests.push(url);
        const parsed = new URL(url, 'http://localhost');
        const page = Number(parsed.searchParams.get('badcase_page') ?? 1);
        const pageSize = Number(parsed.searchParams.get('badcase_page_size') ?? 12);
        const start = (page - 1) * pageSize;
        const pageBadcases = manyBadcases.slice(start, start + pageSize);
        return jsonResponse({
          task: { ...demoTask, status: 'completed', pass_rate: 0.2, badcase_count: manyBadcases.length },
          task_summary: { task_id: 'task-demo', task_name: 'RAG 任务', run_id: 'run-demo', status: 'completed', sample_count: 12 },
          version_snapshot: { dataset: {}, workflow: {}, execution_config: {} },
          report: { run_id: 'run-demo', pass_rate: 0.2, error_rate: 0, p95_latency_ms: 12, metrics: {}, badcases: pageBadcases },
          badcases: pageBadcases,
          badcase_pagination: { page, page_size: pageSize, total_items: manyBadcases.length, total_pages: Math.ceil(manyBadcases.length / pageSize) },
          export_links: { html: '', csv: '', json: '' },
        });
      }
      if (url.includes('/tasks/task-demo/report/export?file_format=json')) {
        return jsonResponse({ task_id: 'task-demo', file_format: 'json', content: { badcases: manyBadcases, badcase_pagination: { total_items: manyBadcases.length } } });
      }
      return defaultFetch?.(input, init) ?? jsonResponse([]);
    });

    await renderWorkbench('/reports?task_id=task-demo');

    expect(await screen.findByText('badcase-item-0')).toBeInTheDocument();
    expect(screen.getByText('badcase-item-4')).toBeInTheDocument();
    expect(screen.queryByText('badcase-item-5')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    await waitFor(() => {
      expect(reportRequests.some((request) => request.includes('badcase_page=2') && request.includes('badcase_page_size=5'))).toBe(true);
    });
    expect(await screen.findByText('badcase-item-5')).toBeInTheDocument();
  });

  it('报告中心展示 Score Analytics、成本预算和红队扫描入口', async () => {
    await renderWorkbench('/reports');

    expect(await screen.findByText('跨任务 Score Analytics')).toBeInTheDocument();
    expect(screen.getByText('成本预算')).toBeInTheDocument();
    expect(screen.getAllByText('退化任务').length).toBeGreaterThan(0);
    expect(screen.getByText(/估算成本已接近任务预算/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /运行红队扫描/ }));

    expect(await screen.findByText('prompt_injection')).toBeInTheDocument();
    expect(screen.getByText('pii_leakage')).toBeInTheDocument();
    expect(screen.getByText('添加 Prompt Injection 断言')).toBeInTheDocument();
  });

  it('修复任务工作台支持查看证据、领取和完成', async () => {
    await renderWorkbench('/repair-tasks');

    expect(screen.getByRole('link', { name: /修复任务/ })).toBeInTheDocument();
    expect(await screen.findByText('修复任务工作台')).toBeInTheDocument();
    expect(screen.getByText('[warning] 复盘低通过率分层')).toBeInTheDocument();
    expect(screen.getByText('scene=payment 通过率 40%，Badcase 12 条。')).toBeInTheDocument();
    expect(screen.getByText('task-demo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /查看报告/ })).toHaveAttribute('href', '/reports?task_id=task-demo');

    fireEvent.click(screen.getByRole('button', { name: /领取/ }));
    expect(await screen.findByText(/修复任务已领取：qa_owner/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /完成/ }));
    expect(await screen.findByText('完成修复任务')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('说明本次修复做了什么、如何验证'), { target: { value: '已补充 Golden 并调整 Prompt。' } });
    fireEvent.click(screen.getByRole('button', { name: /确认完成/ }));
    expect(await screen.findByText(/修复任务已完成/)).toBeInTheDocument();
  });

  it('修复任务工作台支持发起人工审核和 CI Gate 复测动作', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /发起人工审核/ }));
    expect((await screen.findAllByText(/已创建 2 个审核样本/)).length).toBeGreaterThan(0);

    await waitFor(() => expect(screen.getByRole('button', { name: /CI Gate 复测/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /CI Gate 复测/ }));
    expect((await screen.findAllByText(/CI Gate 复测结果：blocked/)).length).toBeGreaterThan(0);
    expect(screen.getByText('seed_annotation_queue')).toBeInTheDocument();
    expect(screen.getByText('evaluate_ci_gate')).toBeInTheDocument();
  });

  it('修复任务工作台支持复跑并展示 Attempt 对比结果', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /复跑对比/ }));

    expect((await screen.findAllByText(/复跑完成，质量状态 unchanged/)).length).toBeGreaterThan(0);
    expect(screen.getByText('retest_and_compare')).toBeInTheDocument();
  });

  it('修复任务工作台支持生成并展示上下文修复建议', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /生成建议/ }));

    expect(await screen.findByText(/已生成 1 条修复建议/)).toBeInTheDocument();
    expect(screen.getByText('低通过率分层修复建议')).toBeInTheDocument();
    expect(screen.getByText('generate_remediation_plan')).toBeInTheDocument();
  });

  it('修复任务工作台支持把建议拆成可追踪子任务', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /拆分子任务/ }));

    expect((await screen.findAllByText(/已创建 2 个后续修复任务/)).length).toBeGreaterThan(0);
    expect(screen.getByText('create_followup_repair_tasks')).toBeInTheDocument();
    expect(screen.getByText('低通过率分层修复建议')).toBeInTheDocument();
    expect(screen.getByText('确认修复是否进入当前 Attempt')).toBeInTheDocument();
    expect(screen.getByText('seed_annotation_queue')).toBeInTheDocument();
    expect(screen.getByText('plan_workflow_parameter_changes')).toBeInTheDocument();
  });

  it('修复任务工作台支持查看修复树进度', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /查看进度/ }));

    expect(await screen.findByText('修复树进度')).toBeInTheDocument();
    expect(await screen.findByText(/已完成 1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText('低通过率分层修复建议')).toBeInTheDocument();
    expect(screen.getAllByText('确认修复是否进入当前 Attempt').length).toBeGreaterThan(0);
    expect(screen.getAllByText('plan_workflow_parameter_changes').length).toBeGreaterThan(0);
  });

  it('修复任务工作台支持指派负责人并在修复树提示逾期', async () => {
    await renderWorkbench('/repair-tasks');

    await screen.findByText('[warning] 复盘低通过率分层');
    fireEvent.click(await screen.findByRole('button', { name: /指派修复任务/ }));
    expect(await screen.findByText('指派修复任务')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('例如：dataset_owner'), { target: { value: 'dataset_owner' } });
    fireEvent.change(screen.getByPlaceholderText('例如：2026-06-01T00:00:00+00:00'), { target: { value: '2000-01-01T00:00:00+00:00' } });
    fireEvent.click(screen.getByRole('button', { name: /确认指派/ }));

    expect(await screen.findByText(/修复任务已指派给：dataset_owner/)).toBeInTheDocument();
    expect(screen.getAllByText('dataset_owner').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /查看进度/ }));
    expect(await screen.findByText(/逾期子任务 1 个/)).toBeInTheDocument();
  });

  it('修复任务工作台支持生成 Dataset 字段修复计划', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /字段修复计划/ }));

    expect(await screen.findByText(/已生成 1 条字段修复建议/)).toBeInTheDocument();
    expect(screen.getByText('fix_dataset_fields')).toBeInTheDocument();
    expect(screen.getByText(/reference/)).toBeInTheDocument();
    expect(screen.getByText(/这是 Workflow 必需字段/)).toBeInTheDocument();
  });

  it('修复任务工作台支持生成 Workflow 参数 diff 和回滚建议', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /参数 diff\/回滚/ }));

    expect(await screen.findByText(/已生成 1 条参数 diff 和回滚建议/)).toBeInTheDocument();
    expect(screen.getByText('plan_workflow_parameter_changes')).toBeInTheDocument();
    expect(screen.getByText(/answer.model/)).toBeInTheDocument();
    expect(screen.getByText(/task-quality-model/)).toBeInTheDocument();
    expect(screen.getByText(/移除覆盖或将确认后的值发布到新 Workflow 版本/)).toBeInTheDocument();
  });

  it('修复任务工作台支持生成 Prompt 和 Skill 版本对比', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /版本对比/ }));

    expect(await screen.findByText(/已生成 1 个 Prompt\/Skill 版本对比候选/)).toBeInTheDocument();
    expect(screen.getByText('compare_prompt_skill_versions')).toBeInTheDocument();
    expect(screen.getByText(/answer.prompt_version/)).toBeInTheDocument();
    expect(screen.getByText(/prompt-flow-v0/)).toBeInTheDocument();
    expect(screen.getByText(/prompt-flow-v1/)).toBeInTheDocument();
  });

  it('修复任务工作台支持把版本对比沉淀为候选配置', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /版本对比/ }));
    expect(await screen.findByText(/已生成 1 个 Prompt\/Skill 版本对比候选/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /沉淀候选/ }));

    expect((await screen.findAllByText(/已沉淀 1 个 Prompt\/Skill 候选配置/)).length).toBeGreaterThan(0);
    expect(screen.getByText('create_prompt_skill_candidate')).toBeInTheDocument();
  });

  it('修复任务工作台支持从版本差异创建 Workflow 草稿', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /版本对比/ }));
    expect(await screen.findByText(/已生成 1 个 Prompt\/Skill 版本对比候选/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /生成草稿/ }));

    expect((await screen.findAllByText(/已创建 Workflow 草稿：draft-version-diff/)).length).toBeGreaterThan(0);
    expect(screen.getByText('create_workflow_draft_from_version_diff')).toBeInTheDocument();
  });

  it('修复任务工作台沉淀候选后仍可继续生成 Workflow 草稿', async () => {
    await renderWorkbench('/repair-tasks');

    fireEvent.click(await screen.findByRole('button', { name: /版本对比/ }));
    expect(await screen.findByText(/已生成 1 个 Prompt\/Skill 版本对比候选/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /沉淀候选/ }));
    expect((await screen.findAllByText(/已沉淀 1 个 Prompt\/Skill 候选配置/)).length).toBeGreaterThan(0);

    fireEvent.click(await screen.findByRole('button', { name: /生成草稿/ }));

    expect((await screen.findAllByText(/已创建 Workflow 草稿：draft-version-diff/)).length).toBeGreaterThan(0);
  });

  it('Judge 审计创建按钮打开审计表单', async () => {
    await renderWorkbench('/judge');

    fireEvent.click(screen.getByRole('button', { name: /创建审计/ }));

    expect(await screen.findByText('创建 Judge 审计')).toBeInTheDocument();
  });

  it('Judge 审计支持打开多 Judge 一致性弹窗并展示结果', async () => {
    await renderWorkbench('/judge');

    fireEvent.click(screen.getByRole('button', { name: /多 Judge 一致性/ }));

    expect((await screen.findAllByText('多 Judge 一致性')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /开始一致性分析/ }));
    expect(await screen.findByText('judge-a|judge-b')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('Judge 审计展示偏差趋势', async () => {
    await renderWorkbench('/judge');

    expect(await screen.findByText('Judge 偏差趋势')).toBeInTheDocument();
    expect(screen.getByText('低一致性 Profile')).toBeInTheDocument();
    expect(screen.getByText('judge-demo')).toBeInTheDocument();
    expect(screen.getByText('一致性偏低。')).toBeInTheDocument();
  });

  it('治理页面权限矩阵按钮打开矩阵弹窗', async () => {
    await renderWorkbench('/governance');

    expect(screen.getByText('生产适配边界已移至文档')).toBeInTheDocument();
    expect(screen.queryByText('schema 已准备')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /查看权限矩阵/ }));

    expect(await screen.findByText('RBAC 权限矩阵')).toBeInTheDocument();
  });
});
