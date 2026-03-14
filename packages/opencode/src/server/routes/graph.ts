import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Instance } from "../../project/instance"
import { GraphAnalyzer } from "../../graph/analyzer"
import { GraphSnapshot, GraphNode, GraphDiff } from "../../graph/schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const analyzers = new Map<string, GraphAnalyzer>()

export function getAnalyzer(directory: string): GraphAnalyzer {
  let analyzer = analyzers.get(directory)
  if (!analyzer) {
    analyzer = new GraphAnalyzer(directory)
    analyzers.set(directory, analyzer)
  }
  return analyzer
}

export const GraphRoutes = lazy(() =>
  new Hono()
    .get(
      "/architecture",
      describeRoute({
        summary: "Get architecture graph",
        description: "Returns the full architecture graph snapshot. Triggers an initial scan on first request.",
        operationId: "graph.architecture",
        responses: {
          200: {
            description: "Full graph snapshot",
            content: {
              "application/json": {
                schema: resolver(GraphSnapshot),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const directory = Instance.directory
        const analyzer = getAnalyzer(directory)
        let snapshot = analyzer.getSnapshot()
        if (!snapshot) {
          snapshot = await analyzer.initialScan()
        }
        return c.json(snapshot)
      },
    )
    .get(
      "/node/:id",
      describeRoute({
        summary: "Get node detail",
        description: "Returns a node and its children for drill-down.",
        operationId: "graph.node",
        responses: {
          200: {
            description: "Node and its children",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    node: GraphNode,
                    children: GraphNode.array(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => {
        const id = c.req.param("id")
        const directory = Instance.directory
        const analyzer = getAnalyzer(directory)
        const detail = analyzer.getNodeDetail(id)
        if (!detail) {
          return c.json({ error: "Node not found" }, 404)
        }
        return c.json(detail)
      },
    )
    .get(
      "/diff",
      describeRoute({
        summary: "Get latest diff",
        description: "Returns null. Diffs are pushed via SSE.",
        operationId: "graph.diff",
        responses: {
          200: {
            description: "Latest diff (null — use SSE for real-time diffs)",
            content: {
              "application/json": {
                schema: resolver(GraphDiff.nullable()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(null)
      },
    )
    .get(
      "/subscribe",
      describeRoute({
        summary: "Subscribe to graph events",
        description: "SSE stream of graph snapshot and diff events.",
        operationId: "graph.subscribe",
        responses: {
          200: {
            description: "SSE event stream",
            content: {
              "text/event-stream": {
                schema: resolver(z.any()),
              },
            },
          },
        },
      }),
      async (c) => {
        const directory = Instance.directory
        const analyzer = getAnalyzer(directory)

        if (!analyzer.getSnapshot()) {
          await analyzer.initialScan()
        }

        return streamSSE(c, async (stream) => {
          const unsubscribe = analyzer.onDiff((diff) => {
            stream.writeSSE({
              event: "graph:diff",
              data: JSON.stringify(diff),
            })
          })

          const snapshot = analyzer.getSnapshot()
          if (snapshot) {
            await stream.writeSSE({
              event: "graph:snapshot",
              data: JSON.stringify(snapshot),
            })
          }

          const keepAlive = setInterval(() => {
            stream.writeSSE({ event: "ping", data: "" }).catch(() => {
              clearInterval(keepAlive)
            })
          }, 30000)

          stream.onAbort(() => {
            unsubscribe()
            clearInterval(keepAlive)
          })
        })
      },
    ),
)
