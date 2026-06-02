import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { listMarkdown } from './vault-fs.js'
import {
  KhWritePlanSchema, KhSecretScanReportSchema,
  type KhState, type AgentType, type KhNodeProposal,
} from '@apc/shared'
import type { AgentRunner } from '@apc/llm-wiki'
import type { Driver, RunnerContext } from './harness-runner.js'
import { StagingVault } from '../staging/staging-vault.js'
import { ObsidianWikiWriter } from '../agents/obsidian-wiki-writer.js'
import { PolicyGuard } from '../policy/policy-guard.js'
import { SecretScanner } from '../policy/secret-scanner.js'
import { GraphIntegrity } from '../verify/graph-integrity.js'
import { MarkdownYamlValidator } from '../verify/markdown-yaml-validator.js'
import { ObsidianLinkValidator } from '../verify/obsidian-link-validator.js'
import { buildEvalReport } from '../eval/eval-report.js'
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
  const policy = new PolicyGuard()
  const secrets = new SecretScanner()
  const graph = new GraphIntegrity()
  const mdYaml = new MarkdownYamlValidator()
  const links = new ObsidianLinkValidator()
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
      // PolicyGuard checkpoint (design §4): block evidence-less / shared-without-2-evidence proposals
      // BEFORE the Lead merges them. A blocking violation throws → the run records FAILED.
      const report = policy.check(data.proposals)
      if (!report.ok) {
        throw new Error(`PolicyGuard blocked ${report.blocked_proposal_ids.length} proposal(s): ` +
          report.violations.filter(v => v.severity === 'block').map(v => `${v.proposal_id}:${v.rule}`).join(', '))
      }
      return { artifacts: [{ name: 'node-proposals', data }, { name: 'policy-report', data: report }] }
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

    VALIDATED: async () => {
      // Deterministic verification over the staging vault (design §7.3-7.4).
      const graphReport = graph.validate(deps.stagingRoot)
      const mdReport = mdYaml.validate(deps.stagingRoot)
      const linkReport = links.validate(deps.stagingRoot)
      const findings = listMarkdown(deps.stagingRoot).flatMap(abs =>
        secrets.scan(readFileSync(abs, 'utf8'), relative(deps.stagingRoot, abs)))
      const secretReport = KhSecretScanReportSchema.parse({ ok: findings.length === 0, findings })
      return { artifacts: [
        { name: 'graph-validation-report', data: graphReport },
        { name: 'markdown-yaml-validation-report', data: mdReport },
        { name: 'link-validation-report', data: linkReport },
        { name: 'secret-scan-report', data: secretReport },
      ] }
    },

    HUMAN_REVIEW_REQUIRED: async (ctx) => {
      // Final policy pass (now with the write plan) feeds the eval safety metrics; non-blocking here.
      const proposals = (artifactByName<{ proposals: KhNodeProposal[] }>(ctx, 'NODE_PROPOSALS_CREATED', 'node-proposals')?.proposals) ?? []
      const writePlanRaw = artifactByName(ctx, 'WRITE_PLAN_CREATED', 'write-plan')
      const writePlan = writePlanRaw ? KhWritePlanSchema.parse(writePlanRaw) : undefined
      const finalPolicy = policy.check(proposals, writePlan)
      const intents = artifactByName<{ documents: unknown[] }>(ctx, 'DOCUMENTS_CLASSIFIED', 'document-intent-report')
      const graphReport = artifactByName(ctx, 'VALIDATED', 'graph-validation-report')
      const applied = artifactByName<{ applied: string[]; proposals: string[]; skipped: string[] }>(ctx, 'STAGING_WRITTEN', 'applied-write-report')

      const evalReport = buildEvalReport({
        sourcesTotal: intents?.documents.length ?? 0,
        sourcesClassified: intents?.documents.length ?? 0,
        proposals,
        policy: finalPolicy,
        graph: graphReport as never,
        applied,
      })
      const finalReport = [
        `# Harness Run ${ctx.runId}`,
        ``,
        `- proposals: ${proposals.length}`,
        `- policy ok: ${finalPolicy.ok} (violations: ${finalPolicy.violations.length})`,
        `- staging applied: ${applied?.applied.length ?? 0}, proposed: ${applied?.proposals.length ?? 0}`,
        `- awaiting human promotion (real vault unchanged).`,
      ].join('\n')
      return { artifacts: [
        { name: 'final-policy-report', data: finalPolicy },
        { name: 'eval-report', data: evalReport },
        { name: 'final-report', data: { markdown: finalReport } },
      ] }
    },
  }
}
