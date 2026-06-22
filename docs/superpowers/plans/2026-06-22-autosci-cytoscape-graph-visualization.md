# AutoSci Cytoscape Graph Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's hand-rolled SVG graph renderer with a port of AutoSci's `graph.js` (Cytoscape.js + `obsidianForceLayout` + the full interaction set), shared across paper and project-docs graphs.

**Architecture:** The React component owns Cytoscape lifecycle and the sidebar; testable graph math lives in three pure modules (`graph-layout`, `graph-algorithms`, `graph-style`). Data still flows from the existing IPC builders (`buildPaperGraphData`, `buildHarnessGraphData`) as `HarnessGraphData`; links gain optional `confidence`/`direction`/`workflow` fields so AutoSci-style edge styling has something to key on.

**Tech Stack:** TypeScript, React, Cytoscape.js, Vite (electron-vite), Vitest.

## Global Constraints

- Reference implementation (read, do not import): `AutoSci/app/modules/graph.js`. Port from it; adapt to our data + stack. The `AutoSci/` folder is an untracked sibling clone — NEVER `git add` it.
- New renderer code lives under `apps/desktop/src/renderer/graph/`. Component stays at `apps/desktop/src/renderer/components/GraphVisualization.tsx`.
- Run desktop tests with: `pnpm --filter @apc/desktop exec vitest run <path>`.
- Typecheck with: `npx tsc -p apps/desktop/tsconfig.json --noEmit`.
- The component's public props are unchanged: `{ data: HarnessGraphData; onNodeClick: (node: HarnessGraphNode) => void }`. `KnowledgeView` must not need edits.
- Determinism deviation from graph.js: NO `Math.random()` anywhere. Initial positions and degenerate-overlap nudges are index-derived.
- Commit after each task. End commit messages with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (use `git commit -F <tmpfile>`; PowerShell here-strings break `-m`).

---

## File Structure

- Create: `apps/desktop/src/renderer/graph/graph-style.ts` — entity/edge colors, workflow + group + preset maps, direction/confidence helpers, present-type derivation.
- Create: `apps/desktop/src/renderer/graph/graph-layout.ts` — `obsidianForceLayout` (pure, deterministic).
- Create: `apps/desktop/src/renderer/graph/graph-algorithms.ts` — `buildAdjacency`, `bfsNeighborhood`, `findPaths`.
- Create: `apps/desktop/src/renderer/graph/*.test.ts` — one per pure module.
- Modify: `apps/desktop/src/renderer/harness-utils.ts` — extend `HarnessGraphLink`; enrich `buildPaperGraphData` + `buildHarnessGraphData`.
- Modify: `apps/desktop/src/renderer/harness-utils.test.ts` — assert new link fields.
- Rewrite: `apps/desktop/src/renderer/components/GraphVisualization.tsx` — Cytoscape component + sidebar.
- Replace: `apps/desktop/src/renderer/components/GraphVisualization.test.tsx` — mock-cytoscape smoke + mapping test.
- Modify: `apps/desktop/src/renderer/app.css` — graph shell + sidebar styles.
- Modify: `apps/desktop/package.json` — add `cytoscape` dependency.

---

## Task 1: Add the cytoscape dependency

**Files:**
- Modify: `apps/desktop/package.json` (dependencies)

**Interfaces:**
- Produces: `cytoscape` importable from the desktop renderer.

- [ ] **Step 1: Install cytoscape into the desktop workspace**

Run: `pnpm --filter @apc/desktop add cytoscape@^3.28.1 && pnpm --filter @apc/desktop add -D @types/cytoscape`
Expected: package.json gains `cytoscape` (dependencies) and `@types/cytoscape` (devDependencies); lockfile updates. cytoscape is pure JS — no electron-rebuild needed.

- [ ] **Step 2: Verify it resolves and types load**

Create a throwaway check, then delete it:
Run: `node -e "require('cytoscape'); console.log('ok')"` (from repo root)
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml
git commit -F <tmpfile>   # "build(desktop): add cytoscape dependency for graph view"
```

---

## Task 2: graph-style module

**Files:**
- Create: `apps/desktop/src/renderer/graph/graph-style.ts`
- Test: `apps/desktop/src/renderer/graph/graph-style.test.ts`

**Interfaces:**
- Produces:
  - `entityColor(type: string): string`
  - `workflowFor(edgeType: string): string`
  - `edgeColor(edgeType: string): string`
  - `directionFor(edgeType: string): 'directed' | 'symmetric'`
  - `confidenceClass(conf?: string): 'conf-high' | 'conf-medium' | 'conf-low' | ''`
  - `presentEntityTypes(types: string[]): string[]` — canonical-ordered, deduped, intersected with input
  - `groupEdgeTypes(present: string[]): { group: string; types: string[] }[]` — canonical groups first, leftovers under `"Other"`, empty groups dropped

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest'
import { entityColor, workflowFor, edgeColor, directionFor, confidenceClass, presentEntityTypes, groupEdgeTypes } from './graph-style.js'

describe('graph-style', () => {
  test('entityColor covers both schemas and falls back to gray', () => {
    expect(entityColor('papers')).toBe('#4A90D9')
    expect(entityColor('run')).toMatch(/^#/)
    expect(entityColor('unknown-type')).toBe('#95A5A6')
  })

  test('paper edge types map to a workflow and a concrete color', () => {
    expect(workflowFor('uses_module')).not.toBe('')
    expect(edgeColor('uses_module')).toMatch(/^#/)
    expect(edgeColor('totally-unknown')).toMatch(/^#/) // never undefined
  })

  test('directionFor defaults directed; symmetric types are symmetric', () => {
    expect(directionFor('uses_module')).toBe('directed')
    expect(directionFor('alternative_to')).toBe('symmetric')
  })

  test('confidenceClass maps known levels, empty otherwise', () => {
    expect(confidenceClass('high')).toBe('conf-high')
    expect(confidenceClass('MEDIUM')).toBe('conf-medium')
    expect(confidenceClass(undefined)).toBe('')
    expect(confidenceClass('bogus')).toBe('')
  })

  test('presentEntityTypes keeps canonical order, only present types', () => {
    expect(presentEntityTypes(['modules', 'papers', 'papers'])).toEqual(['papers', 'modules'])
  })

  test('groupEdgeTypes buckets known types and collects leftovers under Other', () => {
    const groups = groupEdgeTypes(['uses_module', 'mystery_edge'])
    const flat = groups.flatMap((g) => g.types)
    expect(flat).toContain('uses_module')
    expect(groups.find((g) => g.group === 'Other')?.types).toContain('mystery_edge')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/graph/graph-style.test.ts`
Expected: FAIL — `graph-style.js` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

```ts
// Visualization style tables ported/adapted from AutoSci app/modules/graph.js (ENTITY_HEX) and
// app/modules/schema.js. Covers BOTH our graph schemas: project-docs provenance (run/task/evidence/
// file/document) and the paper entity types (papers/modules/pipelines/pipeline_trials).

const ENTITY_COLORS: Record<string, string> = {
  // paper entities (AutoSci hue trio + ours)
  papers: '#4A90D9', modules: '#84CC16', pipelines: '#C084FC', pipeline_trials: '#E74C3C',
  // project-docs provenance buckets
  run: '#60A5FA', task: '#F59E0B', evidence: '#34D399', file: '#94A3B8', document: '#95A5A6',
}
const ENTITY_FALLBACK = '#95A5A6'
const ENTITY_ORDER = ['papers', 'modules', 'pipelines', 'pipeline_trials', 'run', 'task', 'evidence', 'file', 'document']

export function entityColor(type: string): string {
  return ENTITY_COLORS[type] ?? ENTITY_FALLBACK
}

// edge type -> workflow bucket. Buckets carry a color and group edges in the filter sidebar.
const EDGE_WORKFLOW: Record<string, string> = {
  uses_module: 'composition', pipeline_from_paper: 'provenance', alternative_to: 'relation',
  // project-docs edge kinds (from buildHarnessGraphData)
  'run-task': 'provenance', 'run-file': 'provenance', proposal: 'provenance',
  supports: 'evidence', source: 'evidence', 'claim-evidence': 'evidence',
  rel: 'relation', wiki: 'relation', 'action-file': 'composition', 'write-plan': 'composition', result: 'composition',
}
const WORKFLOW_COLORS: Record<string, string> = {
  composition: '#84CC16', provenance: '#4A90D9', evidence: '#34D399', relation: '#EC4899', other: '#999999',
}
const SYMMETRIC_EDGES = new Set(['alternative_to', 'rel'])

export function workflowFor(edgeType: string): string { return EDGE_WORKFLOW[edgeType] ?? 'other' }
export function edgeColor(edgeType: string): string { return WORKFLOW_COLORS[workflowFor(edgeType)] ?? WORKFLOW_COLORS.other }
export function directionFor(edgeType: string): 'directed' | 'symmetric' { return SYMMETRIC_EDGES.has(edgeType) ? 'symmetric' : 'directed' }

export function confidenceClass(conf?: string): 'conf-high' | 'conf-medium' | 'conf-low' | '' {
  const c = (conf ?? '').toLowerCase()
  return c === 'high' ? 'conf-high' : c === 'medium' ? 'conf-medium' : c === 'low' ? 'conf-low' : ''
}

export function presentEntityTypes(types: string[]): string[] {
  const present = new Set(types)
  return ENTITY_ORDER.filter((t) => present.has(t))
}

// Sidebar groups: canonical workflow buckets first, leftovers under "Other" (mirrors graph.js).
const EDGE_GROUPS: { group: string; workflow: string }[] = [
  { group: 'Provenance', workflow: 'provenance' },
  { group: 'Composition', workflow: 'composition' },
  { group: 'Evidence', workflow: 'evidence' },
  { group: 'Relations', workflow: 'relation' },
]

export function groupEdgeTypes(present: string[]): { group: string; types: string[] }[] {
  const uniq = [...new Set(present)]
  const out: { group: string; types: string[] }[] = []
  const claimed = new Set<string>()
  for (const { group, workflow } of EDGE_GROUPS) {
    const types = uniq.filter((t) => workflowFor(t) === workflow).sort()
    types.forEach((t) => claimed.add(t))
    if (types.length) out.push({ group, types })
  }
  const leftovers = uniq.filter((t) => !claimed.has(t)).sort()
  if (leftovers.length) out.push({ group: 'Other', types: leftovers })
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/graph/graph-style.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/graph/graph-style.ts apps/desktop/src/renderer/graph/graph-style.test.ts
git commit -F <tmpfile>   # "feat(graph): entity/edge style tables for cytoscape view"
```

---

## Task 3: graph-layout module (obsidianForceLayout)

**Files:**
- Create: `apps/desktop/src/renderer/graph/graph-layout.ts`
- Test: `apps/desktop/src/renderer/graph/graph-layout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type LayoutNodeInput = { id: string }`
  - `type LayoutEdgeInput = { source: string; target: string }`
  - `type LayoutResult = { positions: Record<string, { x: number; y: number }>; sizes: Record<string, { w: number; h: number; radius: number }> }`
  - `obsidianForceLayout(nodes: LayoutNodeInput[], edges: LayoutEdgeInput[], width: number, height: number): LayoutResult`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest'
import { obsidianForceLayout } from './graph-layout.js'

const nodes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${i}` }))

describe('obsidianForceLayout', () => {
  test('returns a position and a size for every node', () => {
    const r = obsidianForceLayout(nodes(6), [], 1000, 600)
    expect(Object.keys(r.positions)).toHaveLength(6)
    expect(Object.keys(r.sizes)).toHaveLength(6)
    expect(r.sizes.n0.radius).toBeGreaterThan(0)
  })

  test('is deterministic — same input yields identical positions', () => {
    const a = obsidianForceLayout(nodes(8), [{ source: 'n0', target: 'n1' }], 1000, 600)
    const b = obsidianForceLayout(nodes(8), [{ source: 'n0', target: 'n1' }], 1000, 600)
    expect(a.positions).toEqual(b.positions)
  })

  test('positions are finite numbers', () => {
    const r = obsidianForceLayout(nodes(10), [{ source: 'n0', target: 'n9' }], 800, 800)
    for (const p of Object.values(r.positions)) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
  })

  test('higher-degree nodes get a larger radius', () => {
    const edges = [
      { source: 'hub', target: 'a' }, { source: 'hub', target: 'b' },
      { source: 'hub', target: 'c' }, { source: 'hub', target: 'd' },
    ]
    const ns = [{ id: 'hub' }, { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    const r = obsidianForceLayout(ns, edges, 1000, 600)
    expect(r.sizes.hub.radius).toBeGreaterThan(r.sizes.a.radius)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/graph/graph-layout.test.ts`
Expected: FAIL — `graph-layout.js` not found.

- [ ] **Step 3: Write minimal implementation**

Port `obsidianForceLayout` from `AutoSci/app/modules/graph.js:242-341`, with the determinism deviation: replace the random initial scatter (L247, L250-251) and the degenerate-overlap random nudge (L291) with index-derived values. Keep all constants (REPULSION/LINK_STRENGTH/LINK_DISTANCE/GRAVITY/DAMPING/COLLISION_PAD/MAX_SPEED, ITERS=1200, densityScale, baseRadius) identical.

```ts
// Ported from AutoSci app/modules/graph.js:obsidianForceLayout (L242-341).
// Deviation: NO Math.random — initial scatter and overlap nudges are index-derived so layouts are
// deterministic across renders and unit-testable.
export type LayoutNodeInput = { id: string }
export type LayoutEdgeInput = { source: string; target: string }
export type LayoutResult = {
  positions: Record<string, { x: number; y: number }>
  sizes: Record<string, { w: number; h: number; radius: number }>
}

export function obsidianForceLayout(
  nodesIn: LayoutNodeInput[], edgesIn: LayoutEdgeInput[], width: number, height: number,
): LayoutResult {
  const W = width || 1000, H = height || 600
  const N = nodesIn.length
  const nodes = nodesIn.map((n, i) => {
    const angle = (i / Math.max(N, 1)) * Math.PI * 2
    const r = 200 + (i % 5) * 25                 // was 200 + random*100
    const jitter = ((i % 7) - 3) * 12            // was (random-0.5)*80
    return { id: n.id, x: W / 2 + Math.cos(angle) * r + jitter, y: H / 2 + Math.sin(angle) * r + jitter, vx: 0, vy: 0, degree: 0 }
  })
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const edges = edgesIn
    .map((e) => ({ source: nodeMap.get(e.source), target: nodeMap.get(e.target) }))
    .filter((e): e is { source: typeof nodes[number]; target: typeof nodes[number] } => !!e.source && !!e.target)
  edges.forEach((e) => { e.source.degree++; e.target.degree++ })

  const densityScale = Math.min(2.2, 1 + Math.sqrt(Math.max(0, N - 20)) * 0.12)
  const REPULSION = 16000 * densityScale, LINK_STRENGTH = 0.003, LINK_DISTANCE = 320 * densityScale
  const GRAVITY = 0.010, DAMPING = 0.85, COLLISION_PAD = 28, MAX_SPEED = 40, ITERS = 1200
  const CENTER_X = W / 2, CENTER_Y = H / 2
  const baseRadius = (n: typeof nodes[number]) => Math.min(4 + Math.sqrt(n.degree) * 4, 20)

  for (let iter = 0; iter < ITERS; iter++) {
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = nodes[i], b = nodes[j]
        let dx = b.x - a.x, dy = b.y - a.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) { dx = ((i % 3) - 1) || 1; dy = ((j % 3) - 1) || 1; d2 = dx * dx + dy * dy } // deterministic nudge
        const d = Math.sqrt(d2), f = REPULSION / d2
        const fx = (dx / d) * f, fy = (dy / d) * f
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy
      }
    }
    for (const e of edges) {
      let dx = e.target.x - e.source.x, dy = e.target.y - e.source.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const f = (d - LINK_DISTANCE) * LINK_STRENGTH
      const fx = (dx / d) * f, fy = (dy / d) * f
      e.source.vx += fx; e.source.vy += fy; e.target.vx -= fx; e.target.vy -= fy
    }
    for (const nd of nodes) { nd.vx += (CENTER_X - nd.x) * GRAVITY; nd.vy += (CENTER_Y - nd.y) * GRAVITY }
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = nodes[i], b = nodes[j]
        const minDist = baseRadius(a) + baseRadius(b) + COLLISION_PAD
        const dx = b.x - a.x, dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        if (d < minDist) {
          const overlap = (minDist - d) / 2, nx = dx / d, ny = dy / d
          a.x -= nx * overlap; a.y -= ny * overlap; b.x += nx * overlap; b.y += ny * overlap
        }
      }
    }
    for (const nd of nodes) {
      nd.vx *= DAMPING; nd.vy *= DAMPING
      const sp = Math.sqrt(nd.vx * nd.vx + nd.vy * nd.vy)
      if (sp > MAX_SPEED) { nd.vx = (nd.vx / sp) * MAX_SPEED; nd.vy = (nd.vy / sp) * MAX_SPEED }
      nd.x += nd.vx; nd.y += nd.vy
    }
  }

  const positions: LayoutResult['positions'] = {}, sizes: LayoutResult['sizes'] = {}
  for (const nd of nodes) {
    positions[nd.id] = { x: nd.x, y: nd.y }
    const r = baseRadius(nd)
    sizes[nd.id] = { w: r * 2, h: r * 2, radius: r }
  }
  return { positions, sizes }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/graph/graph-layout.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/graph/graph-layout.ts apps/desktop/src/renderer/graph/graph-layout.test.ts
git commit -F <tmpfile>   # "feat(graph): deterministic obsidian force layout"
```

---

## Task 4: graph-algorithms module (BFS + path query)

**Files:**
- Create: `apps/desktop/src/renderer/graph/graph-algorithms.ts`
- Test: `apps/desktop/src/renderer/graph/graph-algorithms.test.ts`

**Interfaces:**
- Produces:
  - `type Adjacency = Map<string, Set<string>>`
  - `buildAdjacency(edges: { source: string; target: string }[]): Adjacency` — undirected
  - `bfsNeighborhood(adj: Adjacency, startId: string, depth: number): Set<string>` — includes start
  - `findPaths(adj: Adjacency, startId: string, endId: string, maxDepth?: number, maxPaths?: number): string[][]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest'
import { buildAdjacency, bfsNeighborhood, findPaths } from './graph-algorithms.js'

const adj = buildAdjacency([
  { source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'd' },
])

describe('graph-algorithms', () => {
  test('buildAdjacency is undirected', () => {
    expect(adj.get('a')?.has('b')).toBe(true)
    expect(adj.get('b')?.has('a')).toBe(true)
  })

  test('bfsNeighborhood respects depth and includes start', () => {
    expect(bfsNeighborhood(adj, 'a', 1)).toEqual(new Set(['a', 'b']))
    expect(bfsNeighborhood(adj, 'a', 2)).toEqual(new Set(['a', 'b', 'c']))
  })

  test('findPaths finds a path within depth', () => {
    const paths = findPaths(adj, 'a', 'd', 4, 20)
    expect(paths).toContainEqual(['a', 'b', 'c', 'd'])
  })

  test('findPaths returns empty when beyond maxDepth', () => {
    expect(findPaths(adj, 'a', 'd', 2, 20)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/graph/graph-algorithms.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Port `highlightBFS` (graph.js:524-548) as a pure set computation and `computeAndHighlightPaths` (graph.js:872-932) as a pure path enumerator.

```ts
// Pure graph traversal ported from AutoSci app/modules/graph.js (highlightBFS L524, path query L872).
export type Adjacency = Map<string, Set<string>>

export function buildAdjacency(edges: { source: string; target: string }[]): Adjacency {
  const adj: Adjacency = new Map()
  const add = (a: string, b: string) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a)!.add(b) }
  for (const e of edges) { if (!e.source || !e.target) continue; add(e.source, e.target); add(e.target, e.source) }
  return adj
}

export function bfsNeighborhood(adj: Adjacency, startId: string, depth: number): Set<string> {
  const visited = new Set([startId])
  let frontier = new Set([startId])
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>()
    for (const id of frontier) for (const n of adj.get(id) ?? []) if (!visited.has(n)) { visited.add(n); next.add(n) }
    frontier = next
  }
  return visited
}

export function findPaths(adj: Adjacency, startId: string, endId: string, maxDepth = 4, maxPaths = 20): string[][] {
  const paths: string[][] = []
  const stack: { node: string; path: string[]; visited: Set<string> }[] = [{ node: startId, path: [startId], visited: new Set([startId]) }]
  while (stack.length && paths.length < maxPaths) {
    const cur = stack.pop()!
    if (cur.path.length > maxDepth + 1) continue
    for (const n of adj.get(cur.node) ?? []) {
      if (n === endId) { if (cur.path.length <= maxDepth) paths.push([...cur.path, n]); continue }
      if (cur.visited.has(n)) continue
      const visited = new Set(cur.visited); visited.add(n)
      stack.push({ node: n, path: [...cur.path, n], visited })
    }
  }
  return paths
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/graph/graph-algorithms.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/graph/graph-algorithms.ts apps/desktop/src/renderer/graph/graph-algorithms.test.ts
git commit -F <tmpfile>   # "feat(graph): pure BFS + path-query algorithms"
```

---

## Task 5: Enrich graph link data

**Files:**
- Modify: `apps/desktop/src/renderer/harness-utils.ts` (type `HarnessGraphLink` ~L190; `buildPaperGraphData` edge loop; `buildHarnessGraphData` `addLink` calls)
- Test: `apps/desktop/src/renderer/harness-utils.test.ts`

**Interfaces:**
- Consumes: `workflowFor`, `directionFor` from `./graph/graph-style.js`.
- Produces: `HarnessGraphLink` with optional `confidence`, `direction`, `workflow`. `buildPaperGraphData` sets them on `rel` links; `label` is the bare edge type (no `· confidence` concat).

- [ ] **Step 1: Write the failing test** (append to `harness-utils.test.ts`, inside the `buildPaperGraphData` describe)

```ts
  test('a paper edge carries confidence/direction/workflow as structured fields (not in the label)', () => {
    const edges = [{ from: 'modules:self-attention', to: 'papers:transformer', type: 'pipeline_from_paper', confidence: 'high' }]
    const link = buildPaperGraphData(nodes, edges).links.find((l) => l.kind === 'rel')
    expect(link?.label).toBe('pipeline_from_paper')          // no "· high" concat
    expect(link?.confidence).toBe('high')
    expect(link?.direction).toBe('directed')
    expect(link?.workflow).toBe('provenance')
  })

  test('a symmetric paper edge is marked symmetric', () => {
    const edges = [{ from: 'papers:transformer', to: 'papers:bert', type: 'alternative_to' }]
    const link = buildPaperGraphData([...nodes, { relPath: 'nodes/bert.md', nodeId: 'bert', nodeType: 'papers', title: 'BERT' }], edges)
      .links.find((l) => l.kind === 'rel')
    expect(link?.direction).toBe('symmetric')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/harness-utils.test.ts -t "structured fields"`
Expected: FAIL — `link.confidence` is undefined and `label` is `"pipeline_from_paper · high"`.

- [ ] **Step 3: Write minimal implementation**

In `harness-utils.ts`, extend the link type:

```ts
export type HarnessGraphLink = {
  id: string
  source: string
  target: string
  label?: string
  kind: string
  confidence?: string
  direction?: 'directed' | 'symmetric'
  workflow?: string
}
```

Add the import at the top of the file:

```ts
import { workflowFor, directionFor } from './graph/graph-style.js'
```

Replace the `buildPaperGraphData` edge loop body (the block that currently builds `confidence` + `addLink`):

```ts
  for (const e of edges) {
    if (!e?.from || !e?.to) continue
    ensureEndpoint(e.from)
    ensureEndpoint(e.to)
    const confidence = typeof e.confidence === 'string' ? e.confidence : undefined
    addLink(links, {
      id: `rel:${e.from}->${e.to}:${e.type}`, source: e.from, target: e.to, kind: 'rel',
      label: e.type, confidence, direction: directionFor(e.type), workflow: workflowFor(e.type),
    })
  }
```

In `buildHarnessGraphData`, leave existing `addLink` calls as-is EXCEPT the `rel` edges (the node↔node relationships, ~L883): add `workflow` + `direction` so provenance graphs also style consistently:

```ts
    addLink(links, { id: `rel:${from}->${to}:${e.type}`, source: from, target: to, kind: 'rel', label: e.type, workflow: workflowFor(e.type), direction: directionFor(e.type) })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/harness-utils.test.ts`
Expected: PASS (all `buildPaperGraphData` + `buildHarnessGraphData` tests green, including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/harness-utils.ts apps/desktop/src/renderer/harness-utils.test.ts
git commit -F <tmpfile>   # "feat(graph): structured confidence/direction/workflow on links"
```

---

## Task 6: Cytoscape component — canvas, mapping, core interactions

**Files:**
- Rewrite: `apps/desktop/src/renderer/components/GraphVisualization.tsx`
- Replace: `apps/desktop/src/renderer/components/GraphVisualization.test.tsx`

**Interfaces:**
- Consumes: `obsidianForceLayout` (graph-layout), `entityColor`/`edgeColor`/`directionFor`/`confidenceClass` (graph-style), `buildAdjacency`/`bfsNeighborhood`/`findPaths` (graph-algorithms), `HarnessGraphData`/`HarnessGraphNode` (harness-utils), `cytoscape`.
- Produces: default-exported `GraphVisualization({ data, onNodeClick })`.

This task delivers: cy element mapping from `HarnessGraphData`, the layout-seeded `preset` Cytoscape init, the entity/edge stylesheet (entity color by `entityColor`, edge color by `edgeColor`, `dir-directed` arrowheads, `conf-*` weighting), node tap = BFS highlight, double-tap = `onNodeClick`, zoom-aware label visibility, and teardown on unmount/data change. The richer sidebar widgets are Task 7.

- [ ] **Step 1: Write the failing test** (mock cytoscape so jsdom needs no canvas)

```tsx
import { describe, expect, test, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { HarnessGraphData } from '../harness-utils.js'

const cyInstance = { on: vi.fn(), destroy: vi.fn(), fit: vi.fn(), elements: () => [], nodes: () => ({ addClass: vi.fn(), removeClass: vi.fn() }), zoom: () => 1 }
const cyFactory = vi.fn(() => cyInstance)
vi.mock('cytoscape', () => ({ default: (opts: unknown) => cyFactory(opts) }))

import { GraphVisualization } from './GraphVisualization.js'

const data: HarnessGraphData = {
  nodes: [
    { id: 'papers:t', label: 'T', type: 'papers', shape: 'square', color: '#000', data: { path: 'nodes/t.md' } },
    { id: 'modules:s', label: 'S', type: 'modules', shape: 'diamond', color: '#000' },
  ],
  links: [{ id: 'e1', source: 'modules:s', target: 'papers:t', kind: 'rel', label: 'uses_module', direction: 'directed' }],
}

describe('GraphVisualization (cytoscape)', () => {
  test('initializes cytoscape with one element per node and link', () => {
    render(<GraphVisualization data={data} onNodeClick={() => {}} />)
    expect(cyFactory).toHaveBeenCalledTimes(1)
    const opts = cyFactory.mock.calls[0][0] as { elements: unknown[] }
    expect(opts.elements).toHaveLength(3) // 2 nodes + 1 edge
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/components/GraphVisualization.test.tsx`
Expected: FAIL — current SVG component does not call cytoscape.

- [ ] **Step 3: Write minimal implementation**

Rewrite `GraphVisualization.tsx`. Port the Cytoscape init + stylesheet + core handlers from `AutoSci/app/modules/graph.js` `initCy` (L345-507), adapting:
- elements come from `data` props (map `HarnessGraphNode` → `{ data: { id, label, labelFull, entity: type, slug, fullId, nodeW, nodeH }, classes: type, position }`, `HarnessGraphLink` → `{ data: { id, source, target, label, direction, confidence, workflow }, classes: [cssSafe(label), 'dir-'+direction, confidenceClass(confidence)].join(' ') }`).
- positions from `obsidianForceLayout(data.nodes, data.links, w, h)`.
- entity selector colors from `entityColor(type)`; edge colors from `edgeColor(type)`.
- replace AutoSci's reader-route `dbltap` (L497-506) with `onNodeClick(node)` using the original `HarnessGraphNode` (keep a `Map<id, HarnessGraphNode>`).
- tap node → `bfsNeighborhood` highlight (use graph-algorithms); tap background → clear.
- zoom-aware labels via `applyLabelVisibility` (L804).
- theme: dark only — `labelColor = '#e6e6f0'`, `labelOutline = 'rgba(0,0,0,0.55)'`.
- run init in a `useEffect` keyed on `data`; `destroy()` on cleanup. Guard the container ref.

Provide the full component (canvas + core handlers; sidebar `<aside>` markup present but widgets wired in Task 7). Keep the existing `.panel graph-visualization` outer shell and a `<div ref className="cy-canvas">` mount.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/components/GraphVisualization.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -p apps/desktop/tsconfig.json --noEmit` → no errors.
```bash
git add apps/desktop/src/renderer/components/GraphVisualization.tsx apps/desktop/src/renderer/components/GraphVisualization.test.tsx
git commit -F <tmpfile>   # "feat(graph): cytoscape canvas with force layout + BFS + node open"
```

---

## Task 7: Sidebar widgets (search, filters, presets, path query, toggles, tooltips)

**Files:**
- Modify: `apps/desktop/src/renderer/components/GraphVisualization.tsx`
- Modify: `apps/desktop/src/renderer/components/GraphVisualization.test.tsx` (add a render-with-data smoke that asserts the sidebar headings render)

**Interfaces:**
- Consumes: everything from Task 6 plus `groupEdgeTypes`, `presentEntityTypes`, `findPaths`.
- Produces: no new exports; the component now renders the full graph.js sidebar.

Port these graph.js functions into the component, adapted to React state + the cy instance ref:
`buildFilters` (L556 — entity checkboxes + grouped/collapsible edge filters via `groupEdgeTypes`), `buildPresets`+`applyPreset`+`resetAllEdges` (L693-776), `setupSearch` (L982), low-confidence toggle `applyLowConfidenceVisibility` (L792), `applyLabelVisibility` "always labels" toggle (L804), right-click path query `handlePathClick`+`refreshPathHighlight`+`computeAndHighlightPaths` (use `findPaths` from graph-algorithms; L824-932), edge hover tooltip `showEdgeTooltip`/`hideEdgeTooltip` (L949-980), and node info panel `showNodeInfo` (L511) — info panel's "open in reader" link becomes a button calling `onNodeClick`.

- [ ] **Step 1: Write the failing test**

```tsx
  test('renders the sidebar with entity and edge filter sections', () => {
    const { getByText } = render(<GraphVisualization data={data} onNodeClick={() => {}} />)
    expect(getByText('Entity types')).toBeTruthy()
    expect(getByText('Edge types')).toBeTruthy()
    expect(getByText('Preset views')).toBeTruthy()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/components/GraphVisualization.test.tsx -t "sidebar"`
Expected: FAIL — those headings not yet rendered.

- [ ] **Step 3: Implement the sidebar**

Add the sidebar markup + widgets per the port list above. Drive entity/edge chip lists from `presentEntityTypes(data.nodes.map(n=>n.type))` and `groupEdgeTypes(present edge labels)`. Wire each handler to the cy ref (show/hide by class, fade/highlight). Keep all logic that is pure (BFS, paths) delegated to the graph-algorithms module.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/components/GraphVisualization.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -p apps/desktop/tsconfig.json --noEmit` → no errors.
```bash
git add apps/desktop/src/renderer/components/GraphVisualization.tsx apps/desktop/src/renderer/components/GraphVisualization.test.tsx
git commit -F <tmpfile>   # "feat(graph): full graph.js sidebar (filters, presets, path query, tooltips)"
```

---

## Task 8: Styles + final integration

**Files:**
- Modify: `apps/desktop/src/renderer/app.css` (add `.graph-shell`, `.graph-sidebar`, `.cy-canvas`, `.graph-info`, filter/preset/tooltip styles; remove dead `.graph-visualization__*` SVG-only rules that no longer apply)

**Interfaces:** none.

- [ ] **Step 1: Add the graph shell + sidebar CSS**

Port the relevant rules from `AutoSci/app/app.css` (search `graph-shell`, `graph-sidebar`, `cy-canvas`, `edge-tooltip`, `preset-btn`, `filter-group`, `edge-group`) into `app.css`, recolored to our dark palette / CSS variables. Ensure `.cy-canvas` has an explicit height (e.g. `min-height: 540px`) — Cytoscape needs a sized container.

- [ ] **Step 2: Verify the app builds and the full suite is green**

Run: `npx tsc -p apps/desktop/tsconfig.json --noEmit` → no errors.
Run: `pnpm --filter @apc/desktop exec vitest run` → all pass.
Expected: green typecheck + full desktop suite.

- [ ] **Step 3: Manual smoke (the user runs the app)**

Note in the handoff: the user should open the running dev app, switch to the graph view for a paper project and a project-docs project, and confirm: nodes render with entity colors, edges have arrowheads (directed) and confidence weighting, BFS on click, right-click path query, preset/filter sidebar works, double-click opens the peek drawer.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/app.css
git commit -F <tmpfile>   # "feat(graph): cytoscape graph shell + sidebar styling"
```

---

## Self-Review notes

- **Spec coverage:** engine=Cytoscape (T1,T6); pure modules layout/algorithms/style (T2-T4); data enrichment confidence/direction/workflow (T5); full interaction set (T6 core + T7 sidebar); shared across both schemas (graph-style covers both; T6 maps any data); CSS (T8); testing strategy (pure-module TDD + mocked-cytoscape component smoke). All covered.
- **Determinism deviation** from the spec is implemented in T3 (index-derived init, no RNG).
- **Type consistency:** `obsidianForceLayout`, `bfsNeighborhood`, `findPaths`, `entityColor`/`edgeColor`/`directionFor`/`confidenceClass`/`groupEdgeTypes`/`presentEntityTypes` names match across tasks; `HarnessGraphLink` optional fields used in T5 and consumed in T6/T7.
- **Out of scope (unchanged):** citations.jsonl, AutoSci full schema, layout persistence.
