import { For, Show, type Component } from "solid-js"
import { useGraph } from "@/context/graph"

export const GraphBreadcrumb: Component = () => {
  const { store, navigateUp } = useGraph()

  const crumbs = () => {
    const items: Array<{ label: string; index: number }> = [{ label: "Project", index: -1 }]
    for (let i = 0; i < store.navigationStack.length; i++) {
      const nodeId = store.navigationStack[i]
      const node = store.graph?.nodes[nodeId]
      items.push({ label: node?.label ?? nodeId, index: i })
    }
    if (store.focusedNode) {
      const node = store.graph?.nodes[store.focusedNode]
      items.push({ label: node?.label ?? store.focusedNode, index: store.navigationStack.length })
    }
    return items
  }

  return (
    <div style={{ display: "flex", "align-items": "center", gap: "4px", padding: "4px 8px", "font-size": "12px", "border-bottom": "1px solid var(--border-base)", "min-height": "28px", "flex-shrink": "0", overflow: "hidden" }}>
      <For each={crumbs()}>
        {(crumb, i) => (
          <>
            <Show when={i() > 0}>
              <span style={{ color: "var(--text-dimmed)" }}>/</span>
            </Show>
            <button
              onClick={() => {
                if (crumb.index === -1) { while (store.navigationStack.length > 0) navigateUp() }
                else if (i() < crumbs().length - 1) { navigateUp(crumb.index) }
              }}
              style={{ background: "none", border: "none", padding: "2px 4px", "border-radius": "3px",
                cursor: i() < crumbs().length - 1 ? "pointer" : "default",
                color: i() < crumbs().length - 1 ? "var(--text-link)" : "var(--text-base)",
                "font-weight": i() === crumbs().length - 1 ? "600" : "400", "font-size": "12px", "white-space": "nowrap" }}
            >
              {crumb.label}
            </button>
          </>
        )}
      </For>
    </div>
  )
}
