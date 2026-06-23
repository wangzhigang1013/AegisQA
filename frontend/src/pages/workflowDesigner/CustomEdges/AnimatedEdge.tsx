import { getSmoothStepPath } from "@xyflow/react";
import { memo } from "react";
import "./AnimatedEdge.css";

export const AnimatedEdge = memo(({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  selected,
  markerEnd,
}: any) => {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 24,
  });

  return (
    <>
      <path
        id={id}
        className={`react-flow__edge-path ${selected ? 'selected-edge' : ''}`}
        d={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: selected ? 3 : 2,
          stroke: selected ? "#4f46e5" : "#64748b",
        }}
      />
      {/* 流动的粒子光圈 */}
      <path
        className="react-flow__edge-path animated-flow"
        d={edgePath}
        style={{
          strokeWidth: 2,
          stroke: selected ? "#6366f1" : "#818cf8",
        }}
      />
    </>
  );
});

AnimatedEdge.displayName = "AnimatedEdge";
