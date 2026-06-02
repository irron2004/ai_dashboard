import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunArtifactStore } from '@apc/knowledge-harness'
import { RunStateSchema } from '@apc/shared'
import { HarnessPromoteService } from './harness-promote-service.js'

describe('HarnessPromoteService', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'kh-promote-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  function seedRun(state: string) {
    const runsRoot = join(root, 'runs')
    const store = new RunArtifactStore(join(runsRoot, 'RUN-1'))
    store.init()
    const rel = store.writeArtifact('STAGING_WRITTEN', 'applied-write-report', {
      applied: ['concepts/n1.md'], proposals: ['current.proposal.md'], skipped: [],
    })
    store.saveRunState(RunStateSchema.parse({
      runId: 'RUN-1', projectId: 'p1', engine: 'claude', state,
      artifacts: { STAGING_WRITTEN: [rel] },
    }))
    // staging contents the writer produced
    const staging = join(runsRoot, 'RUN-1', 'vault-staging')
    mkdirSync(join(staging, 'concepts'), { recursive: true })
    writeFileSync(join(staging, 'concepts', 'n1.md'), '# N1\n')
    writeFileSync(join(staging, 'current.proposal.md'), '# proposed current\n')
    return { runsRoot }
  }

  test('promotes non-canonical files into the vault; canonical stays a proposal; existing current.md untouched', () => {
    const { runsRoot } = seedRun('HUMAN_REVIEW_REQUIRED')
    const vaultRoot = join(root, 'vault')
    mkdirSync(vaultRoot, { recursive: true })
    writeFileSync(join(vaultRoot, 'current.md'), '# original current\n')

    const res = new HarnessPromoteService({ runsRoot, vaultRoot }).promote({ runId: 'RUN-1' })
    expect(res).toEqual({ ok: true, promoted: ['concepts/n1.md'], proposals: ['current.proposal.md'] })
    expect(existsSync(join(vaultRoot, 'concepts', 'n1.md'))).toBe(true)
    expect(existsSync(join(vaultRoot, 'current.proposal.md'))).toBe(true)
    expect(readFileSync(join(vaultRoot, 'current.md'), 'utf8')).toContain('original current')  // untouched
  })

  test('refuses to promote a run that is not at HUMAN_REVIEW_REQUIRED', () => {
    const { runsRoot } = seedRun('FAILED')
    const res = new HarnessPromoteService({ runsRoot, vaultRoot: join(root, 'vault') }).promote({ runId: 'RUN-1' })
    expect(res.ok).toBe(false)
  })

  test('reports a missing run', () => {
    const res = new HarnessPromoteService({ runsRoot: join(root, 'runs'), vaultRoot: join(root, 'vault') }).promote({ runId: 'NOPE' })
    expect(res).toEqual({ ok: false, reason: 'run not found: NOPE' })
  })
})
