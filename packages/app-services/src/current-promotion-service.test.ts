import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultAdapter } from '@apc/vault'
import { ConflictManager } from '@apc/core'
import { CurrentPromotionService } from './current-promotion-service.js'

describe('CurrentPromotionService.promote', () => {
  let dir: string; let vault: VaultAdapter; let conflict: ConflictManager; let svc: CurrentPromotionService
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apc-prom-'))
    vault = new VaultAdapter(dir); conflict = new ConflictManager()
    svc = new CurrentPromotionService({ vault, conflict, stamp: '2026-06-01' })
    vault.writeDoc('projects/p1/current.proposal.md', { frontmatter: { type: 'current-proposal' }, body: '## Current\n- proposed\n' })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('first promotion writes canonical current.md (no conflict)', () => {
    const res = svc.promote({ projectId: 'p1', lastReadHash: '' })
    expect(res.status).toBe('promoted')
    expect(vault.readDoc('projects/p1/current.md').body).toContain('proposed')
  })

  test('stale lastReadHash against an edited canonical creates a conflict doc, does not overwrite', () => {
    // canonical exists and was edited in Obsidian after the app last read it
    vault.writeDoc('projects/p1/current.md', { frontmatter: {}, body: '## Current\n- edited in obsidian\n' })
    const res = svc.promote({ projectId: 'p1', lastReadHash: 'STALE' })
    expect(res.status).toBe('conflict')
    if (res.status !== 'conflict') throw new Error('expected conflict result')
    expect(res.conflictPath).toBe('projects/p1/conflicts/2026-06-01-current-conflict.md')
    expect(vault.readDoc('projects/p1/current.md').body).toContain('edited in obsidian')  // untouched
    expect(vault.readDoc(res.conflictPath).body).toContain('edited in obsidian')
  })

  test('matching lastReadHash promotes over the existing canonical', () => {
    vault.writeDoc('projects/p1/current.md', { frontmatter: {}, body: '## Current\n- old\n' })
    const currentBody = vault.readDoc('projects/p1/current.md').body
    const res = svc.promote({ projectId: 'p1', lastReadHash: conflict.hash(currentBody) })
    expect(res.status).toBe('promoted')
    expect(vault.readDoc('projects/p1/current.md').body).toContain('proposed')
  })
})
