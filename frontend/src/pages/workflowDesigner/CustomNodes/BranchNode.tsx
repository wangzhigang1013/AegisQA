import { BranchesOutlined } from '@ant-design/icons';
import { type NodeProps } from '@xyflow/react';
import { memo } from 'react';

import { BaseNode, type BaseNodeData } from './BaseNode';

export const BranchNode = memo((props: NodeProps) => {
  const nodeData: BaseNodeData = {
    ...(props.data as unknown as BaseNodeData),
    icon: <BranchesOutlined />,
    color: '#f59e0b',
    gradient: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
    inputs: [
      { id: 'input', label: '输入', type: 'input' },
    ],
    outputs: [
      { id: 'true', label: 'True', type: 'output' },
      { id: 'false', label: 'False', type: 'output' },
    ],
  };

  return <BaseNode {...props} data={nodeData as any} />;
});

BranchNode.displayName = 'BranchNode';
