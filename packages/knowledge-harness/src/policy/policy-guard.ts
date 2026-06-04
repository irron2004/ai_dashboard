import { KhPolicyReportSchema, type KhNodeProposal, type KhWritePlan, type KhPolicyReport } from '@apc/shared'
import { SecretScanner } from './secret-scanner.js'
import { isCanonical, isRaw } from '../runtime/vault-fs.js'

type Violation = KhPolicyReport['violations'][number]

/**
 * Deterministic policy gate (design §7.1). Runs after proposals are created and before the Lead
 * merges. It NEVER relies on LLM judgment — every rule is a testable predicate. A `block` violation
 * means the run must halt; `warn` means human review is required but the run may proceed.
 */
export class PolicyGuard {
  readonly name = 'policy-guard'
  constructor(private readonly secrets = new SecretScanner()) {}

  check(proposals: KhNodeProposal[], writePlan?: KhWritePlan): KhPolicyReport {
    const violations: Violation[] = []
    const blocked = new Set<string>()
    const block = (proposal_id: string, rule: string, detail: string) => {
      violations.push({ proposal_id, rule, severity: 'block', detail })
      if (proposal_id) blocked.add(proposal_id)
    }
    const warn = (proposal_id: string, rule: string, detail: string) =>
      violations.push({ proposal_id, rule, severity: 'warn', detail })

    for (const p of proposals) {
      // evidence required
      if (p.evidence.length === 0 || p.claims.length === 0) {
        block(p.proposal_id, 'no_evidence', 'proposal has no evidence or no claims')
      }
      // shared promotion needs >= 2 evidence — applies to ANY non-project scope (shared_candidate AND
      // shared), so a self-declared 'shared' can't bypass the floor (#28).
      if (p.node.scope !== 'project' && p.evidence.length < 2) {
        block(p.proposal_id, 'shared_evidence_min', `${p.node.scope} requires >= 2 evidence`)
      }
      // secrets in evidence text
      for (const ev of p.evidence) {
        const hits = this.secrets.scan(ev.quote_or_summary, ev.source_path)
        if (hits.length) warn(p.proposal_id, 'secret', `secret-like content in evidence ${ev.evidence_id}: ${hits.map(h => h.rule).join(',')}`)
      }
    }

    for (const op of writePlan?.operations ?? []) {
      const pid = op.source_proposal ?? ''
      if (isRaw(op.path)) block(pid, 'raw_write', `write targets immutable raw path: ${op.path}`)
      if (/delete/i.test(op.op)) block(pid, 'delete', `delete operation forbidden: ${op.path}`)
      if (isCanonical(op.path) && op.mode !== 'proposal_only') {
        warn(pid, 'canonical_overwrite', `canonical doc must be proposal_only: ${op.path}`)
      }
      // Only create_file / append_section actually author a file body. Constrain them to markdown (#24)
      // and refuse to author secret-bearing content into the staging vault (#21) — the latter is a BLOCK,
      // not the warn we use for secrets merely quoted in evidence, because here it would be written out.
      if (op.op === 'create_file' || op.op === 'append_section') {
        if (!/\.md$/i.test(op.path)) block(pid, 'non_markdown_write', `write op must target a .md file: ${op.path}`)
        const body = op.content ?? op.content_template ?? ''
        const hits = this.secrets.scan(body, op.path)
        if (hits.length) block(pid, 'secret_in_write', `secret-like content in write op for ${op.path}: ${hits.map(h => h.rule).join(',')}`)
      }
    }

    const hasBlock = violations.some(v => v.severity === 'block')
    return KhPolicyReportSchema.parse({
      ok: !hasBlock,
      blocked_proposal_ids: [...blocked],
      violations,
    })
  }
}
