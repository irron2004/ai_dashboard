import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { KhProjectPolicyProposalSchema, type KhProjectPolicyProposal } from '@apc/shared'
import { resolveInside } from './vault-fs.js'

export type WikiPolicyStatus = 'proposed' | 'approved'

/** On-disk machine state (wiki-policy.json). The human-reviewed body lives in wiki-policy.md. */
type PolicyState = {
  status: WikiPolicyStatus
  proposal: KhProjectPolicyProposal
  generatedAt: string
  approvedAt?: string
}

export type WikiPolicyRecord = PolicyState & { body: string }

/** <vaultRoot>/projects/<projectId>/ — resolveInside guards against projectId path-escape. */
function policyDir(vaultRoot: string, projectId: string): string {
  return resolveInside(vaultRoot, join('projects', projectId))
}
export function policyMarkdownPath(vaultRoot: string, projectId: string): string {
  return join(policyDir(vaultRoot, projectId), 'wiki-policy.md')
}
function policyJsonPath(vaultRoot: string, projectId: string): string {
  return join(policyDir(vaultRoot, projectId), 'wiki-policy.json')
}

/** Render the advisor proposal into a single markdown "## Project Tailoring" section.
 * Deterministic; contains ONLY tailoring — never any governance rule. */
export function renderTailoring(p: KhProjectPolicyProposal): string {
  const lines: string[] = ['## Project Tailoring (advisor)', '']
  if (p.project_character) lines.push(`**Project character:** ${p.project_character}`, '')
  if (p.node_type_priorities.length) {
    lines.push('### Node-type priorities')
    for (const n of p.node_type_priorities) lines.push(`- **${n.node_type}** — ${n.rationale}`)
    lines.push('')
  }
  if (p.canonical_definition) lines.push('### Canonical for this project', p.canonical_definition, '')
  if (p.scan_scope_notes) lines.push('### Scan scope', p.scan_scope_notes, '')
  if (p.tailoring_markdown) lines.push(p.tailoring_markdown, '')
  return lines.join('\n').trimEnd() + '\n'
}

function writeState(vaultRoot: string, projectId: string, state: PolicyState, body: string): void {
  mkdirSync(policyDir(vaultRoot, projectId), { recursive: true })
  writeFileSync(policyMarkdownPath(vaultRoot, projectId), body)
  writeFileSync(policyJsonPath(vaultRoot, projectId), JSON.stringify(state, null, 2))
}

/** Returns null when absent OR unreadable/corrupt — callers must treat that as "no policy". */
export function readPolicy(vaultRoot: string, projectId: string): WikiPolicyRecord | null {
  try {
    const jsonPath = policyJsonPath(vaultRoot, projectId)
    if (!existsSync(jsonPath)) return null
    const raw = JSON.parse(readFileSync(jsonPath, 'utf8')) as Partial<PolicyState>
    if (raw.status !== 'proposed' && raw.status !== 'approved') return null
    const proposal = KhProjectPolicyProposalSchema.parse(raw.proposal)
    const mdPath = policyMarkdownPath(vaultRoot, projectId)
    const body = existsSync(mdPath) ? readFileSync(mdPath, 'utf8') : ''
    return { status: raw.status, proposal, generatedAt: raw.generatedAt ?? '', approvedAt: raw.approvedAt, body }
  } catch {
    return null
  }
}

export function writeProposedPolicy(
  vaultRoot: string, projectId: string, proposal: KhProjectPolicyProposal, now: () => string,
): WikiPolicyRecord {
  const body = renderTailoring(proposal)
  const state: PolicyState = { status: 'proposed', proposal, generatedAt: now() }
  writeState(vaultRoot, projectId, state, body)
  return { ...state, body }
}

export function approvePolicy(vaultRoot: string, projectId: string, now: () => string): WikiPolicyRecord {
  const rec = readPolicy(vaultRoot, projectId)
  if (!rec) throw new Error(`no proposed policy to approve for project ${projectId}`)
  const state: PolicyState = { status: 'approved', proposal: rec.proposal, generatedAt: rec.generatedAt, approvedAt: now() }
  writeState(vaultRoot, projectId, state, rec.body)
  return { ...state, body: rec.body }
}

export function revertPolicy(vaultRoot: string, projectId: string): void {
  rmSync(policyMarkdownPath(vaultRoot, projectId), { force: true })
  rmSync(policyJsonPath(vaultRoot, projectId), { force: true })
}

/** Effective preamble for a run: DEFAULT_PREAMBLE (always fresh) + approved tailoring body.
 * Any non-approved/absent/corrupt state falls back to base — a run is NEVER blocked on a bad policy. */
export function resolveProjectPreamble(vaultRoot: string, projectId: string, base: string): string {
  const rec = readPolicy(vaultRoot, projectId)
  if (!rec || rec.status !== 'approved') return base
  return `${base}\n\n${rec.body}`
}
