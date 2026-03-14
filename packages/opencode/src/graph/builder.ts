import { relative, dirname, resolve, join } from "path"
import type { GraphNode, GraphEdge, GraphSnapshot } from "./schema"
import type { ParsedFile } from "./parser"

function makeModuleId(projectDir: string, filePath: string): string {
  return relative(projectDir, filePath)
}

function makeSubsystemId(projectDir: string, filePath: string): string {
  const rel = relative(projectDir, filePath)
  const parts = rel.split("/")
  if (parts.length >= 2) return parts.slice(0, 2).join("/")
  return parts[0]
}

function resolveImportPath(fromFile: string, importSource: string, allFiles: Set<string>): string | undefined {
  if (!importSource.startsWith(".")) return undefined
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

  for (const filePath of files.keys()) {
    const subsystemId = makeSubsystemId(projectDir, filePath)
    if (!subsystems.has(subsystemId)) {
      subsystems.set(subsystemId, { files: [], label: subsystemId.split("/").pop() ?? subsystemId })
    }
    subsystems.get(subsystemId)!.files.push(filePath)
  }

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

  for (const [filePath, parsed] of files) {
    const moduleId = makeModuleId(projectDir, filePath)
    const subsystemId = makeSubsystemId(projectDir, filePath)
    const children: string[] = []

    for (const cls of parsed.classes) {
      const classId = `${moduleId}::${cls.name}`
      const classChildren: string[] = []

      for (const fn of parsed.functions) {
        if (fn.parentClass === cls.name) {
          const fnId = `${classId}::${fn.name}`
          classChildren.push(fnId)
          nodes.push({
            id: fnId,
            type: "function",
            label: fn.name,
            description: fn.description || undefined,
            filePath,
            lineRange: [fn.lineStart, fn.lineEnd],
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
        description: cls.description || undefined,
        filePath,
        lineRange: [cls.lineStart, cls.lineEnd],
        children: classChildren,
        parent: moduleId,
        lastModified: now,
      })

      if (cls.extendsClause) {
        for (const [otherPath, otherParsed] of files) {
          const match = otherParsed.classes.find((c) => c.name === cls.extendsClause)
          if (match) {
            const targetId = `${makeModuleId(projectDir, otherPath)}::${match.name}`
            edges.push({ id: `${classId}->extends->${targetId}`, source: classId, target: targetId, type: "extends" })
            break
          }
        }
      }
    }

    for (const fn of parsed.functions) {
      if (!fn.parentClass) {
        const fnId = `${moduleId}::${fn.name}`
        children.push(fnId)
        nodes.push({
          id: fnId,
          type: "function",
          label: fn.name,
          description: fn.description || undefined,
          filePath,
          lineRange: [fn.lineStart, fn.lineEnd],
          children: [],
          parent: moduleId,
          lastModified: now,
        })
      }
    }

    nodes.push({
      id: moduleId,
      type: "module",
      label: filePath.split("/").pop() ?? moduleId,
      description: parsed.fileComment || undefined,
      filePath,
      children,
      parent: subsystemId,
      lastModified: now,
    })

    for (const imp of parsed.imports) {
      const targetPath = resolveImportPath(filePath, imp.source, allFilePaths)
      if (targetPath) {
        const targetId = makeModuleId(projectDir, targetPath)
        edges.push({ id: `${moduleId}->imports->${targetId}`, source: moduleId, target: targetId, type: "imports" })
      }
    }
  }

  return { nodes, edges, eventId: `scan_${now}` }
}
