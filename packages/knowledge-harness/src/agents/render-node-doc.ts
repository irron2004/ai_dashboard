import type { KhNodeProposal, KhGraphEdgeOp } from '@apc/shared'

/** Korean labels for edge relation kinds, used in the rendered "관련 노드" section. */
const EDGE_LABEL: Record<string, string> = {
  relates_to: '관련', depends_on: '의존', supersedes: '대체', part_of: '구성',
  contradicts: '상충', derived_from: '파생', evidence_for: '근거',
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * Render a knowledge node into a real, navigable wiki document — deterministically from the proposal's
 * structured data (NOT authored by the LLM, which only writes terse stubs). Produces YAML frontmatter
 * (node_id/type/scope/tags so it's an addressable graph node), an H1, the summary, an optional LLM-supplied
 * narrative paragraph, the claims, [[node-id]] wikilinks to related nodes (from the graph edges), and the
 * evidence citations. This is what makes the output usable as an Obsidian/LLM-style wiki.
 */
export function renderNodeDoc(
  p: KhNodeProposal,
  opts: { narrative?: string; outgoing?: KhGraphEdgeOp[] } = {},
): string {
  const node = p.node
  const fm: string[] = [
    '---',
    `node_id: ${node.id}`,
    `node_type: ${node.type}`,
    `scope: ${node.scope ?? 'project'}`,
  ]
  if (node.project_ids?.length) fm.push(`project_ids: [${node.project_ids.join(', ')}]`)
  if (node.tags?.length) fm.push(`tags: [${node.tags.join(', ')}]`)
  fm.push(`source_proposals: [${p.proposal_id}]`)
  if (p.review?.requires_human_review) fm.push('review_required: true')
  fm.push('---')

  const lines: string[] = [fm.join('\n'), '', `# ${node.title}`, '']
  if (node.summary) lines.push(oneLine(node.summary), '')
  if (opts.narrative) lines.push(oneLine(opts.narrative), '')

  if (p.claims?.length) {
    lines.push('## 핵심 주장', '')
    for (const c of p.claims) {
      const meta = [c.claim_type, c.confidence ? `확신 ${c.confidence}` : '', c.inference ? '추론' : '']
        .filter(Boolean).join(' · ')
      lines.push(`- ${oneLine(c.text)}${meta ? ` _(${meta})_` : ''}`)
    }
    lines.push('')
  }

  const out = (opts.outgoing ?? []).filter((e) => e.to_node_id && e.to_node_id !== node.id)
  if (out.length) {
    lines.push('## 관련 노드', '')
    for (const e of out) {
      const label = EDGE_LABEL[e.type] ?? e.type
      lines.push(`- ${label}: [[${e.to_node_id}]]${e.note ? ` — ${oneLine(e.note)}` : ''}`)
    }
    lines.push('')
  }

  if (p.evidence?.length) {
    lines.push('## 근거', '')
    for (const ev of p.evidence) {
      lines.push(`- \`${ev.source_path}\``)
      if (ev.quote_or_summary) lines.push(`  > ${oneLine(ev.quote_or_summary)}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
