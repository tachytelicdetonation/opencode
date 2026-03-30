# Integrated Flow Architecture Graph — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the architecture graph from a static dependency diagram into an integrated flow visualization — modules render as subgraph containers showing their functions, call chains, and decision nodes (if/else/switch), with change-state highlighting for agent-modified code.

**Architecture:** The parser extracts control flow structures (if/else, switch) from function bodies as `ParsedBranch` data. The builder creates decision nodes (children of functions) with branch edges. The frontend uses ELK compound nodes to render modules as subgraph containers with their children visible inside. Change state (`added`/`modified`/`deleted`) is visualized via glow borders on affected nodes.

**Tech Stack:** TypeScript, web-tree-sitter (parser), ELK.js (layout), SolidJS + SVG (rendering)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/opencode/src/graph/parser.ts` | Modify | Add `ParsedBranch` interface, extract control flow from function bodies |
| `packages/opencode/src/graph/schema.ts` | Modify | Add `"decision"` node type, `condition` field |
| `packages/opencode/src/graph/builder.ts` | Modify | Create decision nodes + branch edges from `ParsedBranch` data |
| `packages/app/src/context/graph/types.ts` | Modify | Mirror schema changes (add `"decision"` type, `condition` field) |
| `packages/app/src/context/graph/layout.ts` | Modify | ELK compound nodes for subgraph layout, decision node sizing |
| `packages/app/src/components/graph/graph-node.tsx` | Modify | Diamond shape for decision nodes, change-state glow, subgraph container rendering |
| `packages/app/src/components/graph/graph-edge.tsx` | Modify | Branch label styling |
| `packages/app/src/components/graph/graph-animations.css` | Modify | Change-state glow animations |
| `packages/app/src/components/graph/graph-canvas.tsx` | Modify | Nested rendering for compound nodes |

---

## Chunk 1: Backend — Parser + Schema + Builder

### Task 1: Add `ParsedBranch` to parser types

**Files:**
- Modify: `packages/opencode/src/graph/parser.ts:34-63`

- [ ] **Step 1: Add ParsedBranch interface after ParsedRef (line 38)**

```typescript
export interface ParsedBranch {
  kind: "if" | "switch" | "try"
  condition: string       // e.g., "config.mode === 'demo'"
  lineStart: number
  branches: {
    label: string         // e.g., "true", "false", "case 'demo'", "catch"
    refs: ParsedRef[]     // refs inside this branch
  }[]
}
```

- [ ] **Step 2: Add `branches` field to ParsedFunction (line 55)**

```typescript
export interface ParsedFunction {
  name: string
  description: string
  lineStart: number
  lineEnd: number
  parentClass?: string
  refs: ParsedRef[]
  branches: ParsedBranch[]  // NEW
}
```

- [ ] **Step 3: Verify build passes**

Run: `cd packages/opencode && bun run build 2>&1 | tail -5`
Expected: Build succeeds (branches defaults to `[]` in existing code paths)

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/graph/parser.ts
git commit -m "feat(graph): add ParsedBranch type for control flow extraction"
```

---

### Task 2: Extract control flow from function bodies in parser

**Files:**
- Modify: `packages/opencode/src/graph/parser.ts` — the `analyze()` function (lines 263-314)

- [ ] **Step 1: Add `extractBranches` function after `analyze()` (after line 314)**

This function walks a function's AST body to find if/switch/try statements and extracts their branches with the refs inside each branch.

Note: The codebase uses a local `Node` type alias (parser.ts lines 6-17), NOT tree-sitter's `SyntaxNode`. Only top-level control flow in function bodies is extracted (not nested inside loops/other blocks). This is intentional to keep the graph simple. Python files will have `branches: []` since the Python parser is regex-based.

```typescript
function extractBranches(body: Node): ParsedBranch[] {
  const branches: ParsedBranch[] = []

  for (const node of body.children) {
    if (node.type === "if_statement") {
      const condition = node.childForFieldName("condition")?.text ?? "?"
      const consequence = node.childForFieldName("consequence")
      const alternative = node.childForFieldName("alternative")

      const branch: ParsedBranch = {
        kind: "if",
        condition: condition.length > 50 ? condition.slice(0, 47) + "..." : condition,
        lineStart: node.startPosition.row + 1,
        branches: [],
      }

      if (consequence) {
        branch.branches.push({
          label: "true",
          refs: analyzeBlock(consequence),
        })
      }
      if (alternative) {
        // else-if is nested, else is a block
        const altBody = alternative.type === "else_clause"
          ? alternative.children.find(c => c.type === "statement_block" || c.type === "if_statement")
          : alternative
        branch.branches.push({
          label: "false",
          refs: altBody ? analyzeBlock(altBody) : [],
        })
      }

      if (branch.branches.length > 0) branches.push(branch)
    }

    if (node.type === "switch_statement") {
      const condition = node.childForFieldName("value")?.text ?? "?"
      const branch: ParsedBranch = {
        kind: "switch",
        condition: condition.length > 50 ? condition.slice(0, 47) + "..." : condition,
        lineStart: node.startPosition.row + 1,
        branches: [],
      }

      const switchBody = node.childForFieldName("body")
      if (switchBody) {
        for (const caseNode of switchBody.children) {
          if (caseNode.type === "switch_case" || caseNode.type === "switch_default") {
            const caseValue = caseNode.childForFieldName("value")?.text ?? "default"
            branch.branches.push({
              label: caseValue,
              refs: analyzeBlock(caseNode),
            })
          }
        }
      }

      if (branch.branches.length > 0) branches.push(branch)
    }

    if (node.type === "try_statement") {
      const tryBody = node.childForFieldName("body")
      const handler = node.childForFieldName("handler")

      const branch: ParsedBranch = {
        kind: "try",
        condition: "try/catch",
        lineStart: node.startPosition.row + 1,
        branches: [],
      }

      if (tryBody) {
        branch.branches.push({
          label: "try",
          refs: analyzeBlock(tryBody),
        })
      }
      if (handler) {
        const catchBody = handler.childForFieldName("body")
        branch.branches.push({
          label: "catch",
          refs: catchBody ? analyzeBlock(catchBody) : [],
        })
      }

      if (branch.branches.length > 0) branches.push(branch)
    }
  }

  return branches
}

function analyzeBlock(node: Node): ParsedRef[] {
  const refs: ParsedRef[] = []
  const aliases = new Map<string, string>()

  function walkBlock(n: Node) {
    if (n.type === "call_expression") {
      const ref = readRef(n.childForFieldName("function")!, aliases)
      if (ref) refs.push({ ...ref, kind: "call" })
    } else if (n.type === "new_expression") {
      const ref = readRef(n.childForFieldName("constructor")!, aliases)
      if (ref) refs.push({ ...ref, kind: "new" })
    }
    for (const child of n.children) {
      walkBlock(child)
    }
  }

  walkBlock(node)
  return refs
}
```

- [ ] **Step 2: Wire `extractBranches` into function parsing**

In the function parsing section where `ParsedFunction` objects are created (around lines 220-250), add branches extraction. Find where function bodies are available and call `extractBranches(body)`.

Look for the pattern where functions are pushed to the result array and add:
```typescript
branches: body ? extractBranches(body) : [],
```

Also ensure existing places that create `ParsedFunction` objects include `branches: []` for the Python parser (around line 599).

- [ ] **Step 3: Verify build**

Run: `cd packages/opencode && bun run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/graph/parser.ts
git commit -m "feat(graph): extract control flow branches from function bodies"
```

---

### Task 3: Add decision node type to schema

**Files:**
- Modify: `packages/opencode/src/graph/schema.ts:3-14`

- [ ] **Step 1: Add "decision" to GraphNode type enum (line 5)**

```typescript
type: z.enum(["subsystem", "module", "class", "function", "decision"]),
```

- [ ] **Step 2: Add optional `condition` field to GraphNode (after line 11)**

```typescript
condition: z.string().optional(),
```

- [ ] **Step 3: Verify build**

Run: `cd packages/opencode && bun run build 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/graph/schema.ts
git commit -m "feat(graph): add decision node type and condition field to schema"
```

---

### Task 4: Mirror schema changes in frontend types + layout + filters

**Files:**
- Modify: `packages/app/src/context/graph/types.ts`
- Modify: `packages/app/src/context/graph/layout.ts`
- Modify: `packages/app/src/context/graph/index.tsx`

All three must be updated together to avoid exhaustiveness build errors.

- [ ] **Step 1: Add "decision" to GraphNode type union in types.ts (line 3)**

```typescript
type: "subsystem" | "module" | "class" | "function" | "decision"
```

- [ ] **Step 2: Add `condition` field to GraphNode in types.ts (after line 9)**

```typescript
condition?: string
```

- [ ] **Step 3: Add decision node sizing to layout.ts nodeWidth/nodeHeight**

Add `case "decision"` to both switch statements:
```typescript
// In nodeWidth:
case "decision": return Math.max(80, labelLen * 6 + 30)

// In nodeHeight:
case "decision": return 40
```

- [ ] **Step 4: Add "decision" to store filters in index.tsx**

```typescript
decision: true,
```

- [ ] **Step 5: Verify build**

Run: `cd packages/app && bun run build 2>&1 | tail -5`

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/context/graph/types.ts packages/app/src/context/graph/layout.ts packages/app/src/context/graph/index.tsx
git commit -m "feat(graph): add decision type to frontend types, layout, and filters"
```

---

### Task 5: Builder creates decision nodes and branch edges

**Files:**
- Modify: `packages/opencode/src/graph/builder.ts`

- [ ] **Step 1: Update the function ref processing loop (lines 494-506)**

After the existing ref loop, add decision node creation from branches:

```typescript
// After the existing ref loop (line 506), add:
for (const branch of fn.branches) {
  const decisionId = `${source}::${branch.kind}_L${branch.lineStart}`
  addNode(nodes, byId, {
    id: decisionId,
    type: "decision",
    label: branch.condition,
    condition: branch.condition,
    filePath: file,
    lineRange: [branch.lineStart, branch.lineStart],
    children: [],
    parent: source,
    lastModified: now,
  })

  // Add edge from function to decision
  addEdge(edges, source, decisionId, "calls", branch.condition)

  // Add edges from decision to targets in each branch
  for (const b of branch.branches) {
    for (const ref of b.refs) {
      const target = resolveRef(root, file, item, fn, ref, allFiles, info)
      if (target && target !== source) {
        addEdge(edges, decisionId, target, "calls", b.label)
      }
    }
  }
}
```

- [ ] **Step 2: Update the `addNode` calls to include children for functions that have decisions**

After creating decision nodes for a function, update the function node's `children` array to include decision node IDs. Find where functions are added via `addNode` and push decision IDs to `kids`:

```typescript
// After the branch processing loop, update the parent function's children
const fnNode = byId.get(source!)
if (fnNode) {
  for (const branch of fn.branches) {
    const decisionId = `${source}::${branch.kind}_L${branch.lineStart}`
    if (!fnNode.children.includes(decisionId)) {
      fnNode.children.push(decisionId)
    }
  }
}
```

- [ ] **Step 3: Verify build**

Run: `cd packages/opencode && bun run build 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add packages/opencode/src/graph/builder.ts
git commit -m "feat(graph): create decision nodes and branch edges from control flow"
```

---

## Chunk 2: Frontend — Layout + Rendering

### Task 6: Diamond shape renderer for decision nodes

**Files:**
- Modify: `packages/app/src/components/graph/graph-node.tsx`

- [ ] **Step 1: Add decision style to NODE_STYLES object**

After the `function` entry in NODE_STYLES:

```typescript
decision: {
  fill: "rgba(255, 130, 100, 0.08)",
  fillHighlight: "rgba(255, 130, 100, 0.16)",
  border: "rgba(255, 150, 120, 0.35)",
  borderHighlight: "rgba(255, 170, 140, 0.65)",
  badge: "rgba(255, 180, 150, 0.85)",
  badgeBg: "rgba(255, 140, 110, 0.12)",
  rx: 4,
  borderWidth: 1,
},
```

- [ ] **Step 2: Add "decision" to TYPE_LABEL map**

```typescript
decision: "IF",
```

- [ ] **Step 3: Add diamond rendering path for decision nodes**

In the `GraphNodeSVG` component, replace the shadow + background rect rendering with conditional logic. Before the existing `<rect>` elements (around line 87), add a check:

```typescript
{/* Diamond shape for decision nodes */}
<Show when={props.node.type === "decision"} fallback={
  <>
    {/* Shadow */}
    <rect x={1} y={2} width={w()} height={h()} rx={ns().rx} fill="rgba(0,0,0,0.20)" />
    {/* Background + border */}
    <rect
      width={w()} height={h()} rx={ns().rx}
      fill={props.highlighted ? ns().fillHighlight : ns().fill}
      stroke={props.highlighted ? ns().borderHighlight : ns().border}
      stroke-width={ns().borderWidth}
      class="graph-node-body"
    />
  </>
}>
  {/* Diamond shape */}
  <polygon
    points={`${w()/2},0 ${w()},${h()/2} ${w()/2},${h()} 0,${h()/2}`}
    fill={props.highlighted ? ns().fillHighlight : ns().fill}
    stroke={props.highlighted ? ns().borderHighlight : ns().border}
    stroke-width={ns().borderWidth}
    class="graph-node-body"
  />
</Show>
```

For decision nodes, the foreignObject content should show just the condition text centered, no type badge or description:

```typescript
<Show when={props.node.type === "decision"} fallback={/* existing content */}>
  <foreignObject x={0} y={0} width={w()} height={h()}>
    <div class="graph-node-content" style={{
      width: "100%",
      height: "100%",
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      "text-align": "center",
      padding: "4px 12px",
      "box-sizing": "border-box",
    }}>
      <span style={{
        "font-family": "var(--font-mono)",
        "font-size": "10px",
        "font-weight": "500",
        color: ns().badge,
      }}>
        {props.node.condition ?? props.node.label}
      </span>
    </div>
  </foreignObject>
</Show>
```

- [ ] **Step 4: Verify build**

Run: `cd packages/app && bun run build 2>&1 | tail -5`

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/graph/graph-node.tsx
git commit -m "feat(graph): add diamond shape renderer for decision nodes"
```

---

### Task 7: Change-state visual indicators

**Files:**
- Modify: `packages/app/src/components/graph/graph-node.tsx`
- Modify: `packages/app/src/components/graph/graph-animations.css`

- [ ] **Step 1: Add change-state border rendering in graph-node.tsx**

After the main background rect (or diamond), add a conditional glow border for changed nodes. Insert after the background shape rendering:

```typescript
{/* Change state indicator */}
<Show when={props.node.changeState}>
  <rect
    x={-2} y={-2}
    width={w() + 4} height={h() + 4}
    rx={ns().rx + 2}
    fill="none"
    stroke={
      props.node.changeState === "added" ? "rgba(80, 220, 120, 0.5)"
      : props.node.changeState === "modified" ? "rgba(80, 180, 255, 0.5)"
      : "rgba(255, 100, 80, 0.5)"
    }
    stroke-width={1.5}
    stroke-dasharray={props.node.changeState === "deleted" ? "4,3" : undefined}
    class="graph-node-change-glow"
  />
</Show>
```

- [ ] **Step 2: Add glow animation to graph-animations.css**

```css
/* Change state glow */
.graph-node-change-glow {
  animation: change-glow-pulse 2.5s ease-in-out infinite;
}
@keyframes change-glow-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
```

- [ ] **Step 3: Verify build**

Run: `cd packages/app && bun run build 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/components/graph/graph-node.tsx packages/app/src/components/graph/graph-animations.css
git commit -m "feat(graph): add change-state glow indicators for agent-modified nodes"
```

---

## Chunk 3: Integration + Polish

### Task 8: Edge label styling for branch conditions

**Files:**
- Modify: `packages/app/src/components/graph/graph-edge.tsx`

- [ ] **Step 1: Add `alwaysShowLabel` prop to GraphEdgeSVG**

Add to the component props interface in graph-edge.tsx:

```typescript
export const GraphEdgeSVG: Component<{
  edge: GraphEdge
  sourcePos: Position
  targetPos: Position
  highlighted?: boolean
  alwaysShowLabel?: boolean  // NEW
}>
```

Update the label group opacity (around line 120):
```typescript
opacity={props.highlighted || props.alwaysShowLabel ? 1 : 0}
```

- [ ] **Step 2: In graph-canvas.tsx, compute alwaysShowLabel when rendering edges**

In the `<For each={visibleEdges()}>` block (around line 263 in graph-canvas.tsx):

```typescript
const isDecisionEdge = () => {
  const sn = store.graph?.nodes[edge.source]
  const tn = store.graph?.nodes[edge.target]
  return sn?.type === "decision" || tn?.type === "decision"
}
```

Pass as prop:
```typescript
alwaysShowLabel={isDecisionEdge()}
```

- [ ] **Step 3: Verify build**

Run: `cd packages/app && bun run build 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/components/graph/graph-edge.tsx packages/app/src/components/graph/graph-canvas.tsx
git commit -m "feat(graph): always show labels on decision node edges"
```

---

### Task 9: Verify end-to-end and build both packages

**Files:**
- All modified files

- [ ] **Step 1: Build backend package**

Run: `cd packages/opencode && bun run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 2: Build frontend package**

Run: `cd packages/app && bun run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Start desktop app and verify**

Run: `bun run dev:desktop` (in background)
Expected: App launches. Navigate to Architecture tab.

Verify:
1. Decision diamonds appear when drilling into functions with if/else/switch
2. Branch labels ("true"/"false"/"catch") visible on edges from diamonds
3. Changed nodes (if any have changeState set) show pulsing glow border
4. Call edges show between functions
5. Graph renders without errors

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(graph): integration fixes for control flow visualization"
```
