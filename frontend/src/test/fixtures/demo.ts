import type { SkillManifest } from '../../types/skill';
import type { WorkflowGraph } from '../../types/workflow';

export const demoSkills: SkillManifest[] = [
  {
    skill_id: 'llm.call@0.1.0',
    name: 'Deterministic LLM Call',
    description: '统一模型调用 Skill',
    version: '0.1.0',
    status: 'approved',
    enabled: true,
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
      },
      required: ['prompt'],
    },
    output_schema: {
      type: 'object',
      properties: {
        answer: { type: 'string' },
        tokens: { type: 'number' },
      },
      required: ['answer'],
    },
    config_schema: {
      type: 'object',
      properties: {
        model: { type: 'string', title: '模型' },
        temperature: { type: 'number', title: '温度' },
        prompt_version: { type: 'string', title: 'Prompt 版本' },
      },
    },
    cacheable: true,
    permissions: ['llm.call'],
    scenarios: ['rag_generation'],
    tags: ['llm', 'generation'],
    example_input: { prompt: '什么是 AegisQA?' },
    example_config: { model: 'demo-model', temperature: 0 },
  },
  {
    skill_id: 'llm.judge@0.1.0',
    name: 'Deterministic LLM Judge',
    description: '基于 question、answer 和 reference 计算 score、label 与 rationale 的质量裁判 Skill',
    version: '0.1.0',
    status: 'approved',
    enabled: true,
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        answer: { type: 'string' },
        reference: { type: 'string' },
      },
      required: ['question', 'answer', 'reference'],
    },
    output_schema: {
      type: 'object',
      properties: {
        score: { type: 'number' },
        label: { type: 'string' },
        rationale: { type: 'string' },
      },
      required: ['score', 'label', 'rationale'],
    },
    config_schema: {
      type: 'object',
      properties: {
        threshold: { type: 'number', title: '通过阈值' },
        prompt_version: { type: 'string', title: 'Prompt 版本' },
      },
    },
    cacheable: false,
    permissions: ['llm.call'],
    scenarios: ['quality_judge'],
    tags: ['judge', 'quality'],
    example_input: { question: '什么是 AegisQA?', answer: 'AI 评测平台', reference: 'AI 评测平台' },
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
      config: { model: 'demo-model', temperature: 0, prompt_version: 'prompt-demo-v1' },
      cacheable: true,
    },
    {
      node_id: 'judge_a',
      node_type: 'skill',
      label: '质量裁判',
      skill_ref: 'llm.judge@0.1.0',
      input_mapping: { question: 'row.question', answer: 'context.answer', reference: 'row.reference' },
      output_mapping: { score: 'metrics.judge_score', label: 'context.judge_label', rationale: 'context.judge_rationale' },
      config: { threshold: 0.6, prompt_version: 'judge-demo-v1' },
    },
    {
      node_id: 'report',
      node_type: 'output',
      label: '任务报告',
      input_mapping: {},
      output_mapping: {},
    },
  ],
  edges: [
    { source: 'answer', target: 'judge_a' },
    { source: 'judge_a', target: 'report' },
  ],
};
