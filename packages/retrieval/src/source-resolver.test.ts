import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDb, migrate, type Db } from '@apc/core'
import { KnowledgeStore, migrateKnowledge } from '@apc/knowledge'
import { SearchIndex } from '@apc/search'
import type { NormalizedSession } from '@apc/shared'
import { EvidenceSourceResolver } from './source-resolver.js'

function session(id: string, projectId: string, rawLocator: string): NormalizedSession {
  return {
    id,
    agentType: 'claude',
    projectId,
    sourceMeta: {
      provider: 'claude',
      sourceKind: 'jsonl-file',
      rawLocator,
      sessionHeader: {},
    },
    turns: [
      { role: 'user', text: 'first question context', toolCalls: [] },
      { role: 'assistant', text: 'selected answer context', toolCalls: [] },
      { role: 'user', text: 'following question context', toolCalls: [] },
    ],
    filesTouched: [],
  }
}

describe('EvidenceSourceResolver', () => {
  let base: string
  let projectRoot: string
  let outside: string
  let db: Db
  let knowledge: KnowledgeStore
  let sessions: SearchIndex
  let resolver: EvidenceSourceResolver

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'apc-source-resolver-'))
    projectRoot = join(base, 'project')
    outside = join(base, 'outside')
    mkdirSync(join(projectRoot, 'docs'), { recursive: true })
    mkdirSync(outside, { recursive: true })
    db = openDb(':memory:')
    migrate(db)
    migrateKnowledge(db)
    knowledge = new KnowledgeStore(db)
    knowledge.upsertCollection({
      id: 'project:p1',
      projectId: 'p1',
      name: 'P1',
      rootPath: projectRoot,
      include: ['**/*.md'],
      exclude: [],
      includeByDefault: true,
    })
    const markdown = '# Root\n\nintro context\n\n## Selected\n\nselected markdown context\n\n## After\n\nafter context'
    writeFileSync(join(projectRoot, 'docs', 'guide.md'), markdown)
    knowledge.indexMarkdownDoc({
      collectionId: 'project:p1',
      projectId: 'p1',
      relPath: 'docs/guide.md',
      markdown,
      updatedAt: '2026-08-02T00:00:00Z',
    })
    sessions = new SearchIndex(new DatabaseSync(':memory:'))
    sessions.indexSession(session('s1', 'p1', '/private/transcripts/secret.jsonl'))
    resolver = new EvidenceSourceResolver({
      registry: { get: (id) => id === 'p1' ? { id: 'p1' } : undefined },
      projectRoots: (id) => id === 'p1' ? [projectRoot] : [],
      knowledge,
      sessions,
      maxBytes: 4_096,
      maxNeighbors: 2,
    })
  })

  afterEach(() => rmSync(base, { recursive: true, force: true }))

  test('resolves a Markdown chunk with bounded neighbors and no filesystem locator', () => {
    const result = resolver.resolve({
      uri: 'pmw://project/p1/docs/guide.md#chunk-1',
      neighbors: 1,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source).toMatchObject({
      uri: 'pmw://project/p1/docs/guide.md#chunk-1',
      sourceKind: 'knowledge',
      projectId: 'p1',
      title: 'Root',
      selectedOrdinal: 1,
      truncated: false,
    })
    expect(result.source.content).toContain('intro context')
    expect(result.source.content).toContain('selected markdown context')
    expect(result.source.content).toContain('after context')
    expect(JSON.stringify(result)).not.toContain(projectRoot)
  })

  test('rejects traversal before attempting a project-root read', () => {
    const result = resolver.resolve({ uri: 'pmw://project/p1/%2E%2E/secret.md#chunk-0' })
    expect(result).toMatchObject({ ok: false, error: { code: 'path-escape' } })
  })

  test('rejects a symlink whose real path escapes the registered project root', () => {
    const outsideFile = join(outside, 'secret.md')
    writeFileSync(outsideFile, '# Secret\n\noutside content')
    symlinkSync(outsideFile, join(projectRoot, 'docs', 'link.md'))
    knowledge.indexMarkdownDoc({
      collectionId: 'project:p1', projectId: 'p1', relPath: 'docs/link.md',
      markdown: '# Secret\n\noutside content', updatedAt: '2026-08-02T00:00:00Z',
    })

    const result = resolver.resolve({ uri: 'pmw://project/p1/docs/link.md#chunk-0' })
    expect(result).toMatchObject({ ok: false, error: { code: 'path-escape' } })
  })

  test('fails closed for unknown projects and sessions', () => {
    expect(resolver.resolve({ uri: 'pmw://project/missing/docs/guide.md#chunk-0' }))
      .toMatchObject({ ok: false, error: { code: 'unknown-project' } })
    expect(resolver.resolve({ uri: 'apc://session/missing#turn-0' }))
      .toMatchObject({ ok: false, error: { code: 'unknown-session' } })
  })

  test('caps oversized source content and emits a truncation warning', () => {
    const large = `# Large\n\n${'한글-content-'.repeat(200)}`
    writeFileSync(join(projectRoot, 'docs', 'large.md'), large)
    knowledge.indexMarkdownDoc({
      collectionId: 'project:p1', projectId: 'p1', relPath: 'docs/large.md',
      markdown: large, updatedAt: '2026-08-02T00:00:00Z',
    })
    const bounded = new EvidenceSourceResolver({
      registry: { get: (id) => id === 'p1' ? { id: 'p1' } : undefined },
      projectRoots: () => [projectRoot],
      knowledge,
      sessions,
      maxBytes: 96,
      maxNeighbors: 1,
    })

    const result = bounded.resolve({ uri: 'pmw://project/p1/docs/large.md#chunk-0' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Buffer.byteLength(result.source.content, 'utf8')).toBeLessThanOrEqual(96)
    expect(result.source.truncated).toBe(true)
    expect(result.source.warnings).toContain('source-content-truncated')
  })

  test('rejects unsupported preview extensions even when indexed', () => {
    writeFileSync(join(projectRoot, 'docs', 'payload.bin'), 'binary-looking text')
    knowledge.indexMarkdownDoc({
      collectionId: 'project:p1', projectId: 'p1', relPath: 'docs/payload.bin',
      markdown: '# Payload\n\nbinary-looking text', updatedAt: '2026-08-02T00:00:00Z',
    })

    expect(resolver.resolve({ uri: 'pmw://project/p1/docs/payload.bin#chunk-0' }))
      .toMatchObject({ ok: false, error: { code: 'unsupported-extension' } })
  })

  test('returns bounded session context without exposing its raw locator', () => {
    const result = resolver.resolve({ uri: 'apc://session/s1#turn-1', neighbors: 1 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source).toMatchObject({
      sourceKind: 'session',
      projectId: 'p1',
      selectedOrdinal: 1,
    })
    expect(result.source.content).toContain('first question context')
    expect(result.source.content).toContain('selected answer context')
    expect(result.source.content).toContain('following question context')
    expect(JSON.stringify(result)).not.toContain('secret.jsonl')
    expect(JSON.stringify(result)).not.toContain('rawLocator')
  })

  test('rejects malformed fragments and neighbor requests beyond the configured bound', () => {
    expect(resolver.resolve({ uri: 'pmw://project/p1/docs/guide.md#wrong-1' }))
      .toMatchObject({ ok: false, error: { code: 'invalid-uri' } })
    expect(resolver.resolve({ uri: 'apc://session/s1#turn-1', neighbors: 3 }))
      .toMatchObject({ ok: false, error: { code: 'neighbor-limit' } })
  })
})
