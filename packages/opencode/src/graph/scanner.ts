// packages/opencode/src/graph/scanner.ts
import { readdir } from "fs/promises"
import { join, extname } from "path"

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".turbo", ".cache", "__pycache__",
  ".venv", "venv", "env", ".env", ".tox", ".mypy_cache", ".ruff_cache",
  ".pytest_cache", "site-packages", ".cargo", "target", "vendor",
  ".output", ".nuxt", ".svelte-kit", "coverage", ".parcel-cache",
  ".agents", ".claude", ".opencode",
])

const NOISE_DIRS = new Set([
  "__tests__",
  "test",
  "tests",
  "e2e",
  "fixture",
  "fixtures",
  "examples",
])

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

  function skip(name: string) {
    if (name.startsWith(".")) return true
    return EXCLUDED_DIRS.has(name) || NOISE_DIRS.has(name)
  }

  function keep(name: string) {
    if (name.includes(".test.") || name.includes(".spec.")) return false
    return SOURCE_EXTENSIONS.has(extname(name))
  }

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
        if (skip(entry.name)) continue
        await walk(join(dir, entry.name))
      } else if (entry.isFile()) {
        if (keep(entry.name)) {
          files.push(join(dir, entry.name))
        }
      }
    }
  }

  await walk(directory)
  return files
}
