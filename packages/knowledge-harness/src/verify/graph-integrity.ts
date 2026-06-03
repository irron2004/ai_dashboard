import { readFileSync } from 'node:fs'
import { relative, basename } from 'node:path'
import { KhGraphValidationReportSchema, type KhGraphValidationReport } from '@apc/shared'
import { listMarkdown } from '../runtime/vault-fs.js'

type Doc = { path: string; stem: string; nodeId: string; links: string[] }

function frontmatterNodeId(text: string): string {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return ''
  const id = m[1].match(/^\s*node_id:\s*(.+?)\s*$/m)
  return id ? id[1].trim() : ''
}

function wikiLinks(text: string): string[] {
  const links: string[] = []
  for (const m of text.matchAll(/\[\[([^\]]+)\]\]/g)) links.push(m[1].split('|')[0].trim())
  return links
}

/**
 * Deterministic graph integrity over a vault directory (design §7.3). A doc's identity is its
 * `node_id` (frontmatter) if present, else its filename stem. Links `[[X]]` resolve to a doc whose
 * stem OR node_id is X. Every check is exact and fixture-testable — no LLM.
 *
 * Two classes of finding (Step-2 spec):
 *  - HARD-FAIL (sets ok=false): broken_links, duplicate_node_ids, node_id_mismatches — genuine corruption.
 *  - ADVISORY (reported, ok unaffected): orphan_nodes, missing_backlinks — graph-completeness signals that
 *    are EXPECTED mid-write (a freshly-authored, not-yet-linked node is legitimately an orphan). Gating on
 *    them would block every run.
 *
 * `node_id_mismatches` is a CROSS-ARTIFACT check: a doc whose frontmatter node_id is absent from the graph
 * update plan's node ids (`opts.graphNodeIds`). With no plan ids the check is skipped — NOT the old (wrong)
 * "node_id !== filename stem" comparison, which false-positived on every titled Obsidian doc.
 */
export class GraphIntegrity {
  readonly name = 'graph-integrity'

  validate(vaultDir: string, opts: { graphNodeIds?: string[] } = {}): KhGraphValidationReport {
    const docs: Doc[] = listMarkdown(vaultDir).map(abs => {
      const text = readFileSync(abs, 'utf8')
      return {
        path: relative(vaultDir, abs),
        stem: basename(abs, '.md'),
        nodeId: frontmatterNodeId(text),
        links: wikiLinks(text),
      }
    })

    const idOf = (d: Doc) => d.nodeId || d.stem
    const byKey = new Map<string, Doc[]>()
    for (const d of docs) for (const k of new Set([d.stem, d.nodeId].filter(Boolean))) {
      byKey.set(k, [...(byKey.get(k) ?? []), d])
    }
    const resolves = (target: string) => byKey.has(target)

    // duplicate node_ids
    const byNodeId = new Map<string, string[]>()
    for (const d of docs) if (d.nodeId) byNodeId.set(d.nodeId, [...(byNodeId.get(d.nodeId) ?? []), d.path])
    const duplicate_node_ids = [...byNodeId.entries()].filter(([, p]) => p.length > 1).map(([node_id, paths]) => ({ node_id, paths }))

    // node_id ↔ graph-plan mismatch: a doc declaring a node_id the graph plan doesn't know about.
    // Skipped when no plan ids are supplied (can't validate against nothing) — never compares to the stem.
    const planIds = new Set(opts.graphNodeIds ?? [])
    const node_id_mismatches = planIds.size === 0 ? []
      : docs.filter(d => d.nodeId && !planIds.has(d.nodeId)).map(d => ({ path: d.path, node_id: d.nodeId }))

    // broken links + collect resolved edges
    const broken_links: { from: string; to: string }[] = []
    const edges: { from: Doc; to: Doc }[] = []
    for (const d of docs) for (const l of d.links) {
      if (!resolves(l)) { broken_links.push({ from: d.path, to: l }); continue }
      const target = byKey.get(l)![0]
      edges.push({ from: d, to: target })
    }

    // orphan nodes (ADVISORY): a doc with no inbound resolved link. Self-links (#39) don't count as inbound.
    const hasInbound = new Set(edges.filter(e => idOf(e.from) !== idOf(e.to)).map(e => idOf(e.to)))
    const orphan_nodes = docs.filter(d => !hasInbound.has(idOf(d))).map(d => d.path)

    // missing backlinks: A→B exists but B→A does not
    const edgeKey = (from: Doc, to: Doc) => `${idOf(from)}->${idOf(to)}`
    const edgeSet = new Set(edges.map(e => edgeKey(e.from, e.to)))
    const missing_backlinks: { from: string; to: string }[] = []
    for (const e of edges) {
      if (!edgeSet.has(edgeKey(e.to, e.from))) missing_backlinks.push({ from: e.from.path, to: e.to.path })
    }

    // ok reflects HARD-FAIL findings only; orphan_nodes + missing_backlinks are advisory (reported, not gating).
    const ok = !broken_links.length && !duplicate_node_ids.length && !node_id_mismatches.length
    return KhGraphValidationReportSchema.parse({
      ok, broken_links, duplicate_node_ids, orphan_nodes, node_id_mismatches, missing_backlinks,
    })
  }
}
