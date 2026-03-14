export type GraphNode = {
  id: string
  type: "subsystem" | "module" | "class" | "function"
  label: string
  description?: string
  filePath: string
  lineRange?: [number, number]
  children: string[]
  parent?: string
  lastModified: number
  changeState?: "added" | "modified" | "deleted"
}

export type GraphEdge = {
  id: string
  source: string
  target: string
  type: "imports" | "extends" | "implements" | "calls" | "composes"
  label?: string
}

export type GraphDiff = {
  eventId: string
  added: GraphNode[]
  modified: GraphNode[]
  removed: string[]
  edgesAdded: GraphEdge[]
  edgesRemoved: string[]
}

export type GraphSnapshot = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  eventId: string
}

export type Position = {
  x: number
  y: number
  width: number
  height: number
}

export type Annotation = {
  id: string
  nodeId: string
  text: string
  position: { x: number; y: number }
}

export type VisualEdit = {
  type: "connect" | "disconnect" | "annotate" | "move" | "rename"
  subject: string
  target?: string
  text?: string
  compiledPrompt: string
}
