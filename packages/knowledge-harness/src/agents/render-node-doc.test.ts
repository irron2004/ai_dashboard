import { describe, expect, test } from 'vitest'
import { renderNodeDoc } from './render-node-doc.js'
import type { KhNodeProposal, KhGraphEdgeOp } from '@apc/shared'

const proposal = (): KhNodeProposal => ({
  proposal_id: 'np-1', proposed_by: 'extractor', created_at: 't',
  node: { id: 'attention-collapse', type: 'ConceptNode', scope: 'project', title: 'Attention collapse', summary: 'Temperature scaling avoids attention collapse.', project_ids: ['p1'], tags: ['attention'] },
  claims: [{ claim_id: 'c1', text: 'Higher temperature prevents collapse.', claim_type: 'finding', confidence: 'high', inference: false, evidence_ids: ['e1'] }],
  evidence: [{ evidence_id: 'e1', source_id: 's', source_path: 'raw/conversations/x.txt', evidence_type: 'd', quote_or_summary: 'we set T=4 and collapse stopped' }],
  review: { requires_human_review: true, reviewer_question: '' },
} as unknown as KhNodeProposal)

const edge = (to: string, type: string): KhGraphEdgeOp => ({ op: 'create', from_node_id: 'attention-collapse', to_node_id: to, type, note: '' } as KhGraphEdgeOp)

describe('renderNodeDoc', () => {
  test('renders frontmatter, title, summary, claims, related links, and evidence', () => {
    const md = renderNodeDoc(proposal(), { narrative: 'Sits upstream of the loss-fix node.', outgoing: [edge('deep-autoencoder-loss-fix', 'depends_on')] })
    expect(md).toContain('node_id: attention-collapse')
    expect(md).toContain('node_type: ConceptNode')
    expect(md).toContain('tags: [attention]')
    expect(md).toContain('review_required: true')
    expect(md).toContain('# Attention collapse')
    expect(md).toContain('Temperature scaling avoids attention collapse.')
    expect(md).toContain('Sits upstream of the loss-fix node.') // LLM narrative woven in
    expect(md).toContain('## 핵심 주장')
    expect(md).toContain('- Higher temperature prevents collapse. _(finding · 확신 high)_')
    expect(md).toContain('## 관련 노드')
    expect(md).toContain('의존: [[deep-autoencoder-loss-fix]]') // wikilink → navigable
    expect(md).toContain('## 근거')
    expect(md).toContain('`raw/conversations/x.txt`')
    expect(md).toContain('> we set T=4 and collapse stopped')
  })

  test('omits empty sections and self-links', () => {
    const p = proposal(); p.claims = []; p.evidence = []
    const md = renderNodeDoc(p, { outgoing: [edge('attention-collapse', 'relates_to')] }) // self-link filtered
    expect(md).not.toContain('## 핵심 주장')
    expect(md).not.toContain('## 근거')
    expect(md).not.toContain('## 관련 노드')
    expect(md).toContain('# Attention collapse')
  })
})
