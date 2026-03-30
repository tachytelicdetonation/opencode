import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"
import { fileURLToPath } from "url"
import fs from "fs/promises"

type Node = {
  type: string
  text: string
  children: Node[]
  parent?: Node
  previousSibling?: Node
  previousNamedSibling?: Node
  startPosition: { row: number }
  endPosition: { row: number }
  descendantsOfType: (type: string | string[]) => Node[]
  childForFieldName: (name: string) => Node | null
}

export interface ParsedImportItem {
  imported: string
  local: string
  namespace?: boolean
  default?: boolean
}

export interface ParsedImport {
  source: string
  names: string[]
  items: ParsedImportItem[]
  typeOnly: boolean
  line: number
}

export interface ParsedRef {
  kind: "call" | "new" | "use"
  name: string
  member?: string
}

export interface ParsedBranch {
  kind: "if" | "switch" | "try"
  condition: string
  lineStart: number
  branches: {
    label: string
    refs: ParsedRef[]
  }[]
}

export interface ParsedClass {
  name: string
  description: string
  lineStart: number
  lineEnd: number
  extendsClause?: string
}

export interface ParsedFunction {
  name: string
  description: string
  lineStart: number
  lineEnd: number
  parentClass?: string
  refs: ParsedRef[]
  branches: ParsedBranch[]
}

export interface ParsedFile {
  filePath: string
  imports: ParsedImport[]
  classes: ParsedClass[]
  functions: ParsedFunction[]
  fileComment: string
}

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

const tsParser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: tsWasm } = await import(
    "tree-sitter-typescript/tree-sitter-typescript.wasm" as string,
    {
      with: { type: "wasm" },
    }
  )
  const tsPath = resolveWasm(tsWasm)
  const tsLanguage = await Language.load(tsPath)
  const p = new Parser()
  p.setLanguage(tsLanguage)
  return p
})

function child(node: Node | null | undefined, name: string): Node | undefined {
  return node?.childForFieldName(name) ?? undefined
}

function text(node: Node | null | undefined) {
  if (!node) return ""
  return node.text.replace(/^['"]|['"]$/g, "")
}

function unwrap(node: Node | null | undefined): Node | undefined {
  if (!node) return undefined
  if (
    node.type === "parenthesized_expression"
    || node.type === "type_assertion"
    || node.type === "as_expression"
    || node.type === "satisfies_expression"
    || node.type === "non_null_expression"
  ) {
    return unwrap(node.children.find((x) => x.type !== "(" && x.type !== ")" && x.type !== "as" && x.type !== "satisfies"))
  }
  return node
}

function prop(node: Node | null | undefined) {
  if (!node) return
  if (
    node.type === "identifier"
    || node.type === "property_identifier"
    || node.type === "private_property_identifier"
    || node.type === "type_identifier"
  ) {
    return node.text.replace(/^#/, "")
  }
}

function walk(node: Node, visit: (node: Node) => false | void) {
  const stop = visit(node)
  if (stop === false) return
  for (const item of node.children) walk(item, visit)
}

function getLeadingComment(node: Node): string {
  let prev = node.previousNamedSibling
  if (prev && prev.type === "comment") {
    return extractCommentText(prev.text)
  }
  prev = node.previousSibling
  if (prev && prev.type === "comment") {
    return extractCommentText(prev.text)
  }
  return ""
}

function extractCommentText(text: string): string {
  if (text.startsWith("/**")) {
    return text
      .replace(/^\/\*\*\s*/, "")
      .replace(/\s*\*\/$/, "")
      .replace(/^\s*\*\s?/gm, "")
      .trim()
  }
  if (text.startsWith("/*")) {
    return text
      .replace(/^\/\*\s*/, "")
      .replace(/\s*\*\/$/, "")
      .replace(/^\s*\*\s?/gm, "")
      .trim()
  }
  if (text.startsWith("//")) {
    return text.replace(/^\/\/\s?/, "").trim()
  }
  return text.trim()
}

function readRef(node: Node | null | undefined, alias: Map<string, ParsedRef>): ParsedRef | undefined {
  const cur = unwrap(node)
  if (!cur) return

  if (cur.type === "identifier" || cur.type === "type_identifier") {
    return alias.get(cur.text) ?? { kind: "use", name: cur.text }
  }

  if (cur.type === "this") {
    return { kind: "use", name: "this" }
  }

  if (cur.type === "member_expression" || cur.type === "subscript_expression") {
    const base = readRef(child(cur, "object"), alias)
    if (!base) return
    const key = prop(child(cur, "property"))
    if (!key) return base
    const member = base.member ? `${base.member}.${key}` : key
    return { ...base, member }
  }

  if (cur.type === "call_expression") {
    return readRef(child(cur, "function"), alias)
  }

  if (cur.type === "new_expression") {
    return readRef(child(cur, "constructor") ?? child(cur, "callee"), alias)
  }
}

function asKind(ref: ParsedRef, kind: ParsedRef["kind"]): ParsedRef {
  return { ...ref, kind }
}

function pushRef(refs: ParsedRef[], seen: Set<string>, ref: ParsedRef | undefined, kind: ParsedRef["kind"]) {
  if (!ref) return
  const key = `${kind}:${ref.name}:${ref.member ?? ""}`
  if (seen.has(key)) return
  seen.add(key)
  refs.push(asKind(ref, kind))
}

function bindAlias(node: Node, alias: Map<string, ParsedRef>) {
  const left = child(node, "name")
  const right = child(node, "value")
  if (!left || left.type !== "identifier" || !right) return
  const ref = readRef(right, alias)
  if (ref) alias.set(left.text, ref)
}

function bindAssign(node: Node, alias: Map<string, ParsedRef>) {
  const left = child(node, "left")
  const right = child(node, "right")
  if (!left || left.type !== "identifier" || !right) return
  const ref = readRef(right, alias)
  if (ref) alias.set(left.text, ref)
}

function isCallee(node: Node) {
  const parent = node.parent
  if (!parent) return false
  if (parent.type === "call_expression" && child(parent, "function") === node) return true
  if (parent.type === "new_expression" && (child(parent, "constructor") === node || child(parent, "callee") === node)) return true
  return false
}

function isProperty(node: Node) {
  const parent = node.parent
  if (!parent) return false
  return (
    (parent.type === "member_expression" || parent.type === "subscript_expression")
    && child(parent, "property") === node
  )
}

function isBinding(node: Node) {
  const parent = node.parent
  if (!parent) return false
  return (
    (parent.type === "variable_declarator" && child(parent, "name") === node)
    || (parent.type === "assignment_expression" && child(parent, "left") === node)
    || (parent.type === "function_declaration" && child(parent, "name") === node)
    || (parent.type === "method_definition" && child(parent, "name") === node)
    || (parent.type === "class_declaration" && child(parent, "name") === node)
    || (parent.type === "formal_parameter" && child(parent, "pattern") === node)
    || (parent.type === "required_parameter" && child(parent, "pattern") === node)
    || (parent.type === "optional_parameter" && child(parent, "pattern") === node)
    || parent.type === "import_specifier"
    || parent.type === "import_clause"
    || parent.type === "namespace_import"
  )
}

function analyze(node: Node): ParsedRef[] {
  const refs: ParsedRef[] = []
  const seen = new Set<string>()
  const alias = new Map<string, ParsedRef>()
  const body = child(node, "body") ?? node

  walk(body, (cur) => {
    if (cur !== body && (cur.type === "function_declaration" || cur.type === "class_declaration" || cur.type === "method_definition")) {
      return false
    }

    if (cur.type === "variable_declarator") {
      bindAlias(cur, alias)
      return
    }

    if (cur.type === "assignment_expression") {
      bindAssign(cur, alias)
      return
    }

    if (cur.type === "call_expression") {
      pushRef(refs, seen, readRef(child(cur, "function"), alias), "call")
      return
    }

    if (cur.type === "new_expression") {
      pushRef(refs, seen, readRef(child(cur, "constructor") ?? child(cur, "callee"), alias), "new")
      return
    }

    if (cur.type === "member_expression" || cur.type === "subscript_expression") {
      if (isCallee(cur)) return
      pushRef(refs, seen, readRef(cur, alias), "use")
      return
    }

    if (cur.type === "identifier") {
      if (isBinding(cur) || isProperty(cur) || isCallee(cur)) return
      if (!alias.has(cur.text)) return
      pushRef(refs, seen, readRef(cur, alias), "use")
      return
    }

    if (cur.type === "type_identifier") {
      if (isBinding(cur)) return
      pushRef(refs, seen, readRef(cur, alias), "use")
    }
  })

  return refs
}

function extractBranches(body: Node): ParsedBranch[] {
  const branches: ParsedBranch[] = []

  for (const node of body.children) {
    if (node.type === "if_statement") {
      const condition = node.childForFieldName("condition")?.text ?? "?"
      const consequence = node.childForFieldName("consequence")
      const alternative = node.childForFieldName("alternative")

      const branch: ParsedBranch = {
        kind: "if",
        condition: condition.length > 50 ? condition.slice(0, 47) + "..." : condition,
        lineStart: node.startPosition.row + 1,
        branches: [],
      }

      if (consequence) {
        branch.branches.push({ label: "true", refs: analyzeBlock(consequence) })
      }
      if (alternative) {
        const altBody = alternative.type === "else_clause"
          ? alternative.children.find(c => c.type === "statement_block" || c.type === "if_statement")
          : alternative
        branch.branches.push({ label: "false", refs: altBody ? analyzeBlock(altBody) : [] })
      }

      if (branch.branches.length > 0) branches.push(branch)
    }

    if (node.type === "switch_statement") {
      const condition = node.childForFieldName("value")?.text ?? "?"
      const branch: ParsedBranch = {
        kind: "switch",
        condition: condition.length > 50 ? condition.slice(0, 47) + "..." : condition,
        lineStart: node.startPosition.row + 1,
        branches: [],
      }

      const switchBody = node.childForFieldName("body")
      if (switchBody) {
        for (const caseNode of switchBody.children) {
          if (caseNode.type === "switch_case" || caseNode.type === "switch_default") {
            const caseValue = caseNode.childForFieldName("value")?.text ?? "default"
            branch.branches.push({ label: caseValue, refs: analyzeBlock(caseNode) })
          }
        }
      }

      if (branch.branches.length > 0) branches.push(branch)
    }

    if (node.type === "try_statement") {
      const tryBody = node.childForFieldName("body")
      const handler = node.childForFieldName("handler")

      const branch: ParsedBranch = {
        kind: "try",
        condition: "try/catch",
        lineStart: node.startPosition.row + 1,
        branches: [],
      }

      if (tryBody) {
        branch.branches.push({ label: "try", refs: analyzeBlock(tryBody) })
      }
      if (handler) {
        const catchBody = handler.childForFieldName("body")
        branch.branches.push({ label: "catch", refs: catchBody ? analyzeBlock(catchBody) : [] })
      }

      if (branch.branches.length > 0) branches.push(branch)
    }
  }

  return branches
}

function analyzeBlock(node: Node): ParsedRef[] {
  const refs: ParsedRef[] = []
  const seen = new Set<string>()
  const alias = new Map<string, ParsedRef>()

  walk(node, (cur) => {
    if (cur.type === "call_expression") {
      pushRef(refs, seen, readRef(child(cur, "function"), alias), "call")
      return
    }
    if (cur.type === "new_expression") {
      pushRef(refs, seen, readRef(child(cur, "constructor") ?? child(cur, "callee"), alias), "new")
      return
    }
  })

  return refs
}

function extractImports(root: Node): ParsedImport[] {
  const imports: ParsedImport[] = []
  for (const node of root.children) {
    if (node.type !== "import_statement") continue
    const source = text(node.descendantsOfType("string")[0])
    if (!source) continue

    const items: ParsedImportItem[] = []
    const clause = node.descendantsOfType("import_clause")[0]
    if (clause) {
      for (const spec of clause.descendantsOfType("import_specifier")) {
        const imported = prop(child(spec, "name"))
        if (!imported) continue
        const local = prop(child(spec, "alias")) ?? imported
        items.push({ imported, local })
      }

      for (const id of clause.descendantsOfType("identifier")) {
        if (id.parent === clause) {
          items.push({ imported: "default", local: id.text, default: true })
        }
      }

      for (const item of clause.descendantsOfType("namespace_import")) {
        const id = item.descendantsOfType("identifier")[0]
        if (!id) continue
        items.push({ imported: "*", local: id.text, namespace: true })
      }
    }

    imports.push({
      source,
      names: items.map((x) => x.namespace ? `${x.local}.*` : x.imported),
      items,
      typeOnly: node.text.includes("import type "),
      line: node.startPosition.row + 1,
    })
  }
  return imports
}

function extractClasses(root: Node, fileComment: string): ParsedClass[] {
  const classes: ParsedClass[] = []
  const kinds = new Set(["class_declaration", "abstract_class_declaration"])

  for (const node of root.children) {
    let cur = node
    if (node.type === "export_statement") {
      const dec = child(node, "declaration")
      if (!dec || !kinds.has(dec.type)) continue
      cur = dec
    } else if (!kinds.has(node.type)) {
      continue
    }

    const name = prop(child(cur, "name"))
    if (!name) continue

    let extendsClause: string | undefined
    const ext = cur.descendantsOfType("extends_clause")[0]
    if (ext) {
      extendsClause = prop(ext.descendantsOfType(["type_identifier", "identifier"])[0])
    }

    const target = node.type === "export_statement" ? node : cur
    const description = getLeadingComment(target) || fileComment

    classes.push({
      name,
      description,
      lineStart: cur.startPosition.row + 1,
      lineEnd: cur.endPosition.row + 1,
      extendsClause,
    })
  }

  return classes
}

function extractFunctions(root: Node): ParsedFunction[] {
  const functions: ParsedFunction[] = []
  const classKinds = new Set(["class_declaration", "abstract_class_declaration"])

  for (const node of root.children) {
    let cur = node
    if (node.type === "export_statement") {
      const dec = child(node, "declaration")
      if (!dec) continue
      cur = dec
    }

    if (cur.type === "function_declaration") {
      const name = prop(child(cur, "name"))
      if (!name) continue
      const target = node.type === "export_statement" ? node : cur
      const fnBody = child(cur, "body")
      functions.push({
        name,
        description: getLeadingComment(target),
        lineStart: cur.startPosition.row + 1,
        lineEnd: cur.endPosition.row + 1,
        refs: analyze(cur),
        branches: fnBody ? extractBranches(fnBody) : [],
      })
      continue
    }

    if (cur.type === "lexical_declaration") {
      for (const dec of cur.descendantsOfType("variable_declarator")) {
        const name = prop(child(dec, "name"))
        const value = child(dec, "value")
        if (!name || !value) continue
        if (value.type !== "arrow_function" && value.type !== "function_expression") continue
        const target = node.type === "export_statement" ? node : cur
        const arrowBody = child(value, "body")
        functions.push({
          name,
          description: getLeadingComment(target),
          lineStart: cur.startPosition.row + 1,
          lineEnd: cur.endPosition.row + 1,
          refs: analyze(value),
          branches: arrowBody ? extractBranches(arrowBody) : [],
        })
      }
      continue
    }

    if (!classKinds.has(cur.type)) continue

    const owner = prop(child(cur, "name"))
    const body = child(cur, "body")
    if (!owner || !body) continue

    for (const item of body.children) {
      if (item.type !== "method_definition") continue
      const name = prop(child(item, "name"))
      if (!name) continue
      const methodBody = child(item, "body")
      functions.push({
        name,
        description: getLeadingComment(item),
        lineStart: item.startPosition.row + 1,
        lineEnd: item.endPosition.row + 1,
        parentClass: owner,
        refs: analyze(item),
        branches: methodBody ? extractBranches(methodBody) : [],
      })
    }
  }

  return functions
}

function extractFileComment(root: Node): string {
  for (const node of root.children) {
    if (node.type === "comment") {
      return extractCommentText(node.text)
    }
    break
  }
  if (root.children.length > 0) {
    const first = root.children[0]
    if (first.type !== "comment") {
      const prev = first.previousSibling
      if (prev && prev.type === "comment") {
        return extractCommentText(prev.text)
      }
    }
  }
  return ""
}

export async function parseFile(filePath: string): Promise<ParsedFile> {
  const source = await fs.readFile(filePath, "utf-8")

  if (filePath.endsWith(".py")) {
    return parsePythonFile(filePath, source)
  }

  const parser = await tsParser()
  const tree = parser.parse(source)
  const root = tree!.rootNode as Node
  const fileComment = extractFileComment(root)

  return {
    filePath,
    imports: extractImports(root),
    classes: extractClasses(root, fileComment),
    functions: extractFunctions(root),
    fileComment,
  }
}

function parsePythonFile(filePath: string, source: string): ParsedFile {
  const lines = source.split("\n")
  const imports: ParsedImport[] = []
  const classes: ParsedClass[] = []
  const functions: ParsedFunction[] = []
  let fileComment = ""

  const doc = source.match(/^(?:\s*#[^\n]*\n)*\s*("""[\s\S]*?"""|'''[\s\S]*?''')/)
  if (doc) {
    fileComment = doc[1].replace(/^"""|"""$|^'''|'''$/g, "").trim()
  }

  let owner: { name: string; indent: number } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1
    const indent = line.search(/\S/)
    if (indent === -1) continue

    const fromImport = line.match(/^\s*from\s+(\.{0,3}[\w.]*)\s+import\s+(.+)/)
    if (fromImport) {
      const source = fromImport[1]
      const items = fromImport[2]
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const [imported, local] = x.split(/\s+as\s+/)
          return { imported, local: local ?? imported }
        })
      imports.push({
        source,
        names: items.map((x) => x.imported),
        items,
        typeOnly: false,
        line: lineNum,
      })
      continue
    }

    const plainImport = line.match(/^\s*import\s+([\w.]+)/)
    if (plainImport) {
      const imported = plainImport[1].split(".").pop()!
      imports.push({
        source: plainImport[1],
        names: [imported],
        items: [{ imported, local: imported }],
        typeOnly: false,
        line: lineNum,
      })
      continue
    }

    const cls = line.match(/^(\s*)class\s+(\w+)(?:\(([^)]*)\))?/)
    if (cls) {
      const depth = cls[1].length
      const name = cls[2]
      const extendsClause = cls[3]?.split(",")[0]?.trim() || undefined
      const description = getCommentAbove(lines, i) || getDocstringBelow(lines, i)

      let endLine = lineNum
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]
        const nextIndent = next.search(/\S/)
        if (nextIndent === -1) continue
        if (nextIndent <= depth) break
        endLine = j + 1
      }

      classes.push({ name, description, lineStart: lineNum, lineEnd: endLine, extendsClause })
      owner = { name, indent: depth }
      continue
    }

    const fn = line.match(/^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/)
    if (fn) {
      const depth = fn[1].length
      const name = fn[2]
      const description = getCommentAbove(lines, i) || getDocstringBelow(lines, i)

      let endLine = lineNum
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]
        const nextIndent = next.search(/\S/)
        if (nextIndent === -1) continue
        if (nextIndent <= depth) break
        endLine = j + 1
      }

      functions.push({
        name,
        description,
        lineStart: lineNum,
        lineEnd: endLine,
        parentClass: owner && depth > owner.indent ? owner.name : undefined,
        refs: [],
        branches: [],
      })
      continue
    }

    if (owner && indent <= owner.indent) {
      owner = null
    }
  }

  return { filePath, imports, classes, functions, fileComment }
}

function getCommentAbove(lines: string[], lineIndex: number): string {
  const comments: string[] = []
  for (let i = lineIndex - 1; i >= 0; i--) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith("#")) {
      comments.unshift(trimmed.replace(/^#\s?/, ""))
      continue
    }
    if (trimmed === "") continue
    break
  }
  return comments.join(" ")
}

function getDocstringBelow(lines: string[], lineIndex: number): string {
  for (let i = lineIndex + 1; i < lines.length && i <= lineIndex + 2; i++) {
    const trimmed = lines[i].trim()
    if (trimmed === "") continue
    const one = trimmed.match(/^(?:"""(.*)"""|'''(.*)''')$/)
    if (one) return (one[1] || one[2] || "").trim()
    const start = trimmed.match(/^(?:"""|''')(.*)/)
    if (start) {
      const delim = trimmed.slice(0, 3)
      const parts = [start[1]]
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].includes(delim)) {
          parts.push(lines[j].trim().replace(delim, ""))
          break
        }
        parts.push(lines[j].trim())
      }
      return parts.join(" ").trim()
    }
    break
  }
  return ""
}
