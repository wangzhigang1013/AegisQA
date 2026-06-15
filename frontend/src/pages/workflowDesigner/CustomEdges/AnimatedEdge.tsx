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
        style={{
          ...style,
          strokeWidth: selected ? 3 : 2,
          stroke: selected ? "#6366f1" : "#cbd5e1",
        }}
      />
      {/* 流动的虚线光圈 */}
      <path
        className="react-flow__edge-path animated-flow"
        d={edgePath}
        style={{
          strokeWidth: 2,
          stroke: selected ? "#818cf8" : "#94a3b8",
        }}
      />
    </>
  );
});

AnimatedEdge.displayName = "AnimatedEdge";
