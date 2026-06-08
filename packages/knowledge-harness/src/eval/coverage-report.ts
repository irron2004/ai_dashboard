import { KhCoverageReportSchema, type KhCoverageReport, type KhNodeProposal } from '@apc/shared'

/**
 * Coverage = which raw source documents were reflected into wiki nodes. A source is `covered` iff at least
 * one node proposal cites it (via evidence.source_path); otherwise it is `unmapped` (omitted from the wiki).
 * Pure: takes the run's source path list and its node proposals. No filesystem, no LLM.
 */
export function buildCoverageReport(sourcePaths: string[], proposals: KhNodeProposal[]): KhCoverageReport {
  const nodes = proposals.map((p) => ({
    id: p.node.id,
    title: p.node.title,
    cites: Array.from(new Set(p.evidence.map((e) => e.source_path))),
  }))
  const citedBy = new Map<string, string[]>()
  for (const n of nodes) {
    for (const src of n.cites) {
      const arr = citedBy.get(src) ?? []
      arr.push(n.id)
      citedBy.set(src, arr)
    }
  }
  const sources = sourcePaths.map((path) => {
    const ids = citedBy.get(path) ?? []
    return { path, status: ids.length > 0 ? ('covered' as const) : ('unmapped' as const), citedBy: ids }
  })
  const covered = sources.filter((s) => s.status === 'covered').length
  return KhCoverageReportSchema.parse({
    sources,
    nodes,
    totals: { sourcesTotal: sources.length, covered, unmapped: sources.length - covered },
  })
}
