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
