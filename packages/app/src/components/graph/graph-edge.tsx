import { createUniqueId, type Component } from "solid-js"
import type { GraphEdge, Position } from "@/context/graph/types"

// Deep ocean edge colors by type
const EDGE_COLORS: Record<GraphEdge["type"], { normal: string; bright: string }> = {
  imports: { normal: "rgba(80, 200, 200, 0.22)", bright: "rgba(80, 200, 200, 0.55)" },
  extends: { normal: "rgba(110, 155, 255, 0.30)", bright: "rgba(110, 155, 255, 0.65)" },
  implements: { normal: "rgba(170, 130, 255, 0.22)", bright: "rgba(170, 130, 255, 0.55)" },
  calls: { normal: "rgba(255, 180, 80, 0.20)", bright: "rgba(255, 180, 80, 0.50)" },
  composes: { normal: "rgba(160, 120, 255, 0.25)", bright: "rgba(160, 120, 255, 0.60)" },
}

const EDGE_STYLES: Record<
  GraphEdge["type"],
  { dash: string | undefined; label: string }
> = {
  imports: { dash: "6,4", label: "imports" },
  extends: { dash: undefined, label: "extends" },
  implements: { dash: "5,3", label: "impl" },
  calls: { dash: "3,3", label: "calls" },
  composes: { dash: undefined, label: "uses" },
}

// Build an orthogonal path with rounded corners: down → across → down
function buildOrthogonalPath(sx: number, sy: number, tx: number, ty: number): string {
  const dy = ty - sy
  const midY = sy + dy * 0.5
  const r = Math.min(8, Math.abs(tx - sx) / 2, Math.abs(dy) / 4) // corner radius

  // If source and target are vertically aligned, just draw a straight line
  if (Math.abs(sx - tx) < 2) {
    return `M ${sx} ${sy} L ${tx} ${ty}`
  }

  const goingRight = tx > sx
  const rh = goingRight ? r : -r

  // Path: down from source → horizontal to target x → down to target
  // With rounded corners at the two bends
  return [
    `M ${sx} ${sy}`,
    `L ${sx} ${midY - r}`,
    `Q ${sx} ${midY} ${sx + rh} ${midY}`,
    `L ${tx - rh} ${midY}`,
    `Q ${tx} ${midY} ${tx} ${midY + r}`,
    `L ${tx} ${ty}`,
  ].join(" ")
}

export const GraphEdgeSVG: Component<{
  edge: GraphEdge
  sourcePos: Position
  targetPos: Position
  highlighted?: boolean
  alwaysShowLabel?: boolean
}> = (props) => {
  const pathId = createUniqueId()
  const markerId = createUniqueId()
  const style = () => EDGE_STYLES[props.edge.type]
  const colors = () => EDGE_COLORS[props.edge.type]

  const strokeColor = () => props.highlighted ? colors().bright : colors().normal
  const strokeWidth = () => props.highlighted ? 1.8 : 1
  const displayLabel = () => props.edge.label || style().label

  const path = () => {
    const sx = props.sourcePos.x + props.sourcePos.width / 2
    const sy = props.sourcePos.y + props.sourcePos.height
    const tx = props.targetPos.x + props.targetPos.width / 2
    const ty = props.targetPos.y
    return buildOrthogonalPath(sx, sy, tx, ty)
  }

  // Midpoint for label
  const labelPos = () => {
    const sx = props.sourcePos.x + props.sourcePos.width / 2
    const sy = props.sourcePos.y + props.sourcePos.height
    const tx = props.targetPos.x + props.targetPos.width / 2
    const ty = props.targetPos.y
    const midY = sy + (ty - sy) * 0.5
    return { x: (sx + tx) / 2, y: midY }
  }

  return (
    <g class="graph-edge">
      {/* Per-edge arrow marker */}
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 8"
          refX="9" refY="4"
          markerWidth="7" markerHeight="6"
          orient="auto-start-reverse"
        >
          <path
            d="M 0 1 L 8 4 L 0 7 Z"
            fill={strokeColor()}
          />
        </marker>
      </defs>

      {/* Invisible wide hit area */}
      <path id={pathId} d={path()} fill="none" stroke="transparent" stroke-width={14} />

      {/* Visible edge */}
      <path
        d={path()}
        fill="none"
        stroke={strokeColor()}
        stroke-width={strokeWidth()}
        stroke-dasharray={style().dash}
        stroke-linecap="round"
        stroke-linejoin="round"
        marker-end={`url(#${markerId})`}
      />

      {/* Label — only visible on hover */}
      <g
        transform={`translate(${labelPos().x}, ${labelPos().y})`}
        class="graph-edge-label"
        opacity={props.highlighted || props.alwaysShowLabel ? 1 : 0}
      >
        <rect
          x={-(displayLabel().length * 3.2 + 8)}
          y={-9}
          width={displayLabel().length * 6.4 + 16}
          height={18}
          rx={4}
          fill="var(--background-base)"
          stroke={colors().bright}
          stroke-width={0.5}
        />
        <text
          text-anchor="middle"
          dominant-baseline="central"
          font-size="10"
          fill="var(--text-strong)"
          font-family="var(--font-mono)"
          font-weight="500"
        >
          {displayLabel()}
        </text>
      </g>
    </g>
  )
}

export const GraphEdgeDefs: Component = () => {
  return (
    <defs>
      <filter id="node-shadow" x="-10%" y="-10%" width="130%" height="130%">
        <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="rgba(0,0,0,0.15)" />
      </filter>
    </defs>
  )
}
