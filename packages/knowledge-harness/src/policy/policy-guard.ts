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
      // shared promotion needs >= 2 evidence
      if (p.node.scope === 'shared_candidate' && p.evidence.length < 2) {
        block(p.proposal_id, 'shared_evidence_min', 'shared_candidate requires >= 2 evidence')
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
    }

    const hasBlock = violations.some(v => v.severity === 'block')
    return KhPolicyReportSchema.parse({
      ok: !hasBlock,
      blocked_proposal_ids: [...blocked],
      violations,
    })
  }
}
