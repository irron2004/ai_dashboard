# Standalone Web Wiki Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visualize an LLM wiki in the browser with no Electron — extract the graph viz into `@apc/graph-view`, then a tiny `apps/graph-web` Vite app serves a wiki's graph via `/api/graph`.

**Architecture:** Phase 1 relocates the already-self-contained `graph/` module (+ `buildWikiGraphData` + the Node `readProjectWiki`) into a shared workspace package consumed by desktop and the new web app. Phase 2 is a Vite+React app whose Vite middleware exposes `GET /api/graph` (reading a wiki dir) that the page fetches and renders with the shared component.

**Tech Stack:** TypeScript, React 18, Vite, Cytoscape, Vitest, pnpm workspaces. Builds on branch `feat/cytoscape-graph-viz`.

## Global Constraints

- Build on branch `feat/cytoscape-graph-viz` (the `graph/` module isn't on main yet).
- `@apc/graph-view` has TWO entry points: `.` (browser — component, builders, types, pure modules) and `./node` (Node — `readProjectWiki`). The `./node` code must NEVER be imported by browser code.
- Phase 1 is a PURE REFACTOR: the desktop app must behave identically and its full test suite + typecheck must stay green. Don't change graph logic during the move.
- Consume `@apc/graph-view` as TS source like the existing `@apc/*` workspace packages (no separate build step unless the others have one — match their pattern).
- Run tests: `pnpm --filter <pkg> exec vitest run <path>` (or `pnpm --filter <pkg> test`). Typecheck: `npx tsc -p apps/desktop/tsconfig.json --noEmit` (desktop) and `npx tsc -p tsconfig.typecheck.json` (workspace).
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Write via a Bash heredoc + `git commit -F /tmp/msg.txt` — NOT PowerShell Out-File (UTF BOM corrupts the subject).
- Untracked `AutoSci/` reference clone — NEVER `git add` it.
- Prefer `git mv` for moves so history is preserved.

---

## File Structure

After this plan:
- `packages/graph-view/` — `package.json`, `tsconfig.json`, `src/{graph-types,graph-layout,graph-algorithms,graph-style,GraphVisualization,build-graph,index}.ts(x)` + tests, `src/node/read-wiki.ts` + test, `README.md`.
- `apps/desktop/src/renderer/graph/` — DELETED (moved). `components/GraphVisualization.tsx` shim now re-exports from `@apc/graph-view`. `harness-utils.ts` imports types/helpers/`buildWikiGraphData` from `@apc/graph-view`; keeps `buildHarnessGraphData`/`buildPaperGraphData`. `main/project-wiki.ts` DELETED; `container.ts` imports `readProjectWiki` from `@apc/graph-view/node`.
- `apps/graph-web/` — `package.json`, `vite.config.ts` (with the `/api/graph` middleware plugin), `index.html`, `src/main.tsx`, `src/App.tsx`, a test for the middleware + a page smoke test.
- root `package.json` — a `graph-web` script.

---

## Task 1: Scaffold the `@apc/graph-view` package

**Files:**
- Create: `packages/graph-view/package.json`
- Create: `packages/graph-view/tsconfig.json`
- Create: `packages/graph-view/src/index.ts` (temporary placeholder)

**Interfaces:**
- Produces: a resolvable `@apc/graph-view` workspace package.

- [ ] **Step 1: Inspect an existing package for the pattern**

Read `packages/wiki-substrate/package.json` and `packages/wiki-substrate/tsconfig.json` (or another small `@apc/*` package) to copy the exact `type`, `exports`/`main`, `scripts` (test = vitest), and tsconfig `extends` conventions this monorepo uses. Match them.

- [ ] **Step 2: Write `packages/graph-view/package.json`**

Mirror the sibling package, with:
```jsonc
{
  "name": "@apc/graph-view",
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./node": "./src/node/read-wiki.ts"
  },
  "scripts": { "test": "vitest run" },
  "dependencies": { "cytoscape": "^3.28.1" },
  "peerDependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },
  "devDependencies": { /* match sibling: vitest, @testing-library/react, jsdom, @types/react, typescript as needed */ }
}
```
(If sibling packages point `exports` at built `dist/`, follow THAT pattern instead — but the desktop renderer consumes `@apc/*` as source via vite; verify by checking how `@apc/wiki-substrate` is consumed. Use source exports if that's the established pattern.)

- [ ] **Step 3: Write `packages/graph-view/tsconfig.json`** — copy the sibling's, adjust `include`/`rootDir` to `src`.

- [ ] **Step 4: Temporary placeholder** `src/index.ts`:
```ts
export const GRAPH_VIEW_PLACEHOLDER = true
```

- [ ] **Step 5: Install + verify the workspace sees it**

Run: `pnpm install --config.minimumReleaseAge=0 --config.block-exotic-subdeps=false`
Run: `pnpm --filter @apc/graph-view exec node -e "0"`
Expected: install succeeds; the filter resolves the package.

- [ ] **Step 6: Commit**

```bash
git add packages/graph-view/package.json packages/graph-view/tsconfig.json packages/graph-view/src/index.ts pnpm-lock.yaml pnpm-workspace.yaml
git commit -F <tmpfile>   # "build(graph-view): scaffold @apc/graph-view package"
```

---

## Task 2: Move the graph module + builders + reader into `@apc/graph-view`; repoint desktop

This is the extraction — atomic by nature (desktop breaks mid-move, so move + repoint in one task; the gate is "desktop suite + typecheck green").

**Files:**
- Move (git mv): `apps/desktop/src/renderer/graph/{graph-types,graph-layout,graph-algorithms,graph-style,GraphVisualization}.{ts,tsx}` + their `.test.ts(x)` + `index.ts` + `README.md` → `packages/graph-view/src/` (overwrite the placeholder index).
- Create: `packages/graph-view/src/build-graph.ts` (+ `build-graph.test.ts`) — `buildWikiGraphData` + the GraphData-shaping helpers (`addNode`, `addLink`, `colorForNode`, and the `PaperGraphEdge`/`GraphEdgeInput` type) extracted from `harness-utils.ts`.
- Move (git mv): `apps/desktop/src/main/project-wiki.ts` + `project-wiki.test.ts` → `packages/graph-view/src/node/read-wiki.ts` + `read-wiki.test.ts`.
- Modify: `packages/graph-view/src/index.ts` — barrel re-exporting the component, types, pure modules, and `buildWikiGraphData`.
- Modify (desktop repoints): `components/GraphVisualization.tsx`, `components/KnowledgeView.tsx`, `harness-utils.ts`, `main/container.ts` (+ any other consumer found by grep).
- Delete: the now-empty `apps/desktop/src/renderer/graph/` dir.

**Interfaces:**
- Produces: `@apc/graph-view` exports `{ GraphVisualization, GraphData, GraphNode, GraphLink, GraphNodeType, GraphShape, buildWikiGraphData, obsidianForceLayout, buildAdjacency, bfsNeighborhood, findPaths, entityColor, … }` from `.`, and `{ readProjectWiki, WikiGraphNode, WikiGraphEdge, ReadWikiResult }` from `./node`.

- [ ] **Step 1: Move the graph module files**

```bash
git mv apps/desktop/src/renderer/graph/graph-types.ts packages/graph-view/src/graph-types.ts
git mv apps/desktop/src/renderer/graph/graph-layout.ts packages/graph-view/src/graph-layout.ts
git mv apps/desktop/src/renderer/graph/graph-layout.test.ts packages/graph-view/src/graph-layout.test.ts
git mv apps/desktop/src/renderer/graph/graph-algorithms.ts packages/graph-view/src/graph-algorithms.ts
git mv apps/desktop/src/renderer/graph/graph-algorithms.test.ts packages/graph-view/src/graph-algorithms.test.ts
git mv apps/desktop/src/renderer/graph/graph-style.ts packages/graph-view/src/graph-style.ts
git mv apps/desktop/src/renderer/graph/graph-style.test.ts packages/graph-view/src/graph-style.test.ts
git mv apps/desktop/src/renderer/graph/GraphVisualization.tsx packages/graph-view/src/GraphVisualization.tsx
git mv apps/desktop/src/renderer/graph/GraphVisualization.test.tsx packages/graph-view/src/GraphVisualization.test.tsx
git mv apps/desktop/src/renderer/graph/README.md packages/graph-view/src/README.md
```
(Internal imports among these are relative `./` — they stay valid after the move. The placeholder `index.ts` is replaced in Step 4.)

- [ ] **Step 2: Move the Node reader**

```bash
mkdir -p packages/graph-view/src/node
git mv apps/desktop/src/main/project-wiki.ts packages/graph-view/src/node/read-wiki.ts
git mv apps/desktop/src/main/project-wiki.test.ts packages/graph-view/src/node/read-wiki.test.ts
```
The reader imports only `node:fs`/`node:path` — no path fixes needed.

- [ ] **Step 3: Extract `buildWikiGraphData` + helpers into `build-graph.ts`**

Read `harness-utils.ts`. CUT `buildWikiGraphData`, the helpers it needs (`addNode`, `addLink`, `colorForNode`, `labelFromPath` if used), and the edge type it uses (`PaperGraphEdge`) into `packages/graph-view/src/build-graph.ts`, importing graph types from `./graph-types.js` and `entityColor`/`workflowFor`/`directionFor` from `./graph-style.js`. Also MOVE `build-graph.test.ts` content for `buildWikiGraphData` out of `harness-utils.test.ts` into `packages/graph-view/src/build-graph.test.ts`.

IMPORTANT: `buildPaperGraphData` and `buildHarnessGraphData` STAY in `harness-utils.ts`. They use `addNode`/`addLink`/`colorForNode`/`PaperGraphEdge` too — so after moving those helpers, `harness-utils.ts` must IMPORT them from `@apc/graph-view`. Re-export the helpers/types from `build-graph.ts` (and thus the barrel) so harness-utils can import them. Keep the helper implementations identical (pure move).

- [ ] **Step 4: Write the barrel `packages/graph-view/src/index.ts`**
```ts
export { GraphVisualization } from './GraphVisualization.js'
export type { GraphData, GraphNode, GraphLink, GraphNodeType, GraphShape } from './graph-types.js'
export { obsidianForceLayout } from './graph-layout.js'
export { buildAdjacency, bfsNeighborhood, findPaths } from './graph-algorithms.js'
export { entityColor, edgeColor, workflowFor, directionFor, confidenceClass, presentEntityTypes, groupEdgeTypes } from './graph-style.js'
export { buildWikiGraphData, addNode, addLink, colorForNode } from './build-graph.js'
export type { PaperGraphEdge } from './build-graph.js'
```
(Adjust the exact exported symbol list to what desktop actually imports — verify by the grep in Step 6.)

- [ ] **Step 5: Add `@apc/graph-view` as a desktop dependency**

In `apps/desktop/package.json` dependencies add `"@apc/graph-view": "workspace:*"`. Run `pnpm install --config.minimumReleaseAge=0 --config.block-exotic-subdeps=false`.

- [ ] **Step 6: Repoint every desktop consumer**

Find them:
```bash
grep -rn "renderer/graph/\|/graph/graph-\|from './graph/\|from '../graph/\|project-wiki" apps/desktop/src
```
Repoint:
- `components/GraphVisualization.tsx` → `export { GraphVisualization } from '@apc/graph-view'`
- `components/KnowledgeView.tsx` — `GraphVisualization` stays imported from `./GraphVisualization.js` (the shim). `buildWikiGraphData` from `@apc/graph-view` (or via harness-utils re-export — pick one and be consistent).
- `harness-utils.ts` — replace `from './graph/graph-style.js'` / `'./graph/graph-types.js'` with `'@apc/graph-view'`; import `addNode`/`addLink`/`colorForNode`/`buildWikiGraphData`/`PaperGraphEdge` from `'@apc/graph-view'`; re-export the `HarnessGraph*` aliases from the graph-view types as before.
- `main/container.ts` — `import { readProjectWiki } from '@apc/graph-view/node'`.
- Any test files that imported from `../harness-utils` for `buildWikiGraphData` → from `@apc/graph-view` (or keep the harness-utils re-export so tests are unchanged).

- [ ] **Step 7: Delete the empty desktop graph dir + verify**

```bash
rmdir apps/desktop/src/renderer/graph 2>/dev/null || true
```
Run: `pnpm --filter @apc/graph-view exec vitest run` → all moved tests pass.
Run: `npx tsc -p apps/desktop/tsconfig.json --noEmit` → 0 errors.
Run: `npx tsc -p tsconfig.typecheck.json` → 0 errors.
Run: `pnpm --filter @apc/desktop exec vitest run` → full desktop suite green (identical behavior).

- [ ] **Step 8: Commit**

```bash
git add -A   # but NOT AutoSci/ (it is gitignored)
git commit -F <tmpfile>   # "refactor(graph-view): extract graph module + reader into @apc/graph-view"
```

---

## Task 3: Scaffold the `apps/graph-web` Vite app

**Files:**
- Create: `apps/graph-web/package.json`, `apps/graph-web/tsconfig.json`, `apps/graph-web/vite.config.ts`, `apps/graph-web/index.html`, `apps/graph-web/src/main.tsx`, `apps/graph-web/src/App.tsx`

**Interfaces:**
- Produces: a runnable Vite app (placeholder page) depending on `@apc/graph-view` + `react`.

- [ ] **Step 1: package.json**
```jsonc
{
  "name": "@apc/graph-web", "private": true, "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "test": "vitest run" },
  "dependencies": { "@apc/graph-view": "workspace:*", "react": "^18.3.1", "react-dom": "^18.3.1", "cytoscape": "^3.28.1" },
  "devDependencies": { "vite": "^5.4.0", "@vitejs/plugin-react": "^4.3.1", "typescript": "<match root>", "vitest": "<match root>", "jsdom": "^24.1.0", "@testing-library/react": "^16.0.1", "@types/react": "^18.3.3", "@types/react-dom": "^18.3.0" }
}
```
- [ ] **Step 2: index.html** — standard Vite React root (`<div id="root">` + `<script type="module" src="/src/main.tsx">`).
- [ ] **Step 3: tsconfig.json** — copy `apps/desktop`'s renderer-side tsconfig conventions (jsx: react-jsx, moduleResolution bundler/nodenext to match).
- [ ] **Step 4: src/main.tsx** — `createRoot(document.getElementById('root')!).render(<App/>)`.
- [ ] **Step 5: src/App.tsx** — placeholder: `export function App(){ return <div>graph-web</div> }`.
- [ ] **Step 6: vite.config.ts** — minimal `defineConfig({ plugins: [react()] })` (the `/api/graph` middleware is added in Task 4).
- [ ] **Step 7: Install + verify it builds**

Run: `pnpm install --config.minimumReleaseAge=0 --config.block-exotic-subdeps=false`
Run: `pnpm --filter @apc/graph-web build`
Expected: a clean production build (placeholder).

- [ ] **Step 8: Commit**
```bash
git add apps/graph-web pnpm-lock.yaml
git commit -F <tmpfile>   # "feat(graph-web): scaffold standalone web viewer app"
```

---

## Task 4: `/api/graph` Vite middleware (reads the wiki via @apc/graph-view/node)

**Files:**
- Modify: `apps/graph-web/vite.config.ts` (add the middleware plugin)
- Create: `apps/graph-web/src/api-graph.ts` (the request handler, unit-testable) + `apps/graph-web/src/api-graph.test.ts`

**Interfaces:**
- Consumes: `readProjectWiki` from `@apc/graph-view/node`.
- Produces: `handleGraphRequest(wikiDir: string | undefined): { status: number; body: ReadWikiResult }` and a Vite plugin wiring it to `GET /api/graph` using `process.env.WIKI_DIR`.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { handleGraphRequest } from './api-graph.js'

function wiki(): string {
  const repo = mkdtempSync(join(tmpdir(), 'gw-'))
  const w = join(repo, 'wiki'); mkdirSync(join(w, 'graph'), { recursive: true }); mkdirSync(join(w, 'papers'), { recursive: true })
  writeFileSync(join(w, 'graph', 'edges.jsonl'), JSON.stringify({ from: 'papers/a', to: 'papers/b', type: 'rel' }) + '\n')
  writeFileSync(join(w, 'papers', 'a.md'), '---\ntitle: A\n---\n')
  writeFileSync(join(w, 'papers', 'b.md'), '---\ntitle: B\n---\n')
  return repo
}

describe('handleGraphRequest', () => {
  test('returns available graph data for a wiki repo dir', () => {
    const res = handleGraphRequest(wiki())
    expect(res.status).toBe(200)
    expect(res.body.available).toBe(true)
    if (res.body.available) { expect(res.body.edges).toHaveLength(1); expect(res.body.nodes).toHaveLength(2) }
  })
  test('returns available:false (200) when WIKI_DIR is missing/unset', () => {
    const res = handleGraphRequest(undefined)
    expect(res.body.available).toBe(false)
  })
})
```
- [ ] **Step 2: Run → FAIL** (`pnpm --filter @apc/graph-web exec vitest run src/api-graph.test.ts`) — module missing.
- [ ] **Step 3: Implement `src/api-graph.ts`**
```ts
import { readProjectWiki } from '@apc/graph-view/node'

/** Resolve the graph for a wiki location. `wikiDir` may be a repo (we look for <repo>/wiki) — readProjectWiki
 *  takes repoPaths, so pass it as a single-element repoPaths. Always 200 (available:false is a normal state). */
export function handleGraphRequest(wikiDir: string | undefined) {
  if (!wikiDir) return { status: 200, body: { available: false as const, reason: 'WIKI_DIR not set' } }
  return { status: 200, body: readProjectWiki([wikiDir]) }
}
```
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Wire the Vite plugin** in `vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { handleGraphRequest } from './src/api-graph.js'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'api-graph',
      configureServer(server) {
        server.middlewares.use('/api/graph', (_req, res) => {
          const { status, body } = handleGraphRequest(process.env.WIKI_DIR)
          res.statusCode = status; res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(body))
        })
      },
    },
  ],
})
```
- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc -p apps/graph-web/tsconfig.json --noEmit` → 0 errors (add this tsconfig if missing; include vite.config via a node tsconfig or `// @ts-check`-free is fine — ensure the app typechecks).
```bash
git add apps/graph-web/vite.config.ts apps/graph-web/src/api-graph.ts apps/graph-web/src/api-graph.test.ts
git commit -F <tmpfile>   # "feat(graph-web): /api/graph middleware via readProjectWiki"
```

---

## Task 5: The viewer page (fetch → buildWikiGraphData → GraphVisualization)

**Files:**
- Modify: `apps/graph-web/src/App.tsx`
- Create: `apps/graph-web/src/App.test.tsx`

**Interfaces:**
- Consumes: `GraphVisualization`, `buildWikiGraphData`, types from `@apc/graph-view`; `ReadWikiResult` shape from the `/api/graph` JSON.

- [ ] **Step 1: Write the failing test** (mock `fetch` + `cytoscape`)
```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
vi.mock('cytoscape', () => ({ default: () => ({ on: vi.fn(), destroy: vi.fn(), fit: vi.fn(), elements: () => [], nodes: () => ({ addClass: vi.fn(), removeClass: vi.fn() }), edges: () => ({}), zoom: () => 1, resize: vi.fn() }) }))
import { App } from './App.js'

beforeEach(() => { vi.clearAllMocks() })

describe('App', () => {
  test('renders the graph when /api/graph returns available data', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ available: true, wikiDir: '/w', nodes: [{ ref: 'papers/a', type: 'papers', title: 'A', relPath: 'wiki/papers/a.md' }], edges: [] }) }) as unknown as typeof fetch
    render(<App />)
    await waitFor(() => expect(screen.queryByText(/no wiki|위키 없음/i)).toBeNull())
  })
  test('shows an empty state when not available', async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ available: false }) }) as unknown as typeof fetch
    render(<App />)
    await waitFor(() => expect(screen.getByText(/no wiki|위키 없음|WIKI_DIR/i)).toBeTruthy())
  })
})
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `App.tsx`**
```tsx
import { useEffect, useState } from 'react'
import { GraphVisualization, buildWikiGraphData, type GraphData, type GraphNode } from '@apc/graph-view'

type WikiNode = { ref: string; type: string; title: string; relPath: string }
type ApiRes = { available: true; wikiDir: string; nodes: WikiNode[]; edges: Array<{ from: string; to: string; type: string } & Record<string, unknown>> } | { available: false; reason?: string }

export function App() {
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [empty, setEmpty] = useState<string | null>(null)
  useEffect(() => {
    let stale = false
    void fetch('/api/graph').then((r) => r.json() as Promise<ApiRes>).then((res) => {
      if (stale) return
      if (res.available) { setGraph(buildWikiGraphData(res.nodes, res.edges)); setEmpty(null) }
      else { setGraph(null); setEmpty(res.reason ?? 'No wiki found. Pass a wiki path: pnpm graph-web <wikiPath>') }
    }).catch(() => { if (!stale) setEmpty('Failed to load /api/graph') })
    return () => { stale = true }
  }, [])
  const onNodeClick = (n: GraphNode) => { /* v1: no-op (node ref is its id). Follow-up: open the md. */ void n }
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {graph ? <GraphVisualization data={graph} onNodeClick={onNodeClick} />
        : <div style={{ padding: 24, color: '#aaa' }}>{empty ?? 'Loading…'}</div>}
    </div>
  )
}
```
- [ ] **Step 4: Run → PASS** (`pnpm --filter @apc/graph-web exec vitest run`). Typecheck `apps/graph-web` → 0 errors.
- [ ] **Step 5: Commit**
```bash
git add apps/graph-web/src/App.tsx apps/graph-web/src/App.test.tsx
git commit -F <tmpfile>   # "feat(graph-web): viewer page renders wiki graph from /api/graph"
```

---

## Task 6: Run wrapper + final verification

**Files:**
- Modify: root `package.json` (add a `graph-web` script)

**Interfaces:** none.

- [ ] **Step 1: Add the run script** to root `package.json` scripts:
```jsonc
"graph-web": "node -e \"process.env.WIKI_DIR=process.argv[1]; require('child_process').spawnSync('pnpm',['--filter','@apc/graph-web','dev','--open'],{stdio:'inherit',env:process.env,shell:true})\" --"
```
(Or a tiny `scripts/graph-web.mjs` that sets `WIKI_DIR` from `process.argv[2]` and runs vite — whichever is cleaner on Windows. The contract: `pnpm graph-web <wikiPath>` sets `WIKI_DIR` and starts the app with the browser open.)

- [ ] **Step 2: Final verification (whole feature)**

Run: `npx tsc -p tsconfig.typecheck.json` → 0 errors.
Run: `npx tsc -p apps/desktop/tsconfig.json --noEmit` → 0 errors.
Run: `pnpm --filter @apc/graph-view exec vitest run` → green.
Run: `pnpm --filter @apc/desktop exec vitest run` → green (desktop unaffected).
Run: `pnpm --filter @apc/graph-web exec vitest run` → green.

- [ ] **Step 3: Manual smoke (the user runs it)**

Note in the handoff: `pnpm graph-web <path-to-a-repo-or-wiki-with-graph/edges.jsonl>` → a browser opens showing the wiki's Cytoscape graph; no Electron involved. An empty/no-wiki path shows the empty-state message.

- [ ] **Step 4: Commit**
```bash
git add package.json scripts/graph-web.mjs 2>/dev/null
git commit -F <tmpfile>   # "feat(graph-web): pnpm graph-web <wikiPath> run wrapper"
```

---

## Self-Review notes

- **Spec coverage:** Phase 1 package extraction (T1 scaffold, T2 move+repoint, desktop stays green); Phase 2 web app (T3 scaffold, T4 /api/graph middleware, T5 viewer page, T6 run wrapper + final verify). The `./node` Node-only entry (T2) and the never-Electron run path (T4/T6) are covered.
- **Pure-refactor invariant:** T2's gate is the full desktop suite + both typechecks green — proving behavior is unchanged.
- **Naming consistency:** package `@apc/graph-view`; node entry `@apc/graph-view/node` → `readProjectWiki`; builder `buildWikiGraphData`; handler `handleGraphRequest`; env `WIKI_DIR`; run `pnpm graph-web <wikiPath>`.
- **Type note:** the moved code is unchanged; only import paths change. `buildPaperGraphData`/`buildHarnessGraphData` stay in desktop and import helpers/types from `@apc/graph-view`.
- **Out of scope:** static HTML export, wiki switching, prod hosting, node-open in the web page.
