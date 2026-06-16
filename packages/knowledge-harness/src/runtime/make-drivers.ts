import { readFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { resolveInside, isRaw } from './vault-fs.js'
import { SourceReader, budgetSourcesForPrompt, isConversationSource, isContextSource, type SourceDoc } from './source-reader.js'
import { planFolders, type FolderPlan, type WorkUnit } from './folder-plan.js'
import type { SourceLedger } from './source-ledger.js'
import { normalizeEvidencePaths } from './evidence-normalize.js'
import { dedupeProposalIds, demoteUnderEvidencedShared, pruneUnverifiableEvidence } from './merge-proposals.js'
import { EvidenceVerifier } from '../verify/evidence-verifier.js'
import {
  KhWritePlanSchema, KhSecretScanReportSchema,
  type KhState, type AgentType, type KhNodeProposal, type KhWritePlan,
} from '@apc/shared'
import type { AgentRunner, EngineOptions } from '@apc/llm-wiki'
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
  /** Char budget for the serialized sources embedded in the reader/extractor prompt — sized to the
   *  engine/model's token context window. Defaults to DEFAULT_MAX_PROMPT_SOURCE_CHARS. */
  maxPromptChars?: number
  /** Per-harness engine tuning (model/reasoning/permission) → CLI flags on every agent call. */
  engineOptions?: EngineOptions
  /** Max folder workers to run concurrently in NODE_PROPOSALS_CREATED. Default 1 (sequential — safest
   *  for engines with strict rate/session limits). Raise to parallelize independent folders. */
  workerConcurrency?: number
  /** Optional idempotency ledger. When present, sources already processed (same id + content hash)
   *  for the project are skipped, and the sources consumed by a run are recorded once it reaches
   *  HUMAN_REVIEW_REQUIRED — making re-requested/resumed generation incremental. */
  sourceLedger?: SourceLedger
  /** Timestamp source for ledger records. Defaults to ISO-now. */
  now?: () => string
  /** Optional live node stream: invoked with the node previews from each folder worker (and the
   *  single-shot extractor) AS they complete during NODE_PROPOSALS_CREATED, so the UI can show the
   *  knowledge graph building up mid-run. Best-effort — never gates or fails the run. */
  onNodesDiscovered?: (ev: LiveNodesEvent) => void
  // Phase 3 will add: policy, validators
}

/** A folder worker's freshly-extracted nodes, surfaced for incremental display. `folder` is the work
 *  unit label (or 'all' for the single-shot fallback); ids are pre-dedupe previews, not final graph ids. */
export type LiveNodesEvent = { folder: string; nodes: Array<{ id: string; title: string; type: string; scope: string }> }

/** Map raw proposals to the minimal node preview the live stream carries. */
function liveNodesOf(proposals: KhNodeProposal[]): LiveNodesEvent['nodes'] {
  return proposals.map((p) => ({
    id: String(p.node?.id ?? p.proposal_id),
    title: String(p.node?.title ?? p.node?.id ?? p.proposal_id),
    type: String(p.node?.type ?? 'ConceptNode'),
    scope: String(p.node?.scope ?? 'project'),
  }))
}

/** Default per-step LLM timeout — 10 min. Overridable via DriverDeps.stepTimeoutMs. */
const DEFAULT_STEP_TIMEOUT_MS = 600_000

/** Default char budget for the serialized `sources` embedded in a reader/extractor prompt. Bounded not
 *  by codex's hard 1,048,576-CHAR input limit (a budget of 800K passed that) but by the model's TOKEN
 *  context window: gpt-5.5 via codex with xhigh reasoning rejected ~200K-token (≈800K-char) input with
 *  "ran out of room in the model's context window". ~200K chars ≈ ~50K tokens leaves ample room for the
 *  rest of the prompt + the model's reasoning reserve, across engines. Overridable per run via
 *  DriverDeps.maxPromptChars (engines/models with larger windows can raise it). Sources beyond the
 *  budget are dropped (and show as uncovered in the coverage report). See budgetSourcesForPrompt. */
export const DEFAULT_MAX_PROMPT_SOURCE_CHARS = 200_000

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
  folderPlan: 'folder-plan',
  fanoutReport: 'fanout-report',
  nodeProposals: 'node-proposals',
  policyReport: 'policy-report',
  evidenceVerification: 'evidence-verification-report',
  graphUpdatePlan: 'graph-update-plan',
  sharedPromotionPlan: 'shared-promotion-plan',
  staleDocReport: 'stale-doc-report',
  leadWritePlan: 'lead-write-plan',
  writePlan: 'write-plan',
  appliedWriteReport: 'applied-write-report',
  writeSanitize: 'write-plan-sanitize-report',
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

/**
 * Run `fn` over `items` with at most `limit` concurrent in flight, returning results in INPUT order.
 * `limit <= 1` is plain sequential. A throwing `fn` rejects the whole call — callers needing per-item
 * error handling must catch inside `fn`. Used to parallelize independent folder workers.
 */
export async function runPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) results[i] = await fn(items[i], i)
  }
  const lanes = Math.max(1, Math.min(Math.floor(limit) || 1, items.length || 1))
  await Promise.all(Array.from({ length: lanes }, worker))
  return results
}

export type FolderFanoutResult = {
  /** Deduped proposals in unit order (workers can emit colliding ids). */
  proposals: KhNodeProposal[]
  /** proposal_id → folder, aligned to the FINAL (deduped) ids — for the lead's cross-folder reduce. */
  provenance: Array<{ proposalId: string; folder: string }>
  ran: number
  skipped: Array<{ unit: string; reason: string }>
}

/**
 * Fan a folder-unit list across at most `concurrency` workers, accumulate proposals in unit order,
 * de-duplicate ids across workers, and build folder provenance aligned to the final ids. A unit with no
 * docs is skipped silently; a unit whose worker throws is recorded in `skipped` (not fatal — user
 * decision). Pure given `unitDocs`/`extractUnit` (no LLM or harness state) → directly unit-testable.
 */
export async function runFolderWorkers(
  units: WorkUnit[],
  unitDocs: (u: WorkUnit) => SourceDoc[],
  concurrency: number,
  extractUnit: (docs: SourceDoc[], u: WorkUnit) => Promise<KhNodeProposal[]>,
  onUnitProposals?: (proposals: KhNodeProposal[], u: WorkUnit) => void,
): Promise<FolderFanoutResult> {
  type UnitResult = { unit: WorkUnit; proposals?: KhNodeProposal[]; error?: string; empty?: true }
  const results = await runPool<WorkUnit, UnitResult>(units, concurrency, async (u) => {
    const docs = unitDocs(u)
    if (!docs.length) return { unit: u, empty: true }
    try {
      const proposals = await extractUnit(docs, u)
      // Emit this folder's nodes the moment they land — drives the mid-run incremental graph. A throwing
      // listener must not corrupt the fan-out, so failures here are swallowed.
      try { onUnitProposals?.(proposals, u) } catch { /* live stream is best-effort */ }
      return { unit: u, proposals }
    }
    catch (e) { return { unit: u, error: e instanceof Error ? e.message : String(e) } }
  })
  const tagged: Array<{ p: KhNodeProposal; folder: string }> = []
  const skipped: Array<{ unit: string; reason: string }> = []
  let ran = 0
  for (const r of results) {
    if (r.empty) continue
    if (r.error !== undefined) { skipped.push({ unit: r.unit.label, reason: r.error }); continue }
    for (const p of r.proposals ?? []) tagged.push({ p, folder: r.unit.label })
    ran++
  }
  // Order-preserving dedupe keeps deduped ids index-aligned with `tagged`, so provenance uses final ids.
  const proposals = dedupeProposalIds(tagged.map((t) => t.p))
  const provenance = proposals.map((p, i) => ({ proposalId: p.proposal_id, folder: tagged[i].folder }))
  return { proposals, provenance, ran, skipped }
}

/**
 * Drop write ops that would author a NON-markdown file (e.g. the lead occasionally emits its own
 * graph-update / shared-promotion plans as `.json` files under inbox/) — instead of failing the whole
 * run on PolicyGuard's `non_markdown_write`. The wiki is markdown-only and those plans are already
 * persisted as run artifacts, so the op is pure noise. Raw-path writes, deletes, and secret-bearing
 * bodies are deliberately LEFT for PolicyGuard to hard-block — those are dangerous, not noise. Returns
 * the cleaned plan + the dropped ops (surfaced as an artifact so the exclusion is visible).
 */
export function sanitizeWritePlan(
  plan: KhWritePlan,
): { plan: KhWritePlan; dropped: Array<{ op: string; path: string; reason: string }> } {
  const dropped: Array<{ op: string; path: string; reason: string }> = []
  const operations = plan.operations.filter((op) => {
    const authoring = op.op === 'create_file' || op.op === 'append_section'
    if (authoring && !isRaw(op.path) && !/\.md$/i.test(op.path)) {
      dropped.push({ op: op.op, path: op.path, reason: 'non_markdown_write' })
      return false
    }
    return true
  })
  return { plan: { ...plan, operations }, dropped }
}

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
  const run = { runner: deps.runner, cwd: deps.projectCwd, timeoutMs: deps.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS, engineOptions: deps.engineOptions }
  const maxPromptChars = deps.maxPromptChars ?? DEFAULT_MAX_PROMPT_SOURCE_CHARS

  return {
    PROJECT_SCANNED: async (ctx) => {
      const data = await discovery.run({ ...run, engine: engineOf(ctx), label: `PROJECT_SCANNED-${discovery.name}`, input: { projectId: ctx.projectId } })
      return { artifacts: [{ name: ARTIFACTS.projectDiscovery, data }] }
    },

    SOURCES_EXTRACTED: async (ctx) => {
      // The reader summarizes CONVERSATION sessions — scope it to conversation sources (spec §7.3). Project
      // docs are handled per-folder by the extractor workers, so feeding all docs here is both the wrong
      // scope and a window-overflow risk (the step that previously failed). Workers still get this summary.
      const convSources = freshSources(ctx.projectId).filter((s) => isConversationSource(s.source_path))
      const data = await reader.run({ ...run, engine: engineOf(ctx), label: `SOURCES_EXTRACTED-${reader.name}`, input: {
        discovery: artifactByName(ctx, 'PROJECT_SCANNED', ARTIFACTS.projectDiscovery),
        sources: budgetSourcesForPrompt(convSources, maxPromptChars).sources,
      } })
      return { artifacts: [{ name: ARTIFACTS.conversationHistory, data }] }
    },

    DOCUMENTS_CLASSIFIED: async (ctx) => {
      const data = await classifier.run({ ...run, engine: engineOf(ctx), label: `DOCUMENTS_CLASSIFIED-${classifier.name}`, input: { discovery: artifactByName(ctx, 'PROJECT_SCANNED', ARTIFACTS.projectDiscovery) } })
      // PM router (spec §4): partition project docs into folder-aligned, window-sized work units. Emitted
      // for visibility now; the NODE_PROPOSALS_CREATED fan-out consumes it next phase.
      const folderPlan = planFolders(freshSources(ctx.projectId), maxPromptChars)
      return { artifacts: [
        { name: ARTIFACTS.documentIntent, data },
        { name: ARTIFACTS.folderPlan, data: folderPlan },
      ] }
    },

    NODE_PROPOSALS_CREATED: async (ctx) => {
      const srcs = freshSources(ctx.projectId)  // A1: extractor cites paths/quotes from real source text
      const history = artifactByName(ctx, 'SOURCES_EXTRACTED', ARTIFACTS.conversationHistory)
      const intents = artifactByName(ctx, 'DOCUMENTS_CLASSIFIED', ARTIFACTS.documentIntent)
      const byId = new Map(srcs.map((s) => [s.source_id, s]))

      // Run one extractor call over a source subset (a folder work unit, or all sources in the single-shot
      // fallback). The budget is the worker's last-resort guard; with folder units it rarely truncates.
      const extractOver = async (sources: SourceDoc[], label: string): Promise<KhNodeProposal[]> => {
        const raw = await extractor.run({ ...run, engine: engineOf(ctx), label, input: {
          history, intents, sources: budgetSourcesForPrompt(sources, maxPromptChars).sources,
        } })
        return raw.proposals as KhNodeProposal[]
      }

      // PM worker fan-out (spec §5): one worker per folder unit. No usable plan (e.g. sources not under
      // raw/project-docs, or materialize off) → single-shot over all sources, identical to legacy.
      const plan = artifactByName<FolderPlan>(ctx, 'DOCUMENTS_CLASSIFIED', ARTIFACTS.folderPlan)
      const units = (plan?.units ?? []).filter((u) => u.docSourceIds.length > 0)
      let proposals: KhNodeProposal[]
      const fanout = {
        units: units.length, ran: 0,
        skipped: [] as Array<{ unit: string; reason: string }>,
        provenance: [] as Array<{ proposalId: string; folder: string }>,
      }

      if (units.length === 0) {
        proposals = dedupeProposalIds(await extractOver(srcs, `NODE_PROPOSALS_CREATED-${extractor.name}`))
        try { deps.onNodesDiscovered?.({ folder: 'all', nodes: liveNodesOf(proposals) }) } catch { /* best-effort */ }
      } else {
        // Out-of-repo context (ancestor CLAUDE.md/AGENTS.md, project memory) is project-wide governance —
        // share it with EVERY worker so any folder can cite it (it belongs to no single folder, and the
        // single-shot fallback that used to surface it no longer runs in fan-out mode).
        const contextSources = srcs.filter((s) => isContextSource(s.source_path))
        const res = await runFolderWorkers(
          units,
          (u) => u.docSourceIds.map((id) => byId.get(id)).filter((s): s is SourceDoc => !!s),
          deps.workerConcurrency ?? 1,
          (docs, u) => extractOver([...docs, ...contextSources], `NODE_PROPOSALS_CREATED-${extractor.name}#${u.id}`),
          (unitProposals, u) => deps.onNodesDiscovered?.({ folder: u.label, nodes: liveNodesOf(unitProposals) }),
        )
        if (res.ran === 0) {
          throw new Error(`all ${units.length} folder worker(s) failed: ` +
            res.skipped.map((s) => `${s.unit}: ${s.reason}`).join(' | '))
        }
        proposals = res.proposals
        fanout.ran = res.ran; fanout.skipped = res.skipped; fanout.provenance = res.provenance
      }

      // Agents reason over the project's original paths (remote /home/… for ssh projects, or local
      // absolutes); rewrite each evidence path to its materialized raw/ copy so it resolves locally.
      // normalize sees the FULL source set so cited paths map regardless of which unit produced them.
      const normalized = normalizeEvidencePaths(proposals, srcs)
      // A2: deterministic evidence verification. A non-existent/escaping source = unverifiable (a real raw
      // source is the hard guarantee); a non-verbatim quote is a warning. Instead of failing the run on a
      // few unverifiable citations (a worker can cite a remote file we didn't materialize), PRUNE the
      // unverifiable evidence and drop any now-unsupported proposal — the verified majority still flows.
      const evidence = evidenceVerifier.verify(normalized, deps.vaultRoot)
      const pruned = pruneUnverifiableEvidence(normalized, evidence.unverifiable)
      // demote AFTER pruning: a 'shared' proposal that dropped below 2 evidence becomes 'project' (the lead
      // re-promotes it from the merged cross-folder view) rather than tripping PolicyGuard's shared floor.
      const data = { proposals: demoteUnderEvidencedShared(pruned.proposals) }
      // PolicyGuard checkpoint (design §4): the cleaned set must still satisfy the deterministic rules
      // (no_evidence, shared floor, secrets). A block here is a genuine violation, not citation noise.
      const report = policy.check(data.proposals)
      if (!report.ok) {
        throw new Error(`PolicyGuard blocked ${report.blocked_proposal_ids.length} proposal(s): ` +
          report.violations.filter(v => v.severity === 'block').map(v => `${v.proposal_id}:${v.rule}`).join(', '))
      }
      return { artifacts: [
        { name: ARTIFACTS.nodeProposals, data }, { name: ARTIFACTS.policyReport, data: report },
        { name: ARTIFACTS.evidenceVerification, data: evidence }, { name: ARTIFACTS.fanoutReport, data: fanout },
      ] }
    },

    LEAD_MERGED: async (ctx) => {
      // PM reducer (spec §7.1): the lead sees ALL folder workers' proposals + their folder provenance,
      // so it can merge duplicates AND create edges across folders the siloed workers couldn't see.
      const fan = artifactByName<{ provenance?: Array<{ proposalId: string; folder: string }> }>(ctx, 'NODE_PROPOSALS_CREATED', ARTIFACTS.fanoutReport)
      const plan = artifactByName<FolderPlan>(ctx, 'DOCUMENTS_CLASSIFIED', ARTIFACTS.folderPlan)
      const out = await lead.run({ ...run, engine: engineOf(ctx), label: `LEAD_MERGED-${lead.name}`, input: {
        proposals: artifactByName(ctx, 'NODE_PROPOSALS_CREATED', ARTIFACTS.nodeProposals),
        folders: plan?.units.map((u) => u.label),
        provenance: fan?.provenance,
      } })
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
      const parsed = KhWritePlanSchema.parse(artifactByName(ctx, 'WRITE_PLAN_CREATED', ARTIFACTS.writePlan))
      // First sanitize: drop non-markdown authoring ops (e.g. the lead's own plan JSONs written into
      // inbox/) — noise that would otherwise trip non_markdown_write and fail the whole run.
      const { plan, dropped } = sanitizeWritePlan(parsed)
      // Pre-staging blocking gate (#21/#22/#26): re-run PolicyGuard with the CLEANED write plan and HALT
      // before touching the staging vault if any op would write to raw/, delete, or carry a secret in its
      // body. Scanning the op bodies HERE (not just the files at VALIDATED) means a dangerous write is
      // refused before it is ever authored — not flagged after the fact.
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
      const artifacts: Array<{ name: string; data: unknown }> = [
        { name: ARTIFACTS.appliedWriteReport, data: applied },
        { name: ARTIFACTS.gitDiffReport, data: { patch } },
      ]
      if (dropped.length) artifacts.push({ name: ARTIFACTS.writeSanitize, data: { dropped } })
      return { artifacts }
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
