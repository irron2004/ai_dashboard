import type { KhNodeProposal } from '@apc/shared'
import type { SourceDoc } from './source-reader.js'

const RAW_PROJECT_DOC = /^raw\/project-docs\/\d+\/(.+)$/

/**
 * Rewrite each evidence's `source_path` to the materialized `raw/` copy of the document it cites.
 *
 * Why: the discovery/classifier agents reason over the project's ORIGINAL paths (a remote
 * `/home/user/repo/docs/x.md` for ssh projects, or a local absolute path), so the extractor cites
 * those — which resolve OUTSIDE the vault and get rejected by EvidenceVerifier (`path_escape`). But
 * materializeProjectDocs has copied each doc to `raw/project-docs/<i>/<rel>`. We match a cited path
 * to its raw/ copy by suffix (the cited path ends with the copy's repo-relative tail) and rewrite it,
 * so evidence points at the verifiable local source. Longest-tail wins to disambiguate same-named
 * files (e.g. several CLAUDE.md at different depths). Paths already under raw/ (conversation evidence)
 * and unmatched paths are left untouched — an unmatched path then fails verification honestly rather
 * than being silently "fixed".
 */
export function normalizeEvidencePaths(proposals: KhNodeProposal[], sources: SourceDoc[]): KhNodeProposal[] {
  const candidates = sources
    .map((s) => {
      const norm = s.source_path.replace(/\\/g, '/')
      const m = RAW_PROJECT_DOC.exec(norm)
      return { raw: norm, rel: m ? m[1] : norm }
    })
    .sort((a, b) => b.rel.length - a.rel.length) // longest (most specific) tail first

  const rewrite = (sourcePath: string): string => {
    const p = sourcePath.replace(/\\/g, '/')
    if (p.startsWith('raw/') || p.includes('/raw/')) return p // already a vault-relative raw source
    for (const c of candidates) {
      if (p === c.rel || p.endsWith(`/${c.rel}`)) return c.raw
    }
    return p
  }

  return proposals.map((pr) => ({
    ...pr,
    evidence: pr.evidence.map((ev) => ({ ...ev, source_path: rewrite(ev.source_path) })),
  }))
}
