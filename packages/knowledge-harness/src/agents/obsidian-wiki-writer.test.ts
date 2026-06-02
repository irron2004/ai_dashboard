import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KhWritePlanSchema } from '@apc/shared'
import { StagingVault } from '../staging/staging-vault.js'
import { ObsidianWikiWriter } from './obsidian-wiki-writer.js'

describe('ObsidianWikiWriter', () => {
  let root: string
  let staging: StagingVault
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kh-writer-'))
    mkdirSync(join(root, 'vault'), { recursive: true })
    staging = new StagingVault(join(root, 'vault'), join(root, 'vault-staging'))
    staging.prepare()
  })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  test('applies create_file, routes proposal_only to a .proposal.md, skips raw/', () => {
    const plan = KhWritePlanSchema.parse({
      write_plan_id: 'WP-1', created_by: 'lead',
      operations: [
        { op: 'create_file', path: 'concepts/n1.md', content: '# N1\n' },
        { op: 'create_file', path: 'current.md', content: '# new current\n', mode: 'proposal_only' },
        { op: 'create_file', path: 'raw/should-not.md', content: 'x' },
      ],
    })
    const report = new ObsidianWikiWriter().apply(plan, staging)
    expect(report.applied).toEqual(['concepts/n1.md'])
    expect(report.proposals).toEqual(['current.proposal.md'])
    expect(report.skipped).toEqual(['raw/should-not.md'])

    expect(existsSync(join(root, 'vault-staging', 'concepts', 'n1.md'))).toBe(true)
    expect(readFileSync(join(root, 'vault-staging', 'current.proposal.md'), 'utf8')).toContain('new current')
    expect(existsSync(join(root, 'vault-staging', 'current.md'))).toBe(false)  // canonical NOT overwritten
    expect(existsSync(join(root, 'vault-staging', 'raw', 'should-not.md'))).toBe(false)
    // real vault untouched
    expect(existsSync(join(root, 'vault', 'concepts', 'n1.md'))).toBe(false)
  })
})
