import { createSignal, Show, type Component } from "solid-js"
import { useGraph } from "@/context/graph"

export const GraphToolbar: Component<{
  editMode: boolean
  onToggleEditMode: () => void
  onSearch: (query: string) => void
}> = (props) => {
  const { store } = useGraph()
  const [searchQuery, setSearchQuery] = createSignal("")
  const [searchOpen, setSearchOpen] = createSignal(false)

  return (
    <div style={{ display: "flex", "align-items": "center", gap: "4px", padding: "4px 8px", "border-bottom": "1px solid var(--border-base)", "min-height": "32px", "flex-shrink": "0" }}>
      <button
        onClick={props.onToggleEditMode}
        style={{ padding: "2px 8px", "border-radius": "4px", border: "1px solid var(--border-base)",
          background: props.editMode ? "var(--surface-accent)" : "transparent",
          color: props.editMode ? "var(--text-on-accent)" : "var(--text-base)",
          "font-size": "11px", cursor: "pointer" }}
      >
        {props.editMode ? "Edit" : "Navigate"}
      </button>
      <div style={{ flex: "1" }} />
      <Show when={searchOpen()}>
        <input type="text" placeholder="Search nodes..." value={searchQuery()}
          onInput={(e) => { setSearchQuery(e.currentTarget.value); props.onSearch(e.currentTarget.value) }}
          onKeyDown={(e) => { if (e.key === "Escape") { setSearchOpen(false); setSearchQuery(""); props.onSearch("") } }}
          style={{ padding: "2px 8px", "border-radius": "4px", border: "1px solid var(--border-base)", background: "var(--surface-base)", color: "var(--text-base)", "font-size": "12px", width: "150px" }}
          autofocus
        />
      </Show>
      <button onClick={() => setSearchOpen(!searchOpen())}
        style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 6px", "font-size": "12px", color: "var(--text-dimmed)" }}
        title="Search (press /)">
        /
      </button>
      <span style={{ "font-size": "11px", color: "var(--text-dimmed)", padding: "0 4px" }}>L{store.zoomLevel}</span>
    </div>
  )
}
