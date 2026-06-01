import { MarkerType, type Edge, type Node } from '@xyflow/react';

import type { DatasetVersion, SkillManifest, WorkflowGraph, WorkflowGraphNode } from '../../types';

export type FlowNodeData = {
  label: string;
  graphNode: WorkflowGraphNode;
};

export type FlowNode = Node<FlowNodeData>;

export type GraphDraftIssue = {
  code: string;
  message: string;
  nodeId?: string;
  field?: string;
};

export const paletteNodeTypes: WorkflowGraphNode['node_type'][] = ['source', 'branch', 'join', 'aggregator', 'output'];

export const nodeTypeLabel: Record<WorkflowGraphNode['node_type'], string> = {
  source: 'Source',
  skill: 'Skill',
  branch: 'Branch',
  join: 'Join',
  aggregator: 'Aggregator',
  output: 'Output',
};

export function graphNodeToFlowNode(graphNode: WorkflowGraphNode, position: { x: number; y: number }): FlowNode {
  return {
    id: graphNode.node_id,
    type: graphNode.node_type === 'output' ? 'output' : 'default',
    position,
    data: { label: formatNodeLabel(graphNode), graphNode },
  };
}

export function graphToNodes(graph: WorkflowGraph): FlowNode[] {
  return graph.nodes.map((graphNode, index) => graphNodeToFlowNode(graphNode, { x: 80 + (index % 4) * 250, y: 100 + Math.floor(index / 4) * 160 }));
}

export function graphToEdges(graph: WorkflowGraph): Edge[] {
  return graph.edges.map((edge) => ({
    id: edgeId(edge.source, edge.target),
    source: edge.source,
    target: edge.target,
    label: edge.condition,
    markerEnd: { type: MarkerType.ArrowClosed },
    animated: Boolean(edge.condition),
  }));
}

export function buildWorkflowGraph(name: string, nodes: FlowNode[], edges: Edge[]): WorkflowGraph {
  // 画布当前状态是唯一事实来源；保存、试运行、发布都必须从这里生成后端 payload。
  return {
    name,
    nodes: nodes.map((node) => ({ ...node.data.graphNode, node_id: node.id })),
    edges: edges.map((edge) => ({ source: edge.source, target: edge.target, condition: typeof edge.label === 'string' ? edge.label : undefined })),
  };
}

export function validateWorkflowGraphDraft(graph: WorkflowGraph): GraphDraftIssue[] {
  const issues: GraphDraftIssue[] = [];
  const outgoing = new Map<string, { target: string; condition?: string }[]>();
  for (const edge of graph.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  for (const node of graph.nodes) {
    if (node.node_type === 'skill' && !node.skill_ref) {
      issues.push({ code: 'SKILL_REF_REQUIRED', message: 'Skill 节点必须选择 Skill。', nodeId: node.node_id });
    }
    if (node.node_type === 'branch') {
      const branchEdges = outgoing.get(node.node_id) ?? [];
      const hasMissingCondition = branchEdges.some((edge) => !edge.condition && !node.condition);
      if (hasMissingCondition) {
        issues.push({ code: 'BRANCH_CONDITION_REQUIRED', message: 'Branch 节点或分支连线必须配置条件表达式。', nodeId: node.node_id });
      }
    }
  }
  return issues;
}

export function buildAvailableFieldPaths(dataset: DatasetVersion | null | undefined, graph: WorkflowGraph, selectedNodeId?: string | null, skills: SkillManifest[] = []): string[] {
  const paths = new Set<string>();
  const skillsById = new Map(skills.map((skill) => [skill.skill_id, skill]));
  for (const path of dataset?.field_paths ?? []) {
    paths.add(path);
  }

  if (!dataset?.field_paths?.length && dataset?.field_schema) {
    for (const fieldName of Object.keys(dataset.field_schema)) {
      paths.add(`row.${fieldName}`);
    }
  }

  const upstreamNodeIds = selectedNodeId ? collectUpstreamNodeIds(graph, selectedNodeId) : new Set(graph.nodes.map((node) => node.node_id));
  for (const node of graph.nodes) {
    if (selectedNodeId && !upstreamNodeIds.has(node.node_id)) continue;
    const skill = node.skill_ref ? skillsById.get(node.skill_ref) : null;
    for (const field of Object.keys(schemaProperties(skill?.output_schema))) {
      paths.add(`${node.node_id}.${field}`);
    }
    for (const [field, targetPath] of Object.entries(node.output_mapping ?? {})) {
      if (field.trim()) {
        paths.add(`${node.node_id}.${field.trim()}`);
      }
      if (typeof targetPath === 'string' && targetPath.trim()) {
        paths.add(targetPath.trim());
      }
    }
  }

  return [...paths].sort((left, right) => left.localeCompare(right));
}

function schemaProperties(schema: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return schema && typeof schema.properties === 'object' && schema.properties ? schema.properties as Record<string, unknown> : {};
}

function collectUpstreamNodeIds(graph: WorkflowGraph, selectedNodeId: string): Set<string> {
  const reverseEdges = new Map<string, string[]>();
  for (const edge of graph.edges) {
    reverseEdges.set(edge.target, [...(reverseEdges.get(edge.target) ?? []), edge.source]);
  }

  const visited = new Set<string>();
  const queue = [...(reverseEdges.get(selectedNodeId) ?? [])];
  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    queue.push(...(reverseEdges.get(nodeId) ?? []));
  }
  return visited;
}

export function parseJsonObjectField(value: string, field: string): { ok: true; value: Record<string, unknown> } | { ok: false; issue: GraphDraftIssue } {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, issue: { code: 'JSON_OBJECT_REQUIRED', message: `${field} 必须是 JSON 对象。`, field } };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      ok: false,
      issue: {
        code: 'JSON_PARSE_ERROR',
        message: error instanceof Error ? error.message : `${field} 不是合法 JSON。`,
        field,
      },
    };
  }
}

export function formatNodeLabel(node: WorkflowGraphNode): string {
  return `${node.label || node.node_id}\n${node.skill_ref || nodeTypeLabel[node.node_type]}`;
}

export function edgeId(source: string, target: string): string {
  return `${source}-${target}`;
}
