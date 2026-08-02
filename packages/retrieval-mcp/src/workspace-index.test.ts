import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { afterEach, describe, expect, test } from 'vitest'
import type { RetrievalMcpConfig } from './config.js'
import { WorkspaceRetrievalRuntime } from './runtime.js'
import { refreshWorkspaceIndex, WorkspaceIndexError } from './workspace-index.js'

const roots: string[] = []

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function fixture(): { root: string; config: RetrievalMcpConfig; runtime: WorkspaceRetrievalRuntime } {
  const root = mkdtempSync(join(tmpdir(), 'retrieval-mcp-'))
  roots.push(root)
  mkdirSync(join(root, 'docs'), { recursive: true })
  mkdirSync(join(root, 'demo', 'wiki'), { recursive: true })
  mkdirSync(join(root, 'career'), { recursive: true })
  write(join(root, 'AGENTS.md'), '# Workspace Rules\nworkspace-control-term')
  write(join(root, 'docs', 'decision.md'), '# Decision\nroot-decision-term')
  write(join(root, 'demo', 'AGENTS.md'), '# Demo Rules\ndemo-rule-term')
  write(join(root, 'demo', 'README.md'), '# Demo\nreadme-term')
  write(join(root, 'demo', 'NEXT.md'), '# Next\nnext-term')
  write(join(root, 'demo', 'wiki', 'retrieval.md'), '# Retrieval\nretrievalneedle original evidence')
  write(join(root, 'career', 'AGENTS.md'), '# Career Rules\npublic-career-rule')
  write(join(root, 'career', 'private.md'), '# Private\nnever-index-private-secret')
  write(join(root, 'workspace.projects.yml'), `version: 1
projects:
  - key: demo
    name: Demo
    path: demo
    tier: independent
    rule_doc: demo/AGENTS.md
    wiki: demo/wiki
    next: demo/next.yml
    desc: Demo project
  - key: career
    name: Career
    path: career
    tier: root-tracked
    rule_doc: career/AGENTS.md
    desc: PII-safe control files only
`)
  const config = {
    workspaceRoot: root,
    manifestPath: join(root, 'workspace.projects.yml'),
    dbPath: join(root, '.autosci', 'cache', 'workspace-retrieval.sqlite'),
  }
  return { root, config, runtime: new WorkspaceRetrievalRuntime(config) }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('workspace evidence index', () => {
  test('indexes only manifest-declared and standard safe documents, then resolves their source', async () => {
    const { config, runtime } = fixture()
    const result = await refreshWorkspaceIndex(config, () => new Date('2026-08-02T00:00:00.000Z'))

    expect(result.skipped).toEqual([])
    expect(result.projects.map((project) => project.id)).toEqual(['workspace', 'demo', 'career'])
    expect(runtime.listProjects()).toMatchObject({
      indexedAt: '2026-08-02T00:00:00.000Z',
      projects: expect.arrayContaining([
        expect.objectContaining({ id: 'demo', documents: 4 }),
        expect.objectContaining({ id: 'career', documents: 1 }),
      ]),
    })

    const response = await runtime.search({ query: 'retrievalneedle', projectIds: ['demo'] })
    expect(response.evidence).toHaveLength(1)
    expect(response.evidence[0]).toMatchObject({ projectId: 'demo', title: 'Retrieval' })
    expect(response.evidence[0].uri).toContain('pmw://project/demo/wiki/retrieval.md#chunk-0')
    const source = runtime.getSource(response.evidence[0].uri, 0)
    expect(source).toMatchObject({ ok: true, source: { content: expect.stringContaining('original evidence') } })

    await expect(runtime.search({ query: 'never-index-private-secret', projectIds: ['career'] }))
      .resolves.toMatchObject({ evidence: [] })
  })

  test('uses snapshot diff for updates and deletes while preserving no-op writes', async () => {
    const { root, config, runtime } = fixture()
    const first = await refreshWorkspaceIndex(config)
    const second = await refreshWorkspaceIndex(config)
    expect(first.totalDocuments).toBeGreaterThan(0)
    expect(second.projects.every((project) => project.unchanged === project.total)).toBe(true)
    expect(second.projects.every((project) => project.inserted === 0 && project.updated === 0 && project.deleted === 0)).toBe(true)

    write(join(root, 'demo', 'wiki', 'retrieval.md'), '# Retrieval\nreplacementneedle changed evidence')
    const changed = await refreshWorkspaceIndex(config)
    expect(changed.projects.find((project) => project.id === 'demo')).toMatchObject({ updated: 1 })
    await expect(runtime.search({ query: 'retrievalneedle', projectIds: ['demo'] }))
      .resolves.toMatchObject({ evidence: [] })
    await expect(runtime.search({ query: 'replacementneedle', projectIds: ['demo'] }))
      .resolves.toMatchObject({ evidence: [expect.objectContaining({ projectId: 'demo' })] })

    rmSync(join(root, 'demo', 'wiki', 'retrieval.md'))
    const deleted = await refreshWorkspaceIndex(config)
    expect(deleted.projects.find((project) => project.id === 'demo')).toMatchObject({ deleted: 1 })
    await expect(runtime.search({ query: 'replacementneedle', projectIds: ['demo'] }))
      .resolves.toMatchObject({ evidence: [] })
  })

  test('rejects manifest paths outside a project before creating an index', async () => {
    const { root, config } = fixture()
    write(join(root, 'workspace.projects.yml'), `version: 1
projects:
  - key: demo
    name: Demo
    path: demo
    tier: independent
    rule_doc: demo/AGENTS.md
    wiki: docs
    desc: invalid
`)
    await expect(refreshWorkspaceIndex(config)).rejects.toThrowError(WorkspaceIndexError)
  })

  test('preserves the last good project snapshot when a required source disappears', async () => {
    const { root, config, runtime } = fixture()
    await refreshWorkspaceIndex(config)
    rmSync(join(root, 'demo', 'AGENTS.md'))
    const partial = await refreshWorkspaceIndex(config)
    expect(partial.skipped).toEqual([
      expect.objectContaining({ id: 'demo', reason: expect.stringContaining('required-source-missing') }),
    ])
    await expect(runtime.search({ query: 'retrievalneedle', projectIds: ['demo'] }))
      .resolves.toMatchObject({ evidence: [expect.objectContaining({ projectId: 'demo' })] })
  })

  test('removes stale documents and registry entries when a project leaves the manifest', async () => {
    const { root, config, runtime } = fixture()
    await refreshWorkspaceIndex(config)
    write(join(root, 'workspace.projects.yml'), `version: 1
projects:
  - key: career
    name: Career
    path: career
    tier: root-tracked
    rule_doc: career/AGENTS.md
    desc: PII-safe control files only
`)

    const refreshed = await refreshWorkspaceIndex(config)

    expect(refreshed.removedProjects).toEqual(['demo'])
    expect(runtime.listProjects().projects.map((project) => project.id)).not.toContain('demo')
    await expect(runtime.search({ query: 'retrievalneedle' }))
      .resolves.toMatchObject({ evidence: [] })
  })
})
