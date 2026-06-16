import type { AgentType, KhState, RunState, FeatureGateKey, EngineOptions, ReasoningEffort } from '@apc/shared'

export const HARNESS_STATE_ORDER: KhState[] = [
  'CREATED', 'PROJECT_SCANNED', 'SOURCES_EXTRACTED', 'DOCUMENTS_CLASSIFIED',
  'NODE_PROPOSALS_CREATED', 'LEAD_MERGED', 'WRITE_PLAN_CREATED', 'STAGING_WRITTEN',
  'VALIDATED', 'HUMAN_REVIEW_REQUIRED', 'MERGED', 'FAILED',
]

// Single-sourced from @apc/shared KNOWN_FEATURE_GATES: the GATE_WIRING / SHIPPED_GATE_VALUES tables
// below are Record<HarnessFeatureGateKey, …>, so adding/removing/renaming a gate in the shared universe
// turns into a compile error here until these tables are updated to match.
export type HarnessFeatureGateKey = FeatureGateKey

export const HARNESS_FEATURE_GATES: Array<{ key: HarnessFeatureGateKey; label: string; description: string }> = [
  { key: 'auto_classify_documents', label: 'Auto classify documents', description: 'Classify markdown and source files into canonical/reference/scratch roles.' },
  { key: 'auto_create_node_proposals', label: 'Auto create node proposals', description: 'Generate node proposals from extracted claims and evidence.' },
  { key: 'auto_create_write_plan', label: 'Auto create write plan', description: 'Synthesize a write plan from the merged graph and proposal set.' },
  { key: 'auto_write_to_staging', label: 'Auto write to staging', description: 'Apply accepted write operations to the staging vault.' },
  { key: 'auto_write_to_real_vault', label: 'Auto write to real vault', description: 'Forward-declared auto-apply to canonical vault.' },
  { key: 'auto_shared_promotion', label: 'Auto shared promotion', description: 'Promote shared candidates without a human gate.' },
  { key: 'auto_deprecate', label: 'Auto deprecate', description: 'Automatically mark stale docs as deprecated.' },
  { key: 'auto_delete', label: 'Auto delete', description: 'Allow delete operations in the pipeline.' },
  { key: 'auto_graph_update', label: 'Auto graph update', description: 'Apply graph updates directly from the lead merge stage.' },
  { key: 'auto_update_current', label: 'Auto update current.md', description: 'Refresh current.md automatically when proposals land.' },
  { key: 'auto_update_adr', label: 'Auto update ADRs', description: 'Write architecture decision records as part of the run.' },
  { key: 'enable_conversation_history_reader', label: 'Conversation history reader', description: 'Enable the conversation-history reader driver.' },
  { key: 'enable_claude_history_reader', label: 'Claude history reader', description: 'Enable Claude-specific transcript ingestion.' },
  { key: 'enable_codex_history_reader', label: 'Codex history reader', description: 'Enable Codex-specific transcript ingestion.' },
  { key: 'enable_opencode_history_reader', label: 'OpenCode history reader', description: 'Enable OpenCode SQLite session ingestion.' },
  { key: 'enable_policy_guard', label: 'Policy guard', description: 'Run proposal policy checks during the pipeline.' },
  { key: 'enable_secret_scan', label: 'Secret scan', description: 'Scan staged markdown for secret patterns.' },
  { key: 'enable_evidence_required', label: 'Evidence required', description: 'Require evidence for claims and proposals.' },
  { key: 'enable_human_review_for_shared', label: 'Human review for shared', description: 'Require human review before shared promotion.' },
  { key: 'enable_human_review_for_canonical', label: 'Human review for canonical', description: 'Require human review before canonical promotion.' },
  { key: 'use_staging_vault', label: 'Use staging vault', description: 'Write proposals to the staging vault only.' },
  { key: 'require_git_diff_before_merge', label: 'Require git diff before merge', description: 'Block merge until the staged diff is reviewed.' },
]

/**
 * What each gate ACTUALLY does in the MVP runtime (mirrors the harness/feature-gates.yml header):
 *  - 'honored'          — drives the pipeline via run-state-machine PIPELINE step.gate.
 *  - 'structural'       — always-on safety, structurally enforced regardless of flag; NOT toggleable.
 *  - 'forward-declared' — inert P1 placeholder; flipping it changes nothing today.
 * The UI uses this to label gates truthfully instead of presenting always-on/inert flags as toggles (#9).
 */
export type HarnessGateWiring = 'honored' | 'structural' | 'forward-declared'

export const GATE_WIRING: Record<HarnessFeatureGateKey, HarnessGateWiring> = {
  auto_classify_documents: 'honored',
  auto_create_node_proposals: 'honored',
  auto_create_write_plan: 'honored',
  auto_write_to_staging: 'honored',
  enable_conversation_history_reader: 'honored',
  enable_policy_guard: 'structural',
  enable_secret_scan: 'structural',
  enable_evidence_required: 'structural',
  enable_human_review_for_shared: 'structural',
  enable_human_review_for_canonical: 'structural',
  use_staging_vault: 'structural',
  require_git_diff_before_merge: 'structural',
  auto_write_to_real_vault: 'forward-declared',
  auto_shared_promotion: 'forward-declared',
  auto_deprecate: 'forward-declared',
  auto_delete: 'forward-declared',
  auto_graph_update: 'forward-declared',
  auto_update_current: 'forward-declared',
  auto_update_adr: 'forward-declared',
  enable_claude_history_reader: 'forward-declared',
  enable_codex_history_reader: 'forward-declared',
  enable_opencode_history_reader: 'forward-declared',
}

export const GATE_WIRING_LABEL: Record<HarnessGateWiring, string> = {
  honored: 'HONORED',
  structural: 'ALWAYS-ON',
  'forward-declared': 'NOT WIRED',
}

/** The on/off the harness actually SHIPS (harness/feature-gates.yml). Read-only source of truth for the
 * UI — it reflects shipped policy, not a user toggle, because the MVP gates are not editable per-run. */
export const SHIPPED_GATE_VALUES: Record<HarnessFeatureGateKey, boolean> = {
  auto_classify_documents: true,
  auto_create_node_proposals: true,
  auto_create_write_plan: true,
  auto_write_to_staging: true,
  auto_write_to_real_vault: false,
  auto_shared_promotion: false,
  auto_deprecate: false,
  auto_delete: false,
  auto_graph_update: false,
  auto_update_current: false,
  auto_update_adr: false,
  enable_conversation_history_reader: true,
  enable_claude_history_reader: false,
  enable_codex_history_reader: false,
  enable_opencode_history_reader: false,
  enable_policy_guard: true,
  enable_secret_scan: true,
  enable_evidence_required: true,
  enable_human_review_for_shared: true,
  enable_human_review_for_canonical: true,
  use_staging_vault: true,
  require_git_diff_before_merge: true,
}

export const HARNESS_AGENT_PROMPTS = [
  { key: 'projectDiscovery', label: 'Project discovery', hint: 'Scan the repository and summarize its canonical docs.' },
  { key: 'conversationHistory', label: 'Conversation history', hint: 'Turn agent sessions into structured work summaries.' },
  { key: 'documentIntent', label: 'Document intent', hint: 'Classify each markdown file as canonical, reference, or scratch.' },
  { key: 'knowledgeNodeExtractor', label: 'Node extractor', hint: 'Extract claims, evidence, and node proposals from sources.' },
  { key: 'wikiGraphLead', label: 'Graph lead', hint: 'Merge proposals into a coherent graph and write plan.' },
  { key: 'policyGuard', label: 'Policy guard', hint: 'Reject unsafe or under-evidenced changes.' },
] as const

export type HarnessAgentPromptKey = typeof HARNESS_AGENT_PROMPTS[number]['key']

export type HarnessModelSettings = {
  engine: AgentType
  temperature: number
  maxTokens: number
  /** Engine CLI tuning (per harness) — empty/undefined means "use the engine default". */
  model?: string
  reasoningEffort?: ReasoningEffort
  sandbox?: EngineOptions['sandbox']
  approval?: EngineOptions['approval']
  permissionMode?: EngineOptions['permissionMode']
}

/** Project the per-harness model settings to the EngineOptions the backend run accepts. Blank strings
 *  become undefined so they add no CLI flag. */
export function modelSettingsToEngineOptions(m: HarnessModelSettings): EngineOptions {
  return {
    model: m.model?.trim() || undefined,
    reasoningEffort: m.reasoningEffort,
    sandbox: m.sandbox,
    approval: m.approval,
    permissionMode: m.permissionMode,
  }
}

export const REASONING_EFFORTS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh']
export const CODEX_SANDBOXES: NonNullable<EngineOptions['sandbox']>[] = ['read-only', 'workspace-write', 'danger-full-access']
export const CODEX_APPROVALS: NonNullable<EngineOptions['approval']>[] = ['untrusted', 'on-failure', 'on-request', 'never']
export const CLAUDE_PERMISSION_MODES: NonNullable<EngineOptions['permissionMode']>[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']

export type HarnessSafetySettings = {
  secretScanSensitivity: 'low' | 'medium' | 'high'
  evidenceRequirement: 'balanced' | 'strict'
}

export type HarnessConfig = {
  model: HarnessModelSettings
  featureGates: Record<HarnessFeatureGateKey, boolean>
  prompts: Record<HarnessAgentPromptKey, string>
  safety: HarnessSafetySettings
}

export type HarnessRunArtifact = {
  state: KhState
  name: string
  path: string
  data: unknown
}

// localStorage에 저장된 옛 run에는 mode가 없다 — 모든 소비처는 undefined를 허용해야 한다.
export type HarnessRunMode = 'full-docs' | 'recent-sessions'

export type HarnessRunBundle = {
  runState: RunState
  artifacts: HarnessRunArtifact[]
  /** 어떤 입력 모드로 시작된 run인지 (renderer가 시작 시점에 기록; resume·과거 run은 undefined). */
  mode?: HarnessRunMode
}

export type HarnessGraphNodeType = 'run' | 'task' | 'evidence' | 'file' | 'document'
export type HarnessGraphShape = 'circle' | 'diamond' | 'square'

export type HarnessGraphNode = {
  id: string
  label: string
  type: HarnessGraphNodeType
  shape: HarnessGraphShape
  color: string
  details?: string
  data?: unknown
}

export type HarnessGraphLink = {
  id: string
  source: string
  target: string
  label?: string
  kind: string
}

export type HarnessGraphData = {
  nodes: HarnessGraphNode[]
  links: HarnessGraphLink[]
}

export type HarnessDiffRow = {
  kind: 'context' | 'add' | 'delete'
  leftNumber?: number
  rightNumber?: number
  left: string
  right: string
}

export type HarnessDiffFile = {
  path: string
  rows: HarnessDiffRow[]
}

export const HARNESS_CONFIG_STORAGE_PREFIX = 'harness-dashboard'

const DEFAULT_PROMPTS: Record<HarnessAgentPromptKey, string> = {
  projectDiscovery: 'Scan the project, identify canonical docs, and summarize the map of the knowledge vault.',
  conversationHistory: 'Read session transcripts and summarize the decisions, files, and open problems.',
  documentIntent: 'Classify markdown files as canonical, reference, or scratch with a short reason.',
  knowledgeNodeExtractor: 'Extract node proposals, claims, and evidence without inventing missing support.',
  wikiGraphLead: 'Merge the proposals into a coherent graph and produce a safe write plan.',
  policyGuard: 'Check for evidence, secret exposure, raw writes, and unsafe canonical overwrites.',
}

export function createDefaultHarnessConfig(): HarnessConfig {
  return {
    model: { engine: 'claude', temperature: 0.2, maxTokens: 8192 },
    featureGates: {
      auto_classify_documents: true,
      auto_create_node_proposals: true,
      auto_create_write_plan: true,
      auto_write_to_staging: true,
      auto_write_to_real_vault: false,
      auto_shared_promotion: false,
      auto_deprecate: false,
      auto_delete: false,
      auto_graph_update: false,
      auto_update_current: false,
      auto_update_adr: false,
      enable_conversation_history_reader: true,
      enable_claude_history_reader: false,
      enable_codex_history_reader: false,
      enable_opencode_history_reader: false,
      enable_policy_guard: true,
      enable_secret_scan: true,
      enable_evidence_required: true,
      enable_human_review_for_shared: true,
      enable_human_review_for_canonical: true,
      use_staging_vault: true,
      require_git_diff_before_merge: true,
    },
    prompts: { ...DEFAULT_PROMPTS },
    safety: { secretScanSensitivity: 'medium', evidenceRequirement: 'strict' },
  }
}

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function readJson<T>(key: string, fallback: T): T {
  if (!storageAvailable()) return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  if (!storageAvailable()) return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore storage failures; the dashboard still works with in-memory state.
  }
}

export function harnessConfigKey(projectId: string): string {
  return `${HARNESS_CONFIG_STORAGE_PREFIX}:config:${projectId}`
}

export function harnessRunsKey(projectId: string): string {
  return `${HARNESS_CONFIG_STORAGE_PREFIX}:runs:${projectId}`
}

export function harnessSelectedRunKey(projectId: string): string {
  return `${HARNESS_CONFIG_STORAGE_PREFIX}:selected:${projectId}`
}

export function loadHarnessConfig(projectId: string): HarnessConfig {
  return readJson(harnessConfigKey(projectId), createDefaultHarnessConfig())
}

export function saveHarnessConfig(projectId: string, config: HarnessConfig): void {
  writeJson(harnessConfigKey(projectId), config)
}

export function loadHarnessRuns(projectId: string): HarnessRunBundle[] {
  return readJson(harnessRunsKey(projectId), [])
}

export function saveHarnessRuns(projectId: string, runs: HarnessRunBundle[]): void {
  writeJson(harnessRunsKey(projectId), runs)
}

export function loadHarnessSelectedRun(projectId: string): string | null {
  return readJson<string | null>(harnessSelectedRunKey(projectId), null)
}

export function saveHarnessSelectedRun(projectId: string, runId: string | null): void {
  writeJson(harnessSelectedRunKey(projectId), runId)
}

export function stateIndex(state: KhState): number {
  return HARNESS_STATE_ORDER.indexOf(state)
}

export function stateProgress(state: KhState): number {
  const idx = stateIndex(state)
  return idx < 0 ? 0 : Math.round((idx / (HARNESS_STATE_ORDER.length - 1)) * 100)
}

export function stateTone(state: KhState): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (state === 'FAILED') return 'danger'
  if (state === 'MERGED') return 'success'
  if (state === 'HUMAN_REVIEW_REQUIRED') return 'warning'
  if (['WRITE_PLAN_CREATED', 'STAGING_WRITTEN', 'VALIDATED'].includes(state)) return 'info'
  return 'neutral'
}

export function formatTimestamp(iso?: string): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function runStartedAt(runState: RunState): string {
  return runState.history[0]?.at ?? ''
}

export function runUpdatedAt(runState: RunState): string {
  return runState.history[runState.history.length - 1]?.at ?? ''
}

export function artifactLabel(name: string): string {
  return name
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

export function isMarkdownArtifact(entry: HarnessRunArtifact): boolean {
  if (typeof entry.data === 'string' && entry.data.trim().length > 0) return true
  if (entry.data && typeof entry.data === 'object') {
    const data = entry.data as Record<string, unknown>
    return typeof data.markdown === 'string' || typeof data.body === 'string' || typeof data.content === 'string'
  }
  return false
}

function escapeMarkdown(text: string): string {
  return text.replace(/\|/g, '\\|')
}

function formatList(items: string[], bullet = '-'): string {
  return items.length ? items.map((item) => `${bullet} ${item}`).join('\n') : `${bullet} (none)`
}

function formatTable(headers: string[], rows: string[][]): string {
  if (!rows.length) return '_No rows._'
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${row.map((cell) => escapeMarkdown(cell)).join(' | ')} |`).join('\n')
  return [head, sep, body].join('\n')
}

function asObject(data: unknown): Record<string, unknown> | null {
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null
}

function textOf(data: unknown): string | null {
  if (typeof data === 'string') return data
  const object = asObject(data)
  if (!object) return null
  for (const key of ['markdown', 'body', 'content', 'summary', 'text', 'patch']) {
    if (typeof object[key] === 'string') return String(object[key])
  }
  return null
}

export function artifactToMarkdown(entry: HarnessRunArtifact): string {
  const raw = textOf(entry.data)
  if (raw) {
    if (entry.name === 'git-diff-report') return `# ${artifactLabel(entry.name)}\n\n\`\`\`diff\n${raw}\n\`\`\``
    return raw
  }

  const object = asObject(entry.data)
  if (!object) return `# ${artifactLabel(entry.name)}\n\n\`\`\`json\n${JSON.stringify(entry.data, null, 2)}\n\`\`\``

  switch (entry.name) {
    case 'project-discovery-report': {
      const repos = Array.isArray(object.repos) ? object.repos as Array<{ path?: string; kind?: string }> : []
      const docs = Array.isArray(object.canonical_docs) ? object.canonical_docs as Array<{ path?: string; role?: string }> : []
      const topics = Array.isArray(object.topics) ? object.topics.map(String) : []
      return [
        `# Project Discovery Report`,
        '',
        `## Summary`,
        String(object.summary ?? '(no summary)'),
        '',
        `## Repositories`,
        formatTable(['Path', 'Kind'], repos.map((repo) => [String(repo.path ?? '—'), String(repo.kind ?? 'repo')])),
        '',
        `## Canonical docs`,
        formatTable(['Path', 'Role'], docs.map((doc) => [String(doc.path ?? '—'), String(doc.role ?? 'canonical')])),
        '',
        `## Topics`,
        formatList(topics),
      ].join('\n')
    }
    case 'conversation-history-report': {
      const highlights = Array.isArray(object.highlights) ? object.highlights as Array<{ text?: string; kind?: string; source_path?: string }> : []
      const filesTouched = Array.isArray(object.files_touched) ? object.files_touched.map(String) : []
      const openProblems = Array.isArray(object.open_problems) ? object.open_problems.map(String) : []
      return [
        `# Conversation History Report`,
        '',
        `## Work summary`,
        String(object.work_summary ?? '(none)'),
        '',
        `## Highlights`,
        formatList(highlights.map((h) => `${h.kind ?? 'decision'} — ${h.text ?? ''}${h.source_path ? ` [[${h.source_path}]]` : ''}`)),
        '',
        `## Files touched`,
        formatList(filesTouched),
        '',
        `## Open problems`,
        formatList(openProblems),
      ].join('\n')
    }
    case 'document-intent-report': {
      const docs = Array.isArray(object.documents) ? object.documents as Array<{ path?: string; intent?: string; confidence?: string; reason?: string }> : []
      return [
        `# Document Intent Report`,
        '',
        formatTable(['Path', 'Intent', 'Confidence', 'Reason'], docs.map((doc) => [
          String(doc.path ?? '—'), String(doc.intent ?? '—'), String(doc.confidence ?? '—'), String(doc.reason ?? ''),
        ])),
      ].join('\n')
    }
    case 'node-proposals': {
      const proposals = Array.isArray(object.proposals) ? object.proposals as Array<any> : []
      return [
        `# Node Proposals`,
        '',
        ...proposals.flatMap((proposal) => {
          const claims = Array.isArray(proposal.claims) ? proposal.claims : []
          const evidence = Array.isArray(proposal.evidence) ? proposal.evidence : []
          const actions = Array.isArray(proposal.actions) ? proposal.actions : []
          return [
            `## ${proposal.node?.title ?? proposal.proposal_id}`,
            `- Proposal: ${proposal.proposal_id}`,
            `- Type: ${proposal.node?.type ?? 'unknown'}`,
            `- Scope: ${proposal.node?.scope ?? 'project'}`,
            `- Proposed by: ${proposal.proposed_by ?? '—'}`,
            proposal.node?.summary ? `- Summary: ${proposal.node.summary}` : '',
            '',
            `### Claims`,
            formatList(claims.map((claim: any) => `${claim.text ?? ''}${claim.evidence_ids?.length ? ` — evidence ${claim.evidence_ids.map((id: string) => `[[${id}]]`).join(', ')}` : ''}`)),
            '',
            `### Evidence`,
            formatList(evidence.map((item: any) => `${item.evidence_id ?? 'evidence'} — [[${item.source_path ?? item.source_id ?? 'unknown'}]] ${item.quote_or_summary ? `— ${item.quote_or_summary}` : ''}`)),
            '',
            `### Actions`,
            formatList(actions.map((action: any) => `${action.action_type ?? 'action'} → ${action.target_path ?? '—'}${action.link ? ` ([[${action.link}]])` : ''}`)),
            '',
          ]
        }),
      ].filter(Boolean).join('\n')
    }
    case 'graph-update-plan': {
      const ops = Array.isArray(object.node_ops) ? object.node_ops as Array<{ op?: string; node_id?: string; note?: string }> : []
      return [
        `# Graph Update Plan`,
        '',
        formatList(ops.map((op) => `${op.op ?? 'op'} — ${op.node_id ?? 'node'}${op.note ? ` — ${op.note}` : ''}`)),
      ].join('\n')
    }
    case 'shared-promotion-plan': {
      const candidates = Array.isArray(object.candidates) ? object.candidates as Array<any> : []
      return [
        `# Shared Promotion Plan`,
        '',
        formatTable(['Node', 'Evidence', 'Review'], candidates.map((candidate) => [
          String(candidate.node_id ?? '—'), String(candidate.evidence_count ?? 0), candidate.requires_human_review ? 'yes' : 'no',
        ])),
      ].join('\n')
    }
    case 'stale-doc-report': {
      const stale = Array.isArray(object.stale) ? object.stale as Array<any> : []
      return [
        `# Stale Document Report`,
        '',
        formatTable(['Path', 'Reason', 'Suggested status'], stale.map((item) => [
          String(item.path ?? '—'), String(item.reason ?? ''), String(item.suggested_status ?? 'review'),
        ])),
      ].join('\n')
    }
    case 'write-plan': {
      const ops = Array.isArray(object.operations) ? object.operations as Array<any> : []
      return [
        `# Write Plan`,
        '',
        `- Plan ID: ${String(object.write_plan_id ?? '—')}`,
        `- Target vault: ${String(object.target_vault ?? 'vault-staging')}`,
        `- Requires approval: ${String(object.requires_human_approval ?? true)}`,
        '',
        `## Operations`,
        ...ops.flatMap((op) => [
          `### ${op.op ?? 'operation'} — ${op.path ?? 'path'}`,
          op.source_proposal ? `- Source proposal: ${String(op.source_proposal)}` : '',
          op.mode ? `- Mode: ${String(op.mode)}` : '',
          op.risk ? `- Risk: ${String(op.risk)}` : '',
          op.reason ? `- Reason: ${String(op.reason)}` : '',
          op.content ? `\n\`\`\`md\n${String(op.content)}\n\`\`\`` : '',
          '',
        ]),
      ].join('\n')
    }
    case 'applied-write-report': {
      const applied = Array.isArray(object.applied) ? object.applied.map(String) : []
      const proposed = Array.isArray(object.proposals) ? object.proposals.map(String) : []
      const skipped = Array.isArray(object.skipped) ? object.skipped.map(String) : []
      return [
        `# Applied Write Report`,
        '',
        formatTable(['Bucket', 'Entries'], [
          ['Applied', String(applied.length)],
          ['Proposed', String(proposed.length)],
          ['Skipped', String(skipped.length)],
        ]),
        '',
        `## Applied`,
        formatList(applied),
        '',
        `## Proposed`,
        formatList(proposed),
        '',
        `## Skipped`,
        formatList(skipped),
      ].join('\n')
    }
    case 'final-policy-report':
    case 'policy-report': {
      const violations = Array.isArray(object.violations) ? object.violations as Array<any> : []
      const blocked = Array.isArray(object.blocked_proposal_ids) ? object.blocked_proposal_ids.map(String) : []
      return [
        `# Policy Report`,
        '',
        `- OK: ${String(object.ok ?? true)}`,
        `- Blocked proposals: ${blocked.join(', ') || 'none'}`,
        '',
        formatTable(['Proposal', 'Rule', 'Severity', 'Detail'], violations.map((violation) => [
          String(violation.proposal_id ?? '—'), String(violation.rule ?? '—'), String(violation.severity ?? 'warn'), String(violation.detail ?? ''),
        ])),
      ].join('\n')
    }
    case 'eval-report': {
      const sections = ['coverage', 'evidence_quality', 'graph_quality', 'safety', 'usefulness']
      return [
        `# Eval Report`,
        '',
        ...sections.flatMap((section) => {
          const obj = asObject(object[section])
          const rows = obj ? Object.entries(obj).map(([key, value]) => [key, String(value)]) : []
          return [
            `## ${section.replace(/_/g, ' ')}`,
            formatTable(['Metric', 'Value'], rows),
            '',
          ]
        }),
      ].join('\n')
    }
    case 'graph-validation-report':
    case 'markdown-yaml-validation-report':
    case 'link-validation-report':
    case 'secret-scan-report': {
      return `# ${artifactLabel(entry.name)}\n\n\`\`\`json\n${JSON.stringify(entry.data, null, 2)}\n\`\`\``
    }
    case 'final-report':
      return String(object.markdown ?? '# Final Report')
    default:
      return `# ${artifactLabel(entry.name)}\n\n\`\`\`json\n${JSON.stringify(entry.data, null, 2)}\n\`\`\``
  }
}

export function extractWikiLinks(text: string): Array<{ target: string; alias: string }> {
  const matches = [...text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)]
  return matches.map((match) => ({ target: match[1].trim(), alias: (match[2] ?? match[1]).trim() }))
}

export function collectWikiLinksFromValue(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    for (const link of extractWikiLinks(value)) out.add(link.target)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectWikiLinksFromValue(item, out)
    return out
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectWikiLinksFromValue(item, out)
  }
  return out
}

function fileTypeFromPath(path: string): 'concept' | 'decision' | 'experiment' | 'file' {
  const lower = path.toLowerCase()
  if (lower.includes('/concepts/') || lower.startsWith('concept')) return 'concept'
  if (lower.includes('/decisions/') || lower.startsWith('adr') || lower.includes('decision')) return 'decision'
  if (lower.includes('/experiments/') || lower.includes('experiment')) return 'experiment'
  return 'file'
}

function colorForNode(type: HarnessGraphNodeType | 'concept' | 'decision' | 'experiment' | 'ghost'): string {
  switch (type) {
    case 'task': return '#f59e0b'
    case 'evidence': return '#34d399'
    case 'run': return '#60a5fa'
    case 'document': return '#94a3b8'
    case 'concept': return '#7dd3fc'
    case 'decision': return '#fbbf24'
    case 'experiment': return '#c084fc'
    case 'ghost': return '#475569'
    default: return '#94a3b8'
  }
}

function uniquePush<T>(list: T[], item: T, key: (value: T) => string): void {
  if (!list.some((existing) => key(existing) === key(item))) list.push(item)
}

function labelFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.[^.]+$/, '')
}

function addNode(map: Map<string, HarnessGraphNode>, node: HarnessGraphNode): void {
  if (!map.has(node.id)) map.set(node.id, node)
}

function addLink(links: HarnessGraphLink[], link: HarnessGraphLink): void {
  uniquePush(links, link, (item) => item.id)
}

function fileNodeId(path: string): string {
  return `file:${path}`
}

function evidenceNodeId(id: string): string {
  return `evidence:${id}`
}

function taskNodeId(id: string): string {
  return `task:${id}`
}

export function buildHarnessGraphData(bundle: HarnessRunBundle | null): HarnessGraphData {
  const nodeMap = new Map<string, HarnessGraphNode>()
  const links: HarnessGraphLink[] = []
  if (!bundle) return { nodes: [], links }

  const run = bundle.runState
  addNode(nodeMap, {
    id: `run:${run.runId}`,
    label: run.runId,
    type: 'run',
    shape: 'square',
    color: colorForNode('run'),
    details: `${run.projectId} · ${run.engine}`,
    data: run,
  })

  const linkTargets = new Map<string, Set<string>>()

  const registerFile = (path: string, typeHint?: 'concept' | 'decision' | 'experiment' | 'file', details?: string): string => {
    const id = fileNodeId(path)
    addNode(nodeMap, {
      id,
      label: labelFromPath(path),
      type: 'file',
      shape: 'square',
      color: colorForNode(typeHint ?? fileTypeFromPath(path)),
      details: details ?? path,
      data: { path, typeHint: typeHint ?? fileTypeFromPath(path) },
    })
    return id
  }

  const registerTask = (proposalId: string, label: string, details?: string): string => {
    const id = taskNodeId(proposalId)
    addNode(nodeMap, {
      id,
      label,
      type: 'task',
      shape: 'diamond',
      color: colorForNode('task'),
      details,
    })
    return id
  }

  const registerEvidence = (id: string, label: string, details?: string): string => {
    const nodeId = evidenceNodeId(id)
    addNode(nodeMap, {
      id: nodeId,
      label,
      type: 'evidence',
      shape: 'circle',
      color: colorForNode('evidence'),
      details,
    })
    return nodeId
  }

  for (const entry of bundle.artifacts) {
    const sourceArtifactId = `artifact:${entry.path}`
    addNode(nodeMap, {
      id: sourceArtifactId,
      label: artifactLabel(entry.name),
      type: 'document',
      shape: 'square',
      color: colorForNode(entry.name.includes('report') ? 'document' : 'ghost'),
      details: `${entry.state} · ${entry.path}`,
      data: entry.data,
    })

    if (entry.name === 'node-proposals') {
      const proposals = asObject(entry.data)?.proposals as Array<any> | undefined
      for (const proposal of proposals ?? []) {
        const proposalId = String(proposal.proposal_id ?? proposal.node?.id ?? cryptoRandomId())
        const taskId = registerTask(proposalId, String(proposal.node?.title ?? proposalId), String(proposal.node?.type ?? 'proposal'))
        addLink(links, { id: `${sourceArtifactId}->${taskId}`, source: sourceArtifactId, target: taskId, kind: 'proposal', label: 'proposal' })
        addLink(links, { id: `run:${run.runId}->${taskId}`, source: `run:${run.runId}`, target: taskId, kind: 'run-task', label: 'run' })

        for (const claim of Array.isArray(proposal.claims) ? proposal.claims : []) {
          for (const evidenceId of Array.isArray(claim.evidence_ids) ? claim.evidence_ids : []) {
            addLink(links, { id: `${taskId}->${evidenceNodeId(String(evidenceId))}`, source: taskId, target: evidenceNodeId(String(evidenceId)), kind: 'claim-evidence', label: 'evidence' })
          }
          for (const link of collectWikiLinksFromValue(claim)) linkTargets.set(taskId, new Set([...(linkTargets.get(taskId) ?? []), link]))
        }

        for (const evidence of Array.isArray(proposal.evidence) ? proposal.evidence : []) {
          const evidenceId = String(evidence.evidence_id ?? cryptoRandomId())
          const evidenceNode = registerEvidence(evidenceId, evidenceId, String(evidence.source_path ?? evidence.source_id ?? 'evidence'))
          addLink(links, { id: `${taskId}->${evidenceNode}`, source: taskId, target: evidenceNode, kind: 'supports', label: 'supports' })
          if (evidence.source_path) {
            const sourceFile = registerFile(String(evidence.source_path), fileTypeFromPath(String(evidence.source_path)), String(evidence.source_id ?? 'evidence source'))
            addLink(links, { id: `${evidenceNode}->${sourceFile}`, source: evidenceNode, target: sourceFile, kind: 'source', label: 'source' })
          }
          for (const link of collectWikiLinksFromValue(evidence)) linkTargets.set(evidenceNode, new Set([...(linkTargets.get(evidenceNode) ?? []), link]))
        }

        for (const action of Array.isArray(proposal.actions) ? proposal.actions : []) {
          if (action?.target_path) {
            const fileId = registerFile(String(action.target_path), fileTypeFromPath(String(action.target_path)), String(action.action_type ?? 'action target'))
            addLink(links, { id: `${taskId}->${fileId}`, source: taskId, target: fileId, kind: 'action-file', label: String(action.action_type ?? 'action') })
          }
          if (action?.link) {
            const targetId = registerFile(String(action.link), fileTypeFromPath(String(action.link)), 'wiki link target')
            addLink(links, { id: `${taskId}->${targetId}`, source: taskId, target: targetId, kind: 'wiki', label: 'wiki-link' })
          }
        }

        for (const link of collectWikiLinksFromValue(proposal)) {
          const targetId = registerFile(link, fileTypeFromPath(link), 'wiki link target')
          addLink(links, { id: `${taskId}->${targetId}`, source: taskId, target: targetId, kind: 'wiki', label: 'wiki-link' })
        }
      }
    }

    if (entry.name === 'write-plan' || entry.name === 'lead-write-plan') {
      const ops = asObject(entry.data)?.operations as Array<any> | undefined
      for (const op of ops ?? []) {
        if (op?.path) {
          const fileId = registerFile(String(op.path), fileTypeFromPath(String(op.path)), String(op.op ?? 'write op'))
          addLink(links, { id: `${sourceArtifactId}->${fileId}`, source: sourceArtifactId, target: fileId, kind: 'write-plan', label: String(op.op ?? 'write') })
          addLink(links, { id: `run:${run.runId}->${fileId}`, source: `run:${run.runId}`, target: fileId, kind: 'run-file', label: 'staging' })
        }
      }
    }

    if (entry.name === 'applied-write-report') {
      const applied = Array.isArray(asObject(entry.data)?.applied) ? asObject(entry.data)?.applied as string[] : []
      const proposed = Array.isArray(asObject(entry.data)?.proposals) ? asObject(entry.data)?.proposals as string[] : []
      const skipped = Array.isArray(asObject(entry.data)?.skipped) ? asObject(entry.data)?.skipped as string[] : []
      for (const path of [...applied, ...proposed, ...skipped]) {
        const fileId = registerFile(path, fileTypeFromPath(path), 'write result')
        addLink(links, { id: `${sourceArtifactId}->${fileId}`, source: sourceArtifactId, target: fileId, kind: 'result', label: 'result' })
      }
    }

    if (entry.name === 'final-report') {
      const text = textOf(entry.data) ?? ''
      for (const link of extractWikiLinks(text)) {
        const targetId = registerFile(link.target, fileTypeFromPath(link.target), 'wiki link target')
        addLink(links, { id: `${sourceArtifactId}->${targetId}`, source: sourceArtifactId, target: targetId, kind: 'wiki', label: link.alias })
      }
    }

    for (const link of collectWikiLinksFromValue(entry.data)) {
      const targetId = registerFile(link, fileTypeFromPath(link), 'wiki link target')
      addLink(links, { id: `${sourceArtifactId}->${targetId}`, source: sourceArtifactId, target: targetId, kind: 'wiki', label: 'wiki-link' })
    }
  }

  for (const [sourceId, targets] of linkTargets.entries()) {
    for (const target of targets) {
      const targetId = registerFile(target, fileTypeFromPath(target), 'wiki link target')
      addLink(links, { id: `${sourceId}->${targetId}`, source: sourceId, target: targetId, kind: 'wiki', label: 'wiki-link' })
    }
  }

  return { nodes: [...nodeMap.values()], links }
}

export function parseUnifiedDiff(patch: string): HarnessDiffFile[] {
  const files: HarnessDiffFile[] = []
  let current: HarnessDiffFile | null = null
  let leftLine = 0
  let rightLine = 0

  const ensureCurrent = (path: string): HarnessDiffFile => {
    if (!current || current.path !== path) {
      current = { path, rows: [] }
      files.push(current)
    }
    return current
  }

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      const match = /diff --git a\/(.+?) b\/(.+)$/.exec(line)
      const path = match?.[2] ?? match?.[1] ?? 'unknown'
      ensureCurrent(path)
      leftLine = 0
      rightLine = 0
      continue
    }
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue
    if (line.startsWith('@@ ')) {
      const match = /@@ -(?:(\d+))(?:,(\d+))? \+(?:(\d+))(?:,(\d+))? @@/.exec(line)
      leftLine = match ? Number(match[1]) : leftLine
      rightLine = match ? Number(match[3]) : rightLine
      continue
    }
    if (!current) continue
    const file = current as HarnessDiffFile
    if (line.startsWith('+')) {
      file.rows.push({ kind: 'add', rightNumber: rightLine++, left: '', right: line.slice(1) })
      continue
    }
    if (line.startsWith('-')) {
      file.rows.push({ kind: 'delete', leftNumber: leftLine++, left: line.slice(1), right: '' })
      continue
    }
    file.rows.push({ kind: 'context', leftNumber: leftLine++, rightNumber: rightLine++, left: line.startsWith(' ') ? line.slice(1) : line, right: line.startsWith(' ') ? line.slice(1) : line })
  }

  return files
}

/** live tail 누적: 마지막 `max`줄만 유지. 줄 중간에서 끊긴 chunk는 직전 마지막 줄에 이어 붙는다. */
export function appendTailLines(prev: string[], chunk: string, max = 10): string[] {
  const joined = (prev.length ? prev.join('\n') : '') + chunk
  return joined.split(/\r?\n/).slice(-max)
}

export function buildTaskStepStatus(current: KhState, step: KhState): 'done' | 'current' | 'upcoming' | 'blocked' {
  const currentIdx = stateIndex(current)
  const stepIdx = stateIndex(step)
  if (current === 'FAILED') return stepIdx <= currentIdx ? 'done' : 'blocked'
  if (current === 'MERGED') return stepIdx <= currentIdx ? 'done' : 'upcoming'
  if (stepIdx < currentIdx) return 'done'
  if (stepIdx === currentIdx) return 'current'
  return 'upcoming'
}

export function runCompletionLabel(state: KhState): string {
  switch (state) {
    case 'MERGED': return 'Merged'
    case 'FAILED': return 'Failed'
    case 'HUMAN_REVIEW_REQUIRED': return 'Needs review'
    default: return state.replace(/_/g, ' ')
  }
}

function cryptoRandomId(): string {
  return `id-${Math.random().toString(36).slice(2, 9)}`
}

/** 이어하기(Resume) 버튼을 보여줄 상태: 실패했거나 파이프라인 중간에서 멈춘 run.
 *  allowlist로 두어 미래에 종료 상태가 추가돼도 Resume이 잘못 노출되지 않는다(닫힘으로 실패). */
export function isRunResumable(state: KhState): boolean {
  return state === 'CREATED' || state === 'FAILED'
    || state === 'PROJECT_SCANNED' || state === 'SOURCES_EXTRACTED'
    || state === 'DOCUMENTS_CLASSIFIED' || state === 'NODE_PROPOSALS_CREATED'
    || state === 'LEAD_MERGED' || state === 'WRITE_PLAN_CREATED'
    || state === 'STAGING_WRITTEN' || state === 'VALIDATED'
}

export function runModeLabel(mode: HarnessRunMode | undefined): string {
  if (mode === 'full-docs') return '전체 문서'
  if (mode === 'recent-sessions') return '최근 세션'
  return ''
}

/** 구조도(=설정 패널)의 단계 정의. promptKey가 있으면 카드 클릭 시 그 프롬프트를 편집한다. */
export type StructureStageId =
  | 'materialize' | 'projectDiscovery' | 'conversationHistory' | 'documentIntent'
  | 'knowledgeNodeExtractor' | 'wikiGraphLead' | 'policyGuard' | 'humanReview'

export type StructureStage = {
  id: StructureStageId
  kind: 'builtin' | 'agent' | 'gate' | 'review'
  icon: string
  name: string
  desc: string
  promptKey?: HarnessAgentPromptKey
}

export const STRUCTURE_STAGES: StructureStage[] = [
  { id: 'materialize', kind: 'builtin', icon: '📥', name: '수집 (materialize)', desc: '프로젝트 md + 최근 세션 Q&A 수집' },
  { id: 'projectDiscovery', kind: 'agent', icon: '🔍', name: 'project-discovery', desc: 'canonical 문서 식별, vault 지도 요약', promptKey: 'projectDiscovery' },
  { id: 'conversationHistory', kind: 'agent', icon: '💬', name: 'conversation-history', desc: '세션에서 결정·파일·미해결 문제 추출', promptKey: 'conversationHistory' },
  { id: 'documentIntent', kind: 'agent', icon: '🏷', name: 'document-intent', desc: 'md를 canonical/reference/scratch로 분류', promptKey: 'documentIntent' },
  { id: 'knowledgeNodeExtractor', kind: 'agent', icon: '🧩', name: 'node-extractor', desc: '노드 제안·주장·근거 추출', promptKey: 'knowledgeNodeExtractor' },
  { id: 'wikiGraphLead', kind: 'agent', icon: '🕸', name: 'wiki-graph-lead', desc: '제안 병합 → 그래프 + 쓰기 계획', promptKey: 'wikiGraphLead' },
  { id: 'policyGuard', kind: 'gate', icon: '🛡', name: 'policy-guard', desc: '스캔·증거·canonical 인간리뷰 게이트' },
  { id: 'humanReview', kind: 'review', icon: '👤', name: '인간 리뷰 → Promote', desc: 'staging에만 자동 쓰기, 실 vault는 promote로만' },
]

export type GraphNodeRef = { id: string; label?: string; data?: unknown }

function artifactMatchesTarget(artifact: HarnessRunArtifact, target: string): boolean {
  const normalized = target.trim().toLowerCase()
  return artifact.path.toLowerCase().includes(normalized)
    || artifact.name.toLowerCase() === normalized
    || artifact.path.toLowerCase().endsWith(`/${normalized}`)
}

/** 그래프 노드를 run 아티팩트로 해석: data.path 정확일치 → endsWith → basename → id-target → label/stem.
 *  viewable(markdown/report) 아티팩트를 우선하고, 없으면 전체에서 찾는다. 못 찾으면 undefined —
 *  호출측은 fs:readDoc 폴백을 시도한다. */
export function pickNodeArtifact(arts: HarnessRunArtifact[], node: GraphNodeRef): HarnessRunArtifact | undefined {
  const viewable = arts.filter((a) => isMarkdownArtifact(a) || a.name === 'git-diff-report' || a.name === 'eval-report' || a.name === 'final-policy-report')
  const nodePath = (node.data as { path?: string } | undefined)?.path
  const base = (p: string) => p.split(/[\\/]/).pop() ?? p
  const idTarget = node.id.replace(/^(artifact|file|task|evidence|run|document):/, '')
  const label = (node.label ?? '').toLowerCase()
  const pick = (pool: HarnessRunArtifact[]): HarnessRunArtifact | undefined => {
    if (nodePath) {
      const np = nodePath.toLowerCase()
      const hit = pool.find((a) => a.path === nodePath)
        ?? pool.find((a) => a.path.toLowerCase().endsWith(np) || a.path.toLowerCase().endsWith(`/${np}`))
        ?? pool.find((a) => base(a.path).toLowerCase() === base(nodePath).toLowerCase())
      if (hit) return hit
    }
    return (idTarget ? pool.find((a) => artifactMatchesTarget(a, idTarget)) : undefined)
      ?? (label ? pool.find((a) => artifactLabel(a.name).toLowerCase() === label || base(a.path).replace(/\.md$/i, '').toLowerCase() === label) : undefined)
  }
  return pick(viewable) ?? pick(arts)
}

/** 진행 상태(KhState) → 구조도 단계. 실행 중 현재 단계 하이라이트와 본문 스테퍼가 같은 매핑을 쓴다. */
export function stageForState(state: KhState): StructureStageId {
  switch (state) {
    case 'PROJECT_SCANNED': return 'projectDiscovery'
    case 'SOURCES_EXTRACTED': return 'conversationHistory'
    case 'DOCUMENTS_CLASSIFIED': return 'documentIntent'
    case 'NODE_PROPOSALS_CREATED': return 'knowledgeNodeExtractor'
    case 'LEAD_MERGED':
    case 'WRITE_PLAN_CREATED': return 'wikiGraphLead'
    case 'STAGING_WRITTEN':
    case 'VALIDATED': return 'policyGuard'
    case 'HUMAN_REVIEW_REQUIRED':
    case 'MERGED': return 'humanReview'
    case 'CREATED':
    case 'FAILED':
    default: return 'materialize'
  }
}
