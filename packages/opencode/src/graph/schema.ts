import z from "zod"

export const GraphNode = z.object({
  id: z.string(),
  type: z.enum(["subsystem", "module", "class", "function"]),
  label: z.string(),
  description: z.string().optional(),
  filePath: z.string(),
  lineRange: z.tuple([z.number(), z.number()]).optional(),
  children: z.array(z.string()),
  parent: z.string().optional(),
  lastModified: z.number(),
  changeState: z.enum(["added", "modified", "deleted"]).optional(),
})
export type GraphNode = z.infer<typeof GraphNode>

export const GraphEdge = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.enum(["imports", "extends", "implements", "calls", "composes"]),
  label: z.string().optional(),
})
export type GraphEdge = z.infer<typeof GraphEdge>

export const GraphDiff = z.object({
  eventId: z.string(),
  added: z.array(GraphNode),
  modified: z.array(GraphNode),
  removed: z.array(z.string()),
  edgesAdded: z.array(GraphEdge),
  edgesRemoved: z.array(z.string()),
})
export type GraphDiff = z.infer<typeof GraphDiff>

export const GraphSnapshot = z.object({
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
  eventId: z.string(),
})
export type GraphSnapshot = z.infer<typeof GraphSnapshot>
