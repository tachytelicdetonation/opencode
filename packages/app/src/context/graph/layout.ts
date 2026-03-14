import ELK from "elkjs/lib/elk-api"
import type { GraphNode, GraphEdge, Position } from "./types"

// Use elk-api (browser-compatible) instead of main entry which requires 'web-worker'
const elk = new ELK()

export async function computeLayout(
  nodes: Record<string, GraphNode>,
  edges: GraphEdge[],
  focusedNode?: string,
): Promise<Record<string, Position>> {
  const visibleNodes = Object.values(nodes).filter((n) => {
    if (!focusedNode) return !n.parent
    return n.parent === focusedNode
  })

  if (visibleNodes.length === 0) return {}

  const visibleIds = new Set(visibleNodes.map((n) => n.id))
  const visibleEdges = edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))

  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "60",
      "elk.padding": "[top=20,left=20,bottom=20,right=20]",
    },
    children: visibleNodes.map((node) => ({
      id: node.id,
      width: nodeWidth(node),
      height: nodeHeight(node),
    })),
    edges: visibleEdges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  }

  const layout = await elk.layout(graph)
  const positions: Record<string, Position> = {}

  for (const child of layout.children ?? []) {
    positions[child.id] = {
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? nodeWidth(nodes[child.id]),
      height: child.height ?? nodeHeight(nodes[child.id]),
    }
  }

  return positions
}

function nodeWidth(node: GraphNode): number {
  const labelLen = node.label.length
  switch (node.type) {
    case "subsystem": return Math.max(160, labelLen * 9 + 40)
    case "module": return Math.max(140, labelLen * 8 + 30)
    case "class": return Math.max(120, labelLen * 8 + 30)
    case "function": return Math.max(100, labelLen * 7 + 20)
  }
}

function nodeHeight(node: GraphNode): number {
  switch (node.type) {
    case "subsystem": return 60
    case "module": return 50
    case "class": return 50
    case "function": return 40
  }
}
