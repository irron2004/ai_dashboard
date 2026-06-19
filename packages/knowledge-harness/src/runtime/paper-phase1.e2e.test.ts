import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, cpSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RunArtifactStore } from './run-artifact-store.js'
import { FeatureGate } from './feature-gate.js'
import { HarnessRunner } from './harness-runner.js'
import { PythonKernelAdapter } from '@apc/wiki-substrate'
import { makePaperPhase1Drivers } from './paper-phase1-drivers.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '../../../..')
const lockPath = join(repoRoot, 'core.lock')
const haveVenv = existsSync(lockPath)
const d = haveVenv ? describe : describe.skip

const ALL_OPEN = {
  enable_conversation_history_reader: true, auto_classify_documents: true,
  auto_create_node_proposals: true, auto_create_write_plan: true, auto_write_to_staging: true,
}
const now = () => '2026-06-19T00:00:00Z'

d('paper-domain Phase 1 seam', () => {
  let dir: string, store: RunArtifactStore, python: string
  const contractDir = join(repoRoot, 'wiki-domains/paper/runtime')
  const goldenWikiDir = join(repoRoot, 'packages/wiki-substrate/test/fixtures/paper-golden/wiki')
  const samplePdf = join(repoRoot, 'packages/wiki-substrate/test/fixtures/paper-golden/raw/papers/attnembed-2402-05370.pdf')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paper-phase1-'))
    store = new RunArtifactStore(join(dir, 'run'))
    python = join(repoRoot, JSON.parse(readFileSync(lockPath, 'utf8')).venv_python)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function drivers(goldenOverride?: string) {
    const substrate = new PythonKernelAdapter({ python, cwd: repoRoot })
    return makePaperPhase1Drivers({
      substrate, vaultRoot: join(dir, 'vault'),
      goldenWikiDir: goldenOverride ?? goldenWikiDir, samplePdf, contractDir,
    })
  }

  test('golden vault walks to HUMAN_REVIEW_REQUIRED with a green kernel-lint-report', async () => {
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers: drivers(), now })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'paper', engine: 'claude' })
    const rs = await runner.advance(store)
    expect(rs.state).toBe('HUMAN_REVIEW_REQUIRED')
    const lint: any = store.readArtifact(rs.artifacts['VALIDATED'][0])
    expect(lint.ok).toBe(true)
    expect(existsSync(join(dir, 'vault', 'wiki', 'index.md'))).toBe(true)  // rebuild-index 산출 (스펙 §6 [4])
    const props: any = store.readArtifact(rs.artifacts['NODE_PROPOSALS_CREATED'][0])
    const types = new Set(props.proposals.map((p: any) => p.node.type))
    expect(types.has('papers')).toBe(true)
    expect(types.has('modules')).toBe(true)
    expect(props.proposals.length).toBeGreaterThan(3)
  })

  test('a broken node fails the run but preserves the kernel-lint-report', async () => {
    const broken = join(dir, 'broken-wiki')
    cpSync(goldenWikiDir, broken, { recursive: true })
    const papers = join(broken, 'papers')
    const f = join(papers, readdirSync(papers).find((n) => n.endsWith('.md'))!)
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^title:.*$/m, ''))

    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers: drivers(broken), now })
    runner.createRun(store, { runId: 'RUN-2', projectId: 'paper', engine: 'claude' })
    const rs = await runner.advance(store)
    expect(rs.state).toBe('FAILED')
    const lint: any = store.readArtifact(rs.artifacts['VALIDATED'][0])
    expect(lint.ok).toBe(false)
    expect(lint.issues.length).toBeGreaterThan(0)
  })
})
