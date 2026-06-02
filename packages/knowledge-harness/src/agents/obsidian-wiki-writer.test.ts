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

  test('append_section preserves existing staged content instead of truncating it', () => {
    // pre-seed an existing non-canonical doc in staging (as if copied from the real vault)
    staging.writeDoc('notes/log.md', '# Log\n- entry 1\n')
    const plan = KhWritePlanSchema.parse({
      write_plan_id: 'WP-3', created_by: 'lead',
      operations: [{ op: 'append_section', path: 'notes/log.md', content: '- entry 2\n', mode: 'apply' }],
    })
    new ObsidianWikiWriter().apply(plan, staging)
    const body = readFileSync(join(root, 'vault-staging', 'notes', 'log.md'), 'utf8')
    expect(body).toContain('entry 1')  // original preserved
    expect(body).toContain('entry 2')  // appended
  })

  test('a canonical op with mode:apply is FORCED to a proposal (LLM cannot opt out)', () => {
    const plan = KhWritePlanSchema.parse({
      write_plan_id: 'WP-2', created_by: 'lead',
      operations: [
        { op: 'create_file', path: 'current.md', content: '# sneaky overwrite\n', mode: 'apply' },
        { op: 'create_file', path: 'projects/p1/PRD.md', content: '# prd\n', mode: 'apply' },
        { op: 'create_file', path: 'decisions/ADR-007-x.md', content: '# adr\n', mode: 'apply' },
      ],
    })
    const report = new ObsidianWikiWriter().apply(plan, staging)
    expect(report.applied).toEqual([])  // nothing canonical landed in applied[]
    expect(report.proposals).toEqual(['current.proposal.md', 'projects/p1/PRD.proposal.md', 'decisions/ADR-007-x.proposal.md'])
    expect(existsSync(join(root, 'vault-staging', 'current.md'))).toBe(false)
  })
})
