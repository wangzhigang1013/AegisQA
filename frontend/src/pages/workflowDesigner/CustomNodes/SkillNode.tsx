import { Blocks, Zap } from 'lucide-react';
import { type NodeProps } from '@xyflow/react';
import { memo, useMemo } from 'react';

import { BaseNode, type BaseNodeData, type PortConfig } from './BaseNode';

export const SkillNode = memo((props: NodeProps) => {
  const baseData = props.data as unknown as BaseNodeData;
  const graphNode = baseData.graphNode;
  const skillRef = graphNode?.skill_ref;
  const inputFields = graphNode?.input_mapping ? Object.keys(graphNode.input_mapping) : [];
  const outputFields = graphNode?.output_mapping ? Object.keys(graphNode.output_mapping) : [];

  const isLLM = skillRef?.includes('llm') || skillRef?.includes('model');
  const icon = isLLM ? <Zap className="w-4 h-4" /> : <Blocks className="w-4 h-4" />;
  const color = isLLM ? '#3b82f6' : '#8b5cf6';
  const gradient = isLLM
    ? 'linear-gradient(135deg, #3b82f6, #6366f1)'
    : 'linear-gradient(135deg, #8b5cf6, #a78bfa)';

  const inputs: PortConfig[] = useMemo(() => {
    if (inputFields.length) {
      return inputFields.map((field) => ({ id: field, label: field, type: 'input' as const }));
    }
    return [{ id: 'input', label: '输入', type: 'input' as const }];
  }, [inputFields]);

  const outputs: PortConfig[] = useMemo(() => {
    if (outputFields.length) {
      return outputFields.map((field) => ({ id: field, label: field, type: 'output' as const }));
    }
    return [{ id: 'output', label: '输出', type: 'output' as const }];
  }, [outputFields]);

  const nodeData: BaseNodeData = {
    ...baseData,
    icon,
    color,
    gradient,
    subtitle: skillRef?.split('@')[0] || undefined,
    inputs,
    outputs,
  };

  return <BaseNode {...props} data={nodeData as any} />;
});

SkillNode.displayName = 'SkillNode';
