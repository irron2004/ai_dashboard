# Agent Project Console — Knowledge Retrieval Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a qmd-inspired local retrieval engine that indexes Obsidian-compatible project Markdown, attaches PM context semantics, and produces agent-friendly context packages for tasks.

**Architecture:** Add a new pure-Node engine package, `@apc/knowledge`, instead of overloading `@apc/search` (which currently indexes normalized agent-session turns). `@apc/knowledge` owns collection/context config, Markdown document indexing, heading-aware chunking, FTS5 retrieval, `pmw://` document URIs, ranking boosts for PM document state, and context-package assembly. MCP stdio/HTTP, vector search, reranking, and Electron UI wiring are deferred; the MVP is SDK-first and testable through package APIs.

**Tech Stack:** TypeScript (ESM), Vitest, Zod, `node:sqlite` FTS5, `gray-matter`, Node 24. No native vector/reranker dependency in MVP.

> Inspired by qmd: collections, context tree, SDK-first store, local config discovery, agent-friendly JSON/files output, and later MCP `query/get/multi_get/status`. We intentionally start with SQLite FTS5 + metadata ranking only; vector search/reranking and MCP transports are P1/P2 adapters over the same store.

---

## File Structure

```
packages/shared/src/
  knowledge-schema.ts          # KnowledgeCollection, ContextNode, Doc, Chunk, SearchHit, ContextPackage
  knowledge-schema.test.ts
  index.ts                     # export knowledge-schema

packages/knowledge/
  package.json
  src/index.ts
  src/migrate.ts               # migrateKnowledge(db): collection/doc/chunk/context tables + FTS5
  src/migrate.test.ts
  src/uri.ts                   # pmw:// URI helpers
  src/uri.test.ts
  src/local-config.ts          # findLocalProjectConfig(startDir) for .pmw/project.yml
  src/local-config.test.ts
  src/chunker.ts               # heading/code-fence aware Markdown chunks
  src/chunker.test.ts
  src/knowledge-store.ts       # collection/context/doc/chunk CRUD + indexing
  src/knowledge-store.test.ts
  src/retrieval.ts             # project-filtered FTS search + ranking rules
  src/retrieval.test.ts
  src/context-package.ts       # buildContextPackage(taskId/projectId/query)
  src/context-package.test.ts

vitest.config.ts               # add @apc/knowledge alias
```

---

## MVP / Deferred Cut

### MVP in this plan

- Project-scoped Markdown collections.
- Context tree metadata inherited by document path.
- `pmw://project/<projectId>/<relPath>` URI scheme.
- Heading/code-fence-aware chunking.
- SQLite FTS5 search over Markdown chunks.
- PM ranking rules: current/canonical/accepted boost; candidate neutral; superseded/deprecated demotion; conflict warning flag.
- Agent-friendly `ContextPackage` with JSON fields and source files.

### Deferred

- Vector search and LLM reranking: P1 adapter behind the same retrieval API.
- MCP stdio server: P1 wrapper exposing `query`, `get`, `multi_get`, `status`.
- Long-lived HTTP MCP server: P2.
- Electron renderer UI and IPC wiring: Plan 6/UI integration.
- YAML config writing UI: Plan 6/UI integration. This plan only discovers and reads `.pmw/project.yml` path conventions; it does not implement a YAML parser dependency.

---

### Task 1: Knowledge contracts in `@apc/shared`

**Files:**
- Create: `packages/shared/src/knowledge-schema.ts`
- Create: `packages/shared/src/knowledge-schema.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest'
import {
  KnowledgeCollectionSchema,
  KnowledgeContextNodeSchema,
  KnowledgeDocumentSchema,
  KnowledgeChunkSchema,
  KnowledgeSearchHitSchema,
  ContextPackageSchema,
} from './knowledge-schema.js'

describe('Knowledge schemas', () => {
  test('parses a project-scoped Markdown collection', () => {
    const collection = KnowledgeCollectionSchema.parse({
      id: 'kc-project-p1',
      projectId: 'p1',
      name: 'Project Wiki',
      rootPath: '/vault/projects/p1',
      include: ['**/*.md'],
      exclude: ['raw/**'],
      includeByDefault: true,
    })
    expect(collection.include).toEqual(['**/*.md'])
    expect(collection.includeByDefault).toBe(true)
  })

  test('parses a context node with inherited semantics', () => {
    const node = KnowledgeContextNodeSchema.parse({
      collectionId: 'kc-project-p1',
      pathPrefix: '/decisions',
      description: 'Accepted design decisions and ADRs',
      docType: 'decision',
      statusHint: 'accepted',
    })
    expect(node.docType).toBe('decision')
  })

  test('parses a document, chunk, search hit, and context package', () => {
    const doc = KnowledgeDocumentSchema.parse({
      id: 'doc-1',
      collectionId: 'kc-project-p1',
      projectId: 'p1',
      uri: 'pmw://project/p1/decisions/ADR-001.md',
      relPath: 'decisions/ADR-001.md',
      title: 'ADR-001',
      docType: 'decision',
      status: 'accepted',
      hash: 'abc',
      updatedAt: '2026-06-01T10:00:00Z',
      contextText: 'Accepted design decisions and ADRs',
    })
    const chunk = KnowledgeChunkSchema.parse({
      id: 'chunk-1',
      docId: doc.id,
      projectId: 'p1',
      uri: `${doc.uri}#chunk-1`,
      headingPath: ['ADR-001', 'Decision'],
      body: 'Use SQLite FTS5 for MVP retrieval.',
      ordinal: 0,
      tokenEstimate: 7,
      contextText: doc.contextText,
    })
    const hit = KnowledgeSearchHitSchema.parse({
      doc,
      chunk,
      score: 1.5,
      reasons: ['status:accepted', 'fts'],
      warnings: [],
    })
    const pkg = ContextPackageSchema.parse({
      id: 'ctx-TASK-1',
      projectId: 'p1',
      taskId: 'TASK-1',
      query: 'retrieval architecture',
      hits: [hit],
      files: ['decisions/ADR-001.md'],
      generatedAt: '2026-06-01T10:30:00Z',
    })
    expect(pkg.hits[0].doc.status).toBe('accepted')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/shared/src/knowledge-schema.test.ts`

Expected: FAIL — cannot resolve `./knowledge-schema.js`.

- [ ] **Step 3: Implement schemas**

```ts
import { z } from 'zod'

export const KnowledgeDocTypeSchema = z.enum([
  'current', 'task', 'review', 'decision', 'wiki', 'agent-run', 'reference', 'conflict', 'unknown',
])
export type KnowledgeDocType = z.infer<typeof KnowledgeDocTypeSchema>

export const KnowledgeStatusSchema = z.enum([
  'canonical', 'accepted', 'candidate', 'superseded', 'deprecated', 'conflict', 'unknown',
])
export type KnowledgeStatus = z.infer<typeof KnowledgeStatusSchema>

export const KnowledgeCollectionSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  include: z.array(z.string()).default(['**/*.md']),
  exclude: z.array(z.string()).default([]),
  includeByDefault: z.boolean().default(true),
})
export type KnowledgeCollection = z.infer<typeof KnowledgeCollectionSchema>

export const KnowledgeContextNodeSchema = z.object({
  collectionId: z.string().min(1),
  pathPrefix: z.string().min(1),
  description: z.string().min(1),
  docType: KnowledgeDocTypeSchema.default('unknown'),
  statusHint: KnowledgeStatusSchema.default('unknown'),
})
export type KnowledgeContextNode = z.infer<typeof KnowledgeContextNodeSchema>

export const KnowledgeDocumentSchema = z.object({
  id: z.string().min(1),
  collectionId: z.string().min(1),
  projectId: z.string().min(1),
  uri: z.string().min(1),
  relPath: z.string().min(1),
  title: z.string().min(1),
  docType: KnowledgeDocTypeSchema.default('unknown'),
  status: KnowledgeStatusSchema.default('unknown'),
  hash: z.string().min(1),
  updatedAt: z.string().min(1),
  contextText: z.string().default(''),
})
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>

export const KnowledgeChunkSchema = z.object({
  id: z.string().min(1),
  docId: z.string().min(1),
  projectId: z.string().min(1),
  uri: z.string().min(1),
  headingPath: z.array(z.string()).default([]),
  body: z.string(),
  ordinal: z.number().int().nonnegative(),
  tokenEstimate: z.number().int().nonnegative(),
  contextText: z.string().default(''),
})
export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>

export const KnowledgeSearchHitSchema = z.object({
  doc: KnowledgeDocumentSchema,
  chunk: KnowledgeChunkSchema,
  score: z.number(),
  reasons: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
})
export type KnowledgeSearchHit = z.infer<typeof KnowledgeSearchHitSchema>

export const ContextPackageSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  query: z.string().min(1),
  hits: z.array(KnowledgeSearchHitSchema).default([]),
  files: z.array(z.string()).default([]),
  generatedAt: z.string().min(1),
})
export type ContextPackage = z.infer<typeof ContextPackageSchema>
```

Modify `packages/shared/src/index.ts`:

```ts
export const VERSION = '0.0.0'
export * from './schema.js'
export * from './ingest-schema.js'
export * from './wiki-schema.js'
export * from './harness-schema.js'
export * from './knowledge-schema.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/shared/src/knowledge-schema.test.ts`

Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/knowledge-schema.ts packages/shared/src/knowledge-schema.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add knowledge retrieval contracts"
```

---

### Task 2: `@apc/knowledge` scaffold and migrations

**Files:**
- Create: `packages/knowledge/package.json`
- Create: `packages/knowledge/src/index.ts`
- Create: `packages/knowledge/src/migrate.ts`
- Create: `packages/knowledge/src/migrate.test.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Write the failing migration test**

```ts
import { describe, expect, test } from 'vitest'
import { openDb, migrate } from '@apc/core'
import { migrateKnowledge } from './migrate.js'

describe('migrateKnowledge', () => {
  test('creates knowledge tables and FTS table', () => {
    const db = openDb(':memory:')
    migrate(db)
    migrateKnowledge(db)
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").all()
      .map((row: { name: string }) => row.name)
    expect(names).toEqual(expect.arrayContaining([
      'knowledge_collections',
      'knowledge_contexts',
      'knowledge_documents',
      'knowledge_chunks',
      'knowledge_chunk_fts',
    ]))
  })

  test('is idempotent', () => {
    const db = openDb(':memory:')
    migrate(db)
    migrateKnowledge(db)
    expect(() => migrateKnowledge(db)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/knowledge/src/migrate.test.ts`

Expected: FAIL — package alias or `migrateKnowledge` does not exist.

- [ ] **Step 3: Create package files and alias**

`packages/knowledge/package.json`:

```json
{
  "name": "@apc/knowledge",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": { "@apc/shared": "workspace:*", "@apc/core": "workspace:*", "@apc/vault": "workspace:*" }
}
```

`packages/knowledge/src/index.ts`:

```ts
export * from './migrate.js'
```

Modify `vitest.config.ts` alias block:

```ts
'@apc/knowledge': `${root}packages/knowledge/src/index.ts`,
```

- [ ] **Step 4: Implement migration**

```ts
import type { Db } from '@apc/core'

export function migrateKnowledge(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_collections (
      id                 TEXT PRIMARY KEY,
      project_id         TEXT NOT NULL,
      name               TEXT NOT NULL,
      root_path          TEXT NOT NULL,
      include_globs      TEXT NOT NULL DEFAULT '["**/*.md"]',
      exclude_globs      TEXT NOT NULL DEFAULT '[]',
      include_by_default INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS knowledge_contexts (
      collection_id TEXT NOT NULL,
      path_prefix   TEXT NOT NULL,
      description   TEXT NOT NULL,
      doc_type      TEXT NOT NULL DEFAULT 'unknown',
      status_hint   TEXT NOT NULL DEFAULT 'unknown',
      PRIMARY KEY (collection_id, path_prefix),
      FOREIGN KEY (collection_id) REFERENCES knowledge_collections(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id            TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      project_id    TEXT NOT NULL,
      uri           TEXT NOT NULL,
      rel_path      TEXT NOT NULL,
      title         TEXT NOT NULL,
      doc_type      TEXT NOT NULL DEFAULT 'unknown',
      status        TEXT NOT NULL DEFAULT 'unknown',
      hash          TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      context_text  TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (collection_id) REFERENCES knowledge_collections(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id             TEXT PRIMARY KEY,
      doc_id         TEXT NOT NULL,
      project_id     TEXT NOT NULL,
      uri            TEXT NOT NULL,
      heading_path   TEXT NOT NULL DEFAULT '[]',
      body           TEXT NOT NULL,
      ordinal        INTEGER NOT NULL,
      token_estimate INTEGER NOT NULL,
      context_text   TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (doc_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunk_fts
      USING fts5(chunk_id, doc_id, project_id, title, context_text, body);

    CREATE INDEX IF NOT EXISTS idx_knowledge_documents_project ON knowledge_documents(project_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_project ON knowledge_chunks(project_id);
  `)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- packages/knowledge/src/migrate.test.ts`

Expected: PASS — 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/knowledge/package.json packages/knowledge/src/index.ts packages/knowledge/src/migrate.ts packages/knowledge/src/migrate.test.ts vitest.config.ts
git commit -m "feat(knowledge): scaffold package and migrations"
```

---

### Task 3: `pmw://` URI helpers and local config discovery

**Files:**
- Create: `packages/knowledge/src/uri.ts`
- Create: `packages/knowledge/src/uri.test.ts`
- Create: `packages/knowledge/src/local-config.ts`
- Create: `packages/knowledge/src/local-config.test.ts`
- Modify: `packages/knowledge/src/index.ts`

- [ ] **Step 1: Write failing tests**

`packages/knowledge/src/uri.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { buildProjectDocUri, parseProjectDocUri } from './uri.js'

describe('pmw project document URIs', () => {
  test('builds and parses a project document URI', () => {
    const uri = buildProjectDocUri('p1', 'decisions/ADR-001.md')
    expect(uri).toBe('pmw://project/p1/decisions/ADR-001.md')
    expect(parseProjectDocUri(uri)).toEqual({ projectId: 'p1', relPath: 'decisions/ADR-001.md' })
  })

  test('rejects non-project URIs', () => {
    expect(() => parseProjectDocUri('qmd://notes/foo.md')).toThrow(/Unsupported pmw URI/)
  })
})
```

`packages/knowledge/src/local-config.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findLocalProjectConfig } from './local-config.js'

describe('findLocalProjectConfig', () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  test('walks upward until it finds .pmw/project.yml', () => {
    const root = mkdtempSync(join(tmpdir(), 'apc-pmw-'))
    dirs.push(root)
    const nested = join(root, 'packages', 'app')
    mkdirSync(nested, { recursive: true })
    mkdirSync(join(root, '.pmw'))
    writeFileSync(join(root, '.pmw', 'project.yml'), 'projectId: p1\n')
    expect(findLocalProjectConfig(nested)).toBe(join(root, '.pmw', 'project.yml'))
  })

  test('returns undefined when no local project config exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'apc-no-pmw-'))
    dirs.push(root)
    expect(findLocalProjectConfig(root)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- packages/knowledge/src/uri.test.ts packages/knowledge/src/local-config.test.ts`

Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement helpers**

`packages/knowledge/src/uri.ts`:

```ts
export function buildProjectDocUri(projectId: string, relPath: string): string {
  const clean = relPath.replace(/^\/+/, '')
  return `pmw://project/${encodeURIComponent(projectId)}/${clean}`
}

export function parseProjectDocUri(uri: string): { projectId: string; relPath: string } {
  const prefix = 'pmw://project/'
  if (!uri.startsWith(prefix)) throw new Error(`Unsupported pmw URI: ${uri}`)
  const rest = uri.slice(prefix.length)
  const slash = rest.indexOf('/')
  if (slash === -1) throw new Error(`Invalid project document URI: ${uri}`)
  return { projectId: decodeURIComponent(rest.slice(0, slash)), relPath: rest.slice(slash + 1) }
}
```

`packages/knowledge/src/local-config.ts`:

```ts
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export function findLocalProjectConfig(startDir: string): string | undefined {
  let current = resolve(startDir)
  while (true) {
    const candidate = join(current, '.pmw', 'project.yml')
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}
```

Modify `packages/knowledge/src/index.ts`:

```ts
export * from './migrate.js'
export * from './uri.js'
export * from './local-config.js'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- packages/knowledge/src/uri.test.ts packages/knowledge/src/local-config.test.ts`

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge/src/uri.ts packages/knowledge/src/uri.test.ts packages/knowledge/src/local-config.ts packages/knowledge/src/local-config.test.ts packages/knowledge/src/index.ts
git commit -m "feat(knowledge): add pmw uri and local config discovery"
```

---

### Task 4: Markdown chunker

**Files:**
- Create: `packages/knowledge/src/chunker.ts`
- Create: `packages/knowledge/src/chunker.test.ts`
- Modify: `packages/knowledge/src/index.ts`

- [ ] **Step 1: Write failing chunker tests**

```ts
import { describe, expect, test } from 'vitest'
import { chunkMarkdown } from './chunker.js'

describe('chunkMarkdown', () => {
  test('keeps heading context on chunks', () => {
    const chunks = chunkMarkdown(`# Current\n\nIntro text\n\n## Decision\n\nUse SQLite FTS5.`, { targetTokens: 8 })
    expect(chunks.map((c) => c.headingPath.join(' > '))).toContain('Current > Decision')
  })

  test('does not split inside fenced code blocks', () => {
    const chunks = chunkMarkdown([
      '# Notes',
      '',
      '```ts',
      'const a = 1',
      'const b = 2',
      'const c = 3',
      '```',
      '',
      'After code.',
    ].join('\n'), { targetTokens: 4 })
    expect(chunks.some((c) => c.body.includes('```ts') && c.body.includes('```'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/knowledge/src/chunker.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement chunker**

```ts
export type MarkdownChunkDraft = {
  headingPath: string[]
  body: string
  ordinal: number
  tokenEstimate: number
}

export type ChunkOptions = { targetTokens?: number }

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3))
}

function headingLevel(line: string): number | undefined {
  const match = /^(#{1,6})\s+(.+)$/.exec(line)
  return match ? match[1].length : undefined
}

function headingTitle(line: string): string | undefined {
  return /^(#{1,6})\s+(.+)$/.exec(line)?.[2]?.trim()
}

export function chunkMarkdown(markdown: string, opts: ChunkOptions = {}): MarkdownChunkDraft[] {
  const target = opts.targetTokens ?? 900
  const lines = markdown.split('\n')
  const chunks: MarkdownChunkDraft[] = []
  const headings: string[] = []
  let current: string[] = []
  let currentHeadingPath: string[] = []
  let inFence = false

  const flush = () => {
    const body = current.join('\n').trim()
    if (!body) return
    chunks.push({ headingPath: currentHeadingPath, body, ordinal: chunks.length, tokenEstimate: estimateTokens(body) })
    current = []
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) inFence = !inFence
    const level = !inFence ? headingLevel(line) : undefined
    if (level) {
      flush()
      headings.splice(level - 1)
      headings[level - 1] = headingTitle(line) ?? line.replace(/^#+\s*/, '')
      currentHeadingPath = headings.filter(Boolean)
      current.push(line)
      continue
    }
    const nextBody = [...current, line].join('\n')
    if (!inFence && current.length > 0 && estimateTokens(nextBody) > target && line.trim() === '') {
      flush()
      currentHeadingPath = headings.filter(Boolean)
      continue
    }
    current.push(line)
  }
  flush()
  return chunks
}
```

Modify `packages/knowledge/src/index.ts`:

```ts
export * from './migrate.js'
export * from './uri.js'
export * from './local-config.js'
export * from './chunker.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/knowledge/src/chunker.test.ts`

Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge/src/chunker.ts packages/knowledge/src/chunker.test.ts packages/knowledge/src/index.ts
git commit -m "feat(knowledge): add markdown chunker"
```

---

### Task 5: KnowledgeStore collection/context/doc indexing

**Files:**
- Create: `packages/knowledge/src/knowledge-store.ts`
- Create: `packages/knowledge/src/knowledge-store.test.ts`
- Modify: `packages/knowledge/src/index.ts`

- [ ] **Step 1: Write failing store tests**

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migrateKnowledge } from './migrate.js'
import { KnowledgeStore } from './knowledge-store.js'

describe('KnowledgeStore', () => {
  let db: Db
  let store: KnowledgeStore
  beforeEach(() => { db = openDb(':memory:'); migrate(db); migrateKnowledge(db); store = new KnowledgeStore(db) })

  test('registers a collection and context node', () => {
    store.upsertCollection({ id: 'kc1', projectId: 'p1', name: 'Wiki', rootPath: '/vault/p1', include: ['**/*.md'], exclude: [], includeByDefault: true })
    store.upsertContext({ collectionId: 'kc1', pathPrefix: '/decisions', description: 'Accepted decisions', docType: 'decision', statusHint: 'accepted' })
    expect(store.listCollections('p1')).toHaveLength(1)
    expect(store.contextForPath('kc1', 'decisions/ADR-001.md')?.description).toBe('Accepted decisions')
  })

  test('indexes a Markdown document into chunks and replaces old chunks', () => {
    store.upsertCollection({ id: 'kc1', projectId: 'p1', name: 'Wiki', rootPath: '/vault/p1', include: ['**/*.md'], exclude: [], includeByDefault: true })
    const first = store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'current.md', markdown: '# Current\n\nFirst version', updatedAt: '2026-06-01T10:00:00Z' })
    const second = store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'current.md', markdown: '# Current\n\nSecond version', updatedAt: '2026-06-01T10:01:00Z' })
    expect(first.id).toBe(second.id)
    expect(store.getDocument(first.id)?.hash).toBe(second.hash)
    expect(store.listChunks(first.id)).toHaveLength(1)
    expect(store.listChunks(first.id)[0].body).toContain('Second version')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/knowledge/src/knowledge-store.test.ts`

Expected: FAIL — `KnowledgeStore` does not exist.

- [ ] **Step 3: Implement KnowledgeStore**

```ts
import { createHash } from 'node:crypto'
import {
  KnowledgeChunkSchema,
  KnowledgeCollectionSchema,
  KnowledgeContextNodeSchema,
  KnowledgeDocumentSchema,
  type KnowledgeChunk,
  type KnowledgeCollection,
  type KnowledgeContextNode,
  type KnowledgeDocument,
  type KnowledgeDocType,
  type KnowledgeStatus,
} from '@apc/shared'
import type { Db } from '@apc/core'
import { chunkMarkdown } from './chunker.js'
import { buildProjectDocUri } from './uri.js'

type CollectionRow = { id: string; project_id: string; name: string; root_path: string; include_globs: string; exclude_globs: string; include_by_default: number }
type ContextRow = { collection_id: string; path_prefix: string; description: string; doc_type: KnowledgeDocType; status_hint: KnowledgeStatus }
type DocRow = { id: string; collection_id: string; project_id: string; uri: string; rel_path: string; title: string; doc_type: KnowledgeDocType; status: KnowledgeStatus; hash: string; updated_at: string; context_text: string }
type ChunkRow = { id: string; doc_id: string; project_id: string; uri: string; heading_path: string; body: string; ordinal: number; token_estimate: number; context_text: string }

function hash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function docId(collectionId: string, relPath: string): string {
  return `${collectionId}:${relPath}`
}

function titleFrom(relPath: string, markdown: string): string {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? relPath.split('/').pop() ?? relPath
}

function collectionFrom(row: CollectionRow): KnowledgeCollection {
  return KnowledgeCollectionSchema.parse({ id: row.id, projectId: row.project_id, name: row.name, rootPath: row.root_path, include: JSON.parse(row.include_globs), exclude: JSON.parse(row.exclude_globs), includeByDefault: row.include_by_default === 1 })
}

function contextFrom(row: ContextRow): KnowledgeContextNode {
  return KnowledgeContextNodeSchema.parse({ collectionId: row.collection_id, pathPrefix: row.path_prefix, description: row.description, docType: row.doc_type, statusHint: row.status_hint })
}

function docFrom(row: DocRow): KnowledgeDocument {
  return KnowledgeDocumentSchema.parse({ id: row.id, collectionId: row.collection_id, projectId: row.project_id, uri: row.uri, relPath: row.rel_path, title: row.title, docType: row.doc_type, status: row.status, hash: row.hash, updatedAt: row.updated_at, contextText: row.context_text })
}

function chunkFrom(row: ChunkRow): KnowledgeChunk {
  return KnowledgeChunkSchema.parse({ id: row.id, docId: row.doc_id, projectId: row.project_id, uri: row.uri, headingPath: JSON.parse(row.heading_path), body: row.body, ordinal: row.ordinal, tokenEstimate: row.token_estimate, contextText: row.context_text })
}

export class KnowledgeStore {
  constructor(private readonly db: Db) {}

  upsertCollection(input: KnowledgeCollection): void {
    const c = KnowledgeCollectionSchema.parse(input)
    this.db.prepare(`INSERT OR REPLACE INTO knowledge_collections
      (id, project_id, name, root_path, include_globs, exclude_globs, include_by_default)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(c.id, c.projectId, c.name, c.rootPath, JSON.stringify(c.include), JSON.stringify(c.exclude), c.includeByDefault ? 1 : 0)
  }

  listCollections(projectId: string): KnowledgeCollection[] {
    const rows = this.db.prepare('SELECT * FROM knowledge_collections WHERE project_id = ? ORDER BY id').all(projectId) as CollectionRow[]
    return rows.map(collectionFrom)
  }

  upsertContext(input: KnowledgeContextNode): void {
    const c = KnowledgeContextNodeSchema.parse(input)
    this.db.prepare(`INSERT OR REPLACE INTO knowledge_contexts
      (collection_id, path_prefix, description, doc_type, status_hint) VALUES (?, ?, ?, ?, ?)`)
      .run(c.collectionId, c.pathPrefix, c.description, c.docType, c.statusHint)
  }

  contextForPath(collectionId: string, relPath: string): KnowledgeContextNode | undefined {
    const normalized = `/${relPath.replace(/^\/+/, '')}`
    const rows = this.db.prepare('SELECT * FROM knowledge_contexts WHERE collection_id = ? ORDER BY length(path_prefix) DESC').all(collectionId) as ContextRow[]
    const match = rows.find((r) => normalized === r.path_prefix || normalized.startsWith(`${r.path_prefix.replace(/\/$/, '')}/`))
    return match ? contextFrom(match) : undefined
  }

  indexMarkdownDoc(input: { collectionId: string; projectId: string; relPath: string; markdown: string; updatedAt: string }): KnowledgeDocument {
    const context = this.contextForPath(input.collectionId, input.relPath)
    const id = docId(input.collectionId, input.relPath)
    const document = KnowledgeDocumentSchema.parse({
      id,
      collectionId: input.collectionId,
      projectId: input.projectId,
      uri: buildProjectDocUri(input.projectId, input.relPath),
      relPath: input.relPath,
      title: titleFrom(input.relPath, input.markdown),
      docType: context?.docType ?? 'unknown',
      status: context?.statusHint ?? 'unknown',
      hash: hash(input.markdown),
      updatedAt: input.updatedAt,
      contextText: context?.description ?? '',
    })
    this.db.prepare(`INSERT OR REPLACE INTO knowledge_documents
      (id, collection_id, project_id, uri, rel_path, title, doc_type, status, hash, updated_at, context_text)
      VALUES (:id, :collectionId, :projectId, :uri, :relPath, :title, :docType, :status, :hash, :updatedAt, :contextText)`).run(document)
    this.db.prepare('DELETE FROM knowledge_chunks WHERE doc_id = ?').run(document.id)
    this.db.prepare('DELETE FROM knowledge_chunk_fts WHERE doc_id = ?').run(document.id)
    const insertChunk = this.db.prepare(`INSERT INTO knowledge_chunks
      (id, doc_id, project_id, uri, heading_path, body, ordinal, token_estimate, context_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const insertFts = this.db.prepare('INSERT INTO knowledge_chunk_fts (chunk_id, doc_id, project_id, title, context_text, body) VALUES (?, ?, ?, ?, ?, ?)')
    for (const draft of chunkMarkdown(input.markdown)) {
      const chunk = KnowledgeChunkSchema.parse({ id: `${document.id}#${draft.ordinal}`, docId: document.id, projectId: document.projectId, uri: `${document.uri}#chunk-${draft.ordinal}`, headingPath: draft.headingPath, body: draft.body, ordinal: draft.ordinal, tokenEstimate: draft.tokenEstimate, contextText: document.contextText })
      insertChunk.run(chunk.id, chunk.docId, chunk.projectId, chunk.uri, JSON.stringify(chunk.headingPath), chunk.body, chunk.ordinal, chunk.tokenEstimate, chunk.contextText)
      insertFts.run(chunk.id, chunk.docId, chunk.projectId, document.title, chunk.contextText, chunk.body)
    }
    return document
  }

  getDocument(id: string): KnowledgeDocument | undefined {
    const row = this.db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(id) as DocRow | undefined
    return row ? docFrom(row) : undefined
  }

  listChunks(docIdValue: string): KnowledgeChunk[] {
    const rows = this.db.prepare('SELECT * FROM knowledge_chunks WHERE doc_id = ? ORDER BY ordinal').all(docIdValue) as ChunkRow[]
    return rows.map(chunkFrom)
  }
}
```

Modify `packages/knowledge/src/index.ts`:

```ts
export * from './migrate.js'
export * from './uri.js'
export * from './local-config.js'
export * from './chunker.js'
export * from './knowledge-store.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/knowledge/src/knowledge-store.test.ts`

Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge/src/knowledge-store.ts packages/knowledge/src/knowledge-store.test.ts packages/knowledge/src/index.ts
git commit -m "feat(knowledge): add collection context and document indexing store"
```

---

### Task 6: Retrieval search and PM ranking rules

**Files:**
- Create: `packages/knowledge/src/retrieval.ts`
- Create: `packages/knowledge/src/retrieval.test.ts`
- Modify: `packages/knowledge/src/index.ts`

- [ ] **Step 1: Write failing retrieval tests**

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migrateKnowledge } from './migrate.js'
import { KnowledgeStore } from './knowledge-store.js'
import { KnowledgeRetrieval } from './retrieval.js'

describe('KnowledgeRetrieval', () => {
  let store: KnowledgeStore
  let retrieval: KnowledgeRetrieval
  beforeEach(() => {
    const db: Db = openDb(':memory:')
    migrate(db); migrateKnowledge(db)
    store = new KnowledgeStore(db)
    retrieval = new KnowledgeRetrieval(db)
    store.upsertCollection({ id: 'kc1', projectId: 'p1', name: 'Wiki', rootPath: '/vault/p1', include: ['**/*.md'], exclude: [], includeByDefault: true })
    store.upsertContext({ collectionId: 'kc1', pathPrefix: '/current.md', description: 'Current canonical project state', docType: 'current', statusHint: 'canonical' })
    store.upsertContext({ collectionId: 'kc1', pathPrefix: '/wiki', description: 'Candidate LLM wiki notes', docType: 'wiki', statusHint: 'candidate' })
    store.upsertContext({ collectionId: 'kc1', pathPrefix: '/conflicts', description: 'Conflict docs', docType: 'conflict', statusHint: 'conflict' })
    store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'wiki/retrieval.md', markdown: '# Retrieval\n\nTemporal and retrieval notes.', updatedAt: '2026-06-01T10:00:00Z' })
    store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'current.md', markdown: '# Current\n\nTemporal is deferred; retrieval uses FTS.', updatedAt: '2026-06-01T10:01:00Z' })
    store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'conflicts/current-conflict.md', markdown: '# Conflict\n\nTemporal retrieval conflict.', updatedAt: '2026-06-01T10:02:00Z' })
  })

  test('searches project-scoped chunks and boosts canonical docs', () => {
    const hits = retrieval.search({ projectId: 'p1', query: 'Temporal retrieval', limit: 5 })
    expect(hits[0].doc.relPath).toBe('current.md')
    expect(hits[0].reasons).toContain('status:canonical')
  })

  test('flags conflict documents as warnings', () => {
    const hits = retrieval.search({ projectId: 'p1', query: 'conflict', limit: 5 })
    expect(hits.some((h) => h.warnings.includes('conflict-document'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/knowledge/src/retrieval.test.ts`

Expected: FAIL — `KnowledgeRetrieval` does not exist.

- [ ] **Step 3: Implement retrieval**

```ts
import { KnowledgeChunkSchema, KnowledgeDocumentSchema, KnowledgeSearchHitSchema, type KnowledgeSearchHit, type KnowledgeStatus } from '@apc/shared'
import type { Db } from '@apc/core'

type Row = {
  doc_id: string
  chunk_id: string
  snip: string
  rank_value: number
  id: string
  collection_id: string
  project_id: string
  uri: string
  rel_path: string
  title: string
  doc_type: string
  status: KnowledgeStatus
  hash: string
  updated_at: string
  context_text: string
  heading_path: string
  body: string
  ordinal: number
  token_estimate: number
  chunk_context_text: string
  chunk_uri: string
}

export type KnowledgeSearchOptions = { projectId: string; query: string; limit?: number }

function boost(status: KnowledgeStatus): { value: number; reasons: string[]; warnings: string[] } {
  if (status === 'canonical' || status === 'accepted') return { value: 1.0, reasons: [`status:${status}`], warnings: [] }
  if (status === 'superseded' || status === 'deprecated') return { value: -1.0, reasons: [`status:${status}`], warnings: [] }
  if (status === 'conflict') return { value: -0.25, reasons: ['status:conflict'], warnings: ['conflict-document'] }
  return { value: 0, reasons: [`status:${status}`], warnings: [] }
}

export class KnowledgeRetrieval {
  constructor(private readonly db: Db) {}

  search(opts: KnowledgeSearchOptions): KnowledgeSearchHit[] {
    const rows = this.db.prepare(`
      SELECT f.doc_id, f.chunk_id, snippet(knowledge_chunk_fts, 5, '[', ']', '…', 12) AS snip,
             bm25(knowledge_chunk_fts) AS rank_value,
             d.id, d.collection_id, d.project_id, d.uri, d.rel_path, d.title, d.doc_type, d.status, d.hash, d.updated_at, d.context_text,
             c.heading_path, c.body, c.ordinal, c.token_estimate, c.context_text AS chunk_context_text, c.uri AS chunk_uri
      FROM knowledge_chunk_fts f
      JOIN knowledge_documents d ON d.id = f.doc_id
      JOIN knowledge_chunks c ON c.id = f.chunk_id
      WHERE knowledge_chunk_fts MATCH ? AND f.project_id = ?
      ORDER BY rank_value
      LIMIT ?
    `).all(opts.query, opts.projectId, opts.limit ?? 10) as Row[]
    return rows
      .map((row) => {
        const metadata = boost(row.status)
        const baseScore = -row.rank_value
        return KnowledgeSearchHitSchema.parse({
          doc: KnowledgeDocumentSchema.parse({ id: row.id, collectionId: row.collection_id, projectId: row.project_id, uri: row.uri, relPath: row.rel_path, title: row.title, docType: row.doc_type, status: row.status, hash: row.hash, updatedAt: row.updated_at, contextText: row.context_text }),
          chunk: KnowledgeChunkSchema.parse({ id: row.chunk_id, docId: row.doc_id, projectId: row.project_id, uri: row.chunk_uri, headingPath: JSON.parse(row.heading_path), body: row.body, ordinal: row.ordinal, tokenEstimate: row.token_estimate, contextText: row.chunk_context_text }),
          score: baseScore + metadata.value,
          reasons: ['fts', ...metadata.reasons],
          warnings: metadata.warnings,
        })
      })
      .sort((a, b) => b.score - a.score)
  }
}
```

Modify `packages/knowledge/src/index.ts`:

```ts
export * from './migrate.js'
export * from './uri.js'
export * from './local-config.js'
export * from './chunker.js'
export * from './knowledge-store.js'
export * from './retrieval.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/knowledge/src/retrieval.test.ts`

Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge/src/retrieval.ts packages/knowledge/src/retrieval.test.ts packages/knowledge/src/index.ts
git commit -m "feat(knowledge): add project-scoped retrieval ranking"
```

---

### Task 7: Agent-friendly context packages

**Files:**
- Create: `packages/knowledge/src/context-package.ts`
- Create: `packages/knowledge/src/context-package.test.ts`
- Modify: `packages/knowledge/src/index.ts`

- [ ] **Step 1: Write failing context package test**

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migrateKnowledge } from './migrate.js'
import { KnowledgeStore } from './knowledge-store.js'
import { KnowledgeRetrieval } from './retrieval.js'
import { ContextPackageBuilder } from './context-package.js'

describe('ContextPackageBuilder', () => {
  let builder: ContextPackageBuilder
  beforeEach(() => {
    const db: Db = openDb(':memory:')
    migrate(db); migrateKnowledge(db)
    const store = new KnowledgeStore(db)
    store.upsertCollection({ id: 'kc1', projectId: 'p1', name: 'Wiki', rootPath: '/vault/p1', include: ['**/*.md'], exclude: [], includeByDefault: true })
    store.upsertContext({ collectionId: 'kc1', pathPrefix: '/decisions', description: 'Accepted decisions', docType: 'decision', statusHint: 'accepted' })
    store.indexMarkdownDoc({ collectionId: 'kc1', projectId: 'p1', relPath: 'decisions/ADR-001.md', markdown: '# ADR-001\n\nUse local retrieval.', updatedAt: '2026-06-01T10:00:00Z' })
    builder = new ContextPackageBuilder(new KnowledgeRetrieval(db), () => '2026-06-01T10:30:00Z')
  })

  test('builds JSON/files output for an agent task', () => {
    const pkg = builder.build({ projectId: 'p1', taskId: 'TASK-1', query: 'local retrieval', limit: 5 })
    expect(pkg.id).toBe('ctx-TASK-1')
    expect(pkg.files).toEqual(['decisions/ADR-001.md'])
    expect(pkg.hits[0].doc.uri).toBe('pmw://project/p1/decisions/ADR-001.md')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/knowledge/src/context-package.test.ts`

Expected: FAIL — `ContextPackageBuilder` does not exist.

- [ ] **Step 3: Implement context package builder**

```ts
import { ContextPackageSchema, type ContextPackage } from '@apc/shared'
import type { KnowledgeRetrieval } from './retrieval.js'

export type BuildContextPackageInput = { projectId: string; taskId: string; query: string; limit?: number }

export class ContextPackageBuilder {
  constructor(private readonly retrieval: KnowledgeRetrieval, private readonly now: () => string = () => new Date().toISOString()) {}

  build(input: BuildContextPackageInput): ContextPackage {
    const hits = this.retrieval.search({ projectId: input.projectId, query: input.query, limit: input.limit ?? 10 })
    const files = [...new Set(hits.map((hit) => hit.doc.relPath))]
    return ContextPackageSchema.parse({
      id: `ctx-${input.taskId}`,
      projectId: input.projectId,
      taskId: input.taskId,
      query: input.query,
      hits,
      files,
      generatedAt: this.now(),
    })
  }
}
```

Modify `packages/knowledge/src/index.ts`:

```ts
export * from './migrate.js'
export * from './uri.js'
export * from './local-config.js'
export * from './chunker.js'
export * from './knowledge-store.js'
export * from './retrieval.js'
export * from './context-package.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/knowledge/src/context-package.test.ts`

Expected: PASS — 1 test passes.

- [ ] **Step 5: Run knowledge package suite**

Run: `pnpm test -- packages/knowledge/src`

Expected: PASS — all `@apc/knowledge` tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/knowledge/src/context-package.ts packages/knowledge/src/context-package.test.ts packages/knowledge/src/index.ts
git commit -m "feat(knowledge): build agent context packages"
```

---

### Task 8: Final integration checks and docs update

**Files:**
- Modify: `docs/superpowers/specs/2026-06-01-agent-project-console-design.md`

- [ ] **Step 1: Add Knowledge Retrieval Core section to the spec**

Insert after the existing search/vault architecture sections:

```md
### Knowledge Retrieval Core

`@apc/knowledge` indexes Obsidian-compatible project Markdown into a local SQLite FTS5 index. It treats vault folders as project collections, stores context-tree metadata for paths such as `/tasks`, `/reviews`, `/decisions`, `/wiki`, and `/current.md`, and emits `ContextPackage` JSON/files output for agent task assignment.

MVP retrieval is keyword/FTS + PM metadata ranking:

- `canonical` / `accepted` documents are boosted.
- `candidate` documents are neutral.
- `superseded` / `deprecated` documents are demoted.
- `conflict` documents remain searchable but carry a warning.

MCP stdio/HTTP and vector/rerank adapters are future wrappers over the SDK-first `KnowledgeRetrieval` and `ContextPackageBuilder` APIs.
```

- [ ] **Step 2: Run all tests**

Run: `pnpm test`

Expected: PASS — all test files and tests pass.

- [ ] **Step 3: Verify package aliases are exported**

Run: `pnpm test -- packages/knowledge/src/context-package.test.ts packages/shared/src/knowledge-schema.test.ts`

Expected: PASS — package-level imports resolve.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-01-agent-project-console-design.md
git commit -m "docs: add Knowledge Retrieval Core to PRD"
```

---

## Definition of Done

- [ ] `@apc/shared` exports Knowledge Retrieval schemas and tests cover collection/context/doc/chunk/search hit/context package parsing.
- [ ] `@apc/knowledge` exists as a pure Node/TypeScript package with `src/index.ts` public exports.
- [ ] `migrateKnowledge(db)` creates collection/context/document/chunk tables and FTS5 index idempotently.
- [ ] `findLocalProjectConfig(startDir)` discovers `.pmw/project.yml` by walking upward.
- [ ] `pmw://project/<projectId>/<relPath>` URIs build and parse deterministically.
- [ ] Markdown chunking preserves heading context and avoids splitting inside fenced code blocks.
- [ ] `KnowledgeStore` registers collections, context nodes, and re-indexes Markdown documents by replacing old chunks.
- [ ] `KnowledgeRetrieval.search()` returns project-scoped hits with PM status ranking and conflict warnings.
- [ ] `ContextPackageBuilder` returns agent-friendly JSON/files output for a task.
- [ ] `pnpm test` passes.

---

## Deferred Work

- MCP stdio server exposing `query`, `get`, `multi_get`, `status`.
- Streamable HTTP MCP server with `/mcp` and `/health`.
- Vector embedding and reranking adapter.
- YAML config parser/writer for `.pmw/project.yml` and `.pmw/search.yml`.
- Electron UI wiring for collection management, search panel, and task context package preview.
- Worker-process indexing for very large vaults.
