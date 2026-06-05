import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, vi } from 'vitest';

import { AppShell } from '../App';
import { FEATURE_FLAG_DEFAULTS, allFeatureFlagsEnabled, type FeatureFlags } from '../features';
import { demoSkills, demoWorkflowGraph } from './fixtures/demo';

export { demoSkills, demoWorkflowGraph };

export const demoWorkflowVersion = {
  workflow_id: 'wf-demo',
  name: 'RAG 回归评测',
  version: 1,
  version_id: 'wf-demo:v1',
  status: 'published',
  graph: demoWorkflowGraph,
  steps: [],
};

export const demoTask = {
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

export const demoWorkbench = {
  source: 'real_store',
  summary: {
    task_count: 1,
    run_count: 1,
    failed_run_count: 1,
    pending_badcase_count: 1,
    gate_failure_count: 1,
    report_count: 1,
  },
  recent_tasks: [
    {
      ...demoTask,
      status: 'completed',
      completed_items: 80,
      failed_items: 20,
      pass_rate: 0.8,
      badcase_count: 20,
      latest_run_summary: { run_id: 'run-demo', status: 'completed', total_items: 100, completed_items: 80, failed_items: 20 },
      preflight_summary: { status: 'passed', message: 'Preflight 通过：可以创建并执行任务。', blocking_check_count: 0, warning_check_count: 0 },
      gate_summary: { status: 'blocked', message: '质量门禁存在阻断项。', evidence: ['pass_rate=0.8 < 0.9'], metrics: { pass_rate: 0.8, badcase_count: 20 } },
      available_actions: [
        { action: 'open_trace_flow', label: '查看 Trace Flow', enabled: true, target_url: '/tasks/task-demo/trace' },
        { action: 'open_report', label: '查看 Report', enabled: true, target_url: '/reports?task_id=task-demo' },
      ],
    },
  ],
  failed_runs: [{ run_id: 'run-demo', status: 'completed', total_items: 100, completed_items: 80, failed_items: 20 }],
  pending_badcases: [
    {
      badcase_id: 'badcase-demo',
      run_id: 'run-demo',
      item_id: 'item-demo',
      status: 'pending_review',
      reason: 'judge_label=fail',
      payload: { question: '坏例样本', score: 0.2 },
      task_id: 'task-demo',
      target_url: '/reports?task_id=task-demo',
    },
  ],
  gate_failures: [{ task_id: 'task-demo', task_name: 'RAG 任务', status: 'blocked', message: '质量门禁存在阻断项。', target_url: '/reports?task_id=task-demo', evidence: ['pass_rate=0.8 < 0.9'] }],
  recent_reports: [{ task_id: 'task-demo', task_name: 'RAG 任务', run_id: 'run-demo', status: 'completed', pass_rate: 0.8, failed_items: 20, badcase_count: 20, gate_status: 'blocked', target_url: '/reports?task_id=task-demo' }],
  continue_actions: [
    { action: 'open_report', label: '处理 Gate 风险 RAG 任务', target_url: '/reports?task_id=task-demo', priority: 'high' },
    { action: 'open_trace_flow', label: '定位 Badcase item-demo', target_url: '/tasks/task-demo/trace', priority: 'high' },
  ],
  empty_state: { message: '', next_actions: [] },
};

export const demoPreflightResult = {
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

export const demoTaskExecutionTemplates = [
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

export const demoBadcase = {
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

export const demoReportExportAuditEvents = [
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

export const demoReportExportRequest = {
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

export const demoRepairTask = {
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

export const demoTraceFlow = {
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
          resolved_input: { prompt: '什么是 Trace?' },
          raw_output: { answer: '模型回答' },
          validated_output: { answer: '模型回答' },
          schema_errors: [],
          prompt_calls: [{ prompt_name: 'answer_prompt', status: 'succeeded', token_usage: { total_tokens: 12 } }],
          diagnostic_tags: ['llm_step', 'prompt_call'],
          error_explanation: null,
          available_actions: [
            { action: 'view_step_detail', label: '查看 Step 详情', target_url: '/runs?task_id=task-demo&item_id=item-demo&step_id=answer' },
            { action: 'replay_step', label: 'Replay Step', target_url: '/runs?task_id=task-demo&item_id=item-demo&step_id=answer&action=replay_step' },
            { action: 'prompt_debug', label: 'Prompt Debug', target_url: '/runs?task_id=task-demo&item_id=item-demo&step_id=answer&action=prompt_debug' },
            { action: 'open_repro_bundle', label: '导出 Repro Bundle', target_url: '/runs?task_id=task-demo&item_id=item-demo&step_id=answer&action=repro_bundle' },
          ],
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

export const demoTraceTree = {
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

export const demoDataset = {
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

export const demoDatasetLineage = {
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

export const demoDatasetQuality = {
  dataset_id: 'dataset-demo',
  dataset_version: 1,
  dataset_version_id: 'dataset-demo:v1',
  name: '问答回归集',
  summary: {
    row_count: 100,
    field_count: 3,
    fields_with_missing: 0,
    duplicate_row_count: 0,
    duplicate_group_count: 0,
    duplicate_rate: 0,
  },
  fields: [
    {
      field: 'question',
      path: 'row.question',
      type: 'text',
      present_count: 100,
      missing_count: 0,
      coverage_rate: 1,
      missing_rate: 0,
      distinct_count: 100,
      recommendation: { action: 'none', message: '字段覆盖完整。' },
    },
    {
      field: 'reference',
      path: 'row.reference',
      type: 'text',
      present_count: 100,
      missing_count: 0,
      coverage_rate: 1,
      missing_rate: 0,
      distinct_count: 90,
      recommendation: { action: 'none', message: '字段覆盖完整。' },
    },
  ],
  duplicate_groups: [],
};

export const demoParameterGovernance = {
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

export const demoJudgeCrossValidation = {
  dataset_version_id: 'dataset-demo:v1',
  profile_count: 2,
  pairwise_agreement: { 'judge-a|judge-b': 0.5 },
  audits: {
    'judge-a': { accuracy: 1, precision: 1, recall: 1, f1: 1, cohen_kappa: 1 },
    'judge-b': { accuracy: 0.5, precision: 0.5, recall: 1, f1: 0.66, cohen_kappa: 0 },
  },
};

export const demoScoreAnalytics = {
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

export const demoRedTeamScan = {
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

export const demoJudgeAuditTrends = {
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

export const demoExperiments = [
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

export const demoCIGates = [
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

export const demoCIGateEvaluations = [
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

export const demoAnnotationTasks = [
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

export const demoAnnotationCandidates = [
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

export const demoPromptSkillCandidate = {
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

export const demoPromptSkillRetestPayload = {
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

export const demoWorkflowPromotionReviewPayload = {
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

export const demoWorkflowPromotionApprovedPayload = {
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

export const demoBaselineApplyPayload = {
  status: 'applied',
  suggestion: {
    ...demoWorkflowPromotionApprovedPayload.release_artifacts.baseline_suggestion,
    status: 'applied',
    applied_by: 'release_owner',
    apply_ci_gate_guard_status: 'passed',
    apply_ci_gate_evaluation_ids: ['gateeval-demo'],
    applied_at: '2026-05-31T04:00:00Z',
  },
  baseline: {
    baseline_id: 'baseline-demo',
    scope: { dataset_id: 'dataset-demo', workflow_id: 'wf-demo' },
    current_experiment_id: 'exp-candidate-demo',
    previous_experiment_id: 'exp-baseline',
    status: 'active',
    history: [{ action: 'apply', suggestion_id: 'baseline-suggestion-demo', from_experiment_id: 'exp-baseline', to_experiment_id: 'exp-candidate-demo', actor: 'release_owner', note: '应用为新 baseline。', ci_gate_guard_status: 'passed', ci_gate_evaluation_ids: ['gateeval-demo'] }],
    created_at: '2026-05-31T04:00:00Z',
    updated_at: '2026-05-31T04:00:00Z',
  },
  ci_gate_guard: {
    status: 'passed',
    ci_gate_evaluations: [{ ...demoCIGateEvaluations[0], evaluation_id: 'gateeval-demo', source: 'experiment_baseline_apply' }],
    blocking_failures: 0,
  },
  impact: {
    suggestion_id: 'baseline-suggestion-demo',
    scope: { dataset_id: 'dataset-demo', workflow_id: 'wf-demo' },
    suggested_experiment_id: 'exp-candidate-demo',
    previous_baseline_experiment_id: 'exp-baseline',
    metric_delta: { pass_rate_delta: 0.05, badcase_delta: -2 },
    summary: { affected_tasks: 1, affected_reports: 1, ci_gate_configs: 1 },
    affected_tasks: [{ task_id: 'task-demo', name: 'RAG 任务', status: 'completed', pass_rate: 0.8 }],
    recommendations: [{ action: 'apply_baseline', label: '可以应用 baseline' }],
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

export const demoBaselineImpactPayload = {
  suggestion_id: 'baseline-suggestion-demo',
  scope: { dataset_id: 'dataset-demo', workflow_id: 'wf-demo' },
  suggested_experiment_id: 'exp-candidate-demo',
  previous_baseline_experiment_id: 'exp-baseline',
  metric_delta: { pass_rate_delta: 0.05, badcase_delta: -2 },
  summary: { affected_tasks: 1, affected_reports: 1, ci_gate_configs: 1 },
  affected_tasks: [{ task_id: 'task-demo', name: 'RAG 任务', status: 'completed', pass_rate: 0.8 }],
  recommendations: [{ action: 'apply_baseline', label: '可以应用 baseline' }],
};

export const demoBaselineRollbackPayload = {
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

export const demoBaselineNotificationAckPayload = {
  ...demoBaselineApplyPayload.notifications[0],
  status: 'acknowledged',
  acknowledged_by: 'qa_owner',
  acknowledged_at: '2026-05-31T04:30:00Z',
};

export const demoCandidateWorkloadPayload = {
  summary: { total_candidates: 1, total_open: 1, total_overdue: 1, escalated: 0 },
  owners: [{ owner: '未指派', total: 1, open_count: 1, overdue_count: 1, escalated_count: 0, status_counts: { candidate: 1 } }],
};

export const demoCandidateBulkAssignPayload = {
  assigned_count: 1,
  skipped_count: 1,
  candidates: [{ ...demoPromptSkillCandidate, owner: 'qa_owner', due_at: '2000-01-01T00:00:00+00:00', overdue: true }],
  skipped: [{ candidate_id: 'candidate-capacity-skipped', reason: 'owner_capacity_exceeded', owner: 'qa_owner', open_count: 5, max_open_per_owner: 5 }],
  capacity: { owner: 'qa_owner', max_open_per_owner: 5, open_before: 4, open_after: 5 },
};

export const demoCandidateBulkArchivePayload = {
  archived_count: 1,
  skipped_count: 0,
  candidates: [{ ...demoPromptSkillCandidate, status: 'archived', previous_status: 'rejected', archived_by: 'ops' }],
  skipped: [],
};

export const demoCandidateEscalatePayload = {
  escalated_count: 1,
  candidates: [{ ...demoPromptSkillCandidate, owner: 'qa_owner', due_at: '2000-01-01T00:00:00+00:00', overdue: true, escalation_status: 'escalated' }],
};

export const demoCandidateBulkReviewPayload = {
  reviewed_count: 1,
  skipped_count: 0,
  candidates: [{ ...demoPromptSkillCandidate, status: 'approved', review_history: [{ decision: 'approved', reviewer: 'qa_owner' }] }],
  skipped: [],
};

export const demoCandidateRetestPlanPayload = {
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

export const demoCandidateBulkRetestPayload = {
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

export const pendingPackageSkill = {
  ...demoSkills[0],
  skill_id: 'plugin.echo@0.1.0',
  name: 'Echo 插件',
  status: 'pending_review',
  enabled: false,
};

export const pendingSkillPackage = {
  package_id: 'pkg-demo',
  filename: 'echo.zip',
  status: 'pending_review',
  manifest: pendingPackageSkill,
  package_dir: 'hidden',
  handler_path: null,
  skill_md_path: 'hidden/SKILL.md',
  runtime_mode: 'script',
  entrypoint: 'scripts/run.py:run',
  last_contract_ok: false,
  last_contract_result: { ok: false, message: '尚未运行' },
  last_contract_at: null,
  approved_by: null,
  approved_at: null,
  approval_note: null,
  contract_history: [],
  approval_history: [],
  base_skill_id: 'plugin.echo',
  skill_version: '0.1.0',
  created_at: '2026-05-31T00:00:00Z',
  updated_at: '2026-05-31T00:00:00Z',
};

export const skillVersionHistory = {
  base_skill_id: 'plugin.echo',
  requested_skill_id: 'plugin.echo@0.2.0',
  latest_approved_skill_id: 'plugin.echo@0.2.0',
  versions: [
    {
      ...pendingSkillPackage,
      status: 'approved',
      manifest: { ...pendingPackageSkill, status: 'approved', enabled: true },
      skill_id: 'plugin.echo@0.1.0',
      version: '0.1.0',
      contract_history: [{ ok: true, created_at: '2026-05-31T00:10:00Z', latency_ms: 1 }],
      approval_history: [{ action: 'approve', actor: 'api', reason: 'v1 稳定', created_at: '2026-05-31T00:11:00Z' }],
      diff_from_previous: [],
    },
    {
      ...pendingSkillPackage,
      package_id: 'pkg-demo-v2',
      filename: 'echo-v2.zip',
      status: 'approved',
      manifest: { ...pendingPackageSkill, skill_id: 'plugin.echo@0.2.0', version: '0.2.0', description: 'Echo 插件 v2', status: 'approved', enabled: true },
      skill_id: 'plugin.echo@0.2.0',
      version: '0.2.0',
      contract_history: [{ ok: true, created_at: '2026-05-31T01:10:00Z', latency_ms: 1 }],
      approval_history: [{ action: 'approve', actor: 'api', reason: 'v2 升级', created_at: '2026-05-31T01:11:00Z' }],
      diff_from_previous: [{ field: 'manifest.description', from: 'Echo 插件', to: 'Echo 插件 v2' }],
    },
  ],
};

export type RenderWorkbenchOptions = {
  featureFlags?: 'all' | 'defaults' | Partial<FeatureFlags>;
};

export async function renderWorkbench(path: string, options: RenderWorkbenchOptions = {}) {
  window.__AEGISQA_FEATURE_FLAGS__ = resolveFeatureFlags(options.featureFlags);
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppShell />
      </MemoryRouter>,
    );
  });
  await waitFor(() => expect(screen.queryByText('正在加载页面...')).not.toBeInTheDocument(), { timeout: 8_000 });
}

function resolveFeatureFlags(featureFlags: RenderWorkbenchOptions['featureFlags']) {
  if (featureFlags === 'defaults') return { ...FEATURE_FLAG_DEFAULTS };
  if (!featureFlags || featureFlags === 'all') return allFeatureFlagsEnabled();
  return { ...FEATURE_FLAG_DEFAULTS, ...featureFlags };
}

export function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  } as Response);
}

export function fileResponse(content: string, headers: Record<string, string> = {}) {
  const responseHeaders = new Headers(headers);
  return Promise.resolve({
    ok: true,
    headers: responseHeaders,
    blob: () => Promise.resolve(new Blob([content], { type: responseHeaders.get('content-type') ?? 'text/plain;charset=utf-8' })),
    text: () => Promise.resolve(content),
    json: () => Promise.reject(new Error('文件响应不是 JSON')),
  } as Response);
}

export function errorResponse(status: number, payload: unknown) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(payload),
  } as Response);
}

export function findComboboxByLabel(label: string) {
  const combobox = screen.getAllByLabelText(label).find((element) => element.getAttribute('role') === 'combobox');
  if (!combobox) {
    throw new Error(`找不到下拉输入框：${label}`);
  }
  return combobox;
}


export function installDefaultWorkbenchMocks() {
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
      if (url.includes('/skills/') && url.endsWith('/versions')) {
        return jsonResponse(skillVersionHistory);
      }
      if (url.endsWith('/governance/runtime-status')) {
        return jsonResponse({
          storage: {
            backend: 'json',
            adapter: 'JsonStore',
            status: 'available',
            scope: 'local',
            message: '当前使用本地 JSON 存储；MySQL adapter 尚未接入运行期。',
          },
          executor: {
            backend: 'local_thread',
            status: 'demo',
            message: '当前使用本地线程执行器，适合本地试用和单进程评测。',
          },
          model_gateway: {
            provider: 'mock',
            ready: true,
            mode: 'offline_mock',
            default_model: 'mock-eval-model',
            base_url_configured: false,
            api_key_configured: false,
            timeout_seconds: 60,
            skill_ref: 'model.chat@0.1.0',
            message: '离线 mock 模型可用。',
            status: 'demo',
          },
          skill_sandbox: {
            mode: 'subprocess',
            status: 'available',
            permissions_required: true,
            network_default: 'denied',
            file_scope: 'package_root_only',
            limits: { max_files: 200, max_file_size_bytes: 1_000_000, max_total_size_bytes: 1_500_000 },
            message: '上传脚本型 Skill 在短生命周期子进程中执行，默认禁止网络和包外文件访问。',
          },
          external_services: {
            mysql: { status: 'not_connected', message: 'MySQL schema 是生产适配资产，当前运行未使用 MySQL repository。' },
            redis: { status: 'not_connected', message: 'Redis 是 Celery/分布式限流生产依赖，当前运行未连接 Redis。' },
            celery: { status: 'not_connected', message: '当前未使用 Celery worker 执行任务。' },
          },
        });
      }
      if (url.endsWith('/model-gateway/status')) {
        return jsonResponse({
          provider: 'mock',
          ready: true,
          mode: 'offline_mock',
          default_model: 'mock-eval-model',
          base_url_configured: false,
          api_key_configured: false,
          timeout_seconds: 60,
          skill_ref: 'model.chat@0.1.0',
          message: '业务 Skill 不需要重复实现模型调用，可在 Workflow 中复用统一模型调用节点。',
        });
      }
      if (url.endsWith('/model-gateway/config')) {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body ?? '{}'));
          return jsonResponse({
            provider: body.provider ?? 'mock',
            base_url: body.base_url ?? null,
            secret_ref: body.secret_ref ?? null,
            default_model: body.default_model ?? 'mock-eval-model',
            timeout_seconds: body.timeout_seconds ?? 60,
            api_key_configured: Boolean(body.secret_ref),
            api_key_masked: body.secret_ref ? 'sk-t...7890' : null,
            source: 'store',
          });
        }
        return jsonResponse({
          provider: 'mock',
          base_url: null,
          secret_ref: null,
          default_model: 'mock-eval-model',
          timeout_seconds: 60,
          api_key_configured: false,
          api_key_masked: null,
          source: 'env',
        });
      }
      if (url.endsWith('/model-gateway/test')) {
        return jsonResponse({
          ok: true,
          response: {
            text: '模型回答：连接测试通过。',
            provider: 'mock',
            model: 'mock-eval-model',
            usage: { total_tokens: 12 },
            latency_ms: 8,
            raw: {},
          },
        });
      }
      if (url.endsWith('/skills/packages/upload')) {
        return jsonResponse({
          package_id: 'pkg-demo',
          status: 'pending_review',
          runtime_mode: 'script',
          entrypoint: 'scripts/run.py:run',
          skill_md_path: 'hidden/SKILL.md',
          handler_path: null,
          manifest: { ...demoSkills[0], skill_id: 'plugin.echo@0.1.0', status: 'pending_review', enabled: false },
        });
      }
      if (url.endsWith('/workflow-templates')) {
        return jsonResponse([{ template_id: 'rag_regression', name: 'RAG 回归评测', description: 'LLMCall + Judge', scenario: 'rag' }]);
      }
      if (url.endsWith('/workflow-drafts/draft-test')) {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body ?? '{}'));
          return jsonResponse({ draft_id: 'draft-test', status: 'draft', name: body.name ?? '测试草稿', graph: body.graph ?? demoWorkflowGraph, created_at: '', updated_at: '2026-06-01T00:00:00Z' });
        }
        if (init?.method === 'DELETE') {
          return jsonResponse({ draft_id: 'draft-test', status: 'deleted', name: '测试草稿', graph: demoWorkflowGraph, created_at: '', updated_at: '2026-06-01T00:00:00Z' });
        }
        return jsonResponse({ draft_id: 'draft-test', status: 'draft', name: '测试草稿', graph: demoWorkflowGraph, published_version_id: 'wf-demo:v1', created_at: '', updated_at: '' });
      }
      if (url.endsWith('/workflow-drafts/draft-test/publish')) {
        return jsonResponse(demoWorkflowVersion);
      }
      if (url.endsWith('/workflow-drafts')) {
        if (init?.method === 'POST') {
          return jsonResponse({ draft_id: 'draft-test', status: 'draft', name: '测试草稿', graph: demoWorkflowGraph, created_at: '', updated_at: '' });
        }
        return jsonResponse([{ draft_id: 'draft-test', status: 'draft', name: '测试草稿', graph: demoWorkflowGraph, published_version_id: 'wf-demo:v1', created_at: '', updated_at: '' }]);
      }
      if (url.endsWith('/workflows')) {
        return jsonResponse([demoWorkflowVersion]);
      }
      if (new URL(url, 'http://localhost').pathname.endsWith('/tasks')) {
        if (init?.method === 'POST') {
          return jsonResponse(demoTask);
        }
        const parsed = new URL(url, 'http://localhost');
        if (parsed.searchParams.has('page')) {
          const page = Number(parsed.searchParams.get('page') ?? 1);
          const pageSize = Number(parsed.searchParams.get('page_size') ?? 8);
          return jsonResponse({
            items: [demoTask],
            pagination: { page, page_size: pageSize, total_items: 1, total_pages: 1 },
          });
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
          skill_overrides: body.skill_overrides,
        });
      }
      if (url.endsWith('/tasks/task-demo/execute')) {
        return jsonResponse({ ...demoTask, status: 'completed', completed_items: 100, pass_rate: 0.8, badcase_count: 20 });
      }
      if (url.endsWith('/tasks/task-demo')) {
        return jsonResponse({
          ...demoTask,
          available_actions: [
            { action: 'execute', label: '执行', enabled: true, target_url: '/tasks/task-demo/execute' },
            { action: 'pause', label: '暂停', enabled: true, target_url: '/tasks/task-demo/pause' },
            { action: 'resume', label: '恢复', enabled: false, disabled_reason: '只有 paused 任务可以恢复。', target_url: '/tasks/task-demo/resume' },
            { action: 'cancel', label: '取消', enabled: true, target_url: '/tasks/task-demo/cancel' },
            { action: 'retry', label: '重试失败项', enabled: false, disabled_reason: '只有 failed 任务可以重试失败项。', target_url: '/tasks/task-demo/retry-failed' },
            { action: 'attempt', label: '新建 Attempt', enabled: false, disabled_reason: '当前任务仍有活动执行实例，结束后才能新建 Attempt。', target_url: '/tasks/task-demo/attempts' },
          ],
        });
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
      if (url.includes('/repair-tasks') && !url.includes('/repair-tasks/')) {
        const parsed = new URL(url, 'http://localhost');
        if (parsed.searchParams.has('page')) {
          return jsonResponse({
            items: [demoRepairTask],
            pagination: { page: Number(parsed.searchParams.get('page') ?? 1), page_size: 8, total_items: 1, total_pages: 1 },
          });
        }
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
          primary_findings: [
            {
              type: 'weak_segment',
              status: 'warning',
              severity: 'warning',
              title: '弱分层风险',
              message: 'scene=payment 分层通过率明显偏低，需要优先复核。',
              evidence: ['scene=payment 通过率 40%，Badcase 12 条。'],
              source: 'diagnostics.root_causes',
            },
            {
              type: 'quality_gate',
              status: 'warning',
              severity: 'medium',
              title: '质量门禁未完全通过',
              message: '请优先处理质量门禁风险后再发布。',
              evidence: ['当前任务产生 1 条 Badcase。'],
              source: 'quality_decision',
            },
          ],
          recommended_actions: [
            {
              action: 'open_trace_flow',
              label: '进入 Trace Flow 定位失败 Step',
              priority: 'high',
              enabled: true,
              target_url: '/tasks/task-demo/trace',
              evidence: ['failed_items=20'],
            },
            {
              action: 'create_repair_tasks',
              label: '生成修复任务',
              priority: 'high',
              enabled: true,
              target_url: '/reports?task_id=task-demo&action=create_repair_tasks',
              evidence: ['badcase_count=1'],
            },
          ],
          action_targets: {
            open_trace_flow: '/tasks/task-demo/trace',
            create_repair_tasks: '/reports?task_id=task-demo&action=create_repair_tasks',
          },
          parameter_governance: demoParameterGovernance,
          budget_status: {
            status: 'warning',
            cost_budget: 20,
            cost_used: 16.2,
            budget_remaining: 3.8,
            usage_ratio: 0.81,
            prompt_tokens: 1200,
            completion_tokens: 420,
            total_tokens: 1620,
            cost_source: 'provider_usage.total_cost',
            cost_currency: 'USD',
            message: '模型网关 usage 成本已接近任务预算。',
          },
          release_context: {
            baselines: [demoBaselineApplyPayload.baseline],
            release_records: [demoWorkflowPromotionApprovedPayload.release_artifacts.release_record],
          },
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
      if (url.includes('/tasks/task-demo/report/offline-package')) {
        return fileResponse('offline-audit-zip', {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="task-demo_offline_audit.zip"',
          'x-aegisqa-file-format': 'offline_zip',
          'x-aegisqa-package-file-count': '7',
        });
      }
      if (url.includes('/tasks/task-demo/results/export?file_format=csv')) {
        return fileResponse('item_id,row.question,context.answer\nitem-demo,什么是 Trace?,模型回答', {
          'content-type': 'text/csv;charset=utf-8',
          'content-disposition': 'attachment; filename="task-demo_results.csv"',
          'x-aegisqa-file-format': 'csv',
          'x-aegisqa-row-count': '1',
          'x-aegisqa-include-steps': 'false',
        });
      }
      if (url.includes('/tasks/task-demo/results/export?file_format=jsonl')) {
        return fileResponse('{"item_id":"item-demo","row.question":"什么是 Trace?"}\n', {
          'content-type': 'application/x-ndjson;charset=utf-8',
          'content-disposition': 'attachment; filename="task-demo_results.jsonl"',
          'x-aegisqa-file-format': 'jsonl',
          'x-aegisqa-row-count': '1',
          'x-aegisqa-include-steps': 'false',
        });
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
      if (url.endsWith('/datasets/dataset-demo/versions/1/quality')) {
        return jsonResponse(demoDatasetQuality);
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
      if (url.includes('/score-analytics')) {
        const parsed = new URL(url, 'http://localhost');
        if (parsed.searchParams.has('page')) {
          const page = Number(parsed.searchParams.get('page') ?? 1);
          const pageSize = Number(parsed.searchParams.get('page_size') ?? demoScoreAnalytics.trend.length);
          const start = (page - 1) * pageSize;
          return jsonResponse({
            ...demoScoreAnalytics,
            trend: demoScoreAnalytics.trend.slice(start, start + pageSize),
            pagination: {
              page,
              page_size: pageSize,
              total_items: demoScoreAnalytics.trend.length,
              total_pages: Math.ceil(demoScoreAnalytics.trend.length / pageSize),
            },
          });
        }
        return jsonResponse(demoScoreAnalytics);
      }
      if (url.endsWith('/judge-audits/trends')) {
        return jsonResponse(demoJudgeAuditTrends);
      }
      if (url.endsWith('/datasets')) {
        return jsonResponse([demoDataset]);
      }
      if (url.includes('/runs?')) {
        const parsed = new URL(url, 'http://localhost');
        const page = Number(parsed.searchParams.get('page') ?? 1);
        const pageSize = Number(parsed.searchParams.get('page_size') ?? 100);
        return jsonResponse({
          items: [{ run_id: demoTask.run_id, status: demoTask.status, total_items: demoTask.total_items, completed_items: demoTask.completed_items, failed_items: demoTask.failed_items, queue_message_count: demoTask.total_items }],
          pagination: { page, page_size: pageSize, total_items: 1, total_pages: 1 },
        });
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
      if (url.endsWith('/overview/workbench')) {
        return jsonResponse(demoWorkbench);
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
}
