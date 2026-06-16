import { CheckCircle2 } from 'lucide-react';
import { type NodeProps } from '@xyflow/react';
import { memo } from 'react';

import { BaseNode, type BaseNodeData } from './BaseNode';

export const OutputNode = memo((props: NodeProps) => {
  const nodeData: BaseNodeData = {
    ...(props.data as unknown as BaseNodeData),
    icon: <CheckCircle2 className="w-4 h-4" />,
    color: '#22c55e',
    gradient: 'linear-gradient(135deg, #22c55e, #4ade80)',
    inputs: [
      { id: 'input', label: '输入', type: 'input' },
    ],
  };

  return <BaseNode {...props} data={nodeData as any} />;
});

OutputNode.displayName = 'OutputNode';
