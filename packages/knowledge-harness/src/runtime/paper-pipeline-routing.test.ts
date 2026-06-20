import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunArtifactStore } from './run-artifact-store.js'
import { makeDrivers, ARTIFACTS } from './make-drivers.js'
import { paperPack } from '../domains/paper-pack.js'
import type { RunInput } from '@apc/llm-wiki'
import type { RunnerContext } from './harness-runner.js'

// Fake runner: returns canned JSON for whatever agent calls it.
const fakeRunner = (out: unknown) => ({ run: async (_i: RunInput) => ({ ok: true, output: JSON.stringify(out), raw: '' }) })

function deps(dir: string, runner: unknown, withPaper: boolean) {
  const base = { runner, vaultRoot: join(dir, 'vault'), stagingRoot: join(dir, 'staging'), preamble: 'P' }
  return (withPaper
    ? { ...base, domainPack: paperPack, substrate: { lint: async () => ({ ok: true, exit_code: 0, issues: [] }), rebuildIndex: async () => {}, checkSources: async () => ({ ok: true, output: '' }) } }
    : base) as never
}

function nodeProposalsCtx(store: RunArtifactStore): RunnerContext {
  return { runId: 'R', projectId: 'p', engine: 'claude', store, runState: { runId: 'R', projectId: 'p', engine: 'claude', state: 'NODE_PROPOSALS_CREATED', history: [], artifacts: {} } } as never
}

describe('makeDrivers domain overlay routing', () => {
  test('domain=paper overlays the paper NODE_PROPOSALS_CREATED (emits {nodes})', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'route-paper-'))
    try {
      // seed a raw/ source so the paper extractor has content
      const raw = join(dir, 'vault', 'raw', 'papers')
      mkdirSync(raw, { recursive: true }); writeFileSync(join(raw, 'p.md'), '# P\nbody', 'utf8')
      const store = new RunArtifactStore(join(dir, 'run')); store.init()
      const drivers = makeDrivers(deps(dir, fakeRunner({ nodes: [{ type: 'papers', slug: 'p1', fields: { title: 'T', slug: 'p1' } }] }), true))
      const res = await drivers.NODE_PROPOSALS_CREATED!(nodeProposalsCtx(store))
      const data = res.artifacts.find((a) => a.name === ARTIFACTS.nodeProposals)!.data as Record<string, unknown>
      expect(data).toHaveProperty('nodes')          // paper shape
      expect(data).not.toHaveProperty('proposals')  // NOT the project-docs shape
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('no domainPack → the project-docs NODE_PROPOSALS_CREATED (emits {proposals})', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'route-pd-'))
    try {
      const store = new RunArtifactStore(join(dir, 'run')); store.init()
      const drivers = makeDrivers(deps(dir, fakeRunner({ proposals: [] }), false))
      const res = await drivers.NODE_PROPOSALS_CREATED!(nodeProposalsCtx(store))
      const data = res.artifacts.find((a) => a.name === ARTIFACTS.nodeProposals)!.data as Record<string, unknown>
      expect(data).toHaveProperty('proposals')  // project-docs shape, unchanged
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('paper overlay replaces the base states (no project-docs agents run)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'route-base-'))
    try {
      const store = new RunArtifactStore(join(dir, 'run')); store.init()
      const paper = makeDrivers(deps(dir, fakeRunner({}), true))
      // PROJECT_SCANNED is now the paper-minimal driver: emits { domain: 'paper' } with NO runner call
      // (the project-docs discovery agent would instead produce a KhProjectDiscoveryReport).
      const res = await paper.PROJECT_SCANNED!(nodeProposalsCtx(store))
      const data = res.artifacts.find((a) => a.name === ARTIFACTS.projectDiscovery)!.data as { domain?: string }
      expect(data.domain).toBe('paper')
      // every generation + base state is overlaid by the paper pack
      for (const s of ['PROJECT_SCANNED', 'SOURCES_EXTRACTED', 'DOCUMENTS_CLASSIFIED', 'LEAD_MERGED', 'WRITE_PLAN_CREATED', 'NODE_PROPOSALS_CREATED', 'STAGING_WRITTEN', 'VALIDATED'] as const) expect(paper[s]).toBeDefined()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
