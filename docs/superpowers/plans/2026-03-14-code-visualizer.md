# Code Visualizer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real-time architecture visualization sidebar to the OpenCode Tauri desktop app that shows codebase structure, updates live as the AI makes changes, supports hierarchical drill-down, and lets users visually edit the graph to spawn new chat sessions.

**Architecture:** Backend static analyzer (tree-sitter) produces graph JSON, served via Hono API routes and pushed via existing WebSocket sync. Frontend SolidJS panel renders interactive SVG with Elkjs layout, integrated into the existing layout store alongside fileTree/terminal/review panels.

**Tech Stack:** TypeScript, SolidJS, Elkjs, tree-sitter (web-tree-sitter), Hono, existing OpenCode Bus/Sync infrastructure.

**Spec:** `docs/superpowers/specs/2026-03-14-code-visualizer-design.md`

**Scope:** Core visualizer only. Comment Enrichment is a separate subsystem (deferred).

---

## Chunk 1: Data Types & Static Analyzer Core

### Task 1: Graph Data Types

**Files:**
- Create: `packages/opencode/src/graph/schema.ts`
- Test: `packages/opencode/src/graph/schema.test.ts`

- [ ] **Step 1: Write the test for graph types**

```typescript
// packages/opencode/src/graph/schema.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencode && bun test src/graph/schema.test.ts`
Expected: FAIL — module `./schema` not found

- [ ] **Step 3: Implement graph types**

```typescript
// packages/opencode/src/graph/schema.ts
import z from "zod"

export const GraphNode = z.object({
  id: z.string(),
  type: z.enum(["subsystem", "module", "class", "function"]),
  label: z.string(),
  description: z.string().optional(),
  filePath: z.string(),
  lineRange: z.tuple([z.number(), z.number()]).optional(),
  children: z.array(z.string()),
  parent: z.string().optional(),
  lastModified: z.number(),
  changeState: z.enum(["added", "modified", "deleted"]).optional(),
})
export type GraphNode = z.infer<typeof GraphNode>

export const GraphEdge = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.enum(["imports", "extends", "implements", "calls", "composes"]),
  label: z.string().optional(),
})
export type GraphEdge = z.infer<typeof GraphEdge>

export const GraphDiff = z.object({
  eventId: z.string(),
  added: z.array(GraphNode),
  modified: z.array(GraphNode),
  removed: z.array(z.string()),
  edgesAdded: z.array(GraphEdge),
  edgesRemoved: z.array(z.string()),
})
export type GraphDiff = z.infer<typeof GraphDiff>

export const GraphSnapshot = z.object({
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
  eventId: z.string(),
})
export type GraphSnapshot = z.infer<typeof GraphSnapshot>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/opencode && bun test src/graph/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/graph/schema.ts packages/opencode/src/graph/schema.test.ts
git commit -m "feat(graph): add graph data types with Zod schemas"
```

---

### Task 2: File Scanner — collect project files respecting gitignore

**Files:**
- Create: `packages/opencode/src/graph/scanner.ts`
- Test: `packages/opencode/src/graph/scanner.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// packages/opencode/src/graph/scanner.test.ts
import { describe, expect, test } from "bun:test"
import { scanProjectFiles } from "./scanner"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("scanProjectFiles", () => {
  const tmp = join(tmpdir(), "graph-scanner-test-" + Date.now())

  test("collects source files, excludes node_modules and .git", async () => {
    // Setup temp project
    mkdirSync(join(tmp, "src"), { recursive: true })
    mkdirSync(join(tmp, "node_modules/pkg"), { recursive: true })
    mkdirSync(join(tmp, ".git"), { recursive: true })
    mkdirSync(join(tmp, "dist"), { recursive: true })
    writeFileSync(join(tmp, "src/index.ts"), "export const x = 1")
    writeFileSync(join(tmp, "src/utils.ts"), "export const y = 2")
    writeFileSync(join(tmp, "node_modules/pkg/index.js"), "module.exports = {}")
    writeFileSync(join(tmp, ".git/config"), "")
    writeFileSync(join(tmp, "dist/bundle.js"), "")

    const files = await scanProjectFiles(tmp)

    expect(files.some((f) => f.includes("src/index.ts"))).toBe(true)
    expect(files.some((f) => f.includes("src/utils.ts"))).toBe(true)
    expect(files.some((f) => f.includes("node_modules"))).toBe(false)
    expect(files.some((f) => f.includes(".git"))).toBe(false)
    expect(files.some((f) => f.includes("dist"))).toBe(false)

    rmSync(tmp, { recursive: true, force: true })
  })

  test("returns empty array for empty directory", async () => {
    const emptyDir = join(tmpdir(), "graph-scanner-empty-" + Date.now())
    mkdirSync(emptyDir, { recursive: true })
    const files = await scanProjectFiles(emptyDir)
    expect(files).toEqual([])
    rmSync(emptyDir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencode && bun test src/graph/scanner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement scanner**

```typescript
// packages/opencode/src/graph/scanner.ts
import { readdir, stat } from "fs/promises"
import { join, extname } from "path"

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", ".cache", "__pycache__"])

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".cpp", ".h", ".hpp", ".cs",
])

export async function scanProjectFiles(
  directory: string,
  maxFiles = 5000,
): Promise<string[]> {
  const files: string[] = []

  async function walk(dir: string) {
    if (files.length >= maxFiles) return

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) return

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name) || entry.name === ".git") continue
        await walk(join(dir, entry.name))
      } else if (entry.isFile()) {
        const ext = extname(entry.name)
        if (SOURCE_EXTENSIONS.has(ext)) {
          files.push(join(dir, entry.name))
        }
      }
    }
  }

  await walk(directory)
  return files
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/opencode && bun test src/graph/scanner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/graph/scanner.ts packages/opencode/src/graph/scanner.test.ts
git commit -m "feat(graph): add project file scanner with exclusion rules"
```

---

### Task 3: TypeScript/JavaScript Parser — extract structure from source files

**Files:**
- Create: `packages/opencode/src/graph/parser.ts`
- Test: `packages/opencode/src/graph/parser.test.ts`

This parser uses tree-sitter (already bundled as `web-tree-sitter`) to extract imports, exports, classes, functions, interfaces, and comments from TypeScript/JavaScript files. Follow the existing pattern in `packages/opencode/src/tool/bash.ts` for tree-sitter initialization.

- [ ] **Step 1: Write the test**

```typescript
// packages/opencode/src/graph/parser.test.ts
import { describe, expect, test } from "bun:test"
import { parseFile, type ParsedFile } from "./parser"
import { writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("parseFile", () => {
  const tmp = join(tmpdir(), "graph-parser-test-" + Date.now())

  test("extracts imports, exports, classes, and functions from TypeScript", async () => {
    mkdirSync(tmp, { recursive: true })
    const filePath = join(tmp, "example.ts")
    writeFileSync(
      filePath,
      `
/** Auth service for token validation */
import { Database } from "./database"
import type { User } from "./types"

export class AuthService {
  /** Validates a JWT token and returns the user */
  async validateToken(token: string): Promise<User> {
    return {} as User
  }
}

export function createAuth(db: Database): AuthService {
  return new AuthService()
}
`,
    )

    const result = await parseFile(filePath)

    // Should find imports
    expect(result.imports).toContainEqual(
      expect.objectContaining({ source: "./database" }),
    )
    expect(result.imports).toContainEqual(
      expect.objectContaining({ source: "./types" }),
    )

    // Should find class with description from JSDoc
    const cls = result.classes.find((c) => c.name === "AuthService")
    expect(cls).toBeDefined()
    expect(cls!.description).toContain("Auth service")

    // Should find functions
    const fn = result.functions.find((f) => f.name === "createAuth")
    expect(fn).toBeDefined()

    // Should find methods inside classes
    const method = result.functions.find((f) => f.name === "validateToken")
    expect(method).toBeDefined()
    expect(method!.description).toContain("Validates a JWT token")

    // Should find file-level comment
    expect(result.fileComment).toContain("Auth service")

    rmSync(tmp, { recursive: true, force: true })
  })

  test("handles file with no exports gracefully", async () => {
    mkdirSync(tmp, { recursive: true })
    const filePath = join(tmp, "empty.ts")
    writeFileSync(filePath, "const x = 1\n")

    const result = await parseFile(filePath)
    expect(result.imports).toEqual([])
    expect(result.classes).toEqual([])

    rmSync(tmp, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencode && bun test src/graph/parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement parser**

Reference `packages/opencode/src/tool/bash.ts` lines 33-51 for the tree-sitter initialization pattern. The parser needs to load the TypeScript grammar WASM. Check `packages/opencode/parsers-config.ts` for available grammar URLs.

```typescript
// packages/opencode/src/graph/parser.ts
import { readFile } from "fs/promises"
import { lazy } from "@/util/lazy"

export type ParsedImport = {
  source: string
  names: string[]
  isTypeOnly: boolean
}

export type ParsedClass = {
  name: string
  description?: string
  lineRange: [number, number]
  extends?: string
  implements?: string[]
}

export type ParsedFunction = {
  name: string
  description?: string
  lineRange: [number, number]
  parentClass?: string
}

export type ParsedFile = {
  imports: ParsedImport[]
  classes: ParsedClass[]
  functions: ParsedFunction[]
  fileComment?: string
}

const initParser = lazy(async () => {
  const { default: Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm")
  const treePath = typeof treeWasm === "string" ? treeWasm : treeWasm.default ?? treeWasm
  await Parser.init({ locateFile: () => treePath })
  // Load TypeScript grammar
  const tsWasmUrl =
    "https://github.com/nicolo-ribaudo/tree-sitter-typescript/releases/download/v0.25.4/tree-sitter-typescript.wasm"
  const response = await fetch(tsWasmUrl)
  const wasmBuffer = await response.arrayBuffer()
  const tsLanguage = await Parser.Language.load(new Uint8Array(wasmBuffer))
  const parser = new Parser()
  parser.setLanguage(tsLanguage)
  return parser
})

function extractComment(node: any): string | undefined {
  let sibling = node.previousNamedSibling
  if (sibling && sibling.type === "comment") {
    const text = sibling.text
    // Strip /** */ or // markers
    return text
      .replace(/^\/\*\*?\s*/, "")
      .replace(/\s*\*\/$/, "")
      .replace(/^\s*\*\s?/gm, "")
      .replace(/^\/\/\s?/, "")
      .trim()
  }
  return undefined
}

export async function parseFile(filePath: string): Promise<ParsedFile> {
  const content = await readFile(filePath, "utf-8")
  const parser = await initParser()
  const tree = parser.parse(content)
  const root = tree.rootNode

  const imports: ParsedImport[] = []
  const classes: ParsedClass[] = []
  const functions: ParsedFunction[] = []
  let fileComment: string | undefined

  // Extract file-level comment (first comment in file)
  const firstChild = root.firstChild
  if (firstChild && firstChild.type === "comment") {
    fileComment = firstChild.text
      .replace(/^\/\*\*?\s*/, "")
      .replace(/\s*\*\/$/, "")
      .replace(/^\s*\*\s?/gm, "")
      .replace(/^\/\/\s?/, "")
      .trim()
  }

  // Walk AST
  function walk(node: any, parentClassName?: string) {
    switch (node.type) {
      case "import_statement": {
        const sourceNode = node.descendantsOfType("string")[0]
        const source = sourceNode?.text?.replace(/['"]/g, "") ?? ""
        const isTypeOnly = node.text.includes("import type")
        const names: string[] = []
        for (const spec of node.descendantsOfType("import_specifier")) {
          names.push(spec.descendantsOfType("identifier")[0]?.text ?? "")
        }
        if (source) imports.push({ source, names: names.filter(Boolean), isTypeOnly })
        break
      }

      case "class_declaration":
      case "export_statement": {
        if (node.type === "export_statement") {
          // Check if it exports a class or function
          for (let i = 0; i < node.childCount; i++) {
            walk(node.child(i), parentClassName)
          }
          return
        }

        const nameNode = node.childForFieldName("name")
        if (!nameNode) break
        const name = nameNode.text
        const description = extractComment(node)

        const heritage = node.descendantsOfType("extends_clause")[0]
        const extendsName = heritage?.descendantsOfType("identifier")[0]?.text

        classes.push({
          name,
          description: description ?? fileComment,
          lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
          extends: extendsName,
        })

        // Walk class body for methods
        const body = node.childForFieldName("body")
        if (body) {
          for (let i = 0; i < body.childCount; i++) {
            walk(body.child(i), name)
          }
        }
        break
      }

      case "function_declaration":
      case "method_definition": {
        const nameNode = node.childForFieldName("name")
        if (!nameNode) break
        functions.push({
          name: nameNode.text,
          description: extractComment(node),
          lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
          parentClass: parentClassName,
        })
        break
      }

      default: {
        for (let i = 0; i < node.childCount; i++) {
          walk(node.child(i), parentClassName)
        }
      }
    }
  }

  walk(root)
  return { imports, classes, functions, fileComment }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/opencode && bun test src/graph/parser.test.ts`
Expected: PASS (may need network to download WASM on first run)

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/graph/parser.ts packages/opencode/src/graph/parser.test.ts
git commit -m "feat(graph): add tree-sitter TypeScript parser for structure extraction"
```

---

### Task 4: Graph Builder — assemble parsed files into graph nodes and edges

**Files:**
- Create: `packages/opencode/src/graph/builder.ts`
- Test: `packages/opencode/src/graph/builder.test.ts`

- [ ] **Step 1: Write the test**

```typescript
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
        { imports: [], classes: [], functions: [], fileComment: "App entry" },
      ],
      [
        "/project/packages/sdk/src/client.ts",
        {
          imports: [{ source: "../types", names: ["Client"], isTypeOnly: false }],
          classes: [],
          functions: [{ name: "createClient", lineRange: [5, 20] }],
        },
      ],
    ])

    const graph = buildGraph(projectDir, files)

    // Should have subsystem nodes for packages/app and packages/sdk
    const subsystems = graph.nodes.filter((n) => n.type === "subsystem")
    expect(subsystems.length).toBeGreaterThanOrEqual(2)

    // Should have module nodes for the files
    const modules = graph.nodes.filter((n) => n.type === "module")
    expect(modules.length).toBe(2)
  })

  test("creates import edges between modules", () => {
    const files = new Map<string, ParsedFile>([
      [
        "/project/src/auth.ts",
        {
          imports: [{ source: "./database", names: ["Database"], isTypeOnly: false }],
          classes: [],
          functions: [],
        },
      ],
      [
        "/project/src/database.ts",
        { imports: [], classes: [{ name: "Database", lineRange: [1, 50] }], functions: [] },
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
          imports: [],
          classes: [{ name: "UserService", description: "Manages users", lineRange: [5, 50] }],
          functions: [{ name: "createUser", lineRange: [10, 30], parentClass: "UserService" }],
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencode && bun test src/graph/builder.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement builder**

```typescript
// packages/opencode/src/graph/builder.ts
import { relative, dirname, resolve, join } from "path"
import type { GraphNode, GraphEdge, GraphSnapshot } from "./schema"
import type { ParsedFile } from "./parser"

function makeModuleId(projectDir: string, filePath: string): string {
  return relative(projectDir, filePath)
}

function makeSubsystemId(projectDir: string, filePath: string): string {
  const rel = relative(projectDir, filePath)
  // Group by first two path segments (e.g. "packages/app")
  const parts = rel.split("/")
  if (parts.length >= 2) return parts.slice(0, 2).join("/")
  return parts[0]
}

function resolveImportPath(fromFile: string, importSource: string, allFiles: Set<string>): string | undefined {
  if (!importSource.startsWith(".")) return undefined // skip external packages
  const dir = dirname(fromFile)
  const candidates = [
    resolve(dir, importSource),
    resolve(dir, importSource + ".ts"),
    resolve(dir, importSource + ".tsx"),
    resolve(dir, importSource + "/index.ts"),
    resolve(dir, importSource + "/index.tsx"),
    resolve(dir, importSource + ".js"),
    resolve(dir, importSource + ".jsx"),
    resolve(dir, importSource + "/index.js"),
  ]
  return candidates.find((c) => allFiles.has(c))
}

export function buildGraph(
  projectDir: string,
  files: Map<string, ParsedFile>,
): GraphSnapshot {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const subsystems = new Map<string, { files: string[]; label: string }>()
  const allFilePaths = new Set(files.keys())
  const now = Date.now()

  // Collect subsystems
  for (const filePath of files.keys()) {
    const subsystemId = makeSubsystemId(projectDir, filePath)
    if (!subsystems.has(subsystemId)) {
      subsystems.set(subsystemId, { files: [], label: subsystemId.split("/").pop() ?? subsystemId })
    }
    subsystems.get(subsystemId)!.files.push(filePath)
  }

  // Create subsystem nodes
  for (const [id, info] of subsystems) {
    nodes.push({
      id,
      type: "subsystem",
      label: info.label,
      filePath: join(projectDir, id),
      children: info.files.map((f) => makeModuleId(projectDir, f)),
      lastModified: now,
    })
  }

  // Create module, class, and function nodes
  for (const [filePath, parsed] of files) {
    const moduleId = makeModuleId(projectDir, filePath)
    const subsystemId = makeSubsystemId(projectDir, filePath)
    const children: string[] = []

    // Class nodes
    for (const cls of parsed.classes) {
      const classId = `${moduleId}::${cls.name}`
      const classChildren: string[] = []

      // Method nodes (functions with parentClass)
      for (const fn of parsed.functions) {
        if (fn.parentClass === cls.name) {
          const fnId = `${classId}::${fn.name}`
          classChildren.push(fnId)
          nodes.push({
            id: fnId,
            type: "function",
            label: fn.name,
            description: fn.description,
            filePath,
            lineRange: fn.lineRange,
            children: [],
            parent: classId,
            lastModified: now,
          })
        }
      }

      children.push(classId)
      nodes.push({
        id: classId,
        type: "class",
        label: cls.name,
        description: cls.description,
        filePath,
        lineRange: cls.lineRange,
        children: classChildren,
        parent: moduleId,
        lastModified: now,
      })

      // Extends edge
      if (cls.extends) {
        // Find the target class node
        for (const [otherPath, otherParsed] of files) {
          const match = otherParsed.classes.find((c) => c.name === cls.extends)
          if (match) {
            const targetId = `${makeModuleId(projectDir, otherPath)}::${match.name}`
            edges.push({
              id: `${classId}->extends->${targetId}`,
              source: classId,
              target: targetId,
              type: "extends",
            })
            break
          }
        }
      }
    }

    // Top-level function nodes (no parentClass)
    for (const fn of parsed.functions) {
      if (!fn.parentClass) {
        const fnId = `${moduleId}::${fn.name}`
        children.push(fnId)
        nodes.push({
          id: fnId,
          type: "function",
          label: fn.name,
          description: fn.description,
          filePath,
          lineRange: fn.lineRange,
          children: [],
          parent: moduleId,
          lastModified: now,
        })
      }
    }

    // Module node
    nodes.push({
      id: moduleId,
      type: "module",
      label: filePath.split("/").pop() ?? moduleId,
      description: parsed.fileComment,
      filePath,
      children,
      parent: subsystemId,
      lastModified: now,
    })

    // Import edges
    for (const imp of parsed.imports) {
      const targetPath = resolveImportPath(filePath, imp.source, allFilePaths)
      if (targetPath) {
        const targetId = makeModuleId(projectDir, targetPath)
        const edgeId = `${moduleId}->imports->${targetId}`
        edges.push({
          id: edgeId,
          source: moduleId,
          target: targetId,
          type: "imports",
        })
      }
    }
  }

  return {
    nodes,
    edges,
    eventId: `scan_${now}`,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/opencode && bun test src/graph/builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/graph/builder.ts packages/opencode/src/graph/builder.test.ts
git commit -m "feat(graph): add graph builder to assemble nodes and edges from parsed files"
```

---

### Task 5: GraphAnalyzer Singleton — orchestrates scanning, parsing, diffing

**Files:**
- Create: `packages/opencode/src/graph/analyzer.ts`
- Test: `packages/opencode/src/graph/analyzer.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// packages/opencode/src/graph/analyzer.test.ts
import { describe, expect, test } from "bun:test"
import { GraphAnalyzer } from "./analyzer"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("GraphAnalyzer", () => {
  const tmp = join(tmpdir(), "graph-analyzer-test-" + Date.now())

  test("initialScan produces a valid snapshot", async () => {
    mkdirSync(join(tmp, "src"), { recursive: true })
    writeFileSync(
      join(tmp, "src/index.ts"),
      `import { helper } from "./utils"\nexport function main() { helper() }\n`,
    )
    writeFileSync(
      join(tmp, "src/utils.ts"),
      `export function helper() { return 1 }\n`,
    )

    const analyzer = new GraphAnalyzer(tmp)
    const snapshot = await analyzer.initialScan()

    expect(snapshot.nodes.length).toBeGreaterThan(0)
    expect(snapshot.edges.length).toBeGreaterThan(0)
    expect(snapshot.eventId).toBeDefined()

    rmSync(tmp, { recursive: true, force: true })
  })

  test("onFilesChanged returns a diff with modified nodes", async () => {
    const tmp2 = join(tmpdir(), "graph-analyzer-diff-" + Date.now())
    mkdirSync(join(tmp2, "src"), { recursive: true })
    writeFileSync(join(tmp2, "src/index.ts"), `export function main() {}\n`)

    const analyzer = new GraphAnalyzer(tmp2)
    await analyzer.initialScan()

    // Modify the file
    writeFileSync(
      join(tmp2, "src/index.ts"),
      `export function main() {}\nexport function newFn() {}\n`,
    )

    const diff = await analyzer.onFilesChanged([join(tmp2, "src/index.ts")])

    expect(diff).toBeDefined()
    if (diff) {
      // Should detect the new function
      const hasNewFn =
        diff.added.some((n) => n.label === "newFn") ||
        diff.modified.some((n) => n.id.includes("index.ts"))
      expect(hasNewFn).toBe(true)
    }

    rmSync(tmp2, { recursive: true, force: true })
  })

  test("getNodeDetail returns children for a subsystem", async () => {
    const tmp3 = join(tmpdir(), "graph-analyzer-detail-" + Date.now())
    mkdirSync(join(tmp3, "src"), { recursive: true })
    writeFileSync(join(tmp3, "src/a.ts"), `export const a = 1\n`)
    writeFileSync(join(tmp3, "src/b.ts"), `export const b = 2\n`)

    const analyzer = new GraphAnalyzer(tmp3)
    await analyzer.initialScan()

    const detail = analyzer.getNodeDetail("src")
    expect(detail).toBeDefined()
    expect(detail!.children.length).toBe(2)

    rmSync(tmp3, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencode && bun test src/graph/analyzer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement analyzer**

```typescript
// packages/opencode/src/graph/analyzer.ts
import { scanProjectFiles } from "./scanner"
import { parseFile, type ParsedFile } from "./parser"
import { buildGraph } from "./builder"
import type { GraphNode, GraphEdge, GraphDiff, GraphSnapshot } from "./schema"

export class GraphAnalyzer {
  private directory: string
  private currentSnapshot: GraphSnapshot | null = null
  private parsedFiles = new Map<string, ParsedFile>()
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private pendingPaths: Set<string> = new Set()
  private eventCounter = 0
  private diffListeners: Array<(diff: GraphDiff) => void> = []

  constructor(directory: string) {
    this.directory = directory
  }

  async initialScan(): Promise<GraphSnapshot> {
    const files = await scanProjectFiles(this.directory)
    this.parsedFiles.clear()

    await Promise.all(
      files.map(async (filePath) => {
        try {
          const parsed = await parseFile(filePath)
          this.parsedFiles.set(filePath, parsed)
        } catch {
          // Skip unparseable files
        }
      }),
    )

    this.currentSnapshot = buildGraph(this.directory, this.parsedFiles)
    return this.currentSnapshot
  }

  async onFilesChanged(paths: string[]): Promise<GraphDiff | undefined> {
    for (const p of paths) this.pendingPaths.add(p)

    if (this.debounceTimer) clearTimeout(this.debounceTimer)

    return new Promise((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        const changedPaths = [...this.pendingPaths]
        this.pendingPaths.clear()
        const diff = await this.processChanges(changedPaths)
        if (diff) {
          for (const listener of this.diffListeners) listener(diff)
        }
        resolve(diff)
      }, 100)
    })
  }

  private async processChanges(paths: string[]): Promise<GraphDiff | undefined> {
    if (!this.currentSnapshot) return undefined

    const oldNodes = new Map(this.currentSnapshot.nodes.map((n) => [n.id, n]))
    const oldEdges = new Map(this.currentSnapshot.edges.map((e) => [e.id, e]))

    // Re-parse changed files
    for (const filePath of paths) {
      try {
        const parsed = await parseFile(filePath)
        this.parsedFiles.set(filePath, parsed)
      } catch {
        this.parsedFiles.delete(filePath)
      }
    }

    // Rebuild full graph
    const newSnapshot = buildGraph(this.directory, this.parsedFiles)
    const newNodes = new Map(newSnapshot.nodes.map((n) => [n.id, n]))
    const newEdges = new Map(newSnapshot.edges.map((e) => [e.id, e]))

    // Compute diff
    const added: GraphNode[] = []
    const modified: GraphNode[] = []
    const removed: string[] = []
    const edgesAdded: GraphEdge[] = []
    const edgesRemoved: string[] = []

    for (const [id, node] of newNodes) {
      if (!oldNodes.has(id)) {
        added.push({ ...node, changeState: "added" })
      } else {
        const old = oldNodes.get(id)!
        if (
          old.label !== node.label ||
          old.description !== node.description ||
          old.children.length !== node.children.length
        ) {
          modified.push({ ...node, changeState: "modified" })
        }
      }
    }

    for (const id of oldNodes.keys()) {
      if (!newNodes.has(id)) removed.push(id)
    }

    for (const [id, edge] of newEdges) {
      if (!oldEdges.has(id)) edgesAdded.push(edge)
    }

    for (const id of oldEdges.keys()) {
      if (!newEdges.has(id)) edgesRemoved.push(id)
    }

    this.eventCounter++
    const eventId = `diff_${this.eventCounter}_${Date.now()}`

    this.currentSnapshot = { ...newSnapshot, eventId }

    if (added.length === 0 && modified.length === 0 && removed.length === 0 && edgesAdded.length === 0 && edgesRemoved.length === 0) {
      return undefined
    }

    return { eventId, added, modified, removed, edgesAdded, edgesRemoved }
  }

  getSnapshot(): GraphSnapshot | null {
    return this.currentSnapshot
  }

  getNodeDetail(nodeId: string): { node: GraphNode; children: GraphNode[] } | undefined {
    if (!this.currentSnapshot) return undefined
    const node = this.currentSnapshot.nodes.find((n) => n.id === nodeId)
    if (!node) return undefined
    const children = this.currentSnapshot.nodes.filter((n) => node.children.includes(n.id))
    return { node, children }
  }

  onDiff(listener: (diff: GraphDiff) => void): () => void {
    this.diffListeners.push(listener)
    return () => {
      this.diffListeners = this.diffListeners.filter((l) => l !== listener)
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/opencode && bun test src/graph/analyzer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/graph/analyzer.ts packages/opencode/src/graph/analyzer.test.ts
git commit -m "feat(graph): add GraphAnalyzer singleton with scan, diff, and drill-down"
```

---

## Chunk 2: Graph API Routes & Tool Pipeline Hook

### Task 6: Graph API Routes

**Files:**
- Create: `packages/opencode/src/server/routes/graph.ts`
- Modify: `packages/opencode/src/server/server.ts:243-253` (add `.route("/graph", GraphRoutes())`)

- [ ] **Step 1: Create graph routes**

```typescript
// packages/opencode/src/server/routes/graph.ts
import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { GraphAnalyzer } from "../../graph/analyzer"
import { GraphSnapshot, GraphDiff, GraphNode } from "../../graph/schema"
import { Instance } from "../../project/instance"
import { errors } from "../error"

const analyzers = new Map<string, GraphAnalyzer>()

export function getAnalyzer(directory: string): GraphAnalyzer {
  if (!analyzers.has(directory)) {
    analyzers.set(directory, new GraphAnalyzer(directory))
  }
  return analyzers.get(directory)!
}

export const GraphRoutes = () =>
  new Hono()
    .get(
      "/architecture",
      describeRoute({
        summary: "Get architecture graph",
        description: "Returns the full architecture graph for the current project",
        operationId: "graph.architecture",
        responses: {
          200: {
            description: "Architecture graph snapshot",
            content: { "application/json": { schema: resolver(GraphSnapshot) } },
          },
          ...errors(500),
        },
      }),
      async (c) => {
        const directory = Instance.directory
        const analyzer = getAnalyzer(directory)
        let snapshot = analyzer.getSnapshot()
        if (!snapshot) {
          snapshot = await analyzer.initialScan()
        }
        return c.json(snapshot)
      },
    )
    .get(
      "/node/:id",
      describeRoute({
        summary: "Get node detail",
        description: "Returns a node and its children for drill-down",
        operationId: "graph.nodeDetail",
        responses: {
          200: {
            description: "Node with children",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    node: GraphNode,
                    children: z.array(GraphNode),
                  }),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const { id } = c.req.valid("param")
        const directory = Instance.directory
        const analyzer = getAnalyzer(directory)
        const detail = analyzer.getNodeDetail(decodeURIComponent(id))
        if (!detail) {
          return c.json({ error: "Node not found" }, 404)
        }
        return c.json(detail)
      },
    )
    .get(
      "/diff",
      describeRoute({
        summary: "Get graph diff",
        description: "Returns changes since a given event ID",
        operationId: "graph.diff",
        responses: {
          200: {
            description: "Graph diff or null if no changes",
            content: { "application/json": { schema: resolver(GraphDiff.nullable()) } },
          },
        },
      }),
      validator("query", z.object({ since: z.string().optional() })),
      async (c) => {
        // For now, return null — diffs are pushed via WebSocket
        return c.json(null)
      },
    )
```

- [ ] **Step 2: Register routes in server.ts**

Add to `packages/opencode/src/server/server.ts`:
- Add import: `import { GraphRoutes } from "./routes/graph"`
- Add route registration after line 252 (after `.route("/mcp", McpRoutes())`):
  `.route("/graph", GraphRoutes())`

- [ ] **Step 3: Run the server to verify routes load**

Run: `cd packages/opencode && bun run build` (or type-check)
Expected: No compilation errors

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/server/routes/graph.ts packages/opencode/src/server/server.ts
git commit -m "feat(graph): add /graph API routes for architecture, node detail, and diff"
```

---

### Task 7: Tool Pipeline Hook — emit file-changed events

**Files:**
- Modify: `packages/opencode/src/tool/write.ts:44-51` (add GraphAnalyzer call after Bus.publish)
- Modify: `packages/opencode/src/tool/edit.ts:73-80,110-117` (add GraphAnalyzer call after Bus.publish)

- [ ] **Step 1: Add hook to write tool**

In `packages/opencode/src/tool/write.ts`, after the existing `Bus.publish(FileWatcher.Event.Updated, ...)` call (around line 50), add:

```typescript
import { getAnalyzer } from "../server/routes/graph"
import { Instance } from "../project/instance"

// After Bus.publish(FileWatcher.Event.Updated, ...) line:
getAnalyzer(Instance.directory).onFilesChanged([filepath]).catch(() => {})
```

- [ ] **Step 2: Add hook to edit tool**

In `packages/opencode/src/tool/edit.ts`, after both `Bus.publish(FileWatcher.Event.Updated, ...)` calls (around lines 79 and 116), add the same pattern:

```typescript
import { getAnalyzer } from "../server/routes/graph"
import { Instance } from "../project/instance"

// After each Bus.publish(FileWatcher.Event.Updated, ...) line:
getAnalyzer(Instance.directory).onFilesChanged([filePath]).catch(() => {})
```

- [ ] **Step 3: Add hook to bash tool**

In `packages/opencode/src/tool/bash.ts`, the bash tool needs to compare mtimes before and after execution. Find the `execute` method and wrap the command execution:

```typescript
import { getAnalyzer } from "../server/routes/graph"
import { Instance } from "../project/instance"
import { stat } from "fs/promises"

// Before command execution — capture mtimes of watchlist files:
const analyzer = getAnalyzer(Instance.directory)
const watchlist = analyzer.getWatchlist() // returns string[] of tracked file paths
const mtimesBefore = new Map<string, number>()
for (const f of watchlist.slice(0, 200)) { // cap to avoid slow stat calls
  try {
    const s = await stat(f)
    mtimesBefore.set(f, s.mtimeMs)
  } catch {}
}

// ... existing command execution ...

// After command execution — check which files changed:
const changedFiles: string[] = []
for (const [f, mtime] of mtimesBefore) {
  try {
    const s = await stat(f)
    if (s.mtimeMs !== mtime) changedFiles.push(f)
  } catch {}
}
if (changedFiles.length > 0) {
  analyzer.onFilesChanged(changedFiles).catch(() => {})
}
```

Also add a `getWatchlist()` method to the `GraphAnalyzer` class in `packages/opencode/src/graph/analyzer.ts`:

```typescript
getWatchlist(): string[] {
  return [...this.parsedFiles.keys()]
}
```

And add a test for it in `packages/opencode/src/graph/analyzer.test.ts`:

```typescript
test("getWatchlist returns parsed file paths", async () => {
  const tmp4 = join(tmpdir(), "graph-analyzer-watchlist-" + Date.now())
  mkdirSync(join(tmp4, "src"), { recursive: true })
  writeFileSync(join(tmp4, "src/a.ts"), `export const a = 1\n`)
  writeFileSync(join(tmp4, "src/b.ts"), `export const b = 2\n`)

  const analyzer = new GraphAnalyzer(tmp4)
  await analyzer.initialScan()

  const watchlist = analyzer.getWatchlist()
  expect(watchlist.length).toBe(2)
  expect(watchlist.some((f) => f.includes("a.ts"))).toBe(true)

  rmSync(tmp4, { recursive: true, force: true })
})
```

Note: when adding imports to tool files (write.ts, edit.ts, bash.ts), check if `Instance` is already imported — only add the import if missing. `getAnalyzer` is always a new import.

- [ ] **Step 4: Verify build passes**

Run: `cd packages/opencode && bun run build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/tool/write.ts packages/opencode/src/tool/edit.ts packages/opencode/src/tool/bash.ts packages/opencode/src/graph/analyzer.ts
git commit -m "feat(graph): hook write/edit/bash tools to trigger graph re-parse"
```

---

### Task 8: SSE Graph Events — push diffs to frontend

**Note:** The spec mentions using the existing WebSocket sync channel. This plan uses a dedicated SSE endpoint instead because: (1) the existing sync system is tightly coupled to session/message data structures, (2) SSE is simpler for one-way server→client streaming, (3) it avoids modifying the complex SyncProvider. The graph data flows through `/graph/subscribe` SSE, not the WebSocket sync channel. The `/graph/diff` GET endpoint (Task 6) is kept as a fallback for clients that miss SSE events.

**Files:**
- Modify: `packages/opencode/src/server/routes/graph.ts` (add WS diff broadcasting)

The existing server uses SSE (Server-Sent Events) via `streamSSE` from `hono/streaming`. Check how existing events are pushed to the frontend via the sync system. The graph diff listener should push events through the same channel.

- [ ] **Step 1: Add diff broadcasting to graph route**

Add a `/subscribe` SSE endpoint to the graph routes that streams diffs in real-time:

```typescript
// Add to packages/opencode/src/server/routes/graph.ts
import { streamSSE } from "hono/streaming"

// Add to the Hono chain:
.get("/subscribe", async (c) => {
  const directory = Instance.directory
  const analyzer = getAnalyzer(directory)

  // Ensure initial scan is done
  if (!analyzer.getSnapshot()) {
    await analyzer.initialScan()
  }

  return streamSSE(c, async (stream) => {
    const unsubscribe = analyzer.onDiff((diff) => {
      stream.writeSSE({
        event: "graph:diff",
        data: JSON.stringify(diff),
      })
    })

    // Send initial snapshot as first event
    const snapshot = analyzer.getSnapshot()
    if (snapshot) {
      await stream.writeSSE({
        event: "graph:snapshot",
        data: JSON.stringify(snapshot),
      })
    }

    // Keep alive
    const keepAlive = setInterval(() => {
      stream.writeSSE({ event: "ping", data: "" }).catch(() => {
        clearInterval(keepAlive)
      })
    }, 30000)

    stream.onAbort(() => {
      unsubscribe()
      clearInterval(keepAlive)
    })
  })
})
```

- [ ] **Step 2: Verify build passes**

Run: `cd packages/opencode && bun run build`
Expected: No errors

- [ ] **Step 3: Manual verification of SSE endpoint**

Start the dev server and verify the SSE stream works:

```bash
# In one terminal, start the server:
cd packages/opencode && bun run dev

# In another terminal, curl the SSE endpoint:
curl -N "http://localhost:3000/graph/subscribe?directory=$(pwd)" \
  -H "Accept: text/event-stream"
```

Expected: Should receive an `event: graph:snapshot` with JSON data containing `nodes` and `edges` arrays. The connection should stay open.

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/server/routes/graph.ts
git commit -m "feat(graph): add SSE /graph/subscribe endpoint for real-time diff streaming"
```

---

## Chunk 3: Frontend — Graph State Store & SDK Client

### Task 9: Add elkjs dependency

**Files:**
- Modify: `packages/app/package.json` (add elkjs)

- [ ] **Step 1: Install elkjs**

Run: `cd packages/app && bun add elkjs`

- [ ] **Step 2: Verify installation**

Run: `cd packages/app && bun run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/app/package.json bun.lockb
git commit -m "feat(graph): add elkjs dependency for graph layout computation"
```

---

### Task 10: Graph Types (Frontend)

**Files:**
- Create: `packages/app/src/context/graph/types.ts`

- [ ] **Step 1: Create frontend graph types**

```typescript
// packages/app/src/context/graph/types.ts
export type GraphNode = {
  id: string
  type: "subsystem" | "module" | "class" | "function"
  label: string
  description?: string
  filePath: string
  lineRange?: [number, number]
  children: string[]
  parent?: string
  lastModified: number
  changeState?: "added" | "modified" | "deleted"
}

export type GraphEdge = {
  id: string
  source: string
  target: string
  type: "imports" | "extends" | "implements" | "calls" | "composes"
  label?: string
}

export type GraphDiff = {
  eventId: string
  added: GraphNode[]
  modified: GraphNode[]
  removed: string[]
  edgesAdded: GraphEdge[]
  edgesRemoved: string[]
}

export type GraphSnapshot = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  eventId: string
}

export type Position = {
  x: number
  y: number
  width: number
  height: number
}

export type Annotation = {
  id: string
  nodeId: string
  text: string
  position: { x: number; y: number }
}

export type VisualEdit = {
  type: "connect" | "disconnect" | "annotate" | "move" | "rename"
  subject: string
  target?: string
  text?: string
  compiledPrompt: string
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/context/graph/types.ts
git commit -m "feat(graph): add frontend graph types"
```

---

### Task 11: Graph State Store

**Files:**
- Create: `packages/app/src/context/graph/store.ts`
- Test: `packages/app/src/context/graph/store.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// packages/app/src/context/graph/store.test.ts
import { describe, expect, test } from "bun:test"
import { applyDiff, applySnapshot } from "./store"
import type { GraphNode, GraphEdge, GraphDiff, GraphSnapshot } from "./types"

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && bun test src/context/graph/store.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement store helpers**

```typescript
// packages/app/src/context/graph/store.ts
import type { GraphNode, GraphEdge, GraphDiff, GraphSnapshot } from "./types"

export type GraphStoreState = {
  nodes: Record<string, GraphNode>
  edges: GraphEdge[]
  eventId: string
}

export function applySnapshot(snapshot: GraphSnapshot): GraphStoreState {
  const nodes: Record<string, GraphNode> = {}
  for (const node of snapshot.nodes) {
    nodes[node.id] = node
  }
  return {
    nodes,
    edges: snapshot.edges,
    eventId: snapshot.eventId,
  }
}

export function applyDiff(
  state: GraphStoreState,
  diff: GraphDiff,
): GraphStoreState {
  const nodes = { ...state.nodes }

  // Add new nodes
  for (const node of diff.added) {
    nodes[node.id] = node
  }

  // Update modified nodes
  for (const node of diff.modified) {
    nodes[node.id] = node
  }

  // Remove deleted nodes
  for (const id of diff.removed) {
    delete nodes[id]
  }

  // Update edges
  const removedEdgeSet = new Set(diff.edgesRemoved)
  const edges = state.edges
    .filter((e) => !removedEdgeSet.has(e.id))
    .concat(diff.edgesAdded)

  return {
    nodes,
    edges,
    eventId: diff.eventId,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && bun test src/context/graph/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/context/graph/store.ts packages/app/src/context/graph/store.test.ts
git commit -m "feat(graph): add graph store helpers with snapshot and diff application"
```

---

### Task 12: Elkjs Layout Worker

**Files:**
- Create: `packages/app/src/context/graph/layout.ts`

- [ ] **Step 1: Implement Elkjs layout computation**

```typescript
// packages/app/src/context/graph/layout.ts
import ELK from "elkjs/lib/elk-worker"
import type { GraphNode, GraphEdge, Position } from "./types"

// elkjs/lib/elk-worker runs layout computation in a Web Worker
// to avoid blocking the main UI thread
const elk = new ELK()

export async function computeLayout(
  nodes: Record<string, GraphNode>,
  edges: GraphEdge[],
  focusedNode?: string,
): Promise<Record<string, Position>> {
  // Filter to nodes at the current view level
  const visibleNodes = Object.values(nodes).filter((n) => {
    if (!focusedNode) return !n.parent // top level = subsystems
    return n.parent === focusedNode
  })

  if (visibleNodes.length === 0) return {}

  // Filter edges to only those connecting visible nodes
  const visibleIds = new Set(visibleNodes.map((n) => n.id))
  const visibleEdges = edges.filter(
    (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
  )

  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "60",
      "elk.padding": "[top=20,left=20,bottom=20,right=20]",
    },
    children: visibleNodes.map((node) => ({
      id: node.id,
      width: nodeWidth(node),
      height: nodeHeight(node),
    })),
    edges: visibleEdges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  }

  const layout = await elk.layout(graph)
  const positions: Record<string, Position> = {}

  for (const child of layout.children ?? []) {
    positions[child.id] = {
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? nodeWidth(nodes[child.id]),
      height: child.height ?? nodeHeight(nodes[child.id]),
    }
  }

  return positions
}

function nodeWidth(node: GraphNode): number {
  const labelLen = node.label.length
  switch (node.type) {
    case "subsystem":
      return Math.max(160, labelLen * 9 + 40)
    case "module":
      return Math.max(140, labelLen * 8 + 30)
    case "class":
      return Math.max(120, labelLen * 8 + 30)
    case "function":
      return Math.max(100, labelLen * 7 + 20)
  }
}

function nodeHeight(node: GraphNode): number {
  switch (node.type) {
    case "subsystem":
      return 60
    case "module":
      return 50
    case "class":
      return 50
    case "function":
      return 40
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/context/graph/layout.ts
git commit -m "feat(graph): add Elkjs layout computation for graph positioning"
```

---

### Task 13: Graph Context Provider

**Files:**
- Create: `packages/app/src/context/graph/index.tsx`

This context provider connects to the `/graph/subscribe` SSE endpoint, manages the graph store, computes layout with Elkjs, and exposes reactive state to the visualizer panel.

- [ ] **Step 1: Implement graph context**

```typescript
// packages/app/src/context/graph/index.tsx
import { createStore, produce } from "solid-js/store"
import { createEffect, onCleanup, createMemo, batch } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "@/context/sdk"
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
      const url = `${sdk.baseUrl}/graph/subscribe?directory=${encodeURIComponent(sdk.directory)}`
      eventSource = new EventSource(url)

      eventSource.addEventListener("graph:snapshot", (e) => {
        const snapshot: GraphSnapshot = JSON.parse(e.data)
        const state = applySnapshot(snapshot)
        batch(() => {
          setStore("graph", state)
          setStore("connected", true)
          setStore("error", undefined)
        })
        recomputeLayout(state)
      })

      eventSource.addEventListener("graph:diff", (e) => {
        const diff: GraphDiff = JSON.parse(e.data)
        setStore(
          produce((s) => {
            if (s.graph) {
              const next = applyDiff(s.graph, diff)
              s.graph = next
            }
          }),
        )
        if (store.graph) recomputeLayout(store.graph)
      })

      eventSource.onerror = () => {
        setStore("connected", false)
      }
    }

    async function recomputeLayout(state: GraphStoreState) {
      setStore("layoutComputing", true)
      try {
        const positions = await computeLayout(
          state.nodes,
          state.edges,
          store.focusedNode,
        )
        setStore("positions", positions)
      } catch {
        // Layout failed — keep previous positions
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

    return {
      store,
      connect,
      drillDown,
      navigateUp,
      addEdit,
      clearEdits,
      compileEditsToPrompt,
    }
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/context/graph/index.tsx
git commit -m "feat(graph): add GraphProvider context with SSE connection and drill-down"
```

---

## Chunk 4: Frontend — Visualizer Panel UI

### Task 14: Layout Store — add visualizer panel state

**Files:**
- Modify: `packages/app/src/context/layout.tsx:230-261` (add `visualizer` to createStore)

- [ ] **Step 1: Add visualizer state to layout store**

In `packages/app/src/context/layout.tsx`, find the `createStore({...})` call (around line 230) and add:

```typescript
visualizer: {
  opened: false,
  width: DEFAULT_PANEL_WIDTH,
},
```

Add it after the `fileTree` entry. Also add the toggle method to the context return value, following the pattern used for `sidebar.opened` and `terminal.opened` toggles.

- [ ] **Step 2: Verify build passes**

Run: `cd packages/app && bun run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/context/layout.tsx
git commit -m "feat(graph): add visualizer panel state to layout store"
```

---

### Task 15: SVG Node Components

**Files:**
- Create: `packages/app/src/components/graph/graph-node.tsx`

- [ ] **Step 1: Create node SVG component**

```typescript
// packages/app/src/components/graph/graph-node.tsx
import { Show, type Component } from "solid-js"
import type { GraphNode } from "@/context/graph/types"
import type { Position } from "@/context/graph/types"

const NODE_COLORS = {
  subsystem: { fill: "var(--surface-info-base)", stroke: "var(--border-info)" },
  module: { fill: "var(--surface-base)", stroke: "var(--border-base)" },
  class: { fill: "var(--surface-warning-base)", stroke: "var(--border-warning)" },
  function: { fill: "var(--surface-success-base)", stroke: "var(--border-success)" },
}

const CHANGE_GLOW = {
  added: "var(--color-green-500)",
  modified: "var(--color-yellow-500)",
  deleted: "var(--color-red-500)",
}

export const GraphNodeSVG: Component<{
  node: GraphNode
  position: Position
  onClick: (nodeId: string) => void
  onHover: (nodeId: string | undefined) => void
}> = (props) => {
  const colors = () => NODE_COLORS[props.node.type]
  const glow = () => props.node.changeState ? CHANGE_GLOW[props.node.changeState] : undefined

  return (
    <g
      transform={`translate(${props.position.x}, ${props.position.y})`}
      onClick={() => props.onClick(props.node.id)}
      onMouseEnter={() => props.onHover(props.node.id)}
      onMouseLeave={() => props.onHover(undefined)}
      style={{ cursor: "pointer" }}
    >
      {/* Glow filter for changed nodes */}
      <Show when={glow()}>
        <rect
          x={-4}
          y={-4}
          width={props.position.width + 8}
          height={props.position.height + 8}
          rx={nodeRadius(props.node.type) + 4}
          fill="none"
          stroke={glow()}
          stroke-width={2}
          opacity={0.6}
          class="graph-node-glow"
        />
      </Show>

      {/* Node shape — circle for functions, rect for others */}
      {props.node.type === "function" ? (
        <circle
          cx={props.position.width / 2}
          cy={props.position.height / 2}
          r={Math.min(props.position.width, props.position.height) / 2}
          fill={colors().fill}
          stroke={colors().stroke}
          stroke-width={1.5}
        />
      ) : (
        <rect
          width={props.position.width}
          height={props.position.height}
          rx={nodeRadius(props.node.type)}
          fill={colors().fill}
          stroke={colors().stroke}
          stroke-width={1.5}
        />
      )}

      {/* Type badge */}
      <text
        x={8}
        y={16}
        font-size="10"
        fill="var(--text-dimmed)"
        font-family="var(--font-mono)"
      >
        {props.node.type}
      </text>

      {/* Label */}
      <text
        x={props.position.width / 2}
        y={props.position.height / 2 + 5}
        text-anchor="middle"
        font-size="13"
        font-weight="500"
        fill="var(--text-base)"
        font-family="var(--font-sans)"
      >
        {truncateLabel(props.node.label, props.position.width)}
      </text>

      {/* Children count badge */}
      <Show when={props.node.children.length > 0}>
        <circle
          cx={props.position.width - 12}
          cy={12}
          r={8}
          fill="var(--surface-accent)"
        />
        <text
          x={props.position.width - 12}
          y={16}
          text-anchor="middle"
          font-size="10"
          fill="var(--text-on-accent)"
        >
          {props.node.children.length}
        </text>
      </Show>
    </g>
  )
}

function nodeRadius(type: GraphNode["type"]): number {
  switch (type) {
    case "subsystem": return 12
    case "module": return 6
    case "class": return 8
    case "function": return 20  // fully rounded for circle-ish
  }
}

function truncateLabel(label: string, maxWidth: number): string {
  const maxChars = Math.floor(maxWidth / 8) - 2
  if (label.length <= maxChars) return label
  return label.slice(0, maxChars - 1) + "\u2026"
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/components/graph/graph-node.tsx
git commit -m "feat(graph): add SVG node component with type-based styling and change glow"
```

---

### Task 16: SVG Edge Components

**Files:**
- Create: `packages/app/src/components/graph/graph-edge.tsx`

- [ ] **Step 1: Create edge SVG component**

```typescript
// packages/app/src/components/graph/graph-edge.tsx
import type { Component } from "solid-js"
import type { GraphEdge, Position } from "@/context/graph/types"

const EDGE_COLORS: Record<GraphEdge["type"], string> = {
  imports: "var(--text-dimmed)",
  extends: "var(--color-blue-500)",
  implements: "var(--color-purple-500)",
  calls: "var(--color-green-500)",
  composes: "var(--color-orange-500)",
}

export const GraphEdgeSVG: Component<{
  edge: GraphEdge
  sourcePos: Position
  targetPos: Position
}> = (props) => {
  const color = () => EDGE_COLORS[props.edge.type]

  // Calculate edge path from center-bottom of source to center-top of target
  const path = () => {
    const sx = props.sourcePos.x + props.sourcePos.width / 2
    const sy = props.sourcePos.y + props.sourcePos.height
    const tx = props.targetPos.x + props.targetPos.width / 2
    const ty = props.targetPos.y

    const midY = (sy + ty) / 2
    return `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`
  }

  return (
    <g>
      <path
        d={path()}
        fill="none"
        stroke={color()}
        stroke-width={1.5}
        stroke-dasharray={props.edge.type === "implements" ? "4,4" : undefined}
        opacity={0.7}
      />
      {/* Arrow marker */}
      <circle
        cx={props.targetPos.x + props.targetPos.width / 2}
        cy={props.targetPos.y - 3}
        r={3}
        fill={color()}
      />
    </g>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/components/graph/graph-edge.tsx
git commit -m "feat(graph): add SVG edge component with type-based coloring"
```

---

### Task 17: Graph Canvas — main SVG container with pan/zoom

**Files:**
- Create: `packages/app/src/components/graph/graph-canvas.tsx`

- [ ] **Step 1: Create graph canvas**

```typescript
// packages/app/src/components/graph/graph-canvas.tsx
import { For, Show, createSignal, type Component } from "solid-js"
import { useGraph } from "@/context/graph"
import { GraphNodeSVG } from "./graph-node"
import { GraphEdgeSVG } from "./graph-edge"

export const GraphCanvas: Component = () => {
  const { store, drillDown } = useGraph()
  const [pan, setPan] = createSignal({ x: 0, y: 0 })
  const [zoom, setZoom] = createSignal(1)
  const [hoveredNode, setHoveredNode] = createSignal<string>()
  const [dragging, setDragging] = createSignal(false)
  const [dragStart, setDragStart] = createSignal({ x: 0, y: 0 })

  // Visible nodes at current zoom level
  const visibleNodes = () => {
    if (!store.graph) return []
    return Object.values(store.graph.nodes).filter((n) => {
      if (!store.focusedNode) return !n.parent
      return n.parent === store.focusedNode
    })
  }

  const visibleEdges = () => {
    if (!store.graph) return []
    const ids = new Set(visibleNodes().map((n) => n.id))
    return store.graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  }

  const hoveredNodeData = () => {
    const id = hoveredNode()
    if (!id || !store.graph) return undefined
    return store.graph.nodes[id]
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom((z) => Math.max(0.1, Math.min(3, z * delta)))
  }

  function handleMouseDown(e: MouseEvent) {
    if (e.target === e.currentTarget || (e.target as SVGElement).tagName === "svg") {
      setDragging(true)
      setDragStart({ x: e.clientX - pan().x, y: e.clientY - pan().y })
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (dragging()) {
      setPan({ x: e.clientX - dragStart().x, y: e.clientY - dragStart().y })
    }
  }

  function handleMouseUp() {
    setDragging(false)
  }

  function handleNodeClick(nodeId: string) {
    const node = store.graph?.nodes[nodeId]
    if (node && node.children.length > 0) {
      drillDown(nodeId)
    }
  }

  return (
    <div
      style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative" }}
      onWheel={handleWheel}
    >
      {/* Loading overlay */}
      <Show when={store.layoutComputing}>
        <div
          style={{
            position: "absolute",
            inset: "0",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "background": "var(--surface-base)",
            opacity: "0.5",
            "z-index": "10",
          }}
        >
          <span style={{ color: "var(--text-dimmed)" }}>Computing layout...</span>
        </div>
      </Show>

      {/* Disconnected badge */}
      <Show when={!store.connected && store.graph}>
        <div
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            padding: "4px 8px",
            background: "var(--surface-warning-base)",
            "border-radius": "4px",
            "font-size": "11px",
            color: "var(--text-warning)",
            "z-index": "10",
          }}
        >
          Disconnected
        </div>
      </Show>

      {/* Tooltip */}
      <Show when={hoveredNodeData()}>
        {(node) => (
          <div
            style={{
              position: "absolute",
              top: "8px",
              left: "8px",
              padding: "8px 12px",
              background: "var(--surface-raised)",
              border: "1px solid var(--border-base)",
              "border-radius": "6px",
              "font-size": "12px",
              "max-width": "300px",
              "z-index": "10",
            }}
          >
            <div style={{ "font-weight": "600" }}>{node().label}</div>
            <Show when={node().description}>
              <div style={{ color: "var(--text-dimmed)", "margin-top": "4px" }}>
                {node().description}
              </div>
            </Show>
            <Show when={node().children.length > 0}>
              <div style={{ color: "var(--text-dimmed)", "margin-top": "4px", "font-size": "11px" }}>
                Click to drill down ({node().children.length} children)
              </div>
            </Show>
          </div>
        )}
      </Show>

      <svg
        width="100%"
        height="100%"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: dragging() ? "grabbing" : "grab" }}
      >
        <g transform={`translate(${pan().x}, ${pan().y}) scale(${zoom()})`}>
          {/* Edges first (behind nodes) */}
          <For each={visibleEdges()}>
            {(edge) => {
              const sourcePos = () => store.positions[edge.source]
              const targetPos = () => store.positions[edge.target]
              return (
                <Show when={sourcePos() && targetPos()}>
                  <GraphEdgeSVG
                    edge={edge}
                    sourcePos={sourcePos()!}
                    targetPos={targetPos()!}
                  />
                </Show>
              )
            }}
          </For>

          {/* Nodes */}
          <For each={visibleNodes()}>
            {(node) => {
              const pos = () => store.positions[node.id]
              return (
                <Show when={pos()}>
                  <GraphNodeSVG
                    node={node}
                    position={pos()!}
                    onClick={handleNodeClick}
                    onHover={setHoveredNode}
                  />
                </Show>
              )
            }}
          </For>
        </g>
      </svg>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/components/graph/graph-canvas.tsx
git commit -m "feat(graph): add graph canvas with pan, zoom, tooltips, and drill-down"
```

---

### Task 18: Breadcrumb Navigation Component

**Files:**
- Create: `packages/app/src/components/graph/graph-breadcrumb.tsx`

- [ ] **Step 1: Create breadcrumb**

```typescript
// packages/app/src/components/graph/graph-breadcrumb.tsx
import { For, Show, type Component } from "solid-js"
import { useGraph } from "@/context/graph"

export const GraphBreadcrumb: Component = () => {
  const { store, navigateUp } = useGraph()

  const crumbs = () => {
    const items: Array<{ label: string; index: number }> = [
      { label: "Project", index: -1 },
    ]
    for (let i = 0; i < store.navigationStack.length; i++) {
      const nodeId = store.navigationStack[i]
      const node = store.graph?.nodes[nodeId]
      items.push({
        label: node?.label ?? nodeId,
        index: i,
      })
    }
    if (store.focusedNode) {
      const node = store.graph?.nodes[store.focusedNode]
      items.push({
        label: node?.label ?? store.focusedNode,
        index: store.navigationStack.length,
      })
    }
    return items
  }

  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "4px",
        padding: "4px 8px",
        "font-size": "12px",
        "border-bottom": "1px solid var(--border-base)",
        "min-height": "28px",
        "flex-shrink": "0",
        overflow: "hidden",
      }}
    >
      <For each={crumbs()}>
        {(crumb, i) => (
          <>
            <Show when={i() > 0}>
              <span style={{ color: "var(--text-dimmed)" }}>/</span>
            </Show>
            <button
              onClick={() => {
                if (crumb.index === -1) {
                  // Navigate to root
                  while (store.navigationStack.length > 0) navigateUp()
                } else if (i() < crumbs().length - 1) {
                  navigateUp(crumb.index)
                }
              }}
              style={{
                background: "none",
                border: "none",
                padding: "2px 4px",
                "border-radius": "3px",
                cursor: i() < crumbs().length - 1 ? "pointer" : "default",
                color: i() < crumbs().length - 1 ? "var(--text-link)" : "var(--text-base)",
                "font-weight": i() === crumbs().length - 1 ? "600" : "400",
                "font-size": "12px",
                "white-space": "nowrap",
              }}
            >
              {crumb.label}
            </button>
          </>
        )}
      </For>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/components/graph/graph-breadcrumb.tsx
git commit -m "feat(graph): add breadcrumb navigation for drill-down levels"
```

---

### Task 19: Visualizer Toolbar

**Files:**
- Create: `packages/app/src/components/graph/graph-toolbar.tsx`

- [ ] **Step 1: Create toolbar**

```typescript
// packages/app/src/components/graph/graph-toolbar.tsx
import { createSignal, Show, type Component } from "solid-js"
import { useGraph } from "@/context/graph"
import { IconButton } from "@opencode-ai/ui/icon-button"

export const GraphToolbar: Component<{
  editMode: boolean
  onToggleEditMode: () => void
  onSearch: (query: string) => void
}> = (props) => {
  const { store } = useGraph()
  const [searchQuery, setSearchQuery] = createSignal("")
  const [searchOpen, setSearchOpen] = createSignal(false)

  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        gap: "4px",
        padding: "4px 8px",
        "border-bottom": "1px solid var(--border-base)",
        "min-height": "32px",
        "flex-shrink": "0",
      }}
    >
      {/* Mode toggle */}
      <button
        onClick={props.onToggleEditMode}
        style={{
          padding: "2px 8px",
          "border-radius": "4px",
          border: "1px solid var(--border-base)",
          background: props.editMode ? "var(--surface-accent)" : "transparent",
          color: props.editMode ? "var(--text-on-accent)" : "var(--text-base)",
          "font-size": "11px",
          cursor: "pointer",
        }}
      >
        {props.editMode ? "Edit" : "Navigate"}
      </button>

      <div style={{ flex: "1" }} />

      {/* Search */}
      <Show when={searchOpen()}>
        <input
          type="text"
          placeholder="Search nodes..."
          value={searchQuery()}
          onInput={(e) => {
            setSearchQuery(e.currentTarget.value)
            props.onSearch(e.currentTarget.value)
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearchOpen(false)
              setSearchQuery("")
              props.onSearch("")
            }
          }}
          style={{
            padding: "2px 8px",
            "border-radius": "4px",
            border: "1px solid var(--border-base)",
            background: "var(--surface-base)",
            color: "var(--text-base)",
            "font-size": "12px",
            width: "150px",
          }}
          autofocus
        />
      </Show>

      <button
        onClick={() => setSearchOpen(!searchOpen())}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "2px 6px",
          "font-size": "12px",
          color: "var(--text-dimmed)",
        }}
        title="Search (press /)"
      >
        /
      </button>

      {/* Zoom level */}
      <span
        style={{
          "font-size": "11px",
          color: "var(--text-dimmed)",
          padding: "0 4px",
        }}
      >
        L{store.zoomLevel}
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/components/graph/graph-toolbar.tsx
git commit -m "feat(graph): add visualizer toolbar with mode toggle and search"
```

---

### Task 20: Edit Bar (pending edits submission)

**Files:**
- Create: `packages/app/src/components/graph/graph-edit-bar.tsx`

- [ ] **Step 1: Create edit bar**

```typescript
// packages/app/src/components/graph/graph-edit-bar.tsx
import { Show, type Component } from "solid-js"
import { useGraph } from "@/context/graph"
import { Button } from "@opencode-ai/ui/button"

export const GraphEditBar: Component<{
  onSubmitToChat: (prompt: string) => void
}> = (props) => {
  const { store, clearEdits, compileEditsToPrompt } = useGraph()

  return (
    <Show when={store.pendingEdits.length > 0}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "6px 8px",
          "border-top": "1px solid var(--border-base)",
          background: "var(--surface-raised)",
          "flex-shrink": "0",
        }}
      >
        <span style={{ "font-size": "12px", color: "var(--text-dimmed)" }}>
          {store.pendingEdits.length} edit{store.pendingEdits.length > 1 ? "s" : ""} pending
        </span>

        <div style={{ flex: "1" }} />

        <button
          onClick={clearEdits}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-dimmed)",
            cursor: "pointer",
            "font-size": "12px",
            padding: "2px 8px",
          }}
        >
          Clear
        </button>

        <button
          onClick={() => props.onSubmitToChat(compileEditsToPrompt())}
          style={{
            padding: "4px 12px",
            "border-radius": "4px",
            border: "none",
            background: "var(--surface-accent)",
            color: "var(--text-on-accent)",
            cursor: "pointer",
            "font-size": "12px",
            "font-weight": "500",
          }}
        >
          Submit to Chat
        </button>
      </div>
    </Show>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/components/graph/graph-edit-bar.tsx
git commit -m "feat(graph): add edit bar for pending visual edits submission"
```

---

### Task 21: Visualizer Panel — main container component

**Files:**
- Create: `packages/app/src/components/graph/visualizer-panel.tsx`

This assembles toolbar + breadcrumb + canvas + edit bar into the full panel.

- [ ] **Step 1: Create visualizer panel**

```typescript
// packages/app/src/components/graph/visualizer-panel.tsx
import { createSignal, createEffect, onMount, type Component } from "solid-js"
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

  onMount(() => {
    connect()
  })

  function handleSearch(query: string) {
    if (!store.graph) return
    // Find matching nodes and scroll/highlight them
    // Simple substring match on label and description
    const matches = Object.values(store.graph.nodes).filter(
      (n) =>
        n.label.toLowerCase().includes(query.toLowerCase()) ||
        n.description?.toLowerCase().includes(query.toLowerCase()),
    )
    // If exactly one match, drill down to its parent and highlight it
    if (matches.length === 1 && matches[0].parent) {
      drillDown(matches[0].parent)
    }
  }

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        background: "var(--surface-base)",
        "border-left": "1px solid var(--border-base)",
      }}
    >
      <GraphToolbar
        editMode={editMode()}
        onToggleEditMode={() => setEditMode(!editMode())}
        onSearch={handleSearch}
      />
      <GraphBreadcrumb />
      <div style={{ flex: "1", "min-height": "0" }}>
        <GraphCanvas />
      </div>
      <GraphEditBar onSubmitToChat={props.onSubmitToChat} />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/components/graph/visualizer-panel.tsx
git commit -m "feat(graph): add visualizer panel assembling toolbar, breadcrumb, canvas, edit bar"
```

---

## Chunk 5: Integration — Wire Panel into Layout & Add Keybinds

### Task 22: Integrate VisualizerPanel into session layout

**Files:**
- Modify: `packages/app/src/pages/layout.tsx` (add visualizer panel rendering alongside file tree)
- Modify: `packages/app/src/pages/session.tsx` (if session layout needs the panel)

This requires reading the existing layout rendering code to find where the `fileTree` panel is rendered, and adding the visualizer panel adjacent to it with its own `ResizeHandle`. Follow the exact pattern used for the file tree panel.

- [ ] **Step 1: Read the existing panel rendering in layout.tsx**

Read `packages/app/src/pages/layout.tsx` fully. Find where `store.fileTree.opened` is checked to conditionally render the file tree panel — look for `<Show when={...fileTree.opened}>` and the `ResizeHandle` adjacent to it. Note the exact variable names used (the layout store is accessed via `useLayout()` which returns the store and setter).

- [ ] **Step 2: Add GraphProvider to the provider tree**

In the main app's provider nesting (likely `packages/app/src/pages/layout.tsx` where `LayoutProvider`, `SyncProvider` etc. are nested), wrap the session content area with `GraphProvider`:

```tsx
import { GraphProvider } from "@/context/graph"

// Add inside the existing provider chain, after SyncProvider:
<GraphProvider>
  {/* existing session content */}
</GraphProvider>
```

- [ ] **Step 3: Add VisualizerPanel rendering**

Adjacent to the file tree panel's `<Show>` block, add the visualizer panel. The exact accessor pattern depends on what `useLayout()` returns — read the file to confirm. The pattern will look like:

```tsx
import { VisualizerPanel } from "@/components/graph/visualizer-panel"

// After the fileTree Show block, add:
<Show when={layout.store.visualizer.opened}>
  <ResizeHandle
    direction="horizontal"
    value={layout.store.visualizer.width}
    onResize={(w) => layout.setStore("visualizer", "width", w)}
    min={200}
    max={800}
  />
  <div style={{ width: `${layout.store.visualizer.width}px`, "flex-shrink": "0", height: "100%" }}>
    <VisualizerPanel onSubmitToChat={handleSubmitToChat} />
  </div>
</Show>
```

Verify accessor names match by reading the `useLayout()` return type in `packages/app/src/context/layout.tsx`.

- [ ] **Step 4: Implement handleSubmitToChat**

Add to the layout component where the VisualizerPanel is rendered. **Important:** In SolidJS, hooks must be called during component setup, not inside callbacks. Capture SDK and navigate at setup time:

```typescript
// At component setup scope (not inside a callback):
const sdk = useGlobalSDK()
const navigate = useNavigate()
const layout = useLayout()

async function handleSubmitToChat(prompt: string) {
  const result = await sdk.client.session.create({
    body: {
      title: "Visual edit: " + prompt.slice(0, 50),
      directory: sdk.directory,
    },
  })
  if (result.data) {
    navigate(`/session/${result.data.id}`)
    layout.setStore("sessionView", result.data.id, "pendingMessage", prompt)
  }
}
```

This follows the same pattern used in `packages/app/src/pages/layout.tsx` for session creation (search for session creation logic in the file).

- [ ] **Step 5: Verify build passes**

Run: `cd packages/app && bun run build`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/pages/layout.tsx
git commit -m "feat(graph): integrate visualizer panel into session layout with resize handle"
```

---

### Task 23: Register keyboard shortcuts

**Files:**
- Modify: `packages/app/src/context/command.tsx` (add visualizer toggle command)

- [ ] **Step 1: Add visualizer toggle command**

In `packages/app/src/context/command.tsx`, find where commands like `terminal.toggle` are registered and add:

```typescript
{
  id: "visualizer.toggle",
  title: "Toggle Code Visualizer",
  category: "View",
  keybind: "mod+shift+v",
  onSelect: () => {
    // Toggle layout.visualizer.opened
    setLayout("visualizer", "opened", (prev) => !prev)
  },
}
```

Also handle `Escape` in the visualizer panel to navigate up one level or exit edit mode (this is handled within the panel component via onKeyDown).

- [ ] **Step 2: Verify build passes**

Run: `cd packages/app && bun run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/context/command.tsx
git commit -m "feat(graph): register Cmd+Shift+V keybind for visualizer toggle"
```

---

### Task 24: CSS Animations for graph transitions

**Files:**
- Create: `packages/app/src/components/graph/graph-animations.css`

- [ ] **Step 1: Create animation styles**

```css
/* packages/app/src/components/graph/graph-animations.css */

/* Pulsing glow for changed nodes */
.graph-node-glow {
  animation: graph-glow-pulse 2s ease-in-out infinite;
}

@keyframes graph-glow-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.8; }
}

/* Fade in for new nodes */
.graph-node-enter {
  animation: graph-fade-in 0.3s ease-out;
}

@keyframes graph-fade-in {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}

/* Fade out for deleted nodes */
.graph-node-exit {
  animation: graph-fade-out 0.3s ease-in forwards;
}

@keyframes graph-fade-out {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.8); }
}

/* Smooth position transitions */
.graph-node-move {
  transition: transform 0.4s ease-in-out;
}
```

- [ ] **Step 2: Import in graph-canvas.tsx**

Add `import "./graph-animations.css"` at the top of `packages/app/src/components/graph/graph-canvas.tsx`.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/graph/graph-animations.css packages/app/src/components/graph/graph-canvas.tsx
git commit -m "feat(graph): add CSS animations for node glow, enter, exit, and move transitions"
```

---

### Task 25: End-to-end integration test

**Files:**
- Create: `packages/app/e2e/graph/visualizer.spec.ts`

- [ ] **Step 1: Write E2E test**

Follow the existing E2E test pattern from `packages/app/e2e/sidebar/sidebar.spec.ts`. The test should:
1. Open the app
2. Toggle the visualizer panel via keyboard shortcut or command palette
3. Verify the panel renders with toolbar, breadcrumb, and canvas
4. Verify nodes appear in the SVG

```typescript
// packages/app/e2e/graph/visualizer.spec.ts
import { test, expect } from "@playwright/test"

test.describe("Visualizer Panel", () => {
  test("toggles open and shows graph nodes", async ({ page }) => {
    await page.goto("/")

    // Open visualizer via command palette
    await page.keyboard.press("Meta+Shift+KeyV")

    // Verify panel appears
    const panel = page.locator("[data-testid='visualizer-panel']")
    await expect(panel).toBeVisible()

    // Verify toolbar exists
    await expect(panel.locator("text=Navigate")).toBeVisible()

    // Verify breadcrumb shows Project root
    await expect(panel.locator("text=Project")).toBeVisible()

    // Verify SVG canvas exists
    await expect(panel.locator("svg")).toBeVisible()

    // Wait for nodes to render (SSE connection + initial scan takes time)
    await expect(panel.locator("svg g[transform]").first()).toBeVisible({ timeout: 10000 })

    // Close and verify hidden
    await page.keyboard.press("Meta+Shift+KeyV")
    await expect(panel).not.toBeVisible()
  })
})
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/e2e/graph/visualizer.spec.ts
git commit -m "test(graph): add E2E test for visualizer panel toggle and basic rendering"
```

---

### Task 26: Add data-testid attributes for E2E tests

**Files:**
- Modify: `packages/app/src/components/graph/visualizer-panel.tsx` (add data-testid)

- [ ] **Step 1: Add testid to panel root**

In `visualizer-panel.tsx`, add `data-testid="visualizer-panel"` to the root `<div>`.

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/components/graph/visualizer-panel.tsx
git commit -m "test(graph): add data-testid to visualizer panel for E2E tests"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|---|---|---|
| 1: Data Types & Static Analyzer | 1-5 | Backend graph analysis engine: types, scanner, parser, builder, analyzer singleton |
| 2: Graph API & Tool Hooks | 6-8 | HTTP + SSE endpoints, tool pipeline integration for real-time updates |
| 3: Frontend Store & Layout | 9-13 | Elkjs dependency, frontend types, reactive store, layout computation, context provider |
| 4: UI Components | 14-21 | Layout store entry, SVG nodes/edges, canvas with pan/zoom, breadcrumb, toolbar, edit bar, panel assembly |
| 5: Integration & Polish | 22-26 | Wire into session layout, keyboard shortcuts, CSS animations, E2E tests |

**Not included (separate subsystem):** Comment Enrichment (LLM-powered comment improvement). The visualizer works without it — it uses whatever comments already exist in source files.
