import { Show, type Component } from "solid-js"
import type { GraphNode } from "@/context/graph/types"
import type { Position } from "@/context/graph/types"

const NODE_COLORS = {
  subsystem: { fill: "var(--surface-info-base)", stroke: "var(--border-info)" },
  module: { fill: "var(--surface-base)", stroke: "var(--border-base)" },
  class: { fill: "var(--surface-warning-base)", stroke: "var(--border-warning)" },
  function: { fill: "var(--surface-success-base)", stroke: "var(--border-success)" },
}

const CHANGE_GLOW = {
  added: "var(--color-green-500)",
  modified: "var(--color-yellow-500)",
  deleted: "var(--color-red-500)",
}

export const GraphNodeSVG: Component<{
  node: GraphNode
  position: Position
  onClick: (nodeId: string) => void
  onHover: (nodeId: string | undefined) => void
}> = (props) => {
  const colors = () => NODE_COLORS[props.node.type]
  const glow = () => props.node.changeState ? CHANGE_GLOW[props.node.changeState] : undefined

  return (
    <g
      transform={`translate(${props.position.x}, ${props.position.y})`}
      onClick={() => props.onClick(props.node.id)}
      onMouseEnter={() => props.onHover(props.node.id)}
      onMouseLeave={() => props.onHover(undefined)}
      style={{ cursor: "pointer" }}
    >
      <Show when={glow()}>
        <rect
          x={-4} y={-4}
          width={props.position.width + 8} height={props.position.height + 8}
          rx={nodeRadius(props.node.type) + 4}
          fill="none" stroke={glow()!} stroke-width={2} opacity={0.6}
          class="graph-node-glow"
        />
      </Show>

      {props.node.type === "function" ? (
        <circle
          cx={props.position.width / 2} cy={props.position.height / 2}
          r={Math.min(props.position.width, props.position.height) / 2}
          fill={colors().fill} stroke={colors().stroke} stroke-width={1.5}
        />
      ) : (
        <rect
          width={props.position.width} height={props.position.height}
          rx={nodeRadius(props.node.type)}
          fill={colors().fill} stroke={colors().stroke} stroke-width={1.5}
        />
      )}

      <text x={8} y={16} font-size="10" fill="var(--text-dimmed)" font-family="var(--font-mono)">
        {props.node.type}
      </text>

      <text
        x={props.position.width / 2} y={props.position.height / 2 + 5}
        text-anchor="middle" font-size="13" font-weight="500"
        fill="var(--text-base)" font-family="var(--font-sans)"
      >
        {truncateLabel(props.node.label, props.position.width)}
      </text>

      <Show when={props.node.children.length > 0}>
        <circle cx={props.position.width - 12} cy={12} r={8} fill="var(--surface-accent)" />
        <text x={props.position.width - 12} y={16} text-anchor="middle" font-size="10" fill="var(--text-on-accent)">
          {props.node.children.length}
        </text>
      </Show>
    </g>
  )
}

function nodeRadius(type: GraphNode["type"]): number {
  switch (type) {
    case "subsystem": return 12
    case "module": return 6
    case "class": return 8
    case "function": return 20
  }
}

function truncateLabel(label: string, maxWidth: number): string {
  const maxChars = Math.floor(maxWidth / 8) - 2
  if (label.length <= maxChars) return label
  return label.slice(0, maxChars - 1) + "\u2026"
}
