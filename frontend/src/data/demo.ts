import type { SkillManifest, WorkflowGraph } from '../types';

export const fieldPreview = [
  {
    path: 'row.question',
    type: 'string',
    example: '什么是 AegisQA?',
    target: 'Workflow 输入映射',
  },
  {
    path: 'row.reference',
    type: 'string',
    example: 'AI 评测平台',
    target: 'Workflow 输入映射',
  },
  {
    path: 'row.expected_label',
    type: 'string',
    example: 'pass',
    target: 'Golden label',
  },
];

export const demoSkills: SkillManifest[] = [
  {
    skill_id: 'llm.call@0.1.0',
    name: 'LLM Call',
    version: '0.1.0',
    description: '根据输入 prompt 生成回答的内置演示 Skill。',
    tags: ['llm', 'answer'],
    scenarios: ['rag'],
    input_schema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
      },
    },
    output_schema: {
      type: 'object',
      required: ['answer'],
      properties: {
        answer: { type: 'string' },
        tokens: { type: 'number' },
      },
    },
    config_schema: {
      type: 'object',
      required: ['model'],
      properties: {
        model: { type: 'string', default: 'demo-model' },
        temperature: { type: 'number', default: 0 },
      },
    },
    cacheable: true,
    permissions: [],
    enabled: true,
    status: 'approved',
    example_input: { prompt: '什么是 AegisQA?' },
    example_config: { model: 'demo-model', temperature: 0 },
  },
  {
    skill_id: 'llm.judge@0.1.0',
    name: 'Deterministic LLM Judge',
    version: '0.1.0',
    description: '根据 question、answer、reference 输出 score、label 和 reason 的确定性演示裁判。',
    tags: ['judge', 'quality', 'score', 'reference'],
    scenarios: ['rag'],
    input_schema: {
      type: 'object',
      required: ['question', 'answer', 'reference'],
      properties: {
        question: { type: 'string' },
        answer: { type: 'string' },
        reference: { type: 'string' },
      },
    },
    output_schema: {
      type: 'object',
      required: ['score', 'label'],
      properties: {
        score: { type: 'number' },
        label: { type: 'string' },
        reason: { type: 'string' },
      },
    },
    config_schema: {
      type: 'object',
      properties: {
        threshold: { type: 'number', default: 0.6 },
      },
    },
    cacheable: false,
    permissions: [],
    enabled: true,
    status: 'approved',
    example_input: { question: 'AegisQA 是什么?', answer: 'AegisQA 是评测平台。', reference: '评测平台' },
    example_config: { threshold: 0.6 },
  },
];

export const demoWorkflowGraph: WorkflowGraph = {
  name: 'RAG 回归评测',
  nodes: [
    {
      node_id: 'answer',
      node_type: 'skill',
      label: '生成回答',
      skill_ref: 'llm.call@0.1.0',
      input_mapping: { prompt: 'row.question' },
      output_mapping: { answer: 'context.answer', tokens: 'metrics.tokens' },
      config: { model: 'demo-model', temperature: 0 },
      cacheable: true,
    },
    {
      node_id: 'judge_a',
      node_type: 'skill',
      label: '质量裁判 A',
      skill_ref: 'llm.judge@0.1.0',
      input_mapping: { question: 'row.question', answer: 'answer.answer', reference: 'row.reference' },
      output_mapping: { score: 'metrics.judge_a_score', label: 'context.judge_a_label', reason: 'context.judge_a_reason' },
      config: { threshold: 0.6 },
    },
    {
      node_id: 'judge_b',
      node_type: 'skill',
      label: '质量裁判 B',
      skill_ref: 'llm.judge@0.1.0',
      input_mapping: { question: 'row.question', answer: 'answer.answer', reference: 'row.reference' },
      output_mapping: { score: 'metrics.judge_b_score', label: 'context.judge_b_label', reason: 'context.judge_b_reason' },
      config: { threshold: 0.8 },
    },
    {
      node_id: 'source',
      node_type: 'source',
      label: 'Dataset Row',
      output_mapping: { question: 'row.question', reference: 'row.reference', expected_label: 'row.expected_label' },
    },
    {
      node_id: 'aggregate',
      node_type: 'aggregator',
      label: '裁判聚合',
      config: { strategy: 'majority_vote' },
    },
    {
      node_id: 'report',
      node_type: 'output',
      label: 'Report',
    },
  ],
  edges: [
    { source: 'source', target: 'answer' },
    { source: 'answer', target: 'judge_a' },
    { source: 'answer', target: 'judge_b' },
    { source: 'judge_a', target: 'aggregate' },
    { source: 'judge_b', target: 'aggregate' },
    { source: 'aggregate', target: 'report' },
  ],
};
