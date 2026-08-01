import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { FakeAgentRunner } from '@apc/llm-wiki'
import { HarnessService } from './harness-service.js'
import type { WorkspaceVault, WorkspaceExportResult } from './workspace-vault.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const gatesPath = join(root, 'harness', 'feature-gates.yml')

function cannedOutputs(): string[] {
  const proposals = { proposals: [{
    proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
    node: { id: 'n1', type: 'ConceptNode', title: 'T' },
    evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a', evidence_type: 'd' }],
    claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
  }] }
  const lead = {
    graph_update_plan: { created_by: 'lead' }, shared_promotion_plan: { created_by: 'lead' }, stale_doc_report: { generated_by: 'lead' },
    write_plan: { write_plan_id: 'WP-1', created_by: 'lead', operations: [{ op: 'create_file', path: 'concepts/n1.md', content: '# T\n' }] },
  }
  return [
    JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
    JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
    JSON.stringify({ generated_by: 'classifier', documents: [{ path: 'current.md', intent: 'canonical' }] }),
    JSON.stringify(proposals),
    JSON.stringify(lead),
  ]
}

/** Records the sync lifecycle and points the harness at a per-test local working root. */
class FakeWorkspaceVault implements WorkspaceVault {
  readonly calls: string[] = []
  exported = false
  constructor(readonly localRoot: string, private readonly onPull?: () => void | Promise<void>) {}
  async pull(): Promise<void> { this.calls.push('pull'); await this.onPull?.() }
  async pushInternal(): Promise<void> { this.calls.push('push') }
  async pushRuns(): Promise<void> { this.calls.push('pushRuns') }
  async exportWiki(): Promise<WorkspaceExportResult> { this.exported = true; return { ok: true, target: this.localRoot, files: 1 } }
}

class ThrowingLocalRootWorkspaceVault implements WorkspaceVault {
  readonly calls: string[] = []
  get localRoot(): string { throw new Error('test vault localRoot failure') }
  async pull(): Promise<void> { this.calls.push('pull') }
  async pushInternal(): Promise<void> { this.calls.push('push') }
  async pushRuns(): Promise<void> { this.calls.push('pushRuns') }
  async exportWiki(): Promise<WorkspaceExportResult> { return { ok: false, reason: 'unreachable' } }
}

describe('HarnessService — workspace vault lifecycle', () => {
  let ws: string
  let localRoot: string
  let vault: FakeWorkspaceVault
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'kh-wv-'))
    localRoot = join(ws, 'workspace', '.apc-wiki')
    mkdirSync(join(localRoot, 'raw'), { recursive: true })
    writeFileSync(join(localRoot, 'raw', 'a'), 'evidence source\n')
    vault = new FakeWorkspaceVault(localRoot)
  })
  afterEach(() => { rmSync(ws, { recursive: true, force: true }) })

  function service() {
    return new HarnessService({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot: join(ws, 'unused-global-vault'), runsRoot: join(ws, 'runs'),
      workspaceVaultFor: () => vault,
      gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })
  }

  test('a successful run pulls before, runs against localRoot, and pushes the internal state back', async () => {
    const svc = service()
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.ok).toBe(true)
    expect(vault.calls).toEqual(['pull', 'push'])

    // the agent-pipeline transcript is saved for later study — in the run dir AND the workspace runs/.
    expect(existsSync(join(ws, 'runs', r.runId, 'pipeline-transcript.jsonl'))).toBe(true)
    expect(existsSync(join(localRoot, 'runs', `${r.runId}.jsonl`))).toBe(true)

    // promote writes into the workspace's localRoot, not the global vaultRoot.
    const promoted = svc.promote({ runId: r.runId })
    expect(promoted.ok).toBe(true)
    expect(existsSync(join(localRoot, 'concepts', 'n1.md'))).toBe(true)
    expect(existsSync(join(ws, 'unused-global-vault', 'concepts', 'n1.md'))).toBe(false)
  })

  test('creates and marks the durable run active before workspace pull starts', async () => {
    const runId = 'RUN-2026-06-02T00-00-00Z'
    let svc!: HarnessService
    vault = new FakeWorkspaceVault(localRoot, () => {
      expect(existsSync(join(ws, 'runs', runId, 'run.json'))).toBe(true)
      expect(existsSync(join(ws, 'runs', runId, 'progress.jsonl'))).toBe(true)
      expect(svc.getProgress({ runId })).toMatchObject({
        ok: true,
        active: true,
        summary: { status: 'generating', health: 'active' },
      })
    })
    svc = service()
    const result = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(result.ok, result.reason).toBe(true)
  })

  test('journals setup failures that happen after initialization', async () => {
    const repo = join(ws, 'repo')
    mkdirSync(repo, { recursive: true })
    writeFileSync(join(repo, 'README.md'), '# source\n')
    const brokenVault = new ThrowingLocalRootWorkspaceVault()
    const svc = new HarnessService({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot: join(ws, 'unused-global-vault'),
      runsRoot: join(ws, 'runs'),
      workspaceVaultFor: () => brokenVault,
      gatesPath,
      preamble: 'RULES',
      now: () => '2026-06-02T00:00:00Z',
    })
    const result = await svc.run({ projectId: 'p1', engine: 'claude', materialize: true, repoPaths: [repo] })
    expect(result.finalState).toBe('FAILED')
    const progress = svc.getProgress({ runId: result.runId })
    expect(progress).toMatchObject({ ok: true, active: false, summary: { status: 'failed' } })
    if (progress.ok) expect(progress.events.map((event) => event.kind)).toEqual(['run_started', 'run_failed'])
    expect(brokenVault.calls).toContain('pushRuns')
  })

  test('syncWorkspaceForRun pushes the project vault (used after promote so it survives the next pull)', async () => {
    const svc = service()
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.ok).toBe(true)
    vault.calls.length = 0
    await svc.syncWorkspaceForRun(r.runId) // resolves projectId p1 from the run, pushes its vault
    expect(vault.calls).toEqual(['push'])
  })

  test('a FAILED run pushes only the transcript (pushRuns), not the wiki (pushInternal)', async () => {
    // Lead emits a forbidden delete_file write op → PolicyGuard blocks before staging → run FAILED.
    const outs = cannedOutputs()
    outs[4] = JSON.stringify({
      graph_update_plan: { created_by: 'lead' }, shared_promotion_plan: { created_by: 'lead' }, stale_doc_report: { generated_by: 'lead' },
      write_plan: { write_plan_id: 'WP-1', created_by: 'lead', operations: [{ op: 'delete_file', path: 'old.md' }] },
    })
    const svc = new HarnessService({
      runner: new FakeAgentRunner(outs), vaultRoot: join(ws, 'unused-global-vault'), runsRoot: join(ws, 'runs'),
      workspaceVaultFor: () => vault, gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })
    const r = await svc.run({ projectId: 'p1', engine: 'claude' })
    expect(r.finalState).toBe('FAILED')
    expect(vault.calls).toEqual(['pull', 'pushRuns']) // transcript travels; wiki ('push') does not
    // the failed run's transcript is still saved for study
    expect(existsSync(join(ws, 'runs', r.runId, 'pipeline-transcript.jsonl'))).toBe(true)
  })

  test('exportWiki pushes the latest state then publishes', async () => {
    const out = await service().exportWiki({ projectId: 'p1' })
    expect(out).toEqual({ ok: true, target: localRoot, files: 1 })
    expect(vault.calls).toContain('push')
    expect(vault.exported).toBe(true)
  })

  test('an ssh project force-materializes even when materialize is false (raw/ is not persisted for ssh)', async () => {
    let fetched = 0
    const logs: string[] = []
    const svc = new HarnessService({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot: join(ws, 'unused-global-vault'), runsRoot: join(ws, 'runs'),
      workspaceVaultFor: () => vault,
      fetchRemoteDocs: async () => { fetched++; return [{ absPath: '/remote/repo/doc.md', content: 'evidence source' }] },
      gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })
    const r = await svc.run(
      { projectId: 'p1', engine: 'claude', materialize: false, repoPaths: ['ssh://u@h:22/remote/repo'] },
      undefined,
      (e) => logs.push(e.chunk),
    )
    expect(r.ok).toBe(true)
    expect(fetched).toBe(1) // forced despite materialize:false
    expect(logs.join('')).toContain('forcing full materialize')
  })

  test('a local project honors materialize:false (raw/ persists across runs)', async () => {
    let fetched = 0
    const svc = new HarnessService({
      runner: new FakeAgentRunner(cannedOutputs()),
      vaultRoot: join(ws, 'unused-global-vault'), runsRoot: join(ws, 'runs'),
      workspaceVaultFor: () => vault,
      fetchRemoteDocs: async () => { fetched++; return [] },
      gatesPath, preamble: 'RULES', now: () => '2026-06-02T00:00:00Z',
    })
    const r = await svc.run({ projectId: 'p1', engine: 'claude', materialize: false, repoPaths: ['/local/repo'] })
    expect(r.ok).toBe(true)
    expect(fetched).toBe(0) // local + materialize:false → no doc sweep
  })
})
