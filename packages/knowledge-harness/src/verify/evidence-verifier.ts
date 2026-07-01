import { statSync, readFileSync } from 'node:fs'
import {
  KhEvidenceVerificationReportSchema,
  type KhNodeProposal, type KhEvidenceVerificationReport,
} from '@apc/shared'
import { resolveInside, isRaw } from '../runtime/vault-fs.js'

type Finding = KhEvidenceVerificationReport['unverifiable'][number]

/** Collapse whitespace + lowercase so a quote matches regardless of re-wrapping / case drift. */
const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * A2 (Step-5 spec): the deterministic backstop the "evidence-based" claim needs. For each proposal's each
 * declared evidence, confirm `source_path` resolves to a real file under the immutable raw/ tree, and (if a
 * quote is given) that a normalized substring of it is present in that file. Evidence that cannot be located
 * is reported as unverifiable; the driver treats `!ok` as a blocking violation (run FAILED), exactly like
 * PolicyGuard's no-evidence rule. Inference-only claims carry no evidence entry, so they are unaffected.
 */
export class EvidenceVerifier {
  readonly name = 'evidence-verifier'

  verify(proposals: KhNodeProposal[], vaultRoot: string): KhEvidenceVerificationReport {
    const unverifiable: Finding[] = []   // BLOCKING: the source itself is invalid (fabricated path)
    const warnings: Finding[] = []       // NON-BLOCKING: source is real but the quote doesn't match verbatim
    for (const p of proposals) {
      for (const ev of p.evidence) {
        const base = { proposal_id: p.proposal_id, evidence_id: ev.evidence_id, source_path: ev.source_path }
        let abs: string
        try {
          abs = resolveInside(vaultRoot, ev.source_path)
        } catch {
          unverifiable.push({ ...base, reason: 'path_escape' }); continue
        }
        // Evidence must cite an immutable raw source that's a real FILE — that's the hard guarantee.
        // statSync(...isFile()) (not existsSync) because existsSync is true for a directory too: a worker
        // that cites a folder path (e.g. raw/project-docs/0/docs) would otherwise fall through to the
        // readFileSync below and throw "EISDIR: illegal operation on a directory, read", killing the run.
        const st = statSync(abs, { throwIfNoEntry: false })
        if (!isRaw(ev.source_path) || !st?.isFile()) {
          unverifiable.push({ ...base, reason: 'source_not_found' }); continue
        }
        // The source is real. The quote is best-effort: `quote_or_summary` explicitly allows a SUMMARY,
        // and LLMs paraphrase, so a non-verbatim match is a WARNING (for human review), not a run-killer.
        if (ev.quote_or_summary && !normalize(readFileSync(abs, 'utf8')).includes(normalize(ev.quote_or_summary))) {
          warnings.push({ ...base, reason: 'quote_not_found' })
        }
      }
    }
    return KhEvidenceVerificationReportSchema.parse({ ok: unverifiable.length === 0, unverifiable, warnings })
  }
}
