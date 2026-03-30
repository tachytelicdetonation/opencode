import { Show, type Component } from "solid-js"
import type { GraphNode } from "@/context/graph/types"
import type { Position } from "@/context/graph/types"

// Deep ocean palette — distinct tints per node type
const NODE_STYLES: Record<GraphNode["type"], {
  fill: string
  fillHighlight: string
  border: string
  borderHighlight: string
  badge: string
  badgeBg: string
  rx: number
  borderWidth: number
}> = {
  subsystem: {
    fill: "rgba(90, 100, 180, 0.10)",
    fillHighlight: "rgba(90, 100, 180, 0.18)",
    border: "rgba(120, 130, 210, 0.35)",
    borderHighlight: "rgba(140, 150, 240, 0.65)",
    badge: "rgba(160, 170, 255, 0.85)",
    badgeBg: "rgba(100, 110, 200, 0.15)",
    rx: 12,
    borderWidth: 1,
  },
  module: {
    fill: "rgba(40, 160, 150, 0.08)",
    fillHighlight: "rgba(40, 160, 150, 0.15)",
    border: "rgba(60, 190, 175, 0.30)",
    borderHighlight: "rgba(80, 220, 200, 0.60)",
    badge: "rgba(100, 230, 210, 0.85)",
    badgeBg: "rgba(50, 170, 160, 0.12)",
    rx: 8,
    borderWidth: 1,
  },
  class: {
    fill: "rgba(50, 120, 240, 0.10)",
    fillHighlight: "rgba(50, 120, 240, 0.18)",
    border: "rgba(70, 145, 255, 0.40)",
    borderHighlight: "rgba(90, 165, 255, 0.70)",
    badge: "rgba(130, 185, 255, 0.90)",
    badgeBg: "rgba(60, 130, 240, 0.15)",
    rx: 8,
    borderWidth: 1.5,
  },
  function: {
    fill: "rgba(200, 160, 40, 0.06)",
    fillHighlight: "rgba(200, 160, 40, 0.12)",
    border: "rgba(220, 185, 60, 0.25)",
    borderHighlight: "rgba(240, 200, 80, 0.50)",
    badge: "rgba(240, 210, 100, 0.80)",
    badgeBg: "rgba(200, 170, 50, 0.10)",
    rx: 16,
    borderWidth: 1,
  },
  decision: {
    fill: "rgba(255, 130, 100, 0.08)",
    fillHighlight: "rgba(255, 130, 100, 0.16)",
    border: "rgba(255, 150, 120, 0.35)",
    borderHighlight: "rgba(255, 170, 140, 0.65)",
    badge: "rgba(255, 180, 150, 0.85)",
    badgeBg: "rgba(255, 140, 110, 0.12)",
    rx: 4,
    borderWidth: 1,
  },
}

const TYPE_LABEL: Record<GraphNode["type"], string> = {
  subsystem: "PKG",
  module: "MOD",
  class: "CLASS",
  function: "FN",
  decision: "IF",
}

export const GraphNodeSVG: Component<{
  node: GraphNode
  position: Position
  onClick: (nodeId: string) => void
  onHover: (nodeId: string | undefined) => void
  highlighted?: boolean
}> = (props) => {
  const w = () => props.position.width
  const h = () => props.position.height
  const ns = () => NODE_STYLES[props.node.type]
  const typeLabel = () => TYPE_LABEL[props.node.type]
  const isDiamond = () => props.node.type === "decision"

  const changeColor = () => {
    if (!props.node.changeState) return undefined
    if (props.node.changeState === "added") return "rgba(80, 220, 120, 0.5)"
    if (props.node.changeState === "modified") return "rgba(80, 180, 255, 0.5)"
    return "rgba(255, 100, 80, 0.5)"
  }

  return (
    <g
      transform={`translate(${props.position.x}, ${props.position.y})`}
      onClick={() => props.onClick(props.node.id)}
      onMouseEnter={() => props.onHover(props.node.id)}
      onMouseLeave={() => props.onHover(undefined)}
      style={{ cursor: "pointer" }}
      class="graph-node"
    >
      {/* Shape: diamond for decisions, rounded rect for everything else */}
      <Show when={isDiamond()} fallback={
        <>
          <rect x={1} y={2} width={w()} height={h()} rx={ns().rx} fill="rgba(0,0,0,0.20)" />
          <rect
            width={w()} height={h()} rx={ns().rx}
            fill={props.highlighted ? ns().fillHighlight : ns().fill}
            stroke={props.highlighted ? ns().borderHighlight : ns().border}
            stroke-width={ns().borderWidth}
            class="graph-node-body"
          />
        </>
      }>
        <polygon
          points={`${w()/2},0 ${w()},${h()/2} ${w()/2},${h()} 0,${h()/2}`}
          fill={props.highlighted ? ns().fillHighlight : ns().fill}
          stroke={props.highlighted ? ns().borderHighlight : ns().border}
          stroke-width={ns().borderWidth}
          class="graph-node-body"
        />
      </Show>

      {/* Change state indicator */}
      <Show when={changeColor()}>
        <rect
          x={-2} y={-2}
          width={w() + 4} height={h() + 4}
          rx={ns().rx + 2}
          fill="none"
          stroke={changeColor()}
          stroke-width={1.5}
          stroke-dasharray={props.node.changeState === "deleted" ? "4,3" : undefined}
          class="graph-node-change-glow"
        />
      </Show>

      {/* Content */}
      <Show when={isDiamond()} fallback={
        <foreignObject x={0} y={0} width={w()} height={h()}>
          <div
            class="graph-node-content"
            style={{
              width: "100%",
              height: "100%",
              padding: "8px 10px",
              "box-sizing": "border-box",
              display: "flex",
              "flex-direction": "column",
              overflow: "hidden",
            }}
          >
            <div style={{
              display: "flex",
              "justify-content": "space-between",
              "align-items": "center",
              "margin-bottom": props.node.type === "function" ? "0" : "4px",
              "flex-shrink": "0",
            }}>
              <span style={{
                "font-family": "var(--font-mono)",
                "font-size": "9px",
                "font-weight": "600",
                color: ns().badge,
                "letter-spacing": "0.06em",
                padding: "1px 5px",
                "border-radius": "3px",
                background: ns().badgeBg,
              }}>
                {typeLabel()}
              </span>
              <Show when={props.node.children.length > 0}>
                <span style={{
                  "font-family": "var(--font-mono)",
                  "font-size": "10px",
                  "font-weight": "500",
                  color: "var(--text-weak)",
                }}>
                  ▸{props.node.children.length}
                </span>
              </Show>
            </div>

            <div style={{
              "font-family": "var(--font-sans)",
              "font-size": props.node.type === "function" ? "12px" : "13px",
              "font-weight": "600",
              color: "var(--text-strong)",
              "white-space": "nowrap",
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "flex-shrink": "0",
            }}>
              {props.node.label}
            </div>

            <Show when={props.node.description && props.node.type !== "function"}>
              <div style={{
                "font-family": "var(--font-sans)",
                "font-size": "11px",
                "line-height": "1.3",
                color: "var(--text-weak)",
                overflow: "hidden",
                display: "-webkit-box",
                "-webkit-line-clamp": "2",
                "-webkit-box-orient": "vertical",
                "margin-top": "2px",
              }}>
                {props.node.description}
              </div>
            </Show>
          </div>
        </foreignObject>
      }>
        {/* Decision node: centered condition text */}
        <foreignObject x={0} y={0} width={w()} height={h()}>
          <div class="graph-node-content" style={{
            width: "100%",
            height: "100%",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "text-align": "center",
            padding: "4px 12px",
            "box-sizing": "border-box",
          }}>
            <span style={{
              "font-family": "var(--font-mono)",
              "font-size": "10px",
              "font-weight": "500",
              color: ns().badge,
            }}>
              {props.node.condition ?? props.node.label}
            </span>
          </div>
        </foreignObject>
      </Show>
    </g>
  )
}
