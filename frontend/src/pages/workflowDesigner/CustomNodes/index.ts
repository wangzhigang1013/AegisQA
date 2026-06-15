export { BaseNode, type BaseNodeData, type PortConfig } from './BaseNode';
export { SourceNode } from './SourceNode';
export { SkillNode } from './SkillNode';
export { OutputNode } from './OutputNode';
export { BranchNode } from './BranchNode';
export { JoinNode } from './JoinNode';
export { AggregatorNode } from './AggregatorNode';

import type { NodeTypes } from '@xyflow/react';

import { AggregatorNode } from './AggregatorNode';
import { BranchNode } from './BranchNode';
import { JoinNode } from './JoinNode';
import { OutputNode } from './OutputNode';
import { SkillNode } from './SkillNode';
import { SourceNode } from './SourceNode';

export const customNodeTypes: NodeTypes = {
  source: SourceNode,
  skill: SkillNode,
  output: OutputNode,
  branch: BranchNode,
  join: JoinNode,
  aggregator: AggregatorNode,
};
