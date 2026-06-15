import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalWorkspaceVault, internalStateFiles, isPublishable, walkVaultFiles } from './workspace-vault.js'

describe('workspace-vault helpers', () => {
  test('isPublishable: readable docs only, no drafts or run history', () => {
    expect(isPublishable('current.md')).toBe(true)
    expect(isPublishable('nodes/concept.md')).toBe(true)
    expect(isPublishable('notes.txt')).toBe(true)
    expect(isPublishable('current.proposal.md')).toBe(false)
    expect(isPublishable('agent-runs/summary.md')).toBe(false)
    expect(isPublishable('nested/agent-runs/x.md')).toBe(false)
    expect(isPublishable('graph/index.json')).toBe(false)
  })

  test('internalStateFiles excludes the re-derivable raw/ tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'wv-int-'))
    mkdirSync(join(root, 'raw', 'project-docs'), { recursive: true })
    mkdirSync(join(root, 'graph'), { recursive: true })
    mkdirSync(join(root, 'projects', 'p1'), { recursive: true })
    writeFileSync(join(root, 'raw', 'project-docs', 'a.md'), 'src')
    writeFileSync(join(root, 'graph', 'g.json'), '{}')
    writeFileSync(join(root, 'projects', 'p1', 'current.md'), '# c')
    const files = internalStateFiles(root).sort()
    expect(files).toEqual(['graph/g.json', 'projects/p1/current.md'])
    rmSync(root, { recursive: true, force: true })
  })

  test('walkVaultFiles returns POSIX-relative paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'wv-walk-'))
    mkdirSync(join(root, 'a', 'b'), { recursive: true })
    writeFileSync(join(root, 'a', 'b', 'c.md'), 'x')
    expect(walkVaultFiles(root)).toEqual(['a/b/c.md'])
    rmSync(root, { recursive: true, force: true })
  })
})

describe('LocalWorkspaceVault', () => {
  let repo: string
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), 'wv-repo-')) })
  afterEach(() => { rmSync(repo, { recursive: true, force: true }) })

  test('localRoot is <repo>/.apc-wiki; pull/push are no-ops', async () => {
    const wv = new LocalWorkspaceVault(repo, 'p1')
    expect(wv.localRoot).toBe(join(repo, '.apc-wiki'))
    await expect(wv.pull()).resolves.toBeUndefined()
    await expect(wv.pushInternal()).resolves.toBeUndefined()
  })

  test('exportWiki publishes readable docs to <repo>/wiki, skipping drafts and agent-runs', async () => {
    const proj = join(repo, '.apc-wiki', 'projects', 'p1')
    mkdirSync(join(proj, 'agent-runs'), { recursive: true })
    writeFileSync(join(proj, 'current.md'), '# Current')
    writeFileSync(join(proj, 'current.proposal.md'), '# Draft')
    writeFileSync(join(proj, 'agent-runs', 'run-summary.md'), '# Run')

    const r = await new LocalWorkspaceVault(repo, 'p1').exportWiki()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.files).toBe(1)
      expect(r.target).toBe(join(repo, 'wiki'))
    }
    expect(readFileSync(join(repo, 'wiki', 'current.md'), 'utf8')).toBe('# Current')
    expect(existsSync(join(repo, 'wiki', 'current.proposal.md'))).toBe(false)
    expect(existsSync(join(repo, 'wiki', 'agent-runs', 'run-summary.md'))).toBe(false)
  })

  test('exportWiki refuses when no wiki has been generated', async () => {
    const r = await new LocalWorkspaceVault(repo, 'p1').exportWiki()
    expect(r).toEqual({ ok: false, reason: 'no generated wiki to export (run a generation first)' })
  })
})
