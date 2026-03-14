import { describe, expect, test } from "bun:test"
import { GraphAnalyzer } from "./analyzer"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("GraphAnalyzer", () => {
  test("initialScan produces a valid snapshot", async () => {
    const tmp = join(tmpdir(), "graph-analyzer-test-" + Date.now())
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

    writeFileSync(
      join(tmp2, "src/index.ts"),
      `export function main() {}\nexport function newFn() {}\n`,
    )

    const diff = await analyzer.onFilesChanged([join(tmp2, "src/index.ts")])

    expect(diff).toBeDefined()
    if (diff) {
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
})
