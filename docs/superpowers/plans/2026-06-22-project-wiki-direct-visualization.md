# Project Wiki Direct Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visualize the selected project's existing `<repoPath>/wiki/` (AutoSci layout: `graph/edges.jsonl` + `<type>/<slug>.md`) directly in the Cytoscape graph, toggled against the existing latest-run graph.

**Architecture:** A pure main-process reader parses the wiki off disk; a new `readProjectWiki` IPC resolves the project's repo→wiki and returns `{nodes, edges}`; a renderer `buildWikiGraphData` maps that to `GraphData`; `KnowledgeView` adds a run↔wiki toggle and feeds the chosen source to the existing `GraphVisualization`. Read-only.

**Tech Stack:** TypeScript, React, Electron IPC, Node fs, Vitest. Builds on branch `feat/cytoscape-graph-viz`.

## Global Constraints

- Work on branch `feat/cytoscape-graph-viz` (this feature depends on the graph component that only exists there).
- Wiki node refs are `<type>/<slug>` (SLASH), distinct from the vendored paper pack's `<type>:<slug>` (colon). The wiki path uses slash throughout.
- v1: LOCAL repos only. A `ssh://` repoPath is treated as "no local wiki" (`available:false`).
- `readProjectWiki` and the reader NEVER throw — they return `{available:false}` on any failure.
- The portable `graph/` module's contract is unchanged: it still receives only `GraphData`.
- Run desktop tests: `pnpm --filter @apc/desktop exec vitest run <path>`. Typecheck: `npx tsc -p apps/desktop/tsconfig.json --noEmit`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Write the message via a Bash heredoc (`cat > /tmp/msg.txt <<'EOF' … EOF`) + `git commit -F /tmp/msg.txt` — NOT PowerShell Out-File (it injects a UTF BOM that corrupts the commit subject).
- There is an untracked `AutoSci/` reference clone — NEVER `git add` it.

---

## File Structure

- Modify: `apps/desktop/src/renderer/graph/graph-style.ts` — add AutoSci entity colors + order.
- Modify: `apps/desktop/src/renderer/graph/graph-style.test.ts` — cover the new colors/order.
- Create: `apps/desktop/src/main/project-wiki.ts` — `readProjectWiki(repoPaths)` pure reader.
- Create: `apps/desktop/src/main/project-wiki.test.ts` — reader unit tests.
- Modify: `apps/desktop/src/shared/ipc-contract.ts` — channel + DTO types.
- Modify: `apps/desktop/src/main/container.ts` — wire `readProjectWiki(projectId)`.
- Modify: `apps/desktop/src/main/ipc.ts` — handler.
- Modify: `apps/desktop/src/renderer/api.ts` — wrapper.
- Modify: `apps/desktop/src/renderer/harness-utils.ts` — `buildWikiGraphData`.
- Modify: `apps/desktop/src/renderer/harness-utils.test.ts` — builder tests.
- Modify: `apps/desktop/src/renderer/components/KnowledgeView.tsx` — toggle + wiring.

---

## Task 1: Extend graph entity vocabulary (AutoSci entity colors)

**Files:**
- Modify: `apps/desktop/src/renderer/graph/graph-style.ts` (the `ENTITY_COLORS` table + `ENTITY_ORDER`)
- Test: `apps/desktop/src/renderer/graph/graph-style.test.ts`

**Interfaces:**
- Produces: `entityColor(type)` returns concrete colors for the AutoSci entity types; `presentEntityTypes` includes them in canonical order.

- [ ] **Step 1: Write the failing test** (append inside the existing `describe('graph-style', …)`)

```ts
  test('AutoSci entity types get concrete colors and order', () => {
    expect(entityColor('concepts')).toMatch(/^#/)
    expect(entityColor('methods')).toMatch(/^#/)
    expect(entityColor('people')).toMatch(/^#/)
    // present in canonical order (papers before concepts before methods)
    expect(presentEntityTypes(['methods', 'concepts', 'papers'])).toEqual(['papers', 'concepts', 'methods'])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/graph/graph-style.test.ts -t "AutoSci entity"`
Expected: FAIL — `entityColor('concepts')` returns the gray fallback `#95A5A6` (not matched by the order assertion, and order excludes concepts/methods).

- [ ] **Step 3: Write minimal implementation**

In `graph-style.ts`, extend `ENTITY_COLORS` (add the AutoSci entity types; keep the existing entries) and `ENTITY_ORDER`:

```ts
const ENTITY_COLORS: Record<string, string> = {
  // paper entities (vendored pack)
  papers: '#4A90D9', modules: '#84CC16', pipelines: '#C084FC', pipeline_trials: '#E74C3C',
  // AutoSci/OmegaWiki entity types (existing wikis)
  concepts: '#EC4899', topics: '#E67E22', people: '#2ECC71', ideas: '#F39C12',
  experiments: '#E74C3C', methods: '#84CC16', Summary: '#1ABC9C', foundations: '#95A5A6',
  outputs: '#9B59B6',
  // project-docs provenance buckets
  run: '#60A5FA', task: '#F59E0B', evidence: '#34D399', file: '#94A3B8', document: '#95A5A6',
}
const ENTITY_FALLBACK = '#95A5A6'
const ENTITY_ORDER = [
  'papers', 'concepts', 'topics', 'people', 'ideas', 'experiments', 'methods', 'foundations', 'Summary', 'outputs',
  'modules', 'pipelines', 'pipeline_trials',
  'run', 'task', 'evidence', 'file', 'document',
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/graph/graph-style.test.ts`
Expected: PASS (all existing + new).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/graph/graph-style.ts apps/desktop/src/renderer/graph/graph-style.test.ts
git commit -F <tmpfile>   # "feat(graph): entity colors for AutoSci wiki vocabulary"
```

---

## Task 2: Main-process wiki reader

**Files:**
- Create: `apps/desktop/src/main/project-wiki.ts`
- Test: `apps/desktop/src/main/project-wiki.test.ts`

**Interfaces:**
- Produces:
  - `type WikiGraphNode = { ref: string; type: string; title: string; relPath: string }`
  - `type WikiGraphEdge = { from: string; to: string; type: string } & Record<string, unknown>`
  - `type ReadWikiResult = { available: true; wikiDir: string; nodes: WikiGraphNode[]; edges: WikiGraphEdge[] } | { available: false; reason?: string }`
  - `readProjectWiki(repoPaths: readonly string[]): ReadWikiResult` — first local repo whose `wiki/graph/edges.jsonl` exists; never throws.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readProjectWiki } from './project-wiki.js'

function makeWiki(): string {
  const repo = mkdtempSync(join(tmpdir(), 'pw-'))
  const wiki = join(repo, 'wiki')
  mkdirSync(join(wiki, 'graph'), { recursive: true })
  mkdirSync(join(wiki, 'papers'), { recursive: true })
  mkdirSync(join(wiki, 'methods'), { recursive: true })
  writeFileSync(join(wiki, 'graph', 'edges.jsonl'), [
    JSON.stringify({ from: 'papers/transformer', to: 'methods/self-attention', type: 'uses_method', confidence: 'high' }),
    '',
    '{ broken',
    JSON.stringify({ from: 'papers/transformer', type: 'missing-to' }),
  ].join('\n'))
  writeFileSync(join(wiki, 'papers', 'transformer.md'), '---\nslug: transformer\ntitle: Attention Is All You Need\n---\nbody')
  writeFileSync(join(wiki, 'methods', 'self-attention.md'), '---\ntitle: Self-Attention\n---\nbody')
  writeFileSync(join(wiki, 'index.md'), '# index')  // must be skipped (not a node)
  return repo
}

describe('readProjectWiki', () => {
  test('reads nodes + well-formed edges, skips malformed lines and index.md', () => {
    const repo = makeWiki()
    const res = readProjectWiki([repo])
    expect(res.available).toBe(true)
    if (!res.available) return
    expect(res.edges).toHaveLength(1)
    expect(res.edges[0]).toMatchObject({ from: 'papers/transformer', to: 'methods/self-attention', type: 'uses_method', confidence: 'high' })
    const refs = res.nodes.map((n) => n.ref).sort()
    expect(refs).toEqual(['methods/self-attention', 'papers/transformer'])
    const t = res.nodes.find((n) => n.ref === 'papers/transformer')
    expect(t).toMatchObject({ type: 'papers', title: 'Attention Is All You Need', relPath: 'wiki/papers/transformer.md' })
    expect(res.nodes.some((n) => n.ref.startsWith('index'))).toBe(false)
  })

  test('available:false when no wiki/graph/edges.jsonl, and skips ssh repos — never throws', () => {
    expect(readProjectWiki([mkdtempSync(join(tmpdir(), 'pw-empty-'))]).available).toBe(false)
    expect(readProjectWiki(['ssh://me@host/home/me/proj']).available).toBe(false)
    expect(readProjectWiki([]).available).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apc/desktop exec vitest run src/main/project-wiki.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type WikiGraphNode = { ref: string; type: string; title: string; relPath: string }
export type WikiGraphEdge = { from: string; to: string; type: string } & Record<string, unknown>
export type ReadWikiResult =
  | { available: true; wikiDir: string; nodes: WikiGraphNode[]; edges: WikiGraphEdge[] }
  | { available: false; reason?: string }

const FRONT = (body: string, key: string): string | undefined => {
  if (!body.startsWith('---')) return undefined
  const end = body.indexOf('\n---', 3)
  const fm = end === -1 ? '' : body.slice(3, end)
  return fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim()
}

/** Read a project's published wiki (<repo>/wiki) into graph data. First LOCAL repo whose
 *  wiki/graph/edges.jsonl exists wins. Never throws — returns {available:false} on any problem. */
export function readProjectWiki(repoPaths: readonly string[]): ReadWikiResult {
  for (const repo of repoPaths) {
    if (!repo || repo.startsWith('ssh://')) continue
    const wikiDir = join(repo, 'wiki')
    const edgesFile = join(wikiDir, 'graph', 'edges.jsonl')
    if (!existsSync(edgesFile)) continue
    try {
      const edges: WikiGraphEdge[] = []
      for (const line of readFileSync(edgesFile, 'utf8').split(/\r?\n/)) {
        const t = line.trim()
        if (!t) continue
        try {
          const e = JSON.parse(t)
          if (e && typeof e.from === 'string' && typeof e.to === 'string' && typeof e.type === 'string') edges.push(e)
        } catch { /* skip malformed line */ }
      }
      const nodes: WikiGraphNode[] = []
      for (const entry of readdirSync(wikiDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === 'graph') continue
        const type = entry.name
        const dir = join(wikiDir, type)
        let files: string[]
        try { files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'index.md' && f !== 'log.md') } catch { continue }
        for (const file of files) {
          try {
            const abs = join(dir, file)
            if (!statSync(abs).isFile()) continue
            const body = readFileSync(abs, 'utf8')
            const slug = FRONT(body, 'slug') ?? file.replace(/\.md$/i, '')
            const title = FRONT(body, 'title') ?? slug
            nodes.push({ ref: `${type}/${slug}`, type, title, relPath: `wiki/${type}/${file}`.replace(/\\/g, '/') })
          } catch { /* skip unreadable node file */ }
        }
      }
      return { available: true, wikiDir, nodes, edges }
    } catch { return { available: false, reason: 'wiki read failed' } }
  }
  return { available: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apc/desktop exec vitest run src/main/project-wiki.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/project-wiki.ts apps/desktop/src/main/project-wiki.test.ts
git commit -F <tmpfile>   # "feat(main): read a project's published wiki into graph data"
```

---

## Task 3: IPC plumbing for readProjectWiki

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts` (CH map ~L36; types near `HarnessReadGraphEdges*`)
- Modify: `apps/desktop/src/main/container.ts` (import types ~L27; interface ~L87; const ~L302; return object ~L310)
- Modify: `apps/desktop/src/main/ipc.ts` (handler near `harnessReadGraphEdges` ~L171)
- Modify: `apps/desktop/src/renderer/api.ts` (import ~L13; wrapper near `harnessReadGraphEdges` ~L122)

**Interfaces:**
- Consumes: `readProjectWiki` (Task 2), `registry.get(projectId).repoPaths` (existing).
- Produces: `api.readProjectWiki(req: ReadProjectWikiReq): Promise<ReadProjectWikiRes>`.

This task is plumbing mirroring the existing `harnessReadGraphEdges` channel (already in the codebase — read it for the exact shape). No new test file; verified by typecheck + the existing `ipc.test.ts` still passing.

- [ ] **Step 1: Add the contract** — in `ipc-contract.ts`, add to the `CH` map (after `harnessReadGraphEdges`):

```ts
  readProjectWiki: 'c:readProjectWiki',
```
and add the types (after the `HarnessReadGraphEdges*` block):

```ts
export type WikiGraphNodeDto = { ref: string; type: string; title: string; relPath: string }
export type ReadProjectWikiReq = { projectId: string }
export type ReadProjectWikiRes =
  | { available: true; wikiDir: string; nodes: WikiGraphNodeDto[]; edges: GraphEdgeDto[] }
  | { available: false; reason?: string }
```
(`GraphEdgeDto` already exists in this file — reuse it.)

- [ ] **Step 2: Wire the container** — in `container.ts`:
  - Import `ReadProjectWikiReq, ReadProjectWikiRes` from the contract (the line that imports `HarnessReadGraphEdgesReq, …`).
  - Add `import { readProjectWiki } from './project-wiki.js'` at the top with the other main imports.
  - Add to the container interface (near `harnessReadGraphEdges`): `readProjectWiki: (req: ReadProjectWikiReq) => ReadProjectWikiRes`
  - Add the implementation (near the other `const harness…` consts):

```ts
  const readProjectWikiQuery = (req: ReadProjectWikiReq): ReadProjectWikiRes => {
    const repoPaths = registry.get(req.projectId)?.repoPaths ?? []
    return readProjectWiki(repoPaths)
  }
```
  - Add `readProjectWiki: readProjectWikiQuery` to the returned object (the line listing `harnessReadGraphEdges, …`).

- [ ] **Step 3: Add the ipc handler** — in `ipc.ts`, after the `harnessReadGraphEdges` handler:

```ts
    [CH.readProjectWiki]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string() }).strict().parse(payload)
      return container.readProjectWiki(req)
    },
```

- [ ] **Step 4: Add the api wrapper** — in `api.ts`, import `ReadProjectWikiReq, ReadProjectWikiRes` (with the other contract imports) and add after `harnessReadGraphEdges`:

```ts
  readProjectWiki(req: ReadProjectWikiReq): Promise<ReadProjectWikiRes> {
    return window.apc.invoke(CH.readProjectWiki, req) as Promise<ReadProjectWikiRes>
  },
```

- [ ] **Step 5: Verify + commit**

Run: `npx tsc -p apps/desktop/tsconfig.json --noEmit` → 0 errors.
Run: `pnpm --filter @apc/desktop exec vitest run src/main/ipc.test.ts` → still passes.
```bash
git add apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/container.ts apps/desktop/src/main/ipc.ts apps/desktop/src/renderer/api.ts
git commit -F <tmpfile>   # "feat(ipc): readProjectWiki channel"
```

---

## Task 4: buildWikiGraphData (renderer builder)

**Files:**
- Modify: `apps/desktop/src/renderer/harness-utils.ts` (add near `buildPaperGraphData`)
- Test: `apps/desktop/src/renderer/harness-utils.test.ts`

**Interfaces:**
- Consumes: `GraphData`/`GraphNode` types, `entityColor`/`workflowFor`/`directionFor` from `./graph/graph-style.js` (already imported in harness-utils), `colorForNode`/`addNode`/`addLink` (existing local helpers).
- Produces: `buildWikiGraphData(nodes: WikiNodeInput[], edges: PaperGraphEdge[]): GraphData` where `WikiNodeInput = { ref: string; type: string; title: string; relPath: string }`. Node graph `id` = `ref`.

- [ ] **Step 1: Write the failing test** (new describe block in `harness-utils.test.ts`)

```ts
describe('buildWikiGraphData (existing wiki: <type>/<slug> refs + edges.jsonl)', () => {
  const nodes = [
    { ref: 'papers/transformer', type: 'papers', title: 'Attention Is All You Need', relPath: 'wiki/papers/transformer.md' },
    { ref: 'methods/self-attention', type: 'methods', title: 'Self-Attention', relPath: 'wiki/methods/self-attention.md' },
  ]

  test('each wiki node becomes a graph node keyed by its <type>/<slug> ref, carrying title + doc path', () => {
    const { nodes: out } = buildWikiGraphData(nodes, [])
    const p = out.find((n) => n.id === 'papers/transformer')
    expect(p?.label).toBe('Attention Is All You Need')
    expect(p?.type).toBe('papers')
    expect((p?.data as { path?: string } | undefined)?.path).toBe('wiki/papers/transformer.md')
  })

  test('a typed edge connects two nodes as a rel link with workflow/direction/confidence', () => {
    const edges = [{ from: 'papers/transformer', to: 'methods/self-attention', type: 'uses_module', confidence: 'high' }]
    const link = buildWikiGraphData(nodes, edges).links.find((l) => l.kind === 'rel')
    expect(link?.source).toBe('papers/transformer')
    expect(link?.target).toBe('methods/self-attention')
    expect(link?.label).toBe('uses_module')
    expect(link?.confidence).toBe('high')
    expect(link?.direction).toBe('directed')
  })

  test('an edge endpoint with no node md still renders (ghost)', () => {
    const edges = [{ from: 'papers/transformer', to: 'concepts/ghosty', type: 'mentions' }]
    const { nodes: out, links } = buildWikiGraphData(nodes, edges)
    expect(out.find((n) => n.id === 'concepts/ghosty')).toBeTruthy()
    expect(links.some((l) => l.source === 'papers/transformer' && l.target === 'concepts/ghosty')).toBe(true)
  })
})
```
Add `buildWikiGraphData` to the import line at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/harness-utils.test.ts -t "buildWikiGraphData"`
Expected: FAIL — `buildWikiGraphData is not a function`.

- [ ] **Step 3: Write minimal implementation** (add to `harness-utils.ts`, right after `buildPaperGraphData`)

```ts
type WikiNodeInput = { ref: string; type: string; title: string; relPath: string }

/** Build the graph from a project's published wiki (<repo>/wiki): node `id` is the AutoSci `<type>/<slug>`
 *  ref the edges.jsonl uses, so edges connect directly. Mirrors buildPaperGraphData but for slash-form
 *  refs and arbitrary entity types. */
export function buildWikiGraphData(nodes: WikiNodeInput[], edges: PaperGraphEdge[]): HarnessGraphData {
  const nodeMap = new Map<string, HarnessGraphNode>()
  const links: HarnessGraphLink[] = []

  for (const n of nodes) {
    addNode(nodeMap, {
      id: n.ref,
      label: n.title || n.ref,
      type: n.type as HarnessGraphNode['type'],
      shape: 'circle',
      color: colorForNode(n.type as Parameters<typeof colorForNode>[0]),
      details: n.type,
      data: { path: n.relPath },
    })
  }

  const ensure = (ref: string): void => {
    if (nodeMap.has(ref)) return
    const type = ref.includes('/') ? ref.slice(0, ref.indexOf('/')) : 'document'
    addNode(nodeMap, {
      id: ref, label: ref.slice(ref.indexOf('/') + 1), type: type as HarnessGraphNode['type'],
      shape: 'circle', color: colorForNode('ghost'), details: `${type} (미생성)`,
    })
  }

  for (const e of edges) {
    if (!e?.from || !e?.to) continue
    ensure(e.from); ensure(e.to)
    const confidence = typeof e.confidence === 'string' ? e.confidence : undefined
    addLink(links, {
      id: `rel:${e.from}->${e.to}:${e.type}`, source: e.from, target: e.to, kind: 'rel',
      label: e.type, confidence, direction: directionFor(e.type), workflow: workflowFor(e.type),
    })
  }
  return { nodes: [...nodeMap.values()], links }
}
```

Note on `colorForNode`: it is the existing local helper in harness-utils. If it does not already cover the AutoSci entity types, prefer `entityColor` from graph-style instead (import is already present): replace `colorForNode(n.type …)` with `entityColor(n.type)` and `colorForNode('ghost')` with a literal muted color `'#475569'`. Use whichever keeps the typecheck clean and colors correct; the test only checks structure, not exact colors.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/harness-utils.test.ts`
Run: `npx tsc -p apps/desktop/tsconfig.json --noEmit`
Expected: PASS (3 new + existing) and 0 typecheck errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/harness-utils.ts apps/desktop/src/renderer/harness-utils.test.ts
git commit -F <tmpfile>   # "feat(graph): buildWikiGraphData from <type>/<slug> wiki refs"
```

---

## Task 5: KnowledgeView — run↔wiki toggle + wiring

**Files:**
- Modify: `apps/desktop/src/renderer/components/KnowledgeView.tsx`
- Test: `apps/desktop/src/renderer/components/KnowledgeView.test.tsx`

**Interfaces:**
- Consumes: `api.readProjectWiki` (Task 3), `buildWikiGraphData` (Task 4), `ReadProjectWikiRes` type.
- Produces: a toggle in the graph view; `effectiveGraph` uses the wiki source when selected.

- [ ] **Step 1: Write the failing test** (add to `KnowledgeView.test.tsx`; mock `api.readProjectWiki`)

```ts
  test('shows a project-wiki / latest-run toggle; wiki button enabled when a wiki is available', async () => {
    // arrange: a selected project + api.readProjectWiki returns available wiki (see existing mocks in this file
    // for how api + store are stubbed; mirror them). Then:
    render(<KnowledgeView />)
    // switch to graph mode
    fireEvent.click(screen.getByRole('button', { name: '그래프' }))
    expect(await screen.findByRole('button', { name: '프로젝트 위키' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '최신 런' })).toBeInTheDocument()
  })
```
(Match the file's existing mocking style for `api`/`useStore`; the existing KnowledgeView tests show the pattern.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/components/KnowledgeView.test.tsx -t "toggle"`
Expected: FAIL — no such buttons.

- [ ] **Step 3: Implement the wiring**

In `KnowledgeView.tsx`:
- Import `buildWikiGraphData` from `../harness-utils.js` and `type ReadProjectWikiRes` from `../../shared/ipc-contract.js`.
- Add state: `const [projectWiki, setProjectWiki] = useState<ReadProjectWikiRes | null>(null)` and `const [graphSource, setGraphSource] = useState<'run' | 'wiki'>('run')`.
- Add an effect keyed on `selectedProjectId` that calls `api.readProjectWiki({ projectId })`, stores the result, and sets `graphSource` to `'wiki'` if `available` else `'run'`:

```ts
  useEffect(() => {
    if (!selectedProjectId) { setProjectWiki(null); setGraphSource('run'); return }
    let stale = false
    void api.readProjectWiki({ projectId: selectedProjectId })
      .then((res) => { if (stale) return; setProjectWiki(res); setGraphSource(res.available ? 'wiki' : 'run') })
      .catch(() => { if (!stale) { setProjectWiki(null); setGraphSource('run') } })
    return () => { stale = true }
  }, [selectedProjectId])
```
- Add a memo for the wiki graph and branch `effectiveGraph`:

```ts
  const wikiGraph = useMemo(
    () => (projectWiki?.available ? buildWikiGraphData(projectWiki.nodes, projectWiki.edges) : { nodes: [], links: [] }),
    [projectWiki],
  )
  const effectiveGraph = liveActive ? liveGraph
    : (graphSource === 'wiki' && projectWiki?.available) ? wikiGraph
    : (domain === 'paper' ? paperGraph : graphData)
```
(Replace the existing `effectiveGraph` assignment with this branch — keep `liveActive`/`paperGraph`/`graphData` as they are.)
- Render the toggle inside the graph-mode block, above `<GraphVisualization …>`:

```tsx
            <div className="knowledge__graph-source">
              <button type="button"
                className={graphSource === 'wiki' ? 'knowledge__seg-btn knowledge__seg-btn--on' : 'knowledge__seg-btn'}
                disabled={!projectWiki?.available}
                onClick={() => setGraphSource('wiki')}>프로젝트 위키</button>
              <button type="button"
                className={graphSource === 'run' ? 'knowledge__seg-btn knowledge__seg-btn--on' : 'knowledge__seg-btn'}
                onClick={() => setGraphSource('run')}>최신 런</button>
            </div>
```
- Node click: the wiki nodes carry `data.path = "wiki/<type>/<slug>.md"`. The existing `handleNodeClick` already reads `(node.data as {path?})?.path` and falls through to `api.fsReadDoc({ projectId, relPath })` for non-staged docs — confirm a wiki node (path under `wiki/…`, `.md`) flows through that disk-read branch and opens in the peek. If `handleNodeClick`'s staging-prefix stripping interferes, guard: when `graphSource === 'wiki'`, skip the staged read and go straight to `fsReadDoc({ projectId, relPath: nodePath })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/components/KnowledgeView.test.tsx`
Run: `npx tsc -p apps/desktop/tsconfig.json --noEmit`
Expected: PASS (existing + new) and 0 typecheck errors.

- [ ] **Step 5: Add toggle CSS + commit**

Add to `app.css` (near `.knowledge__seg`): `.knowledge__graph-source { display: flex; gap: 6px; margin-bottom: 8px; }` (reuse the existing `.knowledge__seg-btn` styles).
```bash
git add apps/desktop/src/renderer/components/KnowledgeView.tsx apps/desktop/src/renderer/components/KnowledgeView.test.tsx apps/desktop/src/renderer/app.css
git commit -F <tmpfile>   # "feat(knowledge): run<->wiki graph source toggle"
```

---

## Self-Review notes

- **Spec coverage:** readProjectWiki IPC (T2+T3); buildWikiGraphData (T4); graph-style AutoSci colors (T1); KnowledgeView toggle + wiki source + node-click (T5); error handling (reader never throws, available:false, malformed-line skip — T2; ssh skip — T2); tests (TDD in T1/T2/T4, light component test T5). All covered.
- **Type note:** wiki node `type` is a free string (AutoSci vocab); it is cast to the graph node type at the builder boundary (T4) and colored at runtime via the style table (T1) — no union exhaustiveness needed.
- **Naming consistency:** channel `readProjectWiki`; reader `readProjectWiki(repoPaths)`; builder `buildWikiGraphData(nodes, edges)`; DTO `WikiGraphNodeDto`/`ReadProjectWikiRes`; refs are `<type>/<slug>` throughout.
- **Out of scope:** ssh:// wikis, editing, layout persistence.
