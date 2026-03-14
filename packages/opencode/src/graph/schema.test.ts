import { describe, expect, test } from "bun:test"
import { GraphNode, GraphEdge, GraphDiff } from "./schema"
import z from "zod"

describe("GraphNode", () => {
  test("validates a valid subsystem node", () => {
    const node = {
      id: "packages/app",
      type: "subsystem",
      label: "App Package",
      filePath: "/project/packages/app",
      children: ["packages/app/src/context", "packages/app/src/pages"],
      lastModified: Date.now(),
    }
    expect(GraphNode.parse(node)).toEqual(node)
  })

  test("validates a function node with optional fields", () => {
    const node = {
      id: "packages/app/src/context/layout.tsx::useLayout",
      type: "function",
      label: "useLayout",
      description: "Provides layout context for panel state management",
      filePath: "/project/packages/app/src/context/layout.tsx",
      lineRange: [133, 280],
      children: [],
      parent: "packages/app/src/context/layout.tsx",
      lastModified: Date.now(),
      changeState: "modified",
    }
    expect(GraphNode.parse(node)).toEqual(node)
  })

  test("rejects invalid node type", () => {
    expect(() =>
      GraphNode.parse({ id: "x", type: "invalid", label: "x", filePath: "/x", children: [], lastModified: 0 }),
    ).toThrow()
  })
})

describe("GraphEdge", () => {
  test("validates an import edge", () => {
    const edge = {
      id: "packages/app->packages/sdk",
      source: "packages/app",
      target: "packages/sdk",
      type: "imports",
    }
    expect(GraphEdge.parse(edge)).toEqual(edge)
  })
})

describe("GraphDiff", () => {
  test("validates a diff with all fields", () => {
    const diff = {
      eventId: "evt_1",
      added: [],
      modified: [],
      removed: ["old-node"],
      edgesAdded: [],
      edgesRemoved: ["old-edge"],
    }
    expect(GraphDiff.parse(diff)).toEqual(diff)
  })
})
