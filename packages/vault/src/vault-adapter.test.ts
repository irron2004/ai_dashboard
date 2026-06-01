import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultAdapter } from './vault-adapter.js'

describe('VaultAdapter', () => {
  let dir: string
  let vault: VaultAdapter

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apc-vault-'))
    vault = new VaultAdapter(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('write then read round-trips frontmatter and body', () => {
    vault.writeDoc('projects/apc/current.md', {
      frontmatter: { project_id: 'apc', status: 'active' },
      body: '# Current\n\nSee [[TASK-003]].\n',
    })
    const doc = vault.readDoc('projects/apc/current.md')
    expect(doc.frontmatter).toEqual({ project_id: 'apc', status: 'active' })
    expect(doc.body.trim()).toBe('# Current\n\nSee [[TASK-003]].')
  })

  test('extractWikiLinks finds [[links]]', () => {
    expect(vault.extractWikiLinks('see [[TASK-003]] and [[RUN-001]]')).toEqual([
      'TASK-003',
      'RUN-001',
    ])
    expect(vault.extractWikiLinks('no links here')).toEqual([])
  })

  test('readDoc throws a clear error for a missing file', () => {
    expect(() => vault.readDoc('projects/apc/missing.md')).toThrow(/not found/i)
  })
})
