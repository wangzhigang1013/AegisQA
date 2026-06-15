import { BarChartOutlined } from '@ant-design/icons';
import { type NodeProps } from '@xyflow/react';
import { memo } from 'react';

import { BaseNode, type BaseNodeData } from './BaseNode';

export const AggregatorNode = memo((props: NodeProps) => {
  const nodeData: BaseNodeData = {
    ...(props.data as unknown as BaseNodeData),
    icon: <BarChartOutlined />,
    color: '#6366f1',
    gradient: 'linear-gradient(135deg, #6366f1, #818cf8)',
    inputs: [
      { id: 'input', label: '数据输入', type: 'input' },
    ],
    outputs: [
      { id: 'output', label: '聚合结果', type: 'output' },
    ],
  };

  return <BaseNode {...props} data={nodeData as any} />;
});

AggregatorNode.displayName = 'AggregatorNode';
