import type { Component } from "solid-js"
import type { GraphEdge, Position } from "@/context/graph/types"

const EDGE_COLORS: Record<GraphEdge["type"], string> = {
  imports: "var(--text-dimmed)",
  extends: "var(--color-blue-500)",
  implements: "var(--color-purple-500)",
  calls: "var(--color-green-500)",
  composes: "var(--color-orange-500)",
}

export const GraphEdgeSVG: Component<{
  edge: GraphEdge
  sourcePos: Position
  targetPos: Position
}> = (props) => {
  const color = () => EDGE_COLORS[props.edge.type]

  const path = () => {
    const sx = props.sourcePos.x + props.sourcePos.width / 2
    const sy = props.sourcePos.y + props.sourcePos.height
    const tx = props.targetPos.x + props.targetPos.width / 2
    const ty = props.targetPos.y
    const midY = (sy + ty) / 2
    return `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`
  }

  return (
    <g>
      <path
        d={path()} fill="none" stroke={color()} stroke-width={1.5}
        stroke-dasharray={props.edge.type === "implements" ? "4,4" : undefined}
        opacity={0.7}
      />
      <circle
        cx={props.targetPos.x + props.targetPos.width / 2}
        cy={props.targetPos.y - 3}
        r={3} fill={color()}
      />
    </g>
  )
}
