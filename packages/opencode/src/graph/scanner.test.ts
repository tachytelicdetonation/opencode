// packages/opencode/src/graph/scanner.test.ts
import { describe, expect, test } from "bun:test"
import { scanProjectFiles } from "./scanner"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("scanProjectFiles", () => {
  const tmp = join(tmpdir(), "graph-scanner-test-" + Date.now())

  test("collects source files, excludes node_modules and .git", async () => {
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
