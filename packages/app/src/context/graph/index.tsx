import { createStore } from "solid-js/store"
import { onCleanup, batch } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "../sdk"
import { applySnapshot, applyDiff, type GraphStoreState } from "./store"
import { computeLayout } from "./layout"
import type { GraphSnapshot, GraphDiff, Position, Annotation, VisualEdit } from "./types"

export const { use: useGraph, provider: GraphProvider } = createSimpleContext({
  name: "Graph",
  init: () => {
    const sdk = useSDK()

    const [store, setStore] = createStore({
      graph: null as GraphStoreState | null,
      positions: {} as Record<string, Position>,
      layoutComputing: false,
      zoomLevel: 1 as 1 | 2 | 3 | 4,
      focusedNode: undefined as string | undefined,
      navigationStack: [] as string[],
      userAnnotations: [] as Annotation[],
      pendingEdits: [] as VisualEdit[],
      connected: false,
      error: undefined as string | undefined,
    })

    let eventSource: EventSource | null = null

    function connect() {
      if (eventSource) {
        eventSource.close()
        eventSource = null
      }

      const baseUrl = sdk.url.replace(/\/$/, "")
      const directory = sdk.directory
      const url = `${baseUrl}/graph/subscribe?directory=${encodeURIComponent(directory)}`

      eventSource = new EventSource(url)

      eventSource.addEventListener("graph:snapshot", (e: MessageEvent) => {
        try {
          const snapshot: GraphSnapshot = JSON.parse(e.data)
          const state = applySnapshot(snapshot)
          setStore("graph", state)
          setStore("connected", true)
          setStore("error", undefined)
          recomputeLayout(state)
        } catch (err) {
          setStore("error", String(err))
        }
      })

      eventSource.addEventListener("graph:diff", (e: MessageEvent) => {
        try {
          const diff: GraphDiff = JSON.parse(e.data)
          const current = store.graph
          if (!current) return
          const next = applyDiff(current, diff)
          setStore("graph", next)
          recomputeLayout(next)
        } catch (err) {
          setStore("error", String(err))
        }
      })

      eventSource.onerror = () => {
        setStore("connected", false)
        setStore("error", "EventSource connection error")
      }

      eventSource.onopen = () => {
        setStore("connected", true)
        setStore("error", undefined)
      }
    }

    async function recomputeLayout(state: GraphStoreState) {
      setStore("layoutComputing", true)
      try {
        const positions = await computeLayout(state.nodes, state.edges, store.focusedNode)
        setStore("positions", positions)
      } catch {
        // ignore layout errors
      } finally {
        setStore("layoutComputing", false)
      }
    }

    function drillDown(nodeId: string) {
      batch(() => {
        setStore("navigationStack", [...store.navigationStack, store.focusedNode ?? ""])
        setStore("focusedNode", nodeId)
        setStore("zoomLevel", Math.min(4, store.zoomLevel + 1) as 1 | 2 | 3 | 4)
      })
      if (store.graph) recomputeLayout(store.graph)
    }

    function navigateUp(targetIndex?: number) {
      const stack = [...store.navigationStack]
      if (stack.length === 0) return
      const idx = targetIndex ?? stack.length - 1
      const target = stack[idx] || undefined
      const newStack = stack.slice(0, idx)
      batch(() => {
        setStore("focusedNode", target)
        setStore("navigationStack", newStack)
        setStore("zoomLevel", Math.max(1, store.zoomLevel - (stack.length - idx)) as 1 | 2 | 3 | 4)
      })
      if (store.graph) recomputeLayout(store.graph)
    }

    function addEdit(edit: VisualEdit) {
      setStore("pendingEdits", [...store.pendingEdits, edit])
    }

    function clearEdits() {
      setStore("pendingEdits", [])
    }

    function compileEditsToPrompt(): string {
      return store.pendingEdits.map((e) => e.compiledPrompt).join("\n")
    }

    onCleanup(() => {
      eventSource?.close()
    })

    return { store, connect, drillDown, navigateUp, addEdit, clearEdits, compileEditsToPrompt }
  },
})
