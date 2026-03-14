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

    for (const filePath of paths) {
      try {
        const parsed = await parseFile(filePath)
        this.parsedFiles.set(filePath, parsed)
      } catch {
        this.parsedFiles.delete(filePath)
      }
    }

    const newSnapshot = buildGraph(this.directory, this.parsedFiles)
    const newNodes = new Map(newSnapshot.nodes.map((n) => [n.id, n]))
    const newEdges = new Map(newSnapshot.edges.map((e) => [e.id, e]))

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

    if (
      added.length === 0 &&
      modified.length === 0 &&
      removed.length === 0 &&
      edgesAdded.length === 0 &&
      edgesRemoved.length === 0
    ) {
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

  getWatchlist(): string[] {
    return [...this.parsedFiles.keys()]
  }

  onDiff(listener: (diff: GraphDiff) => void): () => void {
    this.diffListeners.push(listener)
    return () => {
      this.diffListeners = this.diffListeners.filter((l) => l !== listener)
    }
  }
}
