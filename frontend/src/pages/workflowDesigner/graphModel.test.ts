import { describe, expect, it } from 'vitest';

import { demoWorkflowGraph } from '../../data/demo';
import {
  buildWorkflowGraph,
  graphToEdges,
  graphToNodes,
  parseJsonObjectField,
  validateWorkflowGraphDraft,
} from './graphModel';

describe('Workflow 画布图模型', () => {
  it('以当前 nodes/edges 转换为后端 WorkflowGraph payload', () => {
    const nodes = graphToNodes(demoWorkflowGraph);
    const edges = graphToEdges({
      ...demoWorkflowGraph,
      edges: [{ source: 'answer', target: 'judge', condition: 'metrics.score > 0.6' }],
    });

    const graph = buildWorkflowGraph('转换后的 Workflow', nodes, edges);

    expect(graph.name).toBe('转换后的 Workflow');
    expect(graph.nodes[0].node_id).toBe(nodes[0].id);
    expect(graph.edges).toEqual([{ source: 'answer', target: 'judge', condition: 'metrics.score > 0.6' }]);
  });

  it('在前端发现缺 Skill、Branch 条件缺失和坏 JSON 配置', () => {
    const graph = {
      name: '坏流程',
      nodes: [
        { node_id: 'skill_1', node_type: 'skill' as const, label: '未配置 Skill' },
        { node_id: 'branch_1', node_type: 'branch' as const, label: '分支' },
        { node_id: 'output_1', node_type: 'output' as const, label: '输出' },
      ],
      edges: [{ source: 'branch_1', target: 'output_1' }],
    };

    const issues = validateWorkflowGraphDraft(graph);
    const parsed = parseJsonObjectField('{bad-json', 'input_mapping');

    expect(issues.map((issue) => issue.code)).toContain('SKILL_REF_REQUIRED');
    expect(issues.map((issue) => issue.code)).toContain('BRANCH_CONDITION_REQUIRED');
    if (parsed.ok) {
      throw new Error('坏 JSON 不应解析成功');
    }
    expect(parsed.issue?.code).toBe('JSON_PARSE_ERROR');
  });
});
