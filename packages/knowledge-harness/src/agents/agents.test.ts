import { describe, expect, test } from 'vitest'
import { FakeAgentRunner } from '@apc/llm-wiki'
import { makeProjectDiscovery, makeKnowledgeNodeExtractor } from './index.js'

describe('concrete agents', () => {
  test('ProjectDiscovery parses a ProjectDiscoveryReport', async () => {
    const runner = new FakeAgentRunner([JSON.stringify({ project_id: 'p1', generated_by: 'discovery', repos: [{ path: '/r' }] })])
    const out = await makeProjectDiscovery('PREAMBLE').run({ runner, engine: 'claude', input: { projectId: 'p1' } })
    expect(out.repos[0].path).toBe('/r')
  })

  test('KnowledgeNodeExtractor parses NodeProposal[]', async () => {
    const proposals = [{
      proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
      node: { id: 'n1', type: 'ConceptNode', title: 'T' },
      evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a.jsonl', evidence_type: 'decision' }],
      claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
    }]
    const runner = new FakeAgentRunner([JSON.stringify({ proposals })])
    const out = await makeKnowledgeNodeExtractor('PREAMBLE').run({ runner, engine: 'claude', input: {} })
    expect(out.proposals[0].node.id).toBe('n1')
  })
})
