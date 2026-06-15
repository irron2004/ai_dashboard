import { readFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { resolveInside } from './vault-fs.js'
import { SourceReader, type SourceDoc } from './source-reader.js'
import type { SourceLedger } from './source-ledger.js'
import { normalizeEvidencePaths } from './evidence-normalize.js'
import { EvidenceVerifier } from '../verify/evidence-verifier.js'
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
import { buildCoverageReport } from '../eval/coverage-report.js'
import {
  makeProjectDiscovery, makeConversationHistoryReader, makeDocumentIntentClassifier,
  makeKnowledgeNodeExtractor, makeWikiGraphLead,
} from '../agents/index.js'

export type DriverDeps = {
  runner: AgentRunner
  vaultRoot: string
  stagingRoot: string
  preamble: string
  projectCwd?: string
  /** Per-LLM-step timeout (ms). Agentic CLI steps (project-discovery, node-extractor via claude-opus)
   * routinely exceed the old 180s default and got SIGKILLed mid-run; default 600s gives headroom. */
  stepTimeoutMs?: number
  /** Optional idempotency ledger. When present, sources already processed (same id + content hash)
   *  for the project are skipped, and the sources consumed by a run are recorded once it reaches
   *  HUMAN_REVIEW_REQUIRED — making re-requested/resumed generation incremental. */
  sourceLedger?: SourceLedger
  /** Timestamp source for ledger records. Defaults to ISO-now. */
  now?: () => string
  // Phase 3 will add: policy, validators
}

/** Default per-step LLM timeout — 10 min. Overridable via DriverDeps.stepTimeoutMs. */
const DEFAULT_STEP_TIMEOUT_MS = 600_000

/**
 * Canonical artifact base names (#17). The writer (driver return `name`) and the reader (artifactByName
 * lookup) reference the SAME identifiers here instead of duplicating magic strings across call sites,
 * and lookup is by exact basename equality (not endsWith), so e.g. 'write-plan' can never accidentally
 * resolve 'lead-write-plan'.
 */
export const ARTIFACTS = {
  projectDiscovery: 'project-discovery-report',
  conversationHistory: 'conversation-history-report',
  documentIntent: 'document-intent-report',
  nodeProposals: 'node-proposals',
  policyReport: 'policy-report',
  evidenceVerification: 'evidence-verification-report',
  graphUpdatePlan: 'graph-update-plan',
  sharedPromotionPlan: 'shared-promotion-plan',
  staleDocReport: 'stale-doc-report',
  leadWritePlan: 'lead-write-plan',
  writePlan: 'write-plan',
  appliedWriteReport: 'applied-write-report',
  gitDiffReport: 'git-diff-report',
  graphValidation: 'graph-validation-report',
  markdownYamlValidation: 'markdown-yaml-validation-report',
  linkValidation: 'link-validation-report',
  secretScan: 'secret-scan-report',
  finalPolicy: 'final-policy-report',
  evalReport: 'eval-report',
  coverageReport: 'coverage-report',
  finalReport: 'final-report',
} as const

const engineOf = (ctx: RunnerContext) => ctx.engine as AgentType

/** Read a prior state's artifact by its base name (e.g. ARTIFACTS.leadWritePlan). Order-independent.
 *  Matches on exact basename equality so one name can never resolve a longer-suffixed sibling. */
function artifactByName<T = unknown>(ctx: RunnerContext, state: KhState, name: string): T | undefined {
  const paths = ctx.runState.artifacts[state] ?? []
  const rel = paths.find(p => basename(p) === `${name}.json`)
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
  const evidenceVerifier = new EvidenceVerifier()
  const sources = new SourceReader(deps.vaultRoot)
  const ledger = deps.sourceLedger
  const now = deps.now ?? (() => new Date().toISOString())

  // The sources this run should work on: all raw/ docs minus those the ledger already recorded as
  // processed (unchanged) for this project. Without a ledger, this is every source (legacy behavior).
  // Recomputed per call so every consuming step (reader, extractor, coverage) sees the same set
  // within a run — the ledger is only written at HUMAN_REVIEW_REQUIRED, so it doesn't shift mid-run.
  const freshSources = (projectId: string): SourceDoc[] => {
    const all = sources.read()
    return ledger ? all.filter((s) => !ledger.isProcessed(projectId, s.source_id, s.hash)) : all
  }

  const secrets = new SecretScanner()
  const graph = new GraphIntegrity()
  const mdYaml = new MarkdownYamlValidator()
  const links = new ObsidianLinkValidator()
  const run = { runner: deps.runner, cwd: deps.projectCwd, timeoutMs: deps.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS }

  return {
    PROJECT_SCANNED: async (ctx) => {
      const data = await discovery.run({ ...run, engine: engineOf(ctx), label: `PROJECT_SCANNED-${discovery.name}`, input: { projectId: ctx.projectId } })
      return { artifacts: [{ name: ARTIFACTS.projectDiscovery, data }] }
    },

    SOURCES_EXTRACTED: async (ctx) => {
      // A1: materialize the real raw/ source text so the reader reasons over actual content, not just the
      // (LLM-generated) discovery report.
      const data = await reader.run({ ...run, engine: engineOf(ctx), label: `SOURCES_EXTRACTED-${reader.name}`, input: {
        discovery: artifactByName(ctx, 'PROJECT_SCANNED', ARTIFACTS.projectDiscovery),
        sources: freshSources(ctx.projectId),
      } })
      return { artifacts: [{ name: ARTIFACTS.conversationHistory, data }] }
    },

    DOCUMENTS_CLASSIFIED: async (ctx) => {
      const data = await classifier.run({ ...run, engine: engineOf(ctx), label: `DOCUMENTS_CLASSIFIED-${classifier.name}`, input: { discovery: artifactByName(ctx, 'PROJECT_SCANNED', ARTIFACTS.projectDiscovery) } })
      return { artifacts: [{ name: ARTIFACTS.documentIntent, data }] }
    },

    NODE_PROPOSALS_CREATED: async (ctx) => {
      const srcs = freshSources(ctx.projectId)  // A1: extractor cites paths/quotes from real source text
      const raw = await extractor.run({ ...run, engine: engineOf(ctx), label: `NODE_PROPOSALS_CREATED-${extractor.name}`, input: {
        history: artifactByName(ctx, 'SOURCES_EXTRACTED', ARTIFACTS.conversationHistory),
        intents: artifactByName(ctx, 'DOCUMENTS_CLASSIFIED', ARTIFACTS.documentIntent),
        sources: srcs,
      } })
      // Agents reason over the project's original paths (remote /home/… for ssh projects, or local
      // absolutes); rewrite each evidence path to its materialized raw/ copy so it resolves locally.
      const data = { ...raw, proposals: normalizeEvidencePaths(raw.proposals, srcs) }
      // PolicyGuard checkpoint (design §4): block evidence-less / shared-without-2-evidence proposals
      // BEFORE the Lead merges them. A blocking violation throws → the run records FAILED.
      const report = policy.check(data.proposals)
      if (!report.ok) {
        throw new Error(`PolicyGuard blocked ${report.blocked_proposal_ids.length} proposal(s): ` +
          report.violations.filter(v => v.severity === 'block').map(v => `${v.proposal_id}:${v.rule}`).join(', '))
      }
      // A2: deterministic evidence verification — every declared evidence must resolve to a real raw source
      // (and its quote, if any, must be present). Fabricated evidence is a hard stop, like no-evidence.
      const evidence = evidenceVerifier.verify(data.proposals, deps.vaultRoot)
      if (!evidence.ok) {
        throw new Error(`EvidenceVerifier blocked ${evidence.unverifiable.length} evidence item(s): ` +
          evidence.unverifiable.map(u => `${u.proposal_id}/${u.evidence_id}:${u.reason}`).join(', '))
      }
      return { artifacts: [
        { name: ARTIFACTS.nodeProposals, data }, { name: ARTIFACTS.policyReport, data: report },
        { name: ARTIFACTS.evidenceVerification, data: evidence },
      ] }
    },

    LEAD_MERGED: async (ctx) => {
      const out = await lead.run({ ...run, engine: engineOf(ctx), label: `LEAD_MERGED-${lead.name}`, input: { proposals: artifactByName(ctx, 'NODE_PROPOSALS_CREATED', ARTIFACTS.nodeProposals) } })
      return { artifacts: [
        { name: ARTIFACTS.graphUpdatePlan, data: out.graph_update_plan },
        { name: ARTIFACTS.sharedPromotionPlan, data: out.shared_promotion_plan },
        { name: ARTIFACTS.staleDocReport, data: out.stale_doc_report },
        { name: ARTIFACTS.leadWritePlan, data: out.write_plan },  // cached for WRITE_PLAN_CREATED (no 2nd LLM call)
      ] }
    },

    WRITE_PLAN_CREATED: async (ctx) => {
      const writePlan = artifactByName(ctx, 'LEAD_MERGED', ARTIFACTS.leadWritePlan)
      return { artifacts: [{ name: ARTIFACTS.writePlan, data: writePlan }] }
    },

    STAGING_WRITTEN: async (ctx) => {
      const plan = KhWritePlanSchema.parse(artifactByName(ctx, 'WRITE_PLAN_CREATED', ARTIFACTS.writePlan))
      // Pre-staging blocking gate (#21/#22/#26, #24): re-run PolicyGuard with the write plan and HALT before
      // touching the staging vault if any op would write to raw/, delete, author a non-.md file, or carry a
      // secret in its body. Scanning the op bodies HERE (not just the files at VALIDATED) means a secret or
      // raw/non-md write is refused before it is ever authored — not flagged after the fact.
      const proposals = artifactByName<{ proposals: KhNodeProposal[] }>(ctx, 'NODE_PROPOSALS_CREATED', ARTIFACTS.nodeProposals)?.proposals ?? []
      const gate = policy.check(proposals, plan)
      if (!gate.ok) {
        throw new Error(`PolicyGuard blocked the write plan before staging: ` +
          gate.violations.filter(v => v.severity === 'block').map(v => `${v.proposal_id || '-'}:${v.rule}`).join(', '))
      }
      const staging = new StagingVault(deps.vaultRoot, deps.stagingRoot)
      staging.prepare()
      const applied = writer.apply(plan, staging)
      const patch = staging.diff()
      ctx.store.writeFile('diff.patch', patch)  // top-level deliverable (design §6.2)
      return { artifacts: [
        { name: ARTIFACTS.appliedWriteReport, data: applied },
        { name: ARTIFACTS.gitDiffReport, data: { patch } },
      ] }
    },

    VALIDATED: async (ctx) => {
      // Deterministic verification over the staging vault (design §7.3-7.4).
      // node_id consistency is checked against the graph plan's node ids (cross-artifact), not filenames.
      const graphPlan = artifactByName<{ node_ops?: { node_id?: string }[] }>(ctx, 'LEAD_MERGED', ARTIFACTS.graphUpdatePlan)
      const graphNodeIds = (graphPlan?.node_ops ?? []).map(o => o.node_id).filter((id): id is string => !!id)
      const graphReport = graph.validate(deps.stagingRoot, { graphNodeIds })
      const mdReport = mdYaml.validate(deps.stagingRoot)
      const linkReport = links.validate(deps.stagingRoot)
      // Secret scan is scoped to THIS RUN's authored files (applied + proposals), not the whole
      // staging copy — otherwise a pre-existing vault secret would permanently block all promotions.
      // Scans every authored file regardless of extension (a secret in config/app.env must be caught).
      const applied = artifactByName<{ applied: string[]; proposals: string[] }>(ctx, 'STAGING_WRITTEN', ARTIFACTS.appliedWriteReport)
      const authored = [...(applied?.applied ?? []), ...(applied?.proposals ?? [])]
      const findings = authored.flatMap(rel => {
        const abs = resolveInside(deps.stagingRoot, rel)
        return existsSync(abs) ? secrets.scan(readFileSync(abs, 'utf8'), rel) : []
      })
      const secretReport = KhSecretScanReportSchema.parse({ ok: findings.length === 0, findings })
      return { artifacts: [
        { name: ARTIFACTS.graphValidation, data: graphReport },
        { name: ARTIFACTS.markdownYamlValidation, data: mdReport },
        { name: ARTIFACTS.linkValidation, data: linkReport },
        { name: ARTIFACTS.secretScan, data: secretReport },
      ] }
    },

    HUMAN_REVIEW_REQUIRED: async (ctx) => {
      // Final policy pass (now with the write plan) feeds the eval safety metrics; non-blocking here.
      const proposals = (artifactByName<{ proposals: KhNodeProposal[] }>(ctx, 'NODE_PROPOSALS_CREATED', ARTIFACTS.nodeProposals)?.proposals) ?? []
      const writePlanRaw = artifactByName(ctx, 'WRITE_PLAN_CREATED', ARTIFACTS.writePlan)
      const writePlan = writePlanRaw ? KhWritePlanSchema.parse(writePlanRaw) : undefined
      const finalPolicy = policy.check(proposals, writePlan)
      const intents = artifactByName<{ documents: unknown[] }>(ctx, 'DOCUMENTS_CLASSIFIED', ARTIFACTS.documentIntent)
      const graphReport = artifactByName(ctx, 'VALIDATED', ARTIFACTS.graphValidation)
      const secretReport = artifactByName<{ findings: unknown[] }>(ctx, 'VALIDATED', ARTIFACTS.secretScan)
      const applied = artifactByName<{ applied: string[]; proposals: string[]; skipped: string[] }>(ctx, 'STAGING_WRITTEN', ARTIFACTS.appliedWriteReport)

      const evalReport = buildEvalReport({
        sourcesTotal: intents?.documents.length ?? 0,
        sourcesClassified: intents?.documents.length ?? 0,
        proposals,
        policy: finalPolicy,
        graph: graphReport as never,
        applied,
        secretScanFindings: secretReport?.findings.length ?? 0,
      })
      // Generation reached human review → this run's sources are "processed". Record them so a
      // re-requested/resumed run skips them (and re-does only changed ones). Mark BEFORE building
      // coverage (over the same set) — the ledger write is the durable idempotency signal.
      const consumed = freshSources(ctx.projectId)
      ledger?.markProcessed(
        ctx.projectId, ctx.runId,
        consumed.map((s) => ({ sourceId: s.source_id, sourceHash: s.hash })),
        now(),
      )
      const coverage = buildCoverageReport(consumed.map((s) => s.source_path), proposals)
      const finalReport = [
        `# Harness Run ${ctx.runId}`,
        ``,
        `- proposals: ${proposals.length}`,
        `- policy ok: ${finalPolicy.ok} (violations: ${finalPolicy.violations.length})`,
        `- staging applied: ${applied?.applied.length ?? 0}, proposed: ${applied?.proposals.length ?? 0}`,
        `- awaiting human promotion (real vault unchanged).`,
      ].join('\n')
      ctx.store.writeFile('final-report.md', finalReport)  // top-level deliverable (design §6.2)
      return { artifacts: [
        { name: ARTIFACTS.finalPolicy, data: finalPolicy },
        { name: ARTIFACTS.evalReport, data: evalReport },
        { name: ARTIFACTS.coverageReport, data: coverage },
        { name: ARTIFACTS.finalReport, data: { markdown: finalReport } },
      ] }
    },
  }
}
