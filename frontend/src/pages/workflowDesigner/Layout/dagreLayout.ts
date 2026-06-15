import dagre from 'dagre';
import type { Edge, Node } from '@xyflow/react';

export interface LayoutOptions {
  direction?: 'TB' | 'LR' | 'BT' | 'RL';
  nodeWidth?: number;
  nodeHeight?: number;
  ranksep?: number;
  nodesep?: number;
  marginx?: number;
  marginy?: number;
}

const defaultOptions: Required<LayoutOptions> = {
  direction: 'LR',
  nodeWidth: 220,
  nodeHeight: 120,
  ranksep: 220,
  nodesep: 120,
  marginx: 40,
  marginy: 40,
};

export function getLayoutedElements<T extends Node>(
  nodes: T[],
  edges: Edge[],
  options: LayoutOptions = {}
): { nodes: T[]; edges: Edge[] } {
  const opts = { ...defaultOptions, ...options };

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: opts.direction,
    ranksep: opts.ranksep,
    nodesep: opts.nodesep,
    marginx: opts.marginx,
    marginy: opts.marginy,
  });

  // 添加节点到 dagre 图
  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: opts.nodeWidth,
      height: opts.nodeHeight,
    });
  });

  // 添加边到 dagre 图
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // 执行布局算法
  dagre.layout(dagreGraph);

  // 将布局结果应用到节点
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - opts.nodeWidth / 2,
        y: nodeWithPosition.y - opts.nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

export function autoLayout<T extends Node>(
  nodes: T[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'LR'
): { nodes: T[]; edges: Edge[] } {
  return getLayoutedElements(nodes, edges, { direction });
}
