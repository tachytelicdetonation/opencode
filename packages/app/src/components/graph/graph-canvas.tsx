import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type Component } from "solid-js"
import { useGraph } from "@/context/graph"
import { GraphNodeSVG } from "./graph-node"
import { GraphEdgeSVG, GraphEdgeDefs } from "./graph-edge"
import "./graph-animations.css"

export const GraphCanvas: Component<{
  query: string
}> = (props) => {
  const { store, drillDown } = useGraph()
  const [pan, setPan] = createSignal({ x: 0, y: 0 })
  const [zoom, setZoom] = createSignal(1)
  const [hovered, setHovered] = createSignal<string>()
  const [dragging, setDragging] = createSignal(false)
  const [start, setStart] = createSignal({ x: 0, y: 0 })
  const [box, setBox] = createSignal({ width: 0, height: 0 })
  let ref: HTMLDivElement | undefined

  const visibleNodes = createMemo(() => {
    if (!store.graph) return []
    return Object.values(store.graph.nodes).filter((node) => {
      const inside = store.focusedNode ? node.parent === store.focusedNode : !node.parent
      if (!inside) return false
      return store.filters[node.type]
    })
  })

  const visibleEdges = createMemo(() => {
    if (!store.graph) return []
    const ids = new Set(visibleNodes().map((node) => node.id))
    return store.graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))
  })

  const hits = createMemo(() => {
    const query = props.query.trim().toLowerCase()
    if (!query) return new Set<string>()
    return new Set(
      visibleNodes()
        .filter((node) =>
          node.label.toLowerCase().includes(query)
          || node.description?.toLowerCase().includes(query),
        )
        .map((node) => node.id),
    )
  })

  const linked = createMemo(() => {
    const id = hovered()
    if (!id) return new Set<string>()
    const ids = new Set<string>()
    for (const edge of visibleEdges()) {
      if (edge.source === id) ids.add(edge.target)
      if (edge.target === id) ids.add(edge.source)
    }
    return ids
  })

  const current = createMemo(() => {
    const id = hovered()
    if (!id || !store.graph) return
    return store.graph.nodes[id]
  })

  const currentStyle = createMemo(() => {
    const node = current()
    const pos = node ? store.positions[node.id] : undefined
    if (!node || !pos || !ref) return
    const left = pan().x + (pos.x + pos.width + 18) * zoom()
    const top = pan().y + pos.y * zoom()
    const maxLeft = ref.clientWidth - 300
    const maxTop = ref.clientHeight - 96
    return {
      left: `${Math.max(12, Math.min(left, maxLeft))}px`,
      top: `${Math.max(12, Math.min(top, maxTop))}px`,
    }
  })

  function fit() {
    if (!ref) return
    const ids = new Set(visibleNodes().map((node) => node.id))
    const items = Object.entries(store.positions)
      .filter(([id]) => ids.has(id))
      .map(([, pos]) => pos)
    if (items.length === 0) return

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const pos of items) {
      minX = Math.min(minX, pos.x)
      minY = Math.min(minY, pos.y)
      maxX = Math.max(maxX, pos.x + pos.width)
      maxY = Math.max(maxY, pos.y + pos.height)
    }

    const width = box().width || ref.clientWidth
    const height = box().height || ref.clientHeight
    if (!width || !height) return

    const graphWidth = Math.max(1, maxX - minX)
    const graphHeight = Math.max(1, maxY - minY)
    const pad = 56
    const scaleX = (width - pad * 2) / graphWidth
    const scaleY = (height - pad * 2) / graphHeight
    const next = Math.max(0.2, Math.min(1.35, Math.min(scaleX, scaleY)))
    const cx = minX + graphWidth / 2
    const cy = minY + graphHeight / 2

    setZoom(next)
    setPan({
      x: width / 2 - cx * next,
      y: height / 2 - cy * next,
    })
  }

  createEffect(() => {
    store.positions
    visibleNodes()
    store.fitTick
    box()
    fit()
  })

  onMount(() => {
    if (!ref) return
    const resize = new ResizeObserver((items) => {
      const rect = items[0]?.contentRect
      if (!rect) return
      setBox({ width: rect.width, height: rect.height })
    })
    resize.observe(ref)
    onCleanup(() => resize.disconnect())
  })

  function handleWheel(event: WheelEvent) {
    if (!ref) return
    event.preventDefault()
    const rect = ref.getBoundingClientRect()
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    const delta = event.deltaY > 0 ? 0.92 : 1.08
    const prev = zoom()
    const next = Math.max(0.18, Math.min(3, prev * delta))
    const scale = next / prev
    setPan((item) => ({
      x: px - (px - item.x) * scale,
      y: py - (py - item.y) * scale,
    }))
    setZoom(next)
  }

  function handleMouseDown(event: MouseEvent) {
    if ((event.target as Element)?.closest(".graph-node")) return
    setDragging(true)
    setStart({ x: event.clientX - pan().x, y: event.clientY - pan().y })
  }

  function handleMouseMove(event: MouseEvent) {
    if (!dragging()) return
    setPan({ x: event.clientX - start().x, y: event.clientY - start().y })
  }

  function handleMouseUp() {
    setDragging(false)
  }

  function handleNodeClick(id: string) {
    const node = store.graph?.nodes[id]
    if (node?.children.length) drillDown(id)
  }

  return (
    <div
      ref={ref}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        position: "relative",
        background: "radial-gradient(circle at top, color-mix(in srgb, var(--background-base) 84%, white 16%), var(--background-stronger))",
      }}
      onWheel={handleWheel}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: "0",
          background: "linear-gradient(to right, color-mix(in srgb, var(--border-weaker-base) 45%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--border-weaker-base) 45%, transparent) 1px, transparent 1px)",
          "background-size": "24px 24px",
          opacity: "0.25",
          "pointer-events": "none",
        }}
      />

      <Show when={store.layoutComputing}>
        <div class="absolute inset-0 z-10 flex items-center justify-center bg-background-base/70 backdrop-blur-[1px]">
          <div class="rounded-full border border-border-weak-base bg-background-base px-3 py-1 text-12-medium text-text-weak shadow-xs-border-base">
            Updating layout…
          </div>
        </div>
      </Show>

      <Show when={!store.connected && store.graph}>
        <div class="absolute top-3 right-3 z-10 rounded-full border border-border-weak-base bg-background-base px-3 py-1 text-11-medium text-text-weak shadow-xs-border-base">
          Stale snapshot
        </div>
      </Show>

      <Show when={current()}>
        {(node) => (
          <Show when={currentStyle()}>
            {(style) => (
              <div
                class="absolute z-10 max-w-72 rounded-xl border border-border-weak-base bg-background-base px-3 py-2 shadow-sm"
                style={style()}
              >
                <div class="text-12-medium text-text-strong">{node().label}</div>
                <Show when={node().description}>
                  <div class="mt-1 text-11-regular text-text-weak">{node().description}</div>
                </Show>
                <Show when={node().children.length > 0}>
                  <div class="mt-2 text-11-medium text-text-weak">Click to open {node().children.length} children</div>
                </Show>
              </div>
            )}
          </Show>
        )}
      </Show>

      <Show when={visibleNodes().length === 0 && store.graph}>
        <div class="absolute inset-0 z-10 flex items-center justify-center">
          <div class="rounded-xl border border-border-weak-base bg-background-base px-4 py-3 text-center shadow-xs-border-base">
            <div class="text-14-medium text-text-strong">Nothing visible</div>
            <div class="mt-1 text-12-regular text-text-weak">The current filters hide every node at this level.</div>
          </div>
        </div>
      </Show>

      <svg
        width="100%"
        height="100%"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: dragging() ? "grabbing" : "grab" }}
      >
        <GraphEdgeDefs />
        <g transform={`translate(${pan().x}, ${pan().y}) scale(${zoom()})`}>
          <For each={visibleEdges()}>
            {(edge) => {
              const source = () => store.positions[edge.source]
              const target = () => store.positions[edge.target]
              const isDecisionEdge = () => {
                const sn = store.graph?.nodes[edge.source]
                const tn = store.graph?.nodes[edge.target]
                return sn?.type === "decision" || tn?.type === "decision"
              }
              return (
                <Show when={source() && target()}>
                  <GraphEdgeSVG
                    edge={edge}
                    sourcePos={source()!}
                    targetPos={target()!}
                    highlighted={edge.source === hovered() || edge.target === hovered()}
                    alwaysShowLabel={isDecisionEdge()}
                  />
                </Show>
              )
            }}
          </For>
          <For each={visibleNodes()}>
            {(node) => {
              const pos = () => store.positions[node.id]
              const active = () => {
                if (hovered()) return node.id === hovered() || linked().has(node.id)
                if (hits().size > 0) return hits().has(node.id)
                return false
              }
              return (
                <Show when={pos()}>
                  <GraphNodeSVG
                    node={node}
                    position={pos()!}
                    onClick={handleNodeClick}
                    onHover={setHovered}
                    highlighted={active()}
                  />
                </Show>
              )
            }}
          </For>
        </g>
      </svg>
    </div>
  )
}
