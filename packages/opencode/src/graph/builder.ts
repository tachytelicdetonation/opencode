import { basename, dirname, join, relative, resolve } from "path"
import type { GraphNode, GraphEdge, GraphSnapshot } from "./schema"
import type { ParsedFile, ParsedFunction, ParsedRef } from "./parser"

type Dir = {
  id: string
  parent?: string
  children: Set<string>
  files: string[]
}

type Info = {
  mod: string
  dir?: string
  parsed: ParsedFile
  classes: Map<string, string>
  fns: Map<string, string>
  methods: Map<string, Map<string, string>>
}

const ROOT_ID = "__root__"

function makeModuleId(root: string, file: string) {
  return relative(root, file)
}

function makeDirs(root: string, file: string) {
  const rel = relative(root, file)
  const dir = dirname(rel)
  if (!dir || dir === ".") return [ROOT_ID]
  const parts = dir.split("/")
  const start = parts[0] === "packages" || parts[0] === "sdks"
    ? Math.min(2, parts.length)
    : 1
  const ids: string[] = []
  for (let i = start; i <= parts.length; i++) {
    ids.push(parts.slice(0, i).join("/"))
  }
  return ids
}

function dirLabel(id: string) {
  if (id === ROOT_ID) return "workspace"
  const parts = id.split("/")
  if ((parts[0] === "packages" || parts[0] === "sdks") && parts.length === 2) {
    return `${parts[0] === "packages" ? "pkg" : "sdk"}/${parts[1]}`
  }
  return parts.at(-1) ?? id
}

function moduleLabel(file: string) {
  const name = basename(file).replace(/\.[^.]+$/, "")
  if (name === "index" || name === "main" || name === "mod" || name === "__init__") {
    return basename(dirname(file))
  }
  return name
}

function resolveImportPath(
  fromFile: string,
  source: string,
  files: Set<string>,
  root: string,
): string | undefined {
  if (fromFile.endsWith(".py")) {
    const dir = dirname(fromFile)
    if (source.startsWith(".")) {
      const dots = source.match(/^\.+/)![0].length
      const rest = source.slice(dots)
      let base = dir
      for (let i = 1; i < dots; i++) base = dirname(base)
      if (rest) {
        const parts = rest.split(".")
        const rel = resolve(base, ...parts)
        const hits = [rel + ".py", resolve(rel, "__init__.py")]
        return hits.find((x) => files.has(x))
      }
      const init = resolve(base, "__init__.py")
      if (files.has(init)) return init
      return
    }

    const parts = source.split(".")
    const hits = [
      resolve(root, ...parts) + ".py",
      resolve(resolve(root, ...parts), "__init__.py"),
      ...(parts.length > 1
        ? [
          resolve(root, ...parts.slice(1)) + ".py",
          resolve(resolve(root, ...parts.slice(1)), "__init__.py"),
        ]
        : []),
      resolve(dirname(fromFile), ...parts) + ".py",
      resolve(resolve(dirname(fromFile), ...parts), "__init__.py"),
    ]
    return hits.find((x) => files.has(x))
  }

  if (!source.startsWith(".")) return
  const dir = dirname(fromFile)
  const hits = [
    resolve(dir, source),
    resolve(dir, source + ".ts"),
    resolve(dir, source + ".tsx"),
    resolve(dir, source + "/index.ts"),
    resolve(dir, source + "/index.tsx"),
    resolve(dir, source + ".js"),
    resolve(dir, source + ".jsx"),
    resolve(dir, source + "/index.js"),
  ]
  return hits.find((x) => files.has(x))
}

function summarize(text: string | undefined, max = 110) {
  if (!text) return
  const one = text.replace(/\s+/g, " ").trim()
  if (!one) return
  if (one.length <= max) return one
  return one.slice(0, max - 1).trimEnd() + "…"
}

function uniq(items: string[]) {
  return [...new Set(items.filter(Boolean))]
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

function fnDesc(fn: ParsedFunction) {
  if (fn.description) return summarize(fn.description, 90)
  const refs = uniq(
    fn.refs
      .map((x) => x.member?.split(".").at(-1) ?? x.name)
      .filter((x) => x !== "this"),
  ).slice(0, 3)
  if (refs.length === 0) return
  return `Uses ${refs.join(", ")}`
}

function clsDesc(parsed: ParsedFile, name: string, description: string, base?: string) {
  if (description) return summarize(description, 90)
  const count = parsed.functions.filter((x) => x.parentClass === name).length
  const bits = [plural(count, "method")]
  if (base) bits.push(`extends ${base}`)
  return bits.join(" • ")
}

function modDesc(parsed: ParsedFile) {
  if (parsed.fileComment) return summarize(parsed.fileComment, 110)
  const top = parsed.functions.filter((x) => !x.parentClass).length
  const bits: string[] = []
  if (parsed.classes.length > 0) bits.push(plural(parsed.classes.length, "class"))
  if (top > 0) bits.push(plural(top, "function"))
  const refs = uniq(
    parsed.imports.flatMap((x) =>
      x.items.map((item) => item.namespace ? `${item.local}.*` : item.imported).filter((name) => name !== "default"),
    ),
  ).slice(0, 3)
  if (refs.length > 0) bits.push(`uses ${refs.join(", ")}`)
  return bits.join(" • ") || undefined
}

function addNode(nodes: GraphNode[], byId: Map<string, GraphNode>, node: GraphNode) {
  nodes.push(node)
  byId.set(node.id, node)
}

function addEdge(edges: Map<string, GraphEdge>, source: string | undefined, target: string | undefined, type: GraphEdge["type"], label?: string) {
  if (!source || !target || source === target) return
  const id = `${source}->${type}->${target}`
  const prev = edges.get(id)
  if (!prev) {
    edges.set(id, { id, source, target, type, label })
    return
  }
  if (!prev.label && label) prev.label = label
}

function ancestors(id: string, byId: Map<string, GraphNode>) {
  const out: string[] = []
  let cur = byId.get(id)?.parent
  while (cur) {
    out.push(cur)
    cur = byId.get(cur)?.parent
  }
  return out
}

function branch(id: string, byId: Map<string, GraphNode>, focus?: string) {
  let cur = id
  let parent = byId.get(cur)?.parent
  if (!focus) {
    while (parent) {
      cur = parent
      parent = byId.get(cur)?.parent
    }
    return cur
  }
  while (parent && parent !== focus) {
    cur = parent
    parent = byId.get(cur)?.parent
  }
  if (parent !== focus) return
  return cur
}

function under(id: string, root: string, byId: Map<string, GraphNode>) {
  let cur: string | undefined = id
  while (cur) {
    if (cur === root) return true
    cur = byId.get(cur)?.parent
  }
  return false
}

function linkEdge(
  edges: Map<string, GraphEdge>,
  byId: Map<string, GraphNode>,
  source: string | undefined,
  target: string | undefined,
  type: GraphEdge["type"],
  label?: string,
) {
  if (!source || !target || source === target) return
  addEdge(edges, source, target, type, label)
  const shared = new Set(ancestors(source, byId).filter((x) => ancestors(target, byId).includes(x)))
  for (const focus of [undefined, ...shared]) {
    const a = branch(source, byId, focus)
    const b = branch(target, byId, focus)
    if (!a || !b || a === b) continue
    addEdge(edges, a, b, type)
  }
}

function pick(info: Info, name?: string, member?: string) {
  if (name && info.classes.has(name)) {
    if (member) return info.methods.get(name)?.get(member) ?? info.classes.get(name)
    return info.classes.get(name)
  }
  if (name && info.fns.has(name)) return info.fns.get(name)
  if (!name) {
    if (info.classes.size === 1) {
      const key = [...info.classes.keys()][0]
      return pick(info, key, member)
    }
    if (info.fns.size === 1) {
      const key = [...info.fns.keys()][0]
      return pick(info, key)
    }
  }
  return info.mod
}

function resolveLocal(info: Info, fn: ParsedFunction, ref: ParsedRef) {
  const parts = ref.member?.split(".").filter(Boolean) ?? []
  const first = parts[0]
  const last = parts.at(-1)
  if (ref.name === "this" && fn.parentClass) {
    if (last) return info.methods.get(fn.parentClass)?.get(last) ?? info.classes.get(fn.parentClass)
    return info.classes.get(fn.parentClass)
  }
  if (info.classes.has(ref.name)) {
    if (last) return info.methods.get(ref.name)?.get(last) ?? info.classes.get(ref.name)
    return info.classes.get(ref.name)
  }
  if (first && info.classes.has(first)) {
    if (last && first !== last) return info.methods.get(first)?.get(last) ?? info.classes.get(first)
    return info.classes.get(first)
  }
  if (info.fns.has(ref.name)) return info.fns.get(ref.name)
}

function resolveImported(
  root: string,
  file: string,
  info: Info,
  ref: ParsedRef,
  files: Set<string>,
  all: Map<string, Info>,
) {
  const item = info.parsed.imports
    .flatMap((x) => x.items.map((item) => ({ source: x.source, item })))
    .find((x) => x.item.local === ref.name)
  if (!item) return

  const path = resolveImportPath(file, item.source, files, root)
  if (!path) return
  const target = all.get(path)
  if (!target) return

  const parts = ref.member?.split(".").filter(Boolean) ?? []
  const first = parts[0]
  const last = parts.at(-1)

  if (item.item.namespace) {
    if (first) {
      const hit = pick(target, first, last && first !== last ? last : undefined)
      if (hit) return hit
    }
    if (last) {
      const hit = pick(target, last)
      if (hit) return hit
    }
    return target.mod
  }

  if (item.item.default) {
    return pick(target, undefined, last)
  }

  return pick(target, item.item.imported, last)
}

function resolveRef(
  root: string,
  file: string,
  info: Info,
  fn: ParsedFunction,
  ref: ParsedRef,
  files: Set<string>,
  all: Map<string, Info>,
) {
  return resolveLocal(info, fn, ref) ?? resolveImported(root, file, info, ref, files, all)
}

function depDesc(id: string, edges: Map<string, GraphEdge>, byId: Map<string, GraphNode>) {
  const hits = new Map<string, number>()
  for (const edge of edges.values()) {
    if (!under(edge.source, id, byId)) continue
    if (under(edge.target, id, byId)) continue
    const root = branch(edge.target, byId)
    if (!root || root === id) continue
    hits.set(root, (hits.get(root) ?? 0) + 1)
  }
  return [...hits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([root]) => byId.get(root)?.label ?? root)
}

function modCount(id: string, byId: Map<string, GraphNode>, memo: Map<string, number>): number {
  const hit = memo.get(id)
  if (hit !== undefined) return hit
  const node = byId.get(id)
  if (!node) return 0
  if (node.type === "module") return 1
  const total = node.children.reduce((sum, child) => sum + modCount(child, byId, memo), 0)
  memo.set(id, total)
  return total
}

export function buildGraph(
  root: string,
  files: Map<string, ParsedFile>,
): GraphSnapshot {
  const nodes: GraphNode[] = []
  const byId = new Map<string, GraphNode>()
  const edges = new Map<string, GraphEdge>()
  const dirs = new Map<string, Dir>()
  const info = new Map<string, Info>()
  const allFiles = new Set(files.keys())
  const now = Date.now()

  for (const file of files.keys()) {
    const chain = makeDirs(root, file)
    for (let i = 0; i < chain.length; i++) {
      const id = chain[i]
      const parent = chain[i - 1]
      if (!dirs.has(id)) {
        dirs.set(id, { id, parent, children: new Set(), files: [] })
      }
      if (parent) dirs.get(parent)!.children.add(id)
    }
    const last = chain.at(-1)
    if (last) dirs.get(last)!.files.push(file)
  }

  for (const [file, parsed] of files) {
    const mod = makeModuleId(root, file)
    const dir = makeDirs(root, file).at(-1)
    const classes = new Map<string, string>()
    const fns = new Map<string, string>()
    const methods = new Map<string, Map<string, string>>()
    const kids: string[] = []

    for (const cls of parsed.classes) {
      const id = `${mod}::${cls.name}`
      const own = new Map<string, string>()
      const childIds: string[] = []

      for (const fn of parsed.functions.filter((x) => x.parentClass === cls.name)) {
        const fnId = `${id}::${fn.name}`
        childIds.push(fnId)
        own.set(fn.name, fnId)
        addNode(nodes, byId, {
          id: fnId,
          type: "function",
          label: fn.name,
          description: fnDesc(fn),
          filePath: file,
          lineRange: [fn.lineStart, fn.lineEnd],
          children: [],
          parent: id,
          lastModified: now,
        })
      }

      methods.set(cls.name, own)
      classes.set(cls.name, id)
      kids.push(id)
      addNode(nodes, byId, {
        id,
        type: "class",
        label: cls.name,
        description: clsDesc(parsed, cls.name, cls.description, cls.extendsClause),
        filePath: file,
        lineRange: [cls.lineStart, cls.lineEnd],
        children: childIds,
        parent: mod,
        lastModified: now,
      })
    }

    for (const fn of parsed.functions.filter((x) => !x.parentClass)) {
      const id = `${mod}::${fn.name}`
      fns.set(fn.name, id)
      kids.push(id)
      addNode(nodes, byId, {
        id,
        type: "function",
        label: fn.name,
        description: fnDesc(fn),
        filePath: file,
        lineRange: [fn.lineStart, fn.lineEnd],
        children: [],
        parent: mod,
        lastModified: now,
      })
    }

    addNode(nodes, byId, {
      id: mod,
      type: "module",
      label: moduleLabel(file),
      description: modDesc(parsed),
      filePath: file,
      children: kids,
      parent: dir,
      lastModified: now,
    })

    if (dir) dirs.get(dir)?.children.add(mod)
    info.set(file, { mod, dir, parsed, classes, fns, methods })
  }

  for (const item of dirs.values()) {
    addNode(nodes, byId, {
      id: item.id,
      type: "subsystem",
      label: dirLabel(item.id),
      filePath: item.id === ROOT_ID ? root : join(root, item.id),
      children: [...item.children],
      parent: item.parent,
      lastModified: now,
    })
  }

  for (const [file, item] of info) {
    for (const imp of item.parsed.imports) {
      if (imp.typeOnly) continue
      const path = resolveImportPath(file, imp.source, allFiles, root)
      const target = path ? info.get(path)?.mod : undefined
      const label = uniq(imp.names).slice(0, 3).join(", ") || undefined
      linkEdge(edges, byId, item.mod, target, "imports", label)
    }

    for (const cls of item.parsed.classes) {
      if (!cls.extendsClause) continue
      const local = pick(item, cls.extendsClause)
      if (local) {
        linkEdge(edges, byId, item.classes.get(cls.name), local, "extends", cls.extendsClause)
        continue
      }
      const hit = item.parsed.imports
        .flatMap((x) => x.items.map((entry) => ({ source: x.source, entry })))
        .find((x) => x.entry.imported === cls.extendsClause || x.entry.local === cls.extendsClause)
      if (!hit) continue
      const path = resolveImportPath(file, hit.source, allFiles, root)
      const target = path ? info.get(path) : undefined
      linkEdge(edges, byId, item.classes.get(cls.name), target ? pick(target, cls.extendsClause) : undefined, "extends", cls.extendsClause)
    }

    for (const fn of item.parsed.functions) {
      const source = fn.parentClass
        ? item.methods.get(fn.parentClass)?.get(fn.name)
        : item.fns.get(fn.name)
      if (!source) continue

      for (const ref of fn.refs) {
        const target = resolveRef(root, file, item, fn, ref, allFiles, info)
        const type = ref.kind === "call" ? "calls" : "composes"
        const label = ref.member?.split(".").at(-1) ?? ref.name
        linkEdge(edges, byId, source, target, type, label)
      }

      // Create decision nodes from control flow branches
      for (const branch of fn.branches) {
        const decisionId = `${source}::${branch.kind}_L${branch.lineStart}`
        addNode(nodes, byId, {
          id: decisionId,
          type: "decision",
          label: branch.condition,
          condition: branch.condition,
          filePath: file,
          lineRange: [branch.lineStart, branch.lineStart],
          children: [],
          parent: source,
          lastModified: now,
        })

        addEdge(edges, source, decisionId, "calls", branch.condition)

        for (const b of branch.branches) {
          for (const ref of b.refs) {
            const target = resolveRef(root, file, item, fn, ref, allFiles, info)
            if (target && target !== source) {
              addEdge(edges, decisionId, target, "calls", b.label)
            }
          }
        }
      }

      // Update function node's children to include decision nodes
      const fnNode = byId.get(source!)
      if (fnNode) {
        for (const branch of fn.branches) {
          const decisionId = `${source}::${branch.kind}_L${branch.lineStart}`
          if (!fnNode.children.includes(decisionId)) {
            fnNode.children.push(decisionId)
          }
        }
      }
    }
  }

  const memo = new Map<string, number>()
  for (const node of nodes) {
    if (node.type !== "subsystem") continue
    const bits = [plural(modCount(node.id, byId, memo), "module")]
    const deps = depDesc(node.id, edges, byId)
    if (deps.length > 0) bits.push(`depends on ${deps.join(", ")}`)
    node.description = bits.join(" • ")
    node.children = node.children
      .map((id) => byId.get(id))
      .filter((item): item is GraphNode => !!item)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "subsystem" ? -1 : 1
        return a.label.localeCompare(b.label)
      })
      .map((item) => item.id)
  }

  return {
    nodes,
    edges: [...edges.values()],
    eventId: `snapshot_${Date.now()}`,
  }
}
