import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { KhState } from '@apc/shared'
import { vaultToStagedDocs } from '@apc/wiki-substrate'
import type { Driver, DriverResult, RunnerContext } from './harness-runner.js'
import type { DriverDeps } from './make-drivers.js'
import { ARTIFACTS, artifactByName } from './make-drivers.js'
import { makePaperNodeExtractor } from '../agents/paper-node-extractor.js'
import type { PaperNode } from '../agents/paper-node-extractor.js'

export function makePaperDrivers(deps: DriverDeps): Partial<Record<KhState, Driver>> {
  const extractor = makePaperNodeExtractor(deps.preamble)
  const pack = deps.domainPack!  // makeDrivers only overlays when id==='paper'

  return {
    NODE_PROPOSALS_CREATED: async (ctx: RunnerContext): Promise<DriverResult> => {
      const out = await extractor.run({
        runner: deps.runner,
        engine: ctx.engine as never,
        timeoutMs: deps.stepTimeoutMs,
        cwd: deps.projectCwd,
        engineOptions: deps.engineOptions,
        label: `NODE_PROPOSALS_CREATED-${extractor.name}`,
        input: {},
      })
      return { artifacts: [{ name: ARTIFACTS.nodeProposals, data: out }] }
    },

    STAGING_WRITTEN: async (ctx: RunnerContext): Promise<DriverResult> => {
      const nodes =
        artifactByName<{ nodes: PaperNode[] }>(ctx, 'NODE_PROPOSALS_CREATED', ARTIFACTS.nodeProposals)?.nodes ?? []
      const wikiDir = join(deps.stagingRoot, 'wiki')
      for (const n of nodes) {
        const rendered = pack.renderNode!(n)
        const abs = join(deps.stagingRoot, rendered.relPath)
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, rendered.content)
      }
      // UI staging docs (node_id/node_type) so KnowledgeView/graph render the nodes.
      const staged = vaultToStagedDocs(wikiDir, deps.stagingRoot)
      return {
        artifacts: [
          { name: ARTIFACTS.appliedWriteReport, data: { applied: [], proposals: staged, skipped: [] } },
        ],
      }
    },

    VALIDATED: async (): Promise<DriverResult> => {
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
