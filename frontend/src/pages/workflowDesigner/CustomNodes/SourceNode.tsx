import { Database } from 'lucide-react';
import { type NodeProps } from '@xyflow/react';
import { memo } from 'react';

import { BaseNode, type BaseNodeData } from './BaseNode';

export const SourceNode = memo((props: NodeProps) => {
  const nodeData: BaseNodeData = {
    ...(props.data as unknown as BaseNodeData),
    icon: <Database className="w-4 h-4" />,
    color: '#0ea5e9',
    gradient: 'linear-gradient(135deg, #0ea5e9, #38bdf8)',
    outputs: [
      { id: 'output', label: '数据输出', type: 'output' },
    ],
  };

  return <BaseNode {...props} data={nodeData as any} />;
});

SourceNode.displayName = 'SourceNode';
