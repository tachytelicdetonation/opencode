# Code Visualizer — Design Spec

**Date:** 2026-03-14
**Status:** Draft
**Branch:** `sea-voyage`

## Overview

A real-time code visualization sidebar integrated into the OpenCode Tauri desktop app that renders an interactive architecture overview of the codebase. The visualizer updates in real-time as the AI makes changes, supports hierarchical drill-down from project level to source code, and allows users to visually edit the graph and submit those edits as instructions to a new chat session.

### Scope

**v1 (this spec):** Architecture overview — high-level system components, their relationships, real-time updates, hierarchical drill-down, and visual editing.

**Future (backlog):** Class/type diagrams, call graphs, dependency graphs, control flow diagrams, sequence diagrams, file tree heat maps, data flow diagrams, entity-relationship diagrams, state machine diagrams.

## Architecture

### System Components

**Backend (Sidecar Server) — new components:**

1. **Static Analyzer** — parses the codebase using tree-sitter (already bundled in OpenCode). Extracts imports, exports, classes, functions, interfaces, and crucially, JSDoc/docstrings/file-level comment headers as the primary metadata source for graph labels. Clusters files into subsystems by directory structure and import density. Produces a graph JSON (nodes + edges).

2. **Graph API** — new Hono routes on the existing server:
   - `GET /graph/architecture` — full graph at the top zoom level
   - `GET /graph/node/:id` — drill-down detail for a specific node
   - `GET /graph/diff?since=<eventId>` — incremental updates since a known state
   - Graph events pushed via the existing WebSocket sync channel (new `graph` topic)

3. **Comment Enrichment** — LLM-powered comment improvement that writes better comments into the actual source files, not into the graph. Runs in two modes:
   - **Initial scan:** One-time full codebase review at first activation
   - **Post-task:** After the AI completes a task, runs `git diff --name-only` against the pre-task state and sends only changed files to the LLM for comment improvement. Token-efficient — never runs during a task, only after.

**Frontend (Tauri Webview) — new components:**

4. **Visualizer Panel** — a new toggleable, resizable panel in the existing layout system. Renders an interactive SVG graph using SolidJS native SVG components with Elkjs for layout computation. Includes toolbar, breadcrumb navigation, and graph canvas.

5. **Graph State Store** — SolidJS reactive store (`createStore` + `persisted`) holding nodes, edges, layout positions, change history for highlight effects, user annotations, drill-down navigation stack, and pending visual edits.

6. **Visual Editor** — an edit mode within the visualizer that lets users draw connections, add annotations, drag nodes between groups, and delete edges. Visual edits are compiled into natural language instructions and submitted to a new chat session.

**Modifications to existing code:**

7. **Tool Pipeline** — small hook added to write/edit/bash tool handlers to emit `file-changed` events, triggering the static analyzer to re-parse affected files.

### Two Update Loops

**Real-time loop (after each tool call):**
```
Tool executes (write/edit/bash)
  → Tool pipeline emits { type: "file-changed", paths: string[] }
  → Static analyzer re-parses ONLY affected files (debounced 100ms)
  → Produces graph diff: { added, modified, removed, edgesChanged }
  → Diff pushed via existing WebSocket to frontend
  → SolidJS store reconciles diff reactively
  → SVG transitions animate changes (glow, fade, reposition)
```

During this loop, graph labels come from whatever comments already exist in the source. The graph is structurally accurate in real-time but labels may be basic (just function/class names + existing comments).

**Post-task enrichment loop (after task completes):**
```
AI session reaches terminal state (task done / user sends next message / 10s idle)
  → git diff --name-only against pre-task state
  → Only changed files sent to LLM with comment-writing prompt
  → LLM writes/updates comments IN the source files
  → Static analyzer re-reads those files
  → Graph labels get enriched with better descriptions
```

### What Triggers Re-parse

| Tool | Triggers re-parse? | Reason |
|---|---|---|
| `write` | Yes | File content changed |
| `edit` | Yes | File content changed |
| `bash` | Yes (conditional) | Check if project files changed via mtime |
| `read`, `grep`, `glob`, `ls` | No | Read-only |
| `webfetch`, `websearch` | No | External, no file changes |

### Debouncing

If the AI fires multiple edits in quick succession (e.g., a multi-file refactor), the re-parse is debounced at 100ms. All changed paths are batched and parsed once. The frontend receives one diff, not five.

### Large Codebase Fallback

If initial scan exceeds 5000 files, the analyzer starts with just the top 2 directory levels and lazily parses deeper levels on drill-down. The graph shows "unexpanded" nodes that parse on click.

## Data Model

### GraphNode

```typescript
type GraphNode = {
  id: string                    // e.g. "src/auth/index.ts::AuthService"
  type: "subsystem" | "module" | "class" | "function"
  label: string                 // extracted from comments or name
  description?: string          // from JSDoc/docstring (enriched post-task)
  filePath: string              // absolute file path
  lineRange?: [number, number]  // for classes/functions
  children: string[]            // child node IDs (for drill-down)
  parent?: string               // parent node ID (for breadcrumb)
  lastModified: number          // timestamp of last change
  changeState?: "added" | "modified" | "deleted"
}
```

### GraphEdge

```typescript
type GraphEdge = {
  id: string
  source: string                // node ID
  target: string                // node ID
  type: "imports" | "extends" | "implements" | "calls" | "composes"
  label?: string                // from comments, e.g. "validates tokens"
}
```

### GraphState (Frontend Store)

```typescript
type GraphState = {
  nodes: Map<string, GraphNode>
  edges: GraphEdge[]
  zoomLevel: 1 | 2 | 3 | 4
  focusedNode?: string          // current drill-down target
  navigationStack: string[]     // breadcrumb history
  userAnnotations: Annotation[]
  pendingEdits: VisualEdit[]    // edits queued for chat submission
  layoutCache: Map<string, Position>
}
```

### VisualEdit

```typescript
type VisualEdit = {
  type: "connect" | "disconnect" | "annotate" | "move" | "rename"
  subject: string               // node/edge ID
  target?: string               // for connections
  text?: string                 // for annotations
  compiledPrompt: string        // natural language version
}
```

### Hierarchical Zoom Levels

| Level | Shows | Click behavior |
|---|---|---|
| L1 | Project → Subsystems (clusters) | Drill into subsystem |
| L2 | Subsystem → Modules / Files | Drill into module |
| L3 | Module → Classes / Functions | Drill into function |
| L4 | Function → Source code view (syntax highlighted) | — |

### Subsystem Clustering

At Level 1, the analyzer groups files into subsystems by:
1. Top-level directory structure (e.g. `packages/app`, `packages/sdk`)
2. Import density — files that import each other heavily get clustered together
3. File-level comments (e.g. `// Auth subsystem`) if present

## UI Layout & Panel Integration

### Panel Placement

Right-side panel, same position as the existing file tree / review panels. Added as an additional panel option alongside those. Follows the existing layout store pattern.

### Layout Store Addition

```typescript
// Added to the existing layout store in context/layout.tsx
visualizer: {
  opened: false,
  width: DEFAULT_PANEL_WIDTH,  // 344px default, resizable
  zoomLevel: 1 as 1 | 2 | 3 | 4,
  focusedNode: undefined as string | undefined,
}
```

### Panel Anatomy (Top to Bottom)

1. **Toolbar** — compact bar at top
   - Toggle: Navigate mode / Edit mode
   - Search input (find & focus a component)
   - Zoom level indicator + fit-to-screen button
   - Filter dropdown (show/hide by node type)

2. **Breadcrumb** — shows drill-down path
   - `Project > packages/app > context > layout.tsx`
   - Click any segment to jump back

3. **Graph Canvas** — main SVG area
   - Pan by dragging background
   - Zoom with scroll wheel
   - Nodes styled by type:
     - Subsystem = rounded rectangle
     - Module = rectangle
     - Class = rounded diamond
     - Function = circle
   - Edges colored by type:
     - imports = gray
     - extends = blue
     - calls = green
     - implements = purple
     - composes = orange
   - Modified nodes have a pulsing glow ring
   - New nodes fade in, deleted nodes fade out
   - Layout transitions animate smoothly

4. **Edit Bar** (only visible in edit mode) — bottom bar
   - Shows count of pending edits: "3 edits pending"
   - "Submit to Chat" button → compiles edits to natural language, opens new session
   - "Clear" button → discards all pending edits

### Resize Handle

Uses the existing `ResizeHandle` component from `@opencode-ai/ui/resize-handle`.

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+Shift+V` | Toggle visualizer panel |
| `Escape` | Zoom out one level / exit edit mode |
| `Cmd+F` (panel focused) | Search nodes |

## Interaction Model

### Navigate (Read)

- **Click node** → Drill into sub-components (next zoom level)
- **Breadcrumb click** → Navigate back up levels
- **Scroll wheel** → Zoom in/out
- **Drag canvas** → Pan around
- **Hover node** → Show comment/description tooltip
- **Search bar** → Find and focus a component

### Edit (Write → Chat)

- **Draw connection** → Compiles to "Connect A to B"
- **Add annotation** → Compiles to "Add logging to X"
- **Drag node to new group** → Compiles to "Move X into Y module"
- **Delete connection** → Compiles to "Remove dependency A→B"
- **Submit button** → Compiles all pending edits into a single prompt, opens new chat session pre-filled with that prompt and relevant file context

### Observe (Real-time)

- **AI writes/edits a file** → Affected node glows with pulsing ring, edges animate if relationships changed
- **New file created** → Node appears with entrance animation
- **File deleted** → Node fades out with exit animation
- **Structural change** → Graph smoothly re-layouts with CSS transition animation

## Technology Choices

### Maximize Reuse of Existing OpenCode Infrastructure

| Concern | Reuses from OpenCode | New work |
|---|---|---|
| AST parsing | tree-sitter (already bundled) | Add comment extraction queries |
| WebSocket events | SyncProvider (existing WS channel) | Add `graph` event topic |
| State management | `createStore` + `persisted` (existing pattern) | Graph-specific store shape |
| Panel UI | `ResizeHandle`, layout store, sidebar pattern, `@kobalte/core` | Visualizer-specific components |
| SVG rendering | SolidJS native SVG (no new lib needed) | Node/edge components |
| HTTP API | Hono routes (existing server framework) | `/graph/*` endpoints |
| Syntax highlighting | Shiki (existing, for L4 source view) | Nothing |
| Markdown in tooltips | marked (existing) | Nothing |
| Styling | Tailwind + existing CSS variables/theme tokens | Visualizer-specific classes |
| Icons | Existing sprite icon system | A few graph-specific icons |
| Keyboard shortcuts | Existing keybind system | New bindings |
| Session spawning | Existing session creation API | Pre-fill prompt from visual edits |
| Persistence | Existing `Persist` utility | Visualizer panel state |
| LLM for enrichment | Configured provider/model from user session | Comment-writing system prompt |

### Only New Dependency

**`elkjs`** (~150KB gzipped) — Eclipse Layout Kernel compiled to JavaScript. Handles hierarchical/layered graph layout with compound node support. Runs in a Web Worker to avoid blocking the UI thread.

### Why Not Other Graph Libraries

- **D3.js**: Too large, we only need layout (not rendering — SolidJS handles that)
- **Cytoscape.js**: Full graph library with its own rendering — conflicts with SolidJS reactive model
- **React Flow**: React-specific, won't work with SolidJS
- **vis.js**: Same issue — brings its own rendering, doesn't integrate with SolidJS reactivity

Elkjs provides layout computation only, which pairs perfectly with SolidJS SVG rendering for reactive updates.

## Comment Enrichment — LLM Integration

### System Prompt (for comment writing)

The enrichment LLM call uses a dedicated system prompt focused on writing concise, useful comments. It does NOT modify the graph — it modifies source files only.

**Constraints:**
- Uses the same AI provider/model configured in the user's session
- Token budget cap per enrichment run (configurable, default ~10k tokens)
- Only processes files identified by `git diff --name-only`
- Writes JSDoc/docstrings, file-level headers, and inline comments where missing or unclear
- Never removes existing comments — only adds or improves

### User Control

- Enrichment can be disabled in settings
- Users can review enrichment changes before they're committed (shown as a diff in the chat)
- First-run enrichment on a large codebase shows a progress indicator

## Error Handling

- **tree-sitter parse failure** (e.g., syntax error in file): Node shown with a warning icon, label falls back to filename. Graph remains functional.
- **Elkjs layout timeout** (very large graph): Fall back to simple grid layout, show "simplified view" indicator.
- **WebSocket disconnect**: Graph freezes at last known state, shows "disconnected" badge. Auto-reconnects via existing SyncProvider logic.
- **Enrichment LLM failure**: Silently skipped — graph labels stay at static-analysis quality. No user-facing error.

## Future Visualization Types (Backlog)

These share the same infrastructure (static analyzer, graph store, SVG renderer, panel system) but with different extraction queries and layout configurations:

1. Class/type diagrams
2. Call graphs
3. Dependency graphs (module-level import relationships)
4. Control flow diagrams
5. Sequence diagrams
6. File tree with heat map
7. Data flow diagrams
8. Entity-relationship diagrams
9. State machine diagrams
