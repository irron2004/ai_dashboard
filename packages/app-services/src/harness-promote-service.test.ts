import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunArtifactStore } from '@apc/knowledge-harness'
import { ConflictManager } from '@apc/core'
import { RunStateSchema } from '@apc/shared'
import { HarnessPromoteService } from './harness-promote-service.js'

describe('HarnessPromoteService', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'kh-promote-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  function seedRun(state: string, opts: { applied?: string[]; secretOk?: boolean } = {}) {
    const applied = opts.applied ?? ['concepts/n1.md']
    const runsRoot = join(root, 'runs')
    const store = new RunArtifactStore(join(runsRoot, 'RUN-1'))
    store.init()
    const rel = store.writeArtifact('STAGING_WRITTEN', 'applied-write-report', {
      applied, proposals: ['current.proposal.md'], skipped: [],
    })
    const secretRel = store.writeArtifact('VALIDATED', 'secret-scan-report', {
      ok: opts.secretOk ?? true, findings: (opts.secretOk ?? true) ? [] : [{ rule: 'aws_access_key_id' }],
    })
    store.saveRunState(RunStateSchema.parse({
      runId: 'RUN-1', projectId: 'p1', engine: 'claude', state,
      artifacts: { STAGING_WRITTEN: [rel], VALIDATED: [secretRel] },
    }))
    // staging contents the writer produced
    const staging = join(runsRoot, 'RUN-1', 'vault-staging')
    mkdirSync(join(staging, 'concepts'), { recursive: true })
    writeFileSync(join(staging, 'concepts', 'n1.md'), '# N1\n')
    writeFileSync(join(staging, 'current.md'), '# canonical body\n')
    writeFileSync(join(staging, 'current.proposal.md'), '# proposed current\n')
    return { runsRoot }
  }

  test('promotes non-canonical files into the vault; canonical stays a proposal; existing current.md untouched', () => {
    const { runsRoot } = seedRun('HUMAN_REVIEW_REQUIRED')
    const vaultRoot = join(root, 'vault')
    mkdirSync(vaultRoot, { recursive: true })
    writeFileSync(join(vaultRoot, 'current.md'), '# original current\n')

    const res = new HarnessPromoteService({ runsRoot, vaultRoot }).promote({ runId: 'RUN-1' })
    expect(res).toEqual({ ok: true, promoted: ['concepts/n1.md'], proposals: ['current.proposal.md'], refusedCanonical: [] })
    expect(existsSync(join(vaultRoot, 'concepts', 'n1.md'))).toBe(true)
    expect(existsSync(join(vaultRoot, 'current.proposal.md'))).toBe(true)
    expect(readFileSync(join(vaultRoot, 'current.md'), 'utf8')).toContain('original current')  // untouched
  })

  test('refuses to copy a canonical path even if it leaked into applied[]', () => {
    const { runsRoot } = seedRun('HUMAN_REVIEW_REQUIRED', { applied: ['concepts/n1.md', 'current.md'] })
    const vaultRoot = join(root, 'vault')
    mkdirSync(vaultRoot, { recursive: true })
    writeFileSync(join(vaultRoot, 'current.md'), '# original current\n')

    const res = new HarnessPromoteService({ runsRoot, vaultRoot }).promote({ runId: 'RUN-1' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.promoted).toEqual(['concepts/n1.md'])
      expect(res.refusedCanonical).toEqual(['current.md'])
    }
    expect(readFileSync(join(vaultRoot, 'current.md'), 'utf8')).toContain('original current')  // NOT overwritten
  })

  test('refuses promotion when the staging secret scan found something (unless allowSecrets)', () => {
    const { runsRoot } = seedRun('HUMAN_REVIEW_REQUIRED', { secretOk: false })
    const vaultRoot = join(root, 'vault'); mkdirSync(vaultRoot, { recursive: true })
    const svc = new HarnessPromoteService({ runsRoot, vaultRoot })
    expect(svc.promote({ runId: 'RUN-1' }).ok).toBe(false)
    expect(svc.promote({ runId: 'RUN-1', allowSecrets: true }).ok).toBe(true)  // explicit human override
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

  describe('promoteCanonical (hash-gated, acceptance #7)', () => {
    const cm = new ConflictManager()
    function make() {
      const { runsRoot } = seedRun('HUMAN_REVIEW_REQUIRED')
      const vaultRoot = join(root, 'vault'); mkdirSync(vaultRoot, { recursive: true })
      writeFileSync(join(runsRoot, 'RUN-1', 'vault-staging', 'current.proposal.md'), '# proposed current\n')
      return { svc: new HarnessPromoteService({ runsRoot, vaultRoot, conflict: cm, stamp: '2026-06-03' }), vaultRoot }
    }

    test('first promotion (no existing canonical) writes current.md', () => {
      const { svc, vaultRoot } = make()
      const r = svc.promoteCanonical({ runId: 'RUN-1', proposalRelPath: 'current.proposal.md', lastReadHash: '' })
      expect(r.ok && r.status).toBe('promoted')
      expect(readFileSync(join(vaultRoot, 'current.md'), 'utf8')).toContain('proposed current')
    })

    test('matching lastReadHash overwrites the canonical', () => {
      const { svc, vaultRoot } = make()
      writeFileSync(join(vaultRoot, 'current.md'), '# old\n')
      const r = svc.promoteCanonical({ runId: 'RUN-1', proposalRelPath: 'current.proposal.md', lastReadHash: cm.hash('# old\n') })
      expect(r.ok && r.status).toBe('promoted')
      expect(readFileSync(join(vaultRoot, 'current.md'), 'utf8')).toContain('proposed current')
    })

    test('stale lastReadHash writes a conflict doc and does NOT overwrite the canonical', () => {
      const { svc, vaultRoot } = make()
      writeFileSync(join(vaultRoot, 'current.md'), '# edited in obsidian\n')
      const r = svc.promoteCanonical({ runId: 'RUN-1', proposalRelPath: 'current.proposal.md', lastReadHash: 'STALE' })
      expect(r.ok && r.status).toBe('conflict')
      expect(readFileSync(join(vaultRoot, 'current.md'), 'utf8')).toContain('edited in obsidian')  // untouched
      if (r.ok && r.status === 'conflict') expect(existsSync(join(vaultRoot, r.conflictPath))).toBe(true)
    })

    test('rejects a non-canonical proposal path', () => {
      const { svc } = make()
      expect(svc.promoteCanonical({ runId: 'RUN-1', proposalRelPath: 'concepts/n1.proposal.md', lastReadHash: '' }).ok).toBe(false)
    })

    test('refuses when the secret scan flagged something (unless allowSecrets) — same gate as promote()', () => {
      const { runsRoot } = seedRun('HUMAN_REVIEW_REQUIRED', { secretOk: false })
      const vaultRoot = join(root, 'vault'); mkdirSync(vaultRoot, { recursive: true })
      writeFileSync(join(runsRoot, 'RUN-1', 'vault-staging', 'current.proposal.md'), '# proposed\n')
      const svc = new HarnessPromoteService({ runsRoot, vaultRoot, conflict: cm, stamp: '2026-06-03' })
      expect(svc.promoteCanonical({ runId: 'RUN-1', proposalRelPath: 'current.proposal.md', lastReadHash: '' }).ok).toBe(false)
      expect(svc.promoteCanonical({ runId: 'RUN-1', proposalRelPath: 'current.proposal.md', lastReadHash: '', allowSecrets: true }).ok).toBe(true)
    })

    test('refuses + hides proposals for a non-HUMAN_REVIEW_REQUIRED run (e.g. FAILED)', () => {
      const { runsRoot } = seedRun('FAILED')
      const vaultRoot = join(root, 'vault'); mkdirSync(vaultRoot, { recursive: true })
      writeFileSync(join(runsRoot, 'RUN-1', 'vault-staging', 'current.proposal.md'), '# proposed\n')
      const svc = new HarnessPromoteService({ runsRoot, vaultRoot, conflict: cm, stamp: '2026-06-03' })
      expect(svc.canonicalProposals('RUN-1')).toEqual([])  // UI offers no button
      expect(svc.promoteCanonical({ runId: 'RUN-1', proposalRelPath: 'current.proposal.md', lastReadHash: '' }).ok).toBe(false)  // backstop
      expect(existsSync(join(vaultRoot, 'current.md'))).toBe(false)  // nothing written
    })

    test('canonicalProposals lists canonical proposals with the current vault hash (null if absent)', () => {
      const { svc, vaultRoot } = make()
      writeFileSync(join(vaultRoot, 'current.md'), '# existing\n')
      const list = svc.canonicalProposals('RUN-1')
      const cur = list.find(p => p.proposalRelPath === 'current.proposal.md')
      expect(cur?.canonicalPath).toBe('current.md')
      expect(cur?.currentHash).toBe(cm.hash('# existing\n'))  // matches the round-trip hash the UI would pass back
    })

    test('canonicalProposals reports a null hash when the canonical does not exist yet', () => {
      const { svc } = make()  // no current.md written to the vault
      const cur = svc.canonicalProposals('RUN-1').find(p => p.proposalRelPath === 'current.proposal.md')
      expect(cur?.currentHash).toBeNull()
    })
  })
})
