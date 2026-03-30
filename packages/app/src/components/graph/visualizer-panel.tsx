import { Match, Show, Switch, createMemo, createSignal, onMount, type Component } from "solid-js"
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
  const [query, setQuery] = createSignal("")

  onMount(() => { connect() })

  function handleSearch(query: string) {
    setQuery(query)
    if (!store.graph || !query) return
    const hits = Object.values(store.graph.nodes).filter(
      (node) => node.label.toLowerCase().includes(query.toLowerCase()) ||
        node.description?.toLowerCase().includes(query.toLowerCase()),
    )
    if (hits.length === 1 && hits[0].parent) drillDown(hits[0].parent)
  }

  const count = createMemo(() => store.graph ? Object.values(store.graph.nodes).length : 0)
  const edges = createMemo(() => store.graph?.edges.length ?? 0)

  return (
    <div
      data-testid="visualizer-panel"
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        background: "linear-gradient(180deg, var(--background-base), var(--background-stronger))",
      }}
    >
      <GraphToolbar
        editMode={editMode()}
        onToggleEditMode={() => setEditMode(!editMode())}
        onSearch={handleSearch}
        query={query()}
      />
      <Switch>
        <Match when={store.error && !store.graph}>
          <div class="h-full flex items-center justify-center px-6">
            <div class="max-w-80 rounded-xl border border-border-weak-base bg-background-base px-4 py-4 text-center shadow-xs-border-base">
              <div class="text-14-medium text-text-strong">Architecture unavailable</div>
              <div class="mt-2 text-12-regular text-text-weak">{store.error}</div>
            </div>
          </div>
        </Match>
        <Match when={!store.graph}>
          <div class="h-full flex items-center justify-center px-6">
            <div class="max-w-80 rounded-xl border border-border-weak-base bg-background-base px-4 py-4 text-center shadow-xs-border-base">
              <div class="text-14-medium text-text-strong">
                {store.connecting ? "Scanning codebase" : "Preparing architecture"}
              </div>
              <div class="mt-2 text-12-regular text-text-weak">
                Reading modules, comments, and relationships to build the graph.
              </div>
            </div>
          </div>
        </Match>
        <Match when={true}>
          <div class="flex flex-col h-full min-h-0">
            <GraphBreadcrumb />
            <div class="px-3 py-2 border-b border-border-weaker-base text-11-medium text-text-weak bg-background-base/70">
              {count()} nodes · {edges()} links
              <Show when={query()}>
                <span> · search: {query()}</span>
              </Show>
            </div>
            <div style={{ flex: "1", "min-height": "0" }}>
              <GraphCanvas query={query()} />
            </div>
          </div>
        </Match>
      </Switch>
      <GraphEditBar onSubmitToChat={props.onSubmitToChat} />
    </div>
  )
}
