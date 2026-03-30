import ELK from "elkjs/lib/elk.bundled"
import type { GraphNode, GraphEdge, Position } from "./types"

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
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "20",
      "elk.layered.spacing.edgeNodeBetweenLayers": "25",
      "elk.padding": "[top=40,left=40,bottom=40,right=40]",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.crossingMinimization.greedySwitch.type": "TWO_SIDED",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.considerModelOrder.strategy": "PREFER_EDGES",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.mergeEdges": "true",
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
    case "subsystem": return Math.max(200, labelLen * 8.5 + 50)
    case "module": return Math.max(180, labelLen * 8 + 44)
    case "class": return Math.max(170, labelLen * 8 + 44)
    case "function": return Math.max(120, labelLen * 7 + 24)
    case "decision": return Math.max(80, labelLen * 6 + 30)
  }
}

function nodeHeight(node: GraphNode): number {
  const hasDesc = !!node.description
  switch (node.type) {
    case "subsystem": return hasDesc ? 80 : 52
    case "module": return hasDesc ? 76 : 48
    case "class": return hasDesc ? 76 : 48
    case "function": return 38
    case "decision": return 40
  }
}
