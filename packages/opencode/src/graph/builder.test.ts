// packages/opencode/src/graph/builder.test.ts
import { describe, expect, test } from "bun:test"
import { buildGraph } from "./builder"
import type { ParsedFile } from "./parser"

describe("buildGraph", () => {
  const projectDir = "/project"

  test("creates subsystem nodes from top-level directories", () => {
    const files = new Map<string, ParsedFile>([
      [
        "/project/packages/app/src/index.ts",
        { filePath: "/project/packages/app/src/index.ts", imports: [], classes: [], functions: [], fileComment: "App entry" },
      ],
      [
        "/project/packages/sdk/src/client.ts",
        {
          filePath: "/project/packages/sdk/src/client.ts",
          imports: [{ source: "../types", names: ["Client"], typeOnly: false, line: 1 }],
          classes: [],
          functions: [{ name: "createClient", description: "", lineStart: 5, lineEnd: 20 }],
          fileComment: "",
        },
      ],
    ])

    const graph = buildGraph(projectDir, files)

    const subsystems = graph.nodes.filter((n) => n.type === "subsystem")
    expect(subsystems.length).toBeGreaterThanOrEqual(2)

    const modules = graph.nodes.filter((n) => n.type === "module")
    expect(modules.length).toBe(2)
  })

  test("creates import edges between modules", () => {
    const files = new Map<string, ParsedFile>([
      [
        "/project/src/auth.ts",
        {
          filePath: "/project/src/auth.ts",
          imports: [{ source: "./database", names: ["Database"], typeOnly: false, line: 1 }],
          classes: [],
          functions: [],
          fileComment: "",
        },
      ],
      [
        "/project/src/database.ts",
        {
          filePath: "/project/src/database.ts",
          imports: [],
          classes: [{ name: "Database", description: "", lineStart: 1, lineEnd: 50 }],
          functions: [],
          fileComment: "",
        },
      ],
    ])

    const graph = buildGraph(projectDir, files)

    const importEdges = graph.edges.filter((e) => e.type === "imports")
    expect(importEdges.length).toBeGreaterThanOrEqual(1)
    expect(importEdges[0].source).toContain("auth")
    expect(importEdges[0].target).toContain("database")
  })

  test("creates function and class nodes as children of modules", () => {
    const files = new Map<string, ParsedFile>([
      [
        "/project/src/service.ts",
        {
          filePath: "/project/src/service.ts",
          imports: [],
          classes: [{ name: "UserService", description: "Manages users", lineStart: 5, lineEnd: 50 }],
          functions: [{ name: "createUser", description: "", lineStart: 10, lineEnd: 30, parentClass: "UserService" }],
          fileComment: "",
        },
      ],
    ])

    const graph = buildGraph(projectDir, files)

    const classNode = graph.nodes.find((n) => n.type === "class" && n.label === "UserService")
    expect(classNode).toBeDefined()
    expect(classNode!.description).toBe("Manages users")

    const fnNode = graph.nodes.find((n) => n.type === "function" && n.label === "createUser")
    expect(fnNode).toBeDefined()
    expect(fnNode!.parent).toBe(classNode!.id)
  })
})
