import { type EdgeProps, getBezierPath } from '@xyflow/react';
import { memo } from 'react';

export const AnimatedEdge = memo(({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  label,
}: EdgeProps) => {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      {/* 背景路径 - 更粗的透明区域用于 hover */}
      <path
        id={`${id}-bg`}
        d={edgePath}
        style={{
          ...style,
          strokeWidth: 12,
          stroke: 'transparent',
          fill: 'none',
        }}
      />
      {/* 主路径 */}
      <path
        id={id}
        d={edgePath}
        className="react-flow__edge-path"
        style={{
          ...style,
          strokeWidth: 2,
          stroke: '#94a3b8',
          fill: 'none',
        }}
        markerEnd={markerEnd}
      />
      {/* 动画点 */}
      <circle r="4" fill="#3b82f6" className="edge-animated-dot">
        <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
      </circle>
      {/* 标签 */}
      {label && (
        <text
          x={(sourceX + targetX) / 2}
          y={(sourceY + targetY) / 2 - 10}
          textAnchor="middle"
          className="edge-label"
          style={{
            fontSize: 11,
            fill: '#64748b',
            fontWeight: 500,
          }}
        >
          {label as string}
        </text>
      )}
    </>
  );
});

AnimatedEdge.displayName = 'AnimatedEdge';
