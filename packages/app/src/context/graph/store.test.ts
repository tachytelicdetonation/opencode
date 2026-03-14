import { describe, expect, test } from "bun:test"
import { applyDiff, applySnapshot } from "./store"
import type { GraphEdge, GraphDiff, GraphSnapshot } from "./types"

describe("applySnapshot", () => {
  test("converts snapshot arrays to record-based state", () => {
    const snapshot: GraphSnapshot = {
      nodes: [
        { id: "a", type: "subsystem", label: "A", filePath: "/a", children: [], lastModified: 1 },
        { id: "b", type: "module", label: "B", filePath: "/b", children: [], parent: "a", lastModified: 1 },
      ],
      edges: [{ id: "e1", source: "a", target: "b", type: "imports" }],
      eventId: "evt_1",
    }
    const state = applySnapshot(snapshot)
    expect(state.nodes["a"]).toBeDefined()
    expect(state.nodes["b"]).toBeDefined()
    expect(state.edges.length).toBe(1)
    expect(state.eventId).toBe("evt_1")
  })
})

describe("applyDiff", () => {
  test("adds new nodes and edges", () => {
    const state = {
      nodes: { a: { id: "a", type: "subsystem" as const, label: "A", filePath: "/a", children: [], lastModified: 1 } },
      edges: [] as GraphEdge[],
      eventId: "evt_1",
    }
    const diff: GraphDiff = {
      eventId: "evt_2",
      added: [{ id: "b", type: "module", label: "B", filePath: "/b", children: [], lastModified: 2, changeState: "added" }],
      modified: [],
      removed: [],
      edgesAdded: [{ id: "e1", source: "a", target: "b", type: "imports" }],
      edgesRemoved: [],
    }
    const next = applyDiff(state, diff)
    expect(next.nodes["b"]).toBeDefined()
    expect(next.nodes["b"].changeState).toBe("added")
    expect(next.edges.length).toBe(1)
    expect(next.eventId).toBe("evt_2")
  })

  test("removes nodes and edges", () => {
    const state = {
      nodes: {
        a: { id: "a", type: "subsystem" as const, label: "A", filePath: "/a", children: [], lastModified: 1 },
        b: { id: "b", type: "module" as const, label: "B", filePath: "/b", children: [], lastModified: 1 },
      },
      edges: [{ id: "e1", source: "a", target: "b", type: "imports" as const }],
      eventId: "evt_1",
    }
    const diff: GraphDiff = {
      eventId: "evt_2",
      added: [],
      modified: [],
      removed: ["b"],
      edgesAdded: [],
      edgesRemoved: ["e1"],
    }
    const next = applyDiff(state, diff)
    expect(next.nodes["b"]).toBeUndefined()
    expect(next.edges.length).toBe(0)
  })
})
