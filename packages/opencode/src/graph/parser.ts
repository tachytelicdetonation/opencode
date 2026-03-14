import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"
import { fileURLToPath } from "url"
import fs from "fs/promises"

export interface ParsedImport {
  source: string
  names: string[]
  typeOnly: boolean
  line: number
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

function getLeadingComment(node: any): string {
  let prev = node.previousNamedSibling
  if (prev && prev.type === "comment") {
    return extractCommentText(prev.text)
  }
  // Check previous sibling (including unnamed)
  prev = node.previousSibling
  if (prev && prev.type === "comment") {
    return extractCommentText(prev.text)
  }
  return ""
}

function extractCommentText(text: string): string {
  // Handle JSDoc /** ... */
  if (text.startsWith("/**")) {
    return text
      .replace(/^\/\*\*\s*/, "")
      .replace(/\s*\*\/$/, "")
      .replace(/^\s*\*\s?/gm, "")
      .trim()
  }
  // Handle block comments /* ... */
  if (text.startsWith("/*")) {
    return text
      .replace(/^\/\*\s*/, "")
      .replace(/\s*\*\/$/, "")
      .replace(/^\s*\*\s?/gm, "")
      .trim()
  }
  // Handle line comments //
  if (text.startsWith("//")) {
    return text.replace(/^\/\/\s?/, "").trim()
  }
  return text.trim()
}

function extractImports(rootNode: any): ParsedImport[] {
  const imports: ParsedImport[] = []
  for (const node of rootNode.children) {
    if (node.type === "import_statement") {
      const sourceNode = node.descendantsOfType("string")[0]
      if (!sourceNode) continue
      const source = sourceNode.text.replace(/^['"]|['"]$/g, "")

      const names: string[] = []
      const importClause = node.descendantsOfType("import_clause")[0]
      if (importClause) {
        // Named imports: import { A, B } from "..."
        const namedImports = importClause.descendantsOfType("import_specifier")
        for (const spec of namedImports) {
          const nameNode = spec.childForFieldName("name")
          if (nameNode) names.push(nameNode.text)
        }
        // Default import: import X from "..."
        const identifiers = importClause.descendantsOfType("identifier")
        for (const id of identifiers) {
          // Only add if it's a direct child of the import clause (default import)
          if (id.parent === importClause) {
            names.push(id.text)
          }
        }
        // Namespace import: import * as X from "..."
        const namespaceImports = importClause.descendantsOfType("namespace_import")
        for (const ns of namespaceImports) {
          const id = ns.descendantsOfType("identifier")[0]
          if (id) names.push(id.text)
        }
      }

      // Check if type-only import
      const typeOnly = node.text.includes("import type ")

      imports.push({
        source,
        names,
        typeOnly,
        line: node.startPosition.row + 1,
      })
    }
  }
  return imports
}

function extractClasses(rootNode: any, fileComment: string): ParsedClass[] {
  const classes: ParsedClass[] = []
  const classTypes = ["class_declaration", "abstract_class_declaration"]

  for (const node of rootNode.children) {
    // Handle both direct class declarations and exported ones
    let classNode = node
    if (node.type === "export_statement") {
      const decl = node.childForFieldName("declaration")
      if (decl && classTypes.includes(decl.type)) {
        classNode = decl
      } else {
        continue
      }
    } else if (!classTypes.includes(node.type)) {
      continue
    }

    const nameNode = classNode.childForFieldName("name")
    if (!nameNode) continue

    let extendsClause: string | undefined
    const heritage = classNode.descendantsOfType("extends_clause")[0]
    if (heritage) {
      const extType = heritage.descendantsOfType("type_identifier")[0] || heritage.descendantsOfType("identifier")[0]
      if (extType) extendsClause = extType.text
    }

    // Get the leading comment - check before the export_statement if exported
    const commentTarget = node.type === "export_statement" ? node : classNode
    let description = getLeadingComment(commentTarget)
    // If no direct comment, use the file-level comment as a fallback
    if (!description && fileComment) {
      description = fileComment
    }

    classes.push({
      name: nameNode.text,
      description,
      lineStart: classNode.startPosition.row + 1,
      lineEnd: classNode.endPosition.row + 1,
      extendsClause,
    })
  }
  return classes
}

function extractFunctions(rootNode: any): ParsedFunction[] {
  const functions: ParsedFunction[] = []
  const funcTypes = ["function_declaration", "lexical_declaration"]

  // Top-level functions
  for (const node of rootNode.children) {
    let funcNode = node
    if (node.type === "export_statement") {
      const decl = node.childForFieldName("declaration")
      if (!decl) continue
      funcNode = decl
    }

    if (funcNode.type === "function_declaration") {
      const nameNode = funcNode.childForFieldName("name")
      if (!nameNode) continue
      const commentTarget = node.type === "export_statement" ? node : funcNode
      const description = getLeadingComment(commentTarget)
      functions.push({
        name: nameNode.text,
        description,
        lineStart: funcNode.startPosition.row + 1,
        lineEnd: funcNode.endPosition.row + 1,
      })
    } else if (funcNode.type === "lexical_declaration") {
      // Handle: const foo = (...) => { ... } or const foo = function(...) { ... }
      for (const declarator of funcNode.descendantsOfType("variable_declarator")) {
        const nameNode = declarator.childForFieldName("name")
        const valueNode = declarator.childForFieldName("value")
        if (nameNode && valueNode && (valueNode.type === "arrow_function" || valueNode.type === "function_expression")) {
          const commentTarget = node.type === "export_statement" ? node : funcNode
          const description = getLeadingComment(commentTarget)
          functions.push({
            name: nameNode.text,
            description,
            lineStart: funcNode.startPosition.row + 1,
            lineEnd: funcNode.endPosition.row + 1,
          })
        }
      }
    }
  }

  // Methods inside classes
  const classTypes = ["class_declaration", "abstract_class_declaration"]
  for (const node of rootNode.children) {
    let classNode = node
    if (node.type === "export_statement") {
      const decl = node.childForFieldName("declaration")
      if (decl && classTypes.includes(decl.type)) {
        classNode = decl
      } else {
        continue
      }
    } else if (!classTypes.includes(node.type)) {
      continue
    }

    const nameNode = classNode.childForFieldName("name")
    if (!nameNode) continue
    const className = nameNode.text

    const body = classNode.childForFieldName("body")
    if (!body) continue

    for (const member of body.children) {
      if (member.type === "method_definition") {
        const methodName = member.childForFieldName("name")
        if (!methodName) continue
        const description = getLeadingComment(member)
        functions.push({
          name: methodName.text,
          description,
          lineStart: member.startPosition.row + 1,
          lineEnd: member.endPosition.row + 1,
          parentClass: className,
        })
      }
    }
  }

  return functions
}

function extractFileComment(rootNode: any): string {
  for (const node of rootNode.children) {
    if (node.type === "comment") {
      return extractCommentText(node.text)
    }
    // Stop at first non-comment node
    break
  }
  // Also check if the first statement has a leading comment
  if (rootNode.children.length > 0) {
    const first = rootNode.children[0]
    if (first.type !== "comment") {
      // Check if there's a comment right before it
      const prev = first.previousSibling
      if (prev && prev.type === "comment") {
        return extractCommentText(prev.text)
      }
    }
  }
  return ""
}

export async function parseFile(filePath: string): Promise<ParsedFile> {
  const parser = await tsParser()
  const source = await fs.readFile(filePath, "utf-8")
  const tree = parser.parse(source)

  const rootNode = tree.rootNode

  const fileComment = extractFileComment(rootNode)

  return {
    filePath,
    imports: extractImports(rootNode),
    classes: extractClasses(rootNode, fileComment),
    functions: extractFunctions(rootNode),
    fileComment,
  }
}
