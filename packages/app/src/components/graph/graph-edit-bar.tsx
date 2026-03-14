import { Show, type Component } from "solid-js"
import { useGraph } from "@/context/graph"

export const GraphEditBar: Component<{
  onSubmitToChat: (prompt: string) => void
}> = (props) => {
  const { store, clearEdits, compileEditsToPrompt } = useGraph()

  return (
    <Show when={store.pendingEdits.length > 0}>
      <div style={{ display: "flex", "align-items": "center", gap: "8px", padding: "6px 8px", "border-top": "1px solid var(--border-base)", background: "var(--surface-raised)", "flex-shrink": "0" }}>
        <span style={{ "font-size": "12px", color: "var(--text-dimmed)" }}>
          {store.pendingEdits.length} edit{store.pendingEdits.length > 1 ? "s" : ""} pending
        </span>
        <div style={{ flex: "1" }} />
        <button onClick={clearEdits}
          style={{ background: "none", border: "none", color: "var(--text-dimmed)", cursor: "pointer", "font-size": "12px", padding: "2px 8px" }}>
          Clear
        </button>
        <button onClick={() => props.onSubmitToChat(compileEditsToPrompt())}
          style={{ padding: "4px 12px", "border-radius": "4px", border: "none", background: "var(--surface-accent)", color: "var(--text-on-accent)", cursor: "pointer", "font-size": "12px", "font-weight": "500" }}>
          Submit to Chat
        </button>
      </div>
    </Show>
  )
}
