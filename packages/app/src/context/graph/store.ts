import type { GraphNode, GraphEdge, GraphDiff, GraphSnapshot } from "./types"

export type GraphStoreState = {
  nodes: Record<string, GraphNode>
  edges: GraphEdge[]
  eventId: string
}

export function applySnapshot(snapshot: GraphSnapshot): GraphStoreState {
  const nodes: Record<string, GraphNode> = {}
  for (const node of snapshot.nodes) {
    nodes[node.id] = node
  }
  return { nodes, edges: snapshot.edges, eventId: snapshot.eventId }
}

export function applyDiff(state: GraphStoreState, diff: GraphDiff): GraphStoreState {
  const nodes = { ...state.nodes }
  for (const node of diff.added) nodes[node.id] = node
  for (const node of diff.modified) nodes[node.id] = node
  for (const id of diff.removed) delete nodes[id]

  const removedEdgeSet = new Set(diff.edgesRemoved)
  const edges = state.edges.filter((e) => !removedEdgeSet.has(e.id)).concat(diff.edgesAdded)

  return { nodes, edges, eventId: diff.eventId }
}
