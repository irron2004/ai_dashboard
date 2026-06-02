import { KhWritePlanSchema, type KhState, type AgentType } from '@apc/shared'
import type { AgentRunner } from '@apc/llm-wiki'
import type { Driver, RunnerContext } from './harness-runner.js'
import { StagingVault } from '../staging/staging-vault.js'
import { ObsidianWikiWriter } from '../agents/obsidian-wiki-writer.js'
import {
  makeProjectDiscovery, makeConversationHistoryReader, makeDocumentIntentClassifier,
  makeKnowledgeNodeExtractor, makeWikiGraphLead,
} from '../agents/index.js'

export type DriverDeps = {
  runner: AgentRunner
  vaultRoot: string
  stagingRoot: string
  preamble: string
  // Phase 3 will add: policy, validators
}

const engineOf = (ctx: RunnerContext) => ctx.engine as AgentType

/** Read a prior state's artifact by its base name (e.g. 'lead-write-plan'). Order-independent. */
function artifactByName<T = unknown>(ctx: RunnerContext, state: KhState, name: string): T | undefined {
  const paths = ctx.runState.artifacts[state] ?? []
  const rel = paths.find(p => p.endsWith(`${name}.json`))
  return rel ? ctx.store.readArtifact<T>(rel) : undefined
}

/**
 * Wire the 5 LLM agents + StagingVault + Writer into a `Driver` map for HarnessRunner.
 * The runner contract is unchanged — drivers are closures over the richer deps.
 * VALIDATED and HUMAN_REVIEW_REQUIRED have no driver in Phase 2 (the runner advances them
 * with empty artifacts); validators arrive in Phase 3.
 */
export function makeDrivers(deps: DriverDeps): Partial<Record<KhState, Driver>> {
  const discovery = makeProjectDiscovery(deps.preamble)
  const reader = makeConversationHistoryReader(deps.preamble)
  const classifier = makeDocumentIntentClassifier(deps.preamble)
  const extractor = makeKnowledgeNodeExtractor(deps.preamble)
  const lead = makeWikiGraphLead(deps.preamble)
  const writer = new ObsidianWikiWriter()
  const run = { runner: deps.runner }

  return {
    PROJECT_SCANNED: async (ctx) => {
      const data = await discovery.run({ ...run, engine: engineOf(ctx), input: { projectId: ctx.projectId } })
      return { artifacts: [{ name: 'project-discovery-report', data }] }
    },

    SOURCES_EXTRACTED: async (ctx) => {
      const data = await reader.run({ ...run, engine: engineOf(ctx), input: { discovery: artifactByName(ctx, 'PROJECT_SCANNED', 'project-discovery-report') } })
      return { artifacts: [{ name: 'conversation-history-report', data }] }
    },

    DOCUMENTS_CLASSIFIED: async (ctx) => {
      const data = await classifier.run({ ...run, engine: engineOf(ctx), input: { discovery: artifactByName(ctx, 'PROJECT_SCANNED', 'project-discovery-report') } })
      return { artifacts: [{ name: 'document-intent-report', data }] }
    },

    NODE_PROPOSALS_CREATED: async (ctx) => {
      const data = await extractor.run({ ...run, engine: engineOf(ctx), input: {
        history: artifactByName(ctx, 'SOURCES_EXTRACTED', 'conversation-history-report'),
        intents: artifactByName(ctx, 'DOCUMENTS_CLASSIFIED', 'document-intent-report'),
      } })
      return { artifacts: [{ name: 'node-proposals', data }] }
    },

    LEAD_MERGED: async (ctx) => {
      const out = await lead.run({ ...run, engine: engineOf(ctx), input: { proposals: artifactByName(ctx, 'NODE_PROPOSALS_CREATED', 'node-proposals') } })
      return { artifacts: [
        { name: 'graph-update-plan', data: out.graph_update_plan },
        { name: 'shared-promotion-plan', data: out.shared_promotion_plan },
        { name: 'stale-doc-report', data: out.stale_doc_report },
        { name: 'lead-write-plan', data: out.write_plan },  // cached for WRITE_PLAN_CREATED (no 2nd LLM call)
      ] }
    },

    WRITE_PLAN_CREATED: async (ctx) => {
      const writePlan = artifactByName(ctx, 'LEAD_MERGED', 'lead-write-plan')
      return { artifacts: [{ name: 'write-plan', data: writePlan }] }
    },

    STAGING_WRITTEN: async (ctx) => {
      const staging = new StagingVault(deps.vaultRoot, deps.stagingRoot)
      staging.prepare()
      const plan = KhWritePlanSchema.parse(artifactByName(ctx, 'WRITE_PLAN_CREATED', 'write-plan'))
      const applied = writer.apply(plan, staging)
      const patch = staging.diff()
      return { artifacts: [
        { name: 'applied-write-report', data: applied },
        { name: 'git-diff-report', data: { patch } },
      ] }
    },
  }
}
