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
