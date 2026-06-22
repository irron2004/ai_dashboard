# Project Wiki Direct Visualization — Design

Date: 2026-06-22
Status: Approved (brainstorming) — pending implementation plan
Branch: builds on `feat/cytoscape-graph-viz` (depends on the Cytoscape graph component + GraphData types)

## Goal

Visualize a project's **existing, already-generated wiki** (`<repoPath>/wiki/`, AutoSci/ΩmegaWiki
layout with `graph/edges.jsonl` + `<type>/<slug>.md` node files) directly in the Cytoscape graph view —
without running the harness. The current graph reads only from a harness run's `vault-staging`; this adds
a second source (the promoted project wiki) and a toggle to switch between them.

## Decisions (from brainstorming)

- **Wiki source:** the **selected project's** `<repoPath>/wiki/` (resolved automatically from the project
  registry's `repoPaths`), not a folder picker or manual path.
- **Coexistence:** a **toggle** in the graph view between "프로젝트 위키" (project wiki) and "최신 런"
  (latest run). Not auto-replacement.
- v1 targets **local repos**. ssh:// projects (whose working copy lives under the workspace cache) are a
  follow-up.

## Non-Goals

- Re-running extraction / writing to the wiki. This is read-only visualization.
- Editing the wiki, or persisting graph layout.
- ssh:// project wikis (follow-up).
- Changing the portable graph module's contract — it still receives `GraphData` only.

## Wiki format (read target)

AutoSci/ΩmegaWiki layout under `<repoPath>/wiki/`:
- `graph/edges.jsonl` — one JSON object per line: `{ from, to, type, confidence?, ... }`. `from`/`to` are
  qualified node refs in **`<type>/<slug>`** form (slash separator — note: different from the vendored
  paper pack's `<type>:<slug>` colon form).
- `<type>/<slug>.md` — node files with frontmatter (`slug`, `title`). `<type>` is the entity directory
  (papers, concepts, topics, people, ideas, experiments, methods, foundations, Summary, outputs, …).
- `index.md`, `log.md` at the wiki root are NOT nodes (skip).

## Architecture

### Components

| Unit | Kind | Responsibility |
|------|------|----------------|
| `main/project-wiki.ts` | main, pure-ish | `readProjectWiki(repoPaths)` — resolve `<repo>/wiki`, parse `graph/edges.jsonl`, walk entity dirs for node md (frontmatter title/slug). Returns the wiki graph data or `available:false`. Path-guarded, never throws. |
| IPC `harnessReadProjectWiki` (or `readProjectWiki`) | main wiring | `{ projectId }` → resolve `registry.get(projectId).repoPaths` → `readProjectWiki(...)`. |
| `renderer/harness-utils.ts` `buildWikiGraphData` | renderer | Map the wiki reader output → `GraphData` (node `id` = `<type>/<slug>` ref; ghosts for missing endpoints; `workflow`/`direction`/`confidence` on rel links). |
| `renderer/graph/graph-style.ts` | portable | Add AutoSci entity colors (concepts/topics/people/ideas/experiments/methods/foundations/Summary/outputs) so wiki nodes are colored; unknown types keep the gray fallback. |
| `renderer/components/KnowledgeView.tsx` | renderer | Toggle (`graphSource: 'run' \| 'wiki'`), load the project wiki on project change, branch `effectiveGraph`, wiki node-click opens `<repo>/wiki/<type>/<slug>.md`. |

### IPC contract

```ts
type WikiGraphNodeDto = { ref: string; type: string; title: string; relPath: string }
type ReadProjectWikiReq = { projectId: string }
type ReadProjectWikiRes =
  | { available: true; wikiDir: string; nodes: WikiGraphNodeDto[]; edges: GraphEdgeDto[] }
  | { available: false; reason?: string }
```
`GraphEdgeDto` already exists (`{ from, to, type } & Record<string, unknown>`), reused here.

### `readProjectWiki(repoPaths)` (main)

- For each repo in `repoPaths` (skip `ssh://` in v1): candidate `wikiDir = join(repo, 'wiki')`. Use the
  first whose `graph/edges.jsonl` exists.
- If none → `{ available: false }`.
- Edges: read `graph/edges.jsonl`, split lines, JSON.parse each non-blank line, keep objects with string
  `from`/`to`/`type` (skip malformed).
- Nodes: read entity dirs (immediate subdirs of `wikiDir` except `graph`), for each `*.md` (excluding
  `index.md`/`log.md`): `slug` = frontmatter `slug:` else filename stem; `title` = frontmatter `title:`
  else slug; `ref` = `<dir>/<slug>`; `relPath` = `wiki/<dir>/<file>`.
- Guard the wiki dir resolution against path escape; wrap fs in try/catch (never throw).

### `buildWikiGraphData(nodes, edges)` (renderer)

```ts
export function buildWikiGraphData(
  nodes: Array<{ ref: string; type: string; title: string; relPath: string }>,
  edges: PaperGraphEdge[],
): GraphData
```
- Node graph `id` = `ref`; `label` = `title`; `type` mapped to a `GraphNodeType` (paper/autosci types are
  added to the union via graph-style coverage; cast where needed); `color` from `entityColor(type)`;
  `data = { path: relPath }` so a click opens the md.
- Edge endpoints that have no node → ghost node (muted), so cross-refs still render.
- Each edge → `kind: 'rel'` link, `label = type`, `workflow = workflowFor(type)`,
  `direction = directionFor(type)`, `confidence` if present.

### KnowledgeView wiring

- New state `graphSource: 'run' | 'wiki'`; new state `projectWiki: ReadProjectWikiRes | null`.
- Effect on `selectedProjectId`: call `api.readProjectWiki({ projectId })`; store result; if
  `available`, default `graphSource = 'wiki'`, else `'run'`.
- Toggle UI: two buttons above the graph (in the graph mode block). "프로젝트 위키" disabled when
  `!projectWiki?.available`.
- `effectiveGraph`: if `graphSource === 'wiki'` and available → `buildWikiGraphData(projectWiki.nodes,
  projectWiki.edges)`; else the existing run/paper/project-docs logic.
- `handleNodeClick`: when in wiki mode and the node carries `data.path` (a `wiki/<type>/<slug>.md`
  relPath), open it via `api.fsReadDoc({ projectId, relPath })` into the peek (it lives under repoPath).

## Data flow

```
project selected
  → api.readProjectWiki({projectId})  (main: <repo>/wiki/graph/edges.jsonl + <type>/<slug>.md)
  → { available, nodes, edges }
  → toggle wiki|run → wiki: buildWikiGraphData → GraphData → <GraphVisualization/>
node click (wiki) → fsReadDoc(projectId, "wiki/<type>/<slug>.md") → peek
```

## Error handling

- No wiki / no edges.jsonl → `available:false`; toggle's "프로젝트 위키" disabled; graph stays on run source.
- Malformed `edges.jsonl` lines → skipped (don't fail the whole read).
- Path escape in wiki resolution → guarded; `readProjectWiki` never throws (returns `available:false`).
- ssh:// repoPaths in v1 → treated as no local wiki (`available:false`); documented as follow-up.

## Testing

- **TDD:** `buildWikiGraphData` (renderer unit) — node id = ref, ghost endpoints, rel link with
  workflow/direction/confidence. `readProjectWiki` (main unit) — temp wiki dir: parses edges.jsonl
  (skips malformed), walks entity dirs, skips index/log, `available:false` when no wiki.
- `graph-style` — extend the existing test for the new entity colors.
- KnowledgeView — light test that the toggle renders and is disabled when no wiki (mock api).

## Out-of-scope follow-ups

- ssh:// project wikis (resolve via the workspace cache local copy).
- Auto-detecting the wiki under non-standard locations.
- Merging run + wiki sources in one view.
