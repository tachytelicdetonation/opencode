import { For, Show, createSignal, type Component } from "solid-js"
import { useGraph } from "@/context/graph"
import { GraphNodeSVG } from "./graph-node"
import { GraphEdgeSVG } from "./graph-edge"
import "./graph-animations.css"

export const GraphCanvas: Component = () => {
  const { store, drillDown } = useGraph()
  const [pan, setPan] = createSignal({ x: 0, y: 0 })
  const [zoom, setZoom] = createSignal(1)
  const [hoveredNode, setHoveredNode] = createSignal<string>()
  const [dragging, setDragging] = createSignal(false)
  const [dragStart, setDragStart] = createSignal({ x: 0, y: 0 })

  const visibleNodes = () => {
    if (!store.graph) return []
    return Object.values(store.graph.nodes).filter((n) => {
      if (!store.focusedNode) return !n.parent
      return n.parent === store.focusedNode
    })
  }

  const visibleEdges = () => {
    if (!store.graph) return []
    const ids = new Set(visibleNodes().map((n) => n.id))
    return store.graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  }

  const hoveredNodeData = () => {
    const id = hoveredNode()
    if (!id || !store.graph) return undefined
    return store.graph.nodes[id]
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom((z) => Math.max(0.1, Math.min(3, z * delta)))
  }

  function handleMouseDown(e: MouseEvent) {
    setDragging(true)
    setDragStart({ x: e.clientX - pan().x, y: e.clientY - pan().y })
  }

  function handleMouseMove(e: MouseEvent) {
    if (dragging()) {
      setPan({ x: e.clientX - dragStart().x, y: e.clientY - dragStart().y })
    }
  }

  function handleMouseUp() { setDragging(false) }

  function handleNodeClick(nodeId: string) {
    const node = store.graph?.nodes[nodeId]
    if (node && node.children.length > 0) drillDown(nodeId)
  }

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative" }} onWheel={handleWheel}>
      <Show when={store.layoutComputing}>
        <div style={{ position: "absolute", inset: "0", display: "flex", "align-items": "center", "justify-content": "center", background: "var(--surface-base)", opacity: "0.5", "z-index": "10" }}>
          <span style={{ color: "var(--text-dimmed)" }}>Computing layout...</span>
        </div>
      </Show>

      <Show when={!store.connected && store.graph}>
        <div style={{ position: "absolute", top: "8px", right: "8px", padding: "4px 8px", background: "var(--surface-warning-base)", "border-radius": "4px", "font-size": "11px", color: "var(--text-warning)", "z-index": "10" }}>
          Disconnected
        </div>
      </Show>

      <Show when={hoveredNodeData()}>
        {(node) => (
          <div style={{ position: "absolute", top: "8px", left: "8px", padding: "8px 12px", background: "var(--surface-raised)", border: "1px solid var(--border-base)", "border-radius": "6px", "font-size": "12px", "max-width": "300px", "z-index": "10" }}>
            <div style={{ "font-weight": "600" }}>{node().label}</div>
            <Show when={node().description}>
              <div style={{ color: "var(--text-dimmed)", "margin-top": "4px" }}>{node().description}</div>
            </Show>
            <Show when={node().children.length > 0}>
              <div style={{ color: "var(--text-dimmed)", "margin-top": "4px", "font-size": "11px" }}>
                Click to drill down ({node().children.length} children)
              </div>
            </Show>
          </div>
        )}
      </Show>

      <svg width="100%" height="100%"
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
        style={{ cursor: dragging() ? "grabbing" : "grab" }}>
        <g transform={`translate(${pan().x}, ${pan().y}) scale(${zoom()})`}>
          <For each={visibleEdges()}>
            {(edge) => {
              const sourcePos = () => store.positions[edge.source]
              const targetPos = () => store.positions[edge.target]
              return (
                <Show when={sourcePos() && targetPos()}>
                  <GraphEdgeSVG edge={edge} sourcePos={sourcePos()!} targetPos={targetPos()!} />
                </Show>
              )
            }}
          </For>
          <For each={visibleNodes()}>
            {(node) => {
              const pos = () => store.positions[node.id]
              return (
                <Show when={pos()}>
                  <GraphNodeSVG node={node} position={pos()!} onClick={handleNodeClick} onHover={setHoveredNode} />
                </Show>
              )
            }}
          </For>
        </g>
      </svg>
    </div>
  )
}
