import { createSignal, onMount, type Component } from "solid-js"
import { useGraph } from "@/context/graph"
import { GraphCanvas } from "./graph-canvas"
import { GraphBreadcrumb } from "./graph-breadcrumb"
import { GraphToolbar } from "./graph-toolbar"
import { GraphEditBar } from "./graph-edit-bar"

export const VisualizerPanel: Component<{
  onSubmitToChat: (prompt: string) => void
}> = (props) => {
  const { connect, store, drillDown } = useGraph()
  const [editMode, setEditMode] = createSignal(false)

  onMount(() => { connect() })

  function handleSearch(query: string) {
    if (!store.graph || !query) return
    const matches = Object.values(store.graph.nodes).filter(
      (n) => n.label.toLowerCase().includes(query.toLowerCase()) ||
        n.description?.toLowerCase().includes(query.toLowerCase()),
    )
    if (matches.length === 1 && matches[0].parent) drillDown(matches[0].parent)
  }

  return (
    <div data-testid="visualizer-panel"
      style={{ display: "flex", "flex-direction": "column", height: "100%", background: "var(--surface-base)", "border-left": "1px solid var(--border-base)" }}>
      <GraphToolbar editMode={editMode()} onToggleEditMode={() => setEditMode(!editMode())} onSearch={handleSearch} />
      <GraphBreadcrumb />
      <div style={{ flex: "1", "min-height": "0" }}>
        <GraphCanvas />
      </div>
      <GraphEditBar onSubmitToChat={props.onSubmitToChat} />
    </div>
  )
}
