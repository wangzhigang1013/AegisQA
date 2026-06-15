import { MergeOutlined } from '@ant-design/icons';
import { type NodeProps } from '@xyflow/react';
import { memo } from 'react';

import { BaseNode, type BaseNodeData } from './BaseNode';

export const JoinNode = memo((props: NodeProps) => {
  const nodeData: BaseNodeData = {
    ...(props.data as unknown as BaseNodeData),
    icon: <MergeOutlined />,
    color: '#10b981',
    gradient: 'linear-gradient(135deg, #10b981, #34d399)',
    inputs: [
      { id: 'input-1', label: '输入 1', type: 'input' },
      { id: 'input-2', label: '输入 2', type: 'input' },
    ],
    outputs: [
      { id: 'output', label: '合并输出', type: 'output' },
    ],
  };

  return <BaseNode {...props} data={nodeData as any} />;
});

JoinNode.displayName = 'JoinNode';
