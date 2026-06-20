import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunArtifactStore } from './run-artifact-store.js'
import { makePaperDrivers } from './paper-drivers.js'
import { paperPack } from '../domains/paper-pack.js'
import { ARTIFACTS } from './make-drivers.js'
import { KhKernelLintReportSchema } from '@apc/shared'
import type { RunInput } from '@apc/llm-wiki'
import type { RunnerContext } from './harness-runner.js'

// A runner whose paper extractor output is canned (no real LLM).
// Captures each RunInput passed to run() so tests can assert wiring (e.g. that sources are passed).
function makeFakeRunner(out: unknown) {
  const calls: RunInput[] = []
  return {
    get calls() { return calls },
    get lastCall() { return calls[calls.length - 1] },
    run: async (input: RunInput) => {
      calls.push(input)
      return { ok: true, output: JSON.stringify(out), raw: '' }
    },
  }
}
// Legacy helper for tests that don't need call capture
const fakeRunner = (out: unknown) => ({ run: async () => ({ ok: true, output: JSON.stringify(out), raw: '' }) })

const okSubstrate = {
  lint: async () => KhKernelLintReportSchema.parse({ ok: true, issues: [] }),
  rebuildIndex: async () => {},
  checkSources: async () => ({ ok: true, output: '' }),
}
const failSubstrate = {
  lint: async () => KhKernelLintReportSchema.parse({ ok: false, issues: ['wiki/papers/p1.md: missing title'] }),
  rebuildIndex: async () => {},
  checkSources: async () => ({ ok: true, output: '' }),
}

function makeDeps(dir: string, runner: unknown, substrate: unknown) {
  return {
    runner,
    vaultRoot: join(dir, 'vault'),
    stagingRoot: join(dir, 'staging'),
    preamble: 'P',
    domainPack: paperPack,
    substrate,
  } as never
}

/** Seed a raw/ source file under <vaultRoot>/raw/ so SourceReader.read() returns at least one doc. */
function seedRawSource(vaultRoot: string, relPath: string, content: string): void {
  const abs = join(vaultRoot, 'raw', relPath)
  mkdirSync(join(vaultRoot, 'raw', relPath.replace(/\/[^/]+$/, '')), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

/** Mirror of ctxWith from make-drivers.interactive.test.ts */
function ctxWith(store: RunArtifactStore, seed: Array<{ state: string; name: string; data: unknown }>): RunnerContext {
  const artifacts: Record<string, string[]> = {}
  for (const s of seed) (artifacts[s.state] ??= []).push(store.writeArtifact(s.state as never, s.name, s.data))
  const runState = { runId: 'R', projectId: 'paper', engine: 'claude', state: 'NODE_PROPOSALS_CREATED', history: [], artifacts } as never
  return { runId: 'R', projectId: 'paper', engine: 'claude', store, runState } as RunnerContext
}

describe('makePaperDrivers', () => {
  test('NODE_PROPOSALS_CREATED runs the paper extractor and stores typed nodes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paper-drv-'))
    try {
      const out = { nodes: [{ type: 'papers', slug: 'p1', fields: { title: 'T', slug: 'p1' } }] }
      const store = new RunArtifactStore(join(dir, 'run'))
      store.init()
      const runner = makeFakeRunner(out)
      const vaultRoot = join(dir, 'vault')
      // Seed a raw/ source so SourceReader returns real content
      seedRawSource(vaultRoot, 'papers/paper-one.md', '# Paper One\nContent of paper one.')
      const drivers = makePaperDrivers(makeDeps(dir, runner, okSubstrate))
      // ctx only needs engine (used in extractor.run); store/runState not needed for NODE_PROPOSALS_CREATED
      const ctx = { runId: 'R', projectId: 'paper', engine: 'claude', store, runState: { runId: 'R', projectId: 'paper', engine: 'claude', state: 'CREATED', history: [], artifacts: {} } } as never
      const res = await drivers.NODE_PROPOSALS_CREATED!(ctx)
      const stored = res.artifacts.find((a) => a.name === ARTIFACTS.nodeProposals)
      expect((stored!.data as { nodes: unknown[] }).nodes).toHaveLength(1)

      // Assert that SourceReader was wired: the extractor must have received the run's raw/ sources.
      // LlmAgent.buildPrompt() serialises `input` into the prompt — so "sources" must appear in it.
      expect(runner.calls).toHaveLength(1)
      expect(runner.lastCall.prompt).toContain('"sources"')
      // Also confirm it's not the vacuous empty-object case: the seeded raw/ doc must be present.
      expect(runner.lastCall.prompt).toContain('paper-one.md')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('STAGING_WRITTEN renders nodes to wiki/<type>/<slug>.md + UI staging docs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paper-drv-stg-'))
    try {
      const store = new RunArtifactStore(join(dir, 'run'))
      store.init()
      const drivers = makePaperDrivers(makeDeps(dir, fakeRunner({}), okSubstrate))
      const node = { type: 'papers', slug: 'p1', fields: { title: 'T', slug: 'p1' } }
      const edge = { from: 'pipelines:pl', to: 'papers:p1', type: 'pipeline_from_paper', confidence: 'high' }
      const ctx = ctxWith(store, [
        { state: 'NODE_PROPOSALS_CREATED', name: ARTIFACTS.nodeProposals, data: { nodes: [node], edges: [edge] } },
      ])
      const res = await drivers.STAGING_WRITTEN!(ctx)
      const stagingRoot = join(dir, 'staging')
      // wiki file rendered by paperPack.renderNode → wiki/<type>/<slug>.md
      expect(existsSync(join(stagingRoot, 'wiki', 'papers', 'p1.md'))).toBe(true)
      // UI staging doc written by vaultToStagedDocs → nodes/<slug>.md
      expect(existsSync(join(stagingRoot, 'nodes', 'p1.md'))).toBe(true)
      // typed edges written to wiki/graph/edges.jsonl (one JSON per line)
      const edgesFile = join(stagingRoot, 'wiki', 'graph', 'edges.jsonl')
      expect(existsSync(edgesFile)).toBe(true)
      expect(JSON.parse(readFileSync(edgesFile, 'utf8').trim())).toMatchObject({ type: 'pipeline_from_paper', confidence: 'high' })
      // artifact recorded
      const report = res.artifacts.find((a) => a.name === ARTIFACTS.appliedWriteReport)
      expect(report).toBeDefined()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('VALIDATED green when substrate.lint ok; FAILED+report when issues', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paper-drv-val-'))
    try {
      const store = new RunArtifactStore(join(dir, 'run'))
      store.init()

      // Green path
      const greenDrivers = makePaperDrivers(makeDeps(dir, fakeRunner({}), okSubstrate))
      const ctx = ctxWith(store, [])
      const greenRes = await greenDrivers.VALIDATED!(ctx)
      expect(greenRes.status ?? 'ok').toBe('ok')
      const greenLint = greenRes.artifacts.find((a) => a.name === ARTIFACTS.kernelLint)
      expect(greenLint).toBeDefined()
      expect((greenLint!.data as { ok: boolean }).ok).toBe(true)

      // Failed path
      const failDrivers = makePaperDrivers(makeDeps(dir, fakeRunner({}), failSubstrate))
      const failRes = await failDrivers.VALIDATED!(ctx)
      expect(failRes.status).toBe('failed')
      const failLint = failRes.artifacts.find((a) => a.name === ARTIFACTS.kernelLint)
      expect(failLint).toBeDefined()
      expect((failLint!.data as { ok: boolean }).ok).toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
