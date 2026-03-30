// packages/opencode/src/graph/builder.test.ts
import { describe, expect, test } from "bun:test"
import { buildGraph } from "./builder"
import type { ParsedFile } from "./parser"

describe("buildGraph", () => {
  const projectDir = "/project"
  const importItem = (source: string, name: string) => ({
    source,
    names: [name],
    items: [{ imported: name, local: name }],
    typeOnly: false,
    line: 1,
  })
  const fn = (name: string, lineStart: number, lineEnd: number, parentClass?: string) => ({
    name,
    description: "",
    lineStart,
    lineEnd,
    parentClass,
    refs: [],
    branches: [],
  })

  test("creates package roots from directory hierarchy", () => {
    const files = new Map<string, ParsedFile>([
      [
        "/project/packages/app/src/index.ts",
        { filePath: "/project/packages/app/src/index.ts", imports: [], classes: [], functions: [], fileComment: "App entry" },
      ],
      [
        "/project/packages/sdk/src/client.ts",
        {
          filePath: "/project/packages/sdk/src/client.ts",
          imports: [importItem("../types", "Client")],
          classes: [],
          functions: [fn("createClient", 5, 20)],
          fileComment: "",
        },
      ],
    ])

    const graph = buildGraph(projectDir, files)

    const subsystems = graph.nodes.filter((n) => n.type === "subsystem").map((n) => n.id)
    expect(subsystems).toContain("packages/app")
    expect(subsystems).toContain("packages/sdk")

    const modules = graph.nodes.filter((n) => n.type === "module")
    expect(modules.length).toBe(2)
  })

  test("creates import edges between modules", () => {
    const files = new Map<string, ParsedFile>([
      [
        "/project/src/auth.ts",
        {
          filePath: "/project/src/auth.ts",
          imports: [importItem("./database", "Database")],
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
          functions: [fn("createUser", 10, 30, "UserService")],
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
