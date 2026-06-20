import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { KhState } from '@apc/shared'
import { vaultToStagedDocs } from '@apc/wiki-substrate'
import type { Driver, DriverResult, RunnerContext } from './harness-runner.js'
import type { DriverDeps } from './make-drivers.js'
import { ARTIFACTS, artifactByName } from './make-drivers.js'
import { makePaperNodeExtractor } from '../agents/paper-node-extractor.js'
import type { PaperNode, PaperEdge } from '../agents/paper-node-extractor.js'
import { SourceReader } from './source-reader.js'

export function makePaperDrivers(deps: DriverDeps): Partial<Record<KhState, Driver>> {
  const extractor = makePaperNodeExtractor(deps.preamble)
  const pack = deps.domainPack!  // makeDrivers only overlays when id==='paper'
  const sources = new SourceReader(deps.vaultRoot)

  return {
    // Base-state overlays: paper runs must NOT call the project-docs LLM agents (discovery/reader/
    // classifier/lead). These minimal drivers (mirroring paper-phase1-drivers.ts, proven to advance to
    // HUMAN_REVIEW_REQUIRED) emit the artifact names the runner/UI expect; the paper extractor reads
    // raw/ sources directly and STAGING_WRITTEN reads NODE_PROPOSALS_CREATED, so none of these are read.
    PROJECT_SCANNED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.projectDiscovery, data: { domain: 'paper' } }] }),
    SOURCES_EXTRACTED: async (): Promise<DriverResult> => {
      // Parse binary sources (e.g. PDFs) into raw/_parsed/*.md via autosci-read so the extractor's
      // SourceReader (which skips binaries) picks up their text. Best-effort — markdown/text sources
      // flow regardless; ingest only adds PDF content. Needs the substrate venv (no-op without it).
      let summary = ''
      if (deps.substrate?.ingest) {
        try { summary = (await deps.substrate.ingest(deps.vaultRoot)).output } catch (e) { summary = `ingest skipped: ${String(e)}` }
      }
      return { artifacts: [{ name: ARTIFACTS.conversationHistory, data: { sessions: [], summary } }] }
    },
    DOCUMENTS_CLASSIFIED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.documentIntent, data: { documents: [] } }] }),
    LEAD_MERGED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.graphUpdatePlan, data: { node_ops: [], edge_ops: [] } }] }),
    WRITE_PLAN_CREATED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.writePlan, data: { operations: [] } }] }),

    NODE_PROPOSALS_CREATED: async (ctx: RunnerContext): Promise<DriverResult> => {
      const out = await extractor.run({
        runner: deps.runner,
        engine: ctx.engine as never,
        timeoutMs: deps.stepTimeoutMs,
        cwd: deps.projectCwd,
        engineOptions: deps.engineOptions,
        label: `NODE_PROPOSALS_CREATED-${extractor.name}`,
        input: { sources: sources.read() },
      })
      return { artifacts: [{ name: ARTIFACTS.nodeProposals, data: out }] }
    },

    STAGING_WRITTEN: async (ctx: RunnerContext): Promise<DriverResult> => {
      const result = artifactByName<{ nodes: PaperNode[]; edges?: PaperEdge[] }>(ctx, 'NODE_PROPOSALS_CREATED', ARTIFACTS.nodeProposals)
      const nodes = result?.nodes ?? []
      const edges = result?.edges ?? []
      const wikiDir = join(deps.stagingRoot, 'wiki')
      for (const n of nodes) {
        const rendered = pack.renderNode!(n)
        const abs = join(deps.stagingRoot, rendered.relPath)
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, rendered.content)
      }
      // Typed edges → wiki/graph/edges.jsonl (the kernel's edge_storage; one JSON object per line)
      // so the kernel lints the graph and the UI can render edges.
      if (edges.length) {
        const edgesFile = join(wikiDir, 'graph', 'edges.jsonl')
        mkdirSync(dirname(edgesFile), { recursive: true })
        writeFileSync(edgesFile, edges.map((e) => JSON.stringify(e)).join('\n') + '\n')
      }
      // UI staging docs (node_id/node_type) so KnowledgeView/graph render the nodes.
      const staged = vaultToStagedDocs(wikiDir, deps.stagingRoot)
      return {
        artifacts: [
          { name: ARTIFACTS.appliedWriteReport, data: { applied: [], proposals: staged, skipped: [] } },
        ],
      }
    },

    VALIDATED: async (_ctx: RunnerContext): Promise<DriverResult> => {
      if (!deps.substrate) {
        return {
          artifacts: [],
          status: 'failed',
          error:
            'paper validate needs the substrate venv — bootstrap .venv-substrate (uv) or run on a machine with it',
        }
      }
      const report = await pack.validate!(join(deps.stagingRoot, 'wiki'), { substrate: deps.substrate })
      const artifacts = [{ name: ARTIFACTS.kernelLint, data: report }]
      return report.ok
        ? { artifacts }
        : { artifacts, status: 'failed', error: `kernel lint: ${report.issues.length} issue(s)` }
    },
  }
}
