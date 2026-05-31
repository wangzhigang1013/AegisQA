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
  preflight_result: { status: 'passed', summary: '预检通过，可以创建并执行任务。', checks: [] },
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
  status: 'passed',
  summary: 'Preflight 通过：可以创建并执行任务。',
  dataset_id: 'dataset-demo',
  dataset_version: 1,
  workflow_version_id: 'wf-demo:v1',
  evaluation_goal: 'release_gate',
  quality_gate: { pass_rate: 0.9, max_badcase_count: 0 },
  checks: [
    { check_id: 'dataset_non_empty', title: '数据集非空', status: 'passed', message: '当前数据集包含 100 条样本。', details: {}, recommendation: '' },
    { check_id: 'field_mapping', title: 'Workflow 字段映射', status: 'passed', message: 'Workflow 需要的 row 字段均存在。', details: {}, recommendation: '' },
    { check_id: 'quality_gate', title: '质量门槛', status: 'passed', message: '已设置通过率门槛 90%。', details: {}, recommendation: '' },
  ],
};

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

const demoTraceFlow = {
  task: demoTask,
  dataset: { dataset_id: 'dataset-demo', name: '问答回归集', version: 1, version_id: 'dataset-demo:v1' },
  workflow: { workflow_id: 'wf-demo', name: 'RAG 回归评测', version_id: 'wf-demo:v1', snapshot_hash: 'abcdef1234567890' },
  attempt: { run_id: 'run-demo', status: 'completed', current_attempt: 1, started_at: null, finished_at: null },
  queue_message_shape: ['item_id'],
  data_edges: [{ source: 'dataset.row', target: 'answer.input' }],
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

describe('AegisQA 前端工作台', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
      if (url.endsWith('/tasks/preflight')) {
        return jsonResponse(demoPreflightResult);
      }
      if (url.endsWith('/tasks/task-demo/execute')) {
        return jsonResponse({ ...demoTask, status: 'completed', completed_items: 100, pass_rate: 0.8, badcase_count: 20 });
      }
      if (url.endsWith('/tasks/task-demo/repair-tasks/from-diagnostics')) {
        return jsonResponse({ source_task_id: 'task-demo', created_count: 1, reused_count: 0, repair_tasks: [{ repair_task_id: 'repair-demo', source_task_id: 'task-demo', cause_type: 'weak_segment', status: 'open' }] });
      }
      if (url.endsWith('/tasks/task-demo/report')) {
        return jsonResponse({
          task: { ...demoTask, status: 'completed', completed_items: 100, pass_rate: 0.8, badcase_count: 20 },
          task_summary: { task_id: 'task-demo', task_name: 'RAG 任务', run_id: 'run-demo', status: 'completed', dataset_name: '问答回归集', workflow_name: 'RAG 回归评测', sample_count: 100, current_attempt: 1 },
          version_snapshot: {
            dataset: { dataset_id: 'dataset-demo', version: 1, version_id: 'dataset-demo:v1', name: '问答回归集' },
            workflow: { workflow_id: 'wf-demo', version_id: 'wf-demo:v1', name: 'RAG 回归评测', step_count: 2 },
            execution_config: demoTask.execution_config,
          },
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
          export_links: { html: '/runs/run-demo/report/export?file_format=html', csv: '/runs/run-demo/report/export?file_format=csv', json: '/runs/run-demo/report/export?file_format=json' },
        });
      }
      if (url.endsWith('/tasks/task-demo/trace-flow')) {
        return jsonResponse(demoTraceFlow);
      }
      if (url.endsWith('/tasks/task-demo/trace-tree')) {
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
      if (url.includes('/experiments') || url.endsWith('/annotation-queue')) {
        if (url.endsWith('/annotation-queue')) return jsonResponse(demoAnnotationTasks);
        return jsonResponse(demoExperiments);
      }
      if (url.endsWith('/annotation-candidates')) {
        return jsonResponse(demoAnnotationCandidates);
      }
      if (url.endsWith('/ci-gates')) {
        return jsonResponse(demoCIGates);
      }
      if (url.includes('/ci-gates/evaluations')) {
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
    expect(screen.getByText('测试草稿')).toBeInTheDocument();
    expect(screen.getByText('RAG 回归评测')).toBeInTheDocument();
    expect(screen.getByText(/模板/)).toBeInTheDocument();
  });

  it('Workflow 画布解释点对多和多对一流程', async () => {
    await renderWorkbench('/workflows/designer/draft-test');

    expect(screen.getByText('Skill Palette')).toBeInTheDocument();
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
  });

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

    fireEvent.click(screen.getByRole('button', { name: /新增 Aggregator/ }));
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

  it('Trace Tree 独立页面展示 Item 到 Skill Step 的调用树', async () => {
    await renderWorkbench('/tasks/task-demo/trace-tree');

    expect(await screen.findByText('Trace Tree')).toBeInTheDocument();
    expect(screen.getByText('run-demo')).toBeInTheDocument();
    expect(screen.getAllByText('answer').length).toBeGreaterThan(0);
    expect(screen.getByText('llm.call@0.1.0')).toBeInTheDocument();
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
        return jsonResponse(demoCIGateEvaluations);
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
        return jsonResponse(demoAnnotationTasks);
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
    expect(screen.getByText('候选资产')).toBeInTheDocument();
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

  it('报告中心围绕任务展示报告、质量决策和导出入口', async () => {
    await renderWorkbench('/reports');

    expect(await screen.findByText('任务报告')).toBeInTheDocument();
    expect(screen.getAllByText('RAG 任务').length).toBeGreaterThan(0);
    expect(screen.getByText('任务摘要与版本快照')).toBeInTheDocument();
    expect(screen.getByText('Step 分布与耗时')).toBeInTheDocument();
    expect(screen.getByText('分层分析')).toBeInTheDocument();
    expect(screen.getByText('质量决策中心')).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: '加入人工审核' }));
    expect(await screen.findByText(/诊断动作完成：已创建 1 条人工审核任务/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /生成修复任务/ }));
    expect(await screen.findByText(/已生成 1 个修复任务/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '生成分层门禁' }));
    expect(await screen.findByText(/CI Gate 即时评估完成：blocking/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /导出 HTML \/ CSV/ }));
    expect(await screen.findByText(/报告导出成功/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /忽略/ }));
    expect(await screen.findByText(/Badcase 已忽略/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重开/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /加入审阅队列/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看参数治理' }));
    expect(await screen.findByText('Trace Flow')).toBeInTheDocument();
    expect(await screen.findByText('问答回归集')).toBeInTheDocument();
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
