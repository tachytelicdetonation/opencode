import { type Component } from "solid-js"
import { useGraph } from "@/context/graph"
import type { GraphNode } from "@/context/graph/types"

export const GraphToolbar: Component<{
  editMode: boolean
  onToggleEditMode: () => void
  onSearch: (query: string) => void
  query: string
}> = (props) => {
  const graph = useGraph()

  const chip = (on: boolean) => ({
    padding: "3px 8px",
    "border-radius": "999px",
    border: `1px solid ${on ? "var(--border-weak-base)" : "var(--border-base)"}`,
    background: on ? "var(--surface-info-base)" : "var(--surface-base)",
    color: on ? "var(--text-base)" : "var(--text-weak)",
    "font-size": "11px",
    "font-family": "var(--font-mono)",
    "line-height": "1.1",
    cursor: "pointer",
  })

  const toggle = (type: GraphNode["type"]) => {
    graph.setFilter(type, !graph.store.filters[type])
  }

  return (
    <div style={{
      display: "flex",
      "flex-wrap": "wrap",
      gap: "8px",
      padding: "10px 12px",
      "border-bottom": "1px solid var(--border-base)",
      background: "var(--surface-raised)",
      "flex-shrink": "0",
      "align-items": "center",
    }}>
      <input
        type="text"
        placeholder="Search architecture"
        value={props.query}
        onInput={(e) => props.onSearch(e.currentTarget.value)}
        style={{
          flex: "1 1 180px",
          padding: "7px 10px",
          "border-radius": "8px",
          border: "1px solid var(--border-base)",
          background: "var(--surface-base)",
          color: "var(--text-base)",
          "font-size": "12px",
        }}
      />
      <button onClick={graph.requestFit} style={chip(true)}>
        fit
      </button>
      <button onClick={() => props.onSearch("")} style={chip(false)}>
        clear
      </button>
      <button onClick={graph.resetFilters} style={chip(false)}>
        all
      </button>
      <button onClick={props.onToggleEditMode} style={chip(props.editMode)}>
        {props.editMode ? "edit" : "view"}
      </button>
      <button onClick={() => toggle("subsystem")} style={chip(graph.store.filters.subsystem)}>
        subsystem
      </button>
      <button onClick={() => toggle("module")} style={chip(graph.store.filters.module)}>
        module
      </button>
      <button onClick={() => toggle("class")} style={chip(graph.store.filters.class)}>
        class
      </button>
      <button onClick={() => toggle("function")} style={chip(graph.store.filters.function)}>
        fn
      </button>
      <span style={{
        "font-size": "11px",
        color: "var(--text-dimmed)",
        "font-family": "var(--font-mono)",
        "margin-left": "auto",
      }}>
        L{graph.store.zoomLevel}
      </span>
    </div>
  )
}
