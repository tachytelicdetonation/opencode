import { createStore } from "solid-js/store"
import { onCleanup, batch } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "../sdk"
import { useGlobalSDK } from "../global-sdk"
import { applySnapshot, applyDiff, type GraphStoreState } from "./store"
import { computeLayout } from "./layout"
import type { GraphSnapshot, GraphDiff, Position, Annotation, VisualEdit } from "./types"

export const { use: useGraph, provider: GraphProvider } = createSimpleContext({
  name: "Graph",
  init: () => {
    const sdk = useSDK()
    const globalSDK = useGlobalSDK()

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

    let pollTimer: ReturnType<typeof setInterval> | null = null

    async function connect() {
      // Use the SDK client to fetch the graph via authenticated HTTP
      // (EventSource doesn't support Basic Auth headers)
      try {
        const client = globalSDK.createClient({
          directory: sdk.directory,
          throwOnError: true,
        })
        const baseUrl = sdk.url.replace(/\/$/, "")
        const res = await fetch(
          `${baseUrl}/graph/architecture?directory=${encodeURIComponent(sdk.directory)}`,
          {
            headers: {
              ...(client as any)?.options?.headers,
            },
          },
        )
        if (!res.ok) {
          setStore("error", `HTTP ${res.status}`)
          return
        }
        const snapshot: GraphSnapshot = await res.json()
        const state = applySnapshot(snapshot)
        setStore("graph", state)
        setStore("connected", true)
        setStore("error", undefined)
        recomputeLayout(state)

        // Poll for updates every 5 seconds (until we implement proper SSE with auth)
        pollTimer = setInterval(async () => {
          try {
            const res = await fetch(
              `${baseUrl}/graph/architecture?directory=${encodeURIComponent(sdk.directory)}`,
            )
            if (!res.ok) return
            const snapshot: GraphSnapshot = await res.json()
            const newState = applySnapshot(snapshot)
            if (newState.eventId !== store.graph?.eventId) {
              setStore("graph", newState)
              recomputeLayout(newState)
            }
          } catch {
            // ignore poll errors
          }
        }, 5000)
      } catch (err) {
        setStore("error", String(err))
        setStore("connected", false)
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
      if (pollTimer) clearInterval(pollTimer)
    })

    return { store, connect, drillDown, navigateUp, addEdit, clearEdits, compileEditsToPrompt }
  },
})
