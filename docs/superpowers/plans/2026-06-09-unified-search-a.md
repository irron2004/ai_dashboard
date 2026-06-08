# Unified Search A (service + modal UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a normalized unified search over the session index (`@apc/search`) plus a search modal, closing the first half of PRD AC#6 (knowledge results are a slot filled by sub-project B).

**Architecture:** A `UnifiedSearch` composition (in `apps/desktop/src/main`, alongside the container/searchIndex) queries the session FTS index and maps hits to a normalized `UnifiedSearchResponse` (`@apc/shared`). The existing `q:search` IPC returns it; a new `SearchModal` (toolbar button + Ctrl+K) renders the hits and switches projects on click.

**Tech Stack:** TypeScript, node:sqlite (FTS5), React, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-09-unified-search-a-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/shared/src/search-schema.ts` | Create | `UnifiedSearchHit` / `UnifiedSearchResponse` types |
| `packages/shared/src/index.ts` | Modify | Export the search types |
| `apps/desktop/src/main/unified-search.ts` | Create | `UnifiedSearch` (session → normalized; knowledge slot) |
| `apps/desktop/src/main/unified-search.test.ts` | Create | Service unit tests |
| `apps/desktop/src/main/container.ts` | Modify | Instantiate + expose `search` |
| `apps/desktop/src/main/ipc.ts` | Modify | `q:search` → `container.search` |
| `apps/desktop/src/renderer/api.ts` | Modify | `search` return type |
| `apps/desktop/src/renderer/components/SearchModal.tsx` | Create | Search modal UI |
| `apps/desktop/src/renderer/components/SearchModal.test.tsx` | Create | Component tests |
| `apps/desktop/src/renderer/App.tsx` | Modify | Toolbar button + Ctrl+K + render modal |
| `apps/desktop/src/renderer/app.css` | Modify | `.search-modal*` styles |

**Verification:** `cd apps/desktop && npx vitest run`; `npx vitest run packages/shared`; `pnpm typecheck`.

> NodeNext: relative imports use `.js`.

---

## Task 1: `UnifiedSearch` service + types

**Files:**
- Create: `packages/shared/src/search-schema.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/desktop/src/main/unified-search.ts`
- Create: `apps/desktop/src/main/unified-search.test.ts`

- [ ] **Step 1: Write the failing test.** Create `apps/desktop/src/main/unified-search.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { SearchIndex } from '@apc/search'
import { UnifiedSearch } from './unified-search.js'

function session(id: string, projectId: string, texts: [string, string][]) {
  return { id, agentType: 'claude' as const, projectId,
    sourceMeta: { provider: 'claude' as const, sourceKind: 'jsonl-file' as const, rawLocator: '', sessionHeader: {} },
    turns: texts.map(([role, text]) => ({ role: role as 'user' | 'assistant', text, toolCalls: [] })),
    filesTouched: [] }
}

describe('UnifiedSearch', () => {
  test('returns normalized session hits', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    idx.indexSession(session('s1', 'p1', [['user', 'design the agent session manager']]))
    idx.indexSession(session('s2', 'p2', [['user', 'unrelated billing']]))
    const res = new UnifiedSearch({ sessions: idx }).search({ query: 'agent' })
    expect(res.query).toBe('agent')
    expect(res.hits.length).toBe(1)
    expect(res.hits[0]).toMatchObject({ kind: 'session', id: 's1', projectId: 'p1' })
    expect(res.hits[0].excerpt).toContain('agent')
  })

  test('empty/whitespace query returns no hits', () => {
    const idx = new SearchIndex(new DatabaseSync(':memory:'))
    expect(new UnifiedSearch({ sessions: idx }).search({ query: '  ' }).hits).toEqual([])
  })
})
```

- [ ] **Step 2: Run, confirm FAIL** — `cd apps/desktop && npx vitest run src/main/unified-search.test.ts` (module not found).

- [ ] **Step 3: Add the types.** Create `packages/shared/src/search-schema.ts`:

```ts
export type UnifiedSearchHit = {
  kind: string
  id: string
  title: string
  excerpt: string
  projectId: string
  score?: number
}
export type UnifiedSearchResponse = { query: string; hits: UnifiedSearchHit[] }
```
And in `packages/shared/src/index.ts` add:
```ts
export * from './search-schema.js'
```

- [ ] **Step 4: Write the service.** Create `apps/desktop/src/main/unified-search.ts`:

```ts
import type { SearchIndex } from '@apc/search'
import type { UnifiedSearchResponse } from '@apc/shared'

/** Composes the result sets of the indexes into one normalized response.
 *  Session index is live; knowledge is a slot filled by sub-project B (`deps.knowledge`). */
export class UnifiedSearch {
  constructor(private readonly deps: { sessions: SearchIndex }) {}

  search(input: { query: string; projectId?: string }): UnifiedSearchResponse {
    const query = input.query.trim()
    if (!query) return { query, hits: [] }
    const sessionHits = this.deps.sessions.search(query, input.projectId ? { projectId: input.projectId } : {})
    const hits = sessionHits.map((h) => ({
      kind: 'session', id: h.sessionId, title: h.sessionId, excerpt: h.snippet, projectId: h.projectId,
    }))
    // knowledge hits = [] until sub-project B
    return { query, hits }
  }
}
```

- [ ] **Step 5: Run test + typecheck, confirm PASS** — `cd apps/desktop && npx vitest run src/main/unified-search.test.ts && cd ../.. && pnpm typecheck` (2 tests green).

- [ ] **Step 6: Commit**
```bash
git add packages/shared/src/search-schema.ts packages/shared/src/index.ts apps/desktop/src/main/unified-search.ts apps/desktop/src/main/unified-search.test.ts
git commit -m "feat(desktop): UnifiedSearch service + normalized search types"
```

---

## Task 2: Wire `search` through container + ipc + api

**Files:**
- Modify: `apps/desktop/src/main/container.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/renderer/api.ts`

- [ ] **Step 1: container.ts.**
(a) Add the import near the other local imports:
```ts
import { UnifiedSearch } from './unified-search.js'
```
(b) Add `SearchReq` and `UnifiedSearchResponse` to the imports. `SearchReq` comes from `'../shared/ipc-contract.js'` (add to that import list). `UnifiedSearchResponse` comes from `@apc/shared` — add it to the existing `@apc/shared`/`ipc-contract` type imports (it is re-exported by neither automatically, so import from `'@apc/shared'`; if container.ts has no `@apc/shared` import line, add `import type { UnifiedSearchResponse } from '@apc/shared'`).
(c) In the `Container` type, add:
```ts
  search: (req: SearchReq) => UnifiedSearchResponse
```
(d) After `const searchIndex = new SearchIndex(searchDb)` is created, add:
```ts
  const unifiedSearch = new UnifiedSearch({ sessions: searchIndex })
  const search = (req: SearchReq): UnifiedSearchResponse => unifiedSearch.search(req)
```
(e) Add `search` to the returned container object (the `return { db, registry, ..., searchIndex, ... }`):
```ts
    search,
```

- [ ] **Step 2: ipc.ts.** Replace the `[CH.search]` handler body:
```ts
    [CH.search]: async (payload: unknown) => {
      const req = payload as SearchReq
      return container.searchIndex.search(req.query, req.projectId ? { projectId: req.projectId } : {})
    },
```
with:
```ts
    [CH.search]: async (payload: unknown) => {
      return container.search(payload as SearchReq)
    },
```

- [ ] **Step 3: api.ts.** Change the `search` wrapper return type. Replace:
```ts
  search(req: SearchReq): Promise<unknown[]> {
    return window.apc.invoke(CH.search, req) as Promise<unknown[]>
  },
```
with:
```ts
  search(req: SearchReq): Promise<UnifiedSearchResponse> {
    return window.apc.invoke(CH.search, req) as Promise<UnifiedSearchResponse>
  },
```
Add `UnifiedSearchResponse` to api.ts's imports — it's a `@apc/shared` type, so add `import type { UnifiedSearchResponse } from '@apc/shared'` (or extend an existing `@apc/shared` import line if present).

- [ ] **Step 4: Verify** — `cd apps/desktop && npx vitest run && cd ../.. && pnpm typecheck`. (ipc.test builds the container; `search` is additive. The existing `q:search` handler now returns the unified shape — if `ipc.test.ts` asserts on `search`, update that assertion to the `{ query, hits }` shape; if it doesn't test search, no change.)

- [ ] **Step 5: Commit**
```bash
git add apps/desktop/src/main/container.ts apps/desktop/src/main/ipc.ts apps/desktop/src/renderer/api.ts
git commit -m "feat(desktop): q:search returns UnifiedSearchResponse via container.search"
```

---

## Task 3: `SearchModal` component

**Files:**
- Create: `apps/desktop/src/renderer/components/SearchModal.tsx`
- Create: `apps/desktop/src/renderer/components/SearchModal.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `apps/desktop/src/renderer/components/SearchModal.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { SearchModal } from './SearchModal.js'

vi.mock('../api.js', () => ({
  api: { search: vi.fn().mockResolvedValue({ query: 'auth', hits: [{ kind: 'session', id: 's1', title: 's1', excerpt: 'jwt auth flow', projectId: 'p1' }] }) },
}))

describe('SearchModal', () => {
  test('renders nothing when closed', () => {
    const { container } = render(<SearchModal open={false} onClose={vi.fn()} onSelectProject={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  test('searches on Enter and renders hits; clicking a hit switches project and closes', async () => {
    const onClose = vi.fn(); const onSelectProject = vi.fn()
    render(<SearchModal open onClose={onClose} onSelectProject={onSelectProject} />)
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'auth' } })
    fireEvent.keyDown(screen.getByLabelText('search'), { key: 'Enter' })
    const hit = await screen.findByText('jwt auth flow')
    fireEvent.click(hit)
    expect(onSelectProject).toHaveBeenCalledWith('p1')
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run, confirm FAIL** (module not found).

- [ ] **Step 3: Write the component.** Create `apps/desktop/src/renderer/components/SearchModal.tsx`:

```tsx
import { useState } from 'react'
import type { UnifiedSearchHit } from '@apc/shared'
import { api } from '../api.js'

type Props = { open: boolean; onClose: () => void; onSelectProject: (projectId: string) => void }

export function SearchModal({ open, onClose, onSelectProject }: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<UnifiedSearchHit[]>([])
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const run = async () => {
    try {
      const res = await api.search({ query })
      setHits(res.hits); setSearched(true); setError(null)
    } catch (e) {
      setError(String(e)); setHits([]); setSearched(true)
    }
  }

  return (
    <div className="add-project-overlay" onClick={onClose}>
      <div className="add-project-dialog search-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Search</h2>
        <input
          autoFocus
          aria-label="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void run() }}
          placeholder="검색어 입력 후 Enter"
        />
        {error && <p className="search-modal__error">{error}</p>}
        {searched && hits.length === 0 && !error && <p className="search-modal__empty">결과 없음</p>}
        <ul className="search-modal__results">
          {hits.map((h) => (
            <li key={`${h.kind}:${h.id}`}>
              <button type="button" onClick={() => { onSelectProject(h.projectId); onClose() }}>
                <span className="search-modal__kind">[{h.kind}]</span>
                <span className="search-modal__proj">{h.projectId}</span>
                <span className="search-modal__title">{h.title}</span>
                <span className="search-modal__excerpt">{h.excerpt}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="add-project-dialog__actions">
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test + typecheck, confirm PASS** (2 tests). `cd apps/desktop && npx vitest run src/renderer/components/SearchModal.test.tsx && cd ../.. && pnpm typecheck`.

- [ ] **Step 5: Commit**
```bash
git add apps/desktop/src/renderer/components/SearchModal.tsx apps/desktop/src/renderer/components/SearchModal.test.tsx
git commit -m "feat(desktop): SearchModal renders unified search hits"
```

---

## Task 4: Wire the modal into App (toolbar button + Ctrl+K)

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/app.css`

- [ ] **Step 1: App.tsx — import + state.** Add the import:
```tsx
import { SearchModal } from './components/SearchModal.js'
```
Add state near the other `useState` hooks (e.g. by `const [generateModalOpen, setGenerateModalOpen] = useState(false)`):
```tsx
  const [searchOpen, setSearchOpen] = useState(false)
```

- [ ] **Step 2: App.tsx — Ctrl+K effect.** Add a `useEffect` (near the other keydown effect):
```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyK') {
        e.preventDefault(); setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
```

- [ ] **Step 3: App.tsx — toolbar button.** In the `<header className="app-layout__toolbar">` (next to the Ingest/Generate buttons), add:
```tsx
          <button onClick={() => setSearchOpen(true)} title="검색 (Ctrl+K)">🔎 Search</button>
```

- [ ] **Step 4: App.tsx — render the modal.** Near the other modal renders (e.g. after the generate modal block, before the `{error && ...}` toast), add:
```tsx
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} onSelectProject={(id) => void selectProject(id)} />
```
(`selectProject` is already destructured from the store in App.tsx.)

- [ ] **Step 5: app.css — styles.** Append to `apps/desktop/src/renderer/app.css`:
```css
/* ── Search modal ────────────────────────────────────── */
.search-modal { width: 640px; max-width: 92vw; }
.search-modal input { width: 100%; box-sizing: border-box; margin-bottom: 8px; padding: 6px 8px; }
.search-modal__results { list-style: none; margin: 0; padding: 0; max-height: 50vh; overflow: auto; }
.search-modal__results button { display: grid; grid-template-columns: auto auto 1fr; gap: 6px; width: 100%; text-align: left; background: #161616; border: 1px solid #2c2c2c; border-radius: 4px; padding: 5px 7px; margin-bottom: 4px; color: #ccc; cursor: pointer; }
.search-modal__kind { color: #9cf; font-size: 0.7rem; }
.search-modal__proj { opacity: 0.6; font-size: 0.7rem; }
.search-modal__title { font-weight: 600; font-size: 0.8rem; }
.search-modal__excerpt { grid-column: 1 / -1; font-size: 0.72rem; opacity: 0.7; }
.search-modal__empty, .search-modal__error { opacity: 0.6; font-size: 0.82rem; }
.search-modal__error { color: #f87171; }
```

- [ ] **Step 6: Verify** — `cd apps/desktop && npx vitest run && cd ../.. && pnpm typecheck` (full desktop suite green, typecheck clean).

- [ ] **Step 7: Commit**
```bash
git add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/app.css
git commit -m "feat(desktop): search modal toolbar button + Ctrl+K"
```

---

## Task 5: Full verification

- [ ] **Step 1: Run all affected suites + typecheck.**
```bash
npx vitest run packages/shared
cd apps/desktop && npx vitest run && cd ../..
pnpm typecheck
```
Expected: all green, typecheck clean.

- [ ] **Step 2: Confirm acceptance criteria (spec §11).**
1. Toolbar/Ctrl+K opens the modal; query → normalized session hits. ✔ (Task 3/4)
2. `q:search` returns `UnifiedSearchResponse`. ✔ (Task 1/2)
3. Clicking a hit switches project. ✔ (Task 3/4)
4. Empty/0-result/error states handled. ✔ (Task 3)
5. New + existing tests + typecheck pass; no new IPC command (reuse `q:search`), no migration. ✔
6. `UnifiedSearch` has a knowledge slot for sub-project B. ✔ (Task 1: `deps` shape)

---

## Notes for the implementer
- `UnifiedSearch.search` returns synchronously; the IPC handler wraps it in the async handler (returns a resolved value) — fine.
- `UnifiedSearch` lives in `apps/desktop/src/main` (not `@apc/app-services`) to avoid adding a `@apc/search` dependency to that package; the desktop already depends on `@apc/search`.
- The session index FTS `snippet(...)` wraps the matched term in `[...]`, so a hit's `excerpt` contains the query term — the test asserts this.
- Sub-project B will add `deps.knowledge?: KnowledgeRetrieval` and append its normalized hits; the contract and modal already handle arbitrary `kind` values.
