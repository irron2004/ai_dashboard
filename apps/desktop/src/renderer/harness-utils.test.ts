import { describe, expect, test } from 'vitest'
import { appendTailLines, isRunResumable, runModeLabel, stageForState, STRUCTURE_STAGES, pickNodeArtifact, readFanoutSummary, buildHarnessGraphData, resolveStagedRel } from './harness-utils.js'
import type { HarnessRunArtifact, HarnessRunBundle } from './harness-utils.js'

const artifact = (name: string, data: unknown): HarnessRunArtifact => ({ state: 'NODE_PROPOSALS_CREATED', name, path: name, data })

describe('buildHarnessGraphData', () => {
  test('a proposal node carries its staging draft path so a click can open it', () => {
    const bundle = {
      runState: { runId: 'RUN-1', projectId: 'p1', engine: 'claude', state: 'HUMAN_REVIEW_REQUIRED', artifacts: {} },
      artifacts: [artifact('node-proposals', { proposals: [{
        proposal_id: 'np-1', node: { id: 'attention-collapse', title: 'Attention collapse', type: 'DecisionNode' }, claims: [], evidence: [],
      }] })],
      mode: 'full-docs',
    } as unknown as HarnessRunBundle
    const task = buildHarnessGraphData(bundle).nodes.find((n) => n.id === 'task:np-1')
    expect((task?.data as { path?: string } | undefined)?.path).toBe('nodes/attention-collapse.md')
  })

  test('graph-update-plan edge_ops connect the proposal nodes (node↔node relationships)', () => {
    const bundle = {
      runState: { runId: 'RUN-1', projectId: 'p1', engine: 'claude', state: 'HUMAN_REVIEW_REQUIRED', artifacts: {} },
      artifacts: [
        artifact('node-proposals', { proposals: [
          { proposal_id: 'np-1', node: { id: 'a', title: 'A', type: 'ConceptNode' }, claims: [], evidence: [] },
          { proposal_id: 'np-2', node: { id: 'b', title: 'B', type: 'DecisionNode' }, claims: [], evidence: [] },
        ] }),
        { state: 'LEAD_MERGED', name: 'graph-update-plan', path: 'graph-update-plan', data: {
          created_by: 'lead', node_ops: [], edge_ops: [{ op: 'create', from_node_id: 'a', to_node_id: 'b', type: 'depends_on' }],
        } },
      ],
      mode: 'full-docs',
    } as unknown as HarnessRunBundle
    const g = buildHarnessGraphData(bundle)
    const rel = g.links.find((l) => l.kind === 'rel')
    expect(rel).toMatchObject({ source: 'task:np-1', target: 'task:np-2', label: 'depends_on' })
  })
})

describe('readFanoutSummary', () => {
  test('null when neither folder-plan nor fanout-report is present (legacy single-shot)', () => {
    expect(readFanoutSummary([artifact('node-proposals', { proposals: [] })])).toBeNull()
  })

  test('summarizes folder units + fan-out run report', () => {
    const s = readFanoutSummary([
      artifact('folder-plan', { units: [{ label: 'paper-A', memberPaths: ['paper-A'], role: 'canonical' }, { label: 'misc (2 folders)', memberPaths: ['a', 'b'], role: 'reference' }] }),
      artifact('fanout-report', { units: 2, ran: 1, skipped: [{ unit: 'paper-A', reason: 'boom' }] }),
    ])
    expect(s).toEqual({
      units: 2, ran: 1,
      skipped: [{ unit: 'paper-A', reason: 'boom' }],
      folders: [{ label: 'paper-A', members: 'paper-A', role: 'canonical' }, { label: 'misc (2 folders)', members: 'a, b', role: 'reference' }],
    })
  })
})

describe('appendTailLines', () => {
  test('keeps only the last `max` lines', () => {
    expect(appendTailLines([], 'a\nb\nc\nd', 3)).toEqual(['b', 'c', 'd'])
  })
  test('merges a partial chunk into the previous last line', () => {
    const first = appendTailLines([], 'hel')
    expect(appendTailLines(first, 'lo\nworld')).toEqual(['hello', 'world'])
  })
  test('handles CRLF', () => {
    expect(appendTailLines([], 'a\r\nb')).toEqual(['a', 'b'])
  })
})

describe('run mode / resumable / stage helpers', () => {
  test('isRunResumable: FAILED and mid-pipeline states are resumable', () => {
    expect(isRunResumable('FAILED')).toBe(true)
    expect(isRunResumable('STAGING_WRITTEN')).toBe(true)
    expect(isRunResumable('CREATED')).toBe(true)
  })

  test('isRunResumable: review-ready and merged runs are not', () => {
    expect(isRunResumable('HUMAN_REVIEW_REQUIRED')).toBe(false)
    expect(isRunResumable('MERGED')).toBe(false)
  })

  test('runModeLabel maps mode to Korean label', () => {
    expect(runModeLabel('full-docs')).toBe('전체 문서')
    expect(runModeLabel('recent-sessions')).toBe('최근 세션')
    expect(runModeLabel(undefined)).toBe('')
  })

  test('stageForState maps every pipeline state to a structure stage', () => {
    expect(stageForState('PROJECT_SCANNED')).toBe('projectDiscovery')
    expect(stageForState('SOURCES_EXTRACTED')).toBe('conversationHistory')
    expect(stageForState('DOCUMENTS_CLASSIFIED')).toBe('documentIntent')
    expect(stageForState('NODE_PROPOSALS_CREATED')).toBe('knowledgeNodeExtractor')
    expect(stageForState('LEAD_MERGED')).toBe('wikiGraphLead')
    expect(stageForState('WRITE_PLAN_CREATED')).toBe('wikiGraphLead')
    expect(stageForState('STAGING_WRITTEN')).toBe('policyGuard')
    expect(stageForState('VALIDATED')).toBe('policyGuard')
    expect(stageForState('HUMAN_REVIEW_REQUIRED')).toBe('humanReview')
    expect(stageForState('MERGED')).toBe('humanReview')
    expect(stageForState('CREATED')).toBe('materialize')
    expect(stageForState('FAILED')).toBe('materialize')
  })

  test('STRUCTURE_STAGES is ordered and includes the gate row', () => {
    expect(STRUCTURE_STAGES.map((s) => s.id)).toEqual([
      'materialize', 'projectDiscovery', 'conversationHistory', 'documentIntent',
      'knowledgeNodeExtractor', 'wikiGraphLead', 'policyGuard', 'humanReview',
    ])
    expect(STRUCTURE_STAGES.find((s) => s.id === 'policyGuard')?.kind).toBe('gate')
  })
})

describe('pickNodeArtifact', () => {
  const arts: HarnessRunArtifact[] = [
    { state: 'STAGING_WRITTEN', name: 'wiki-architecture', path: '/runs/R1/staging/wiki/architecture.md', data: { markdown: '# arch' } },
    { state: 'VALIDATED', name: 'git-diff-report', path: '/runs/R1/git-diff.json', data: { patch: '' } },
  ]

  test('matches by exact node data.path', () => {
    const hit = pickNodeArtifact(arts, { id: 'file:x', data: { path: '/runs/R1/staging/wiki/architecture.md' } })
    expect(hit?.name).toBe('wiki-architecture')
  })

  test('matches by basename when paths differ', () => {
    const hit = pickNodeArtifact(arts, { id: 'doc:y', data: { path: 'vault/wiki/architecture.md' } })
    expect(hit?.name).toBe('wiki-architecture')
  })

  test('matches by label/file-stem', () => {
    const hit = pickNodeArtifact(arts, { id: 'document:architecture', label: 'architecture' })
    expect(hit?.name).toBe('wiki-architecture')
  })

  test('returns undefined when nothing matches', () => {
    expect(pickNodeArtifact(arts, { id: 'document:unknown', label: '없는문서' })).toBeUndefined()
  })

  test('prefers a viewable artifact over a non-viewable one when both match', () => {
    const artsWithRaw: HarnessRunArtifact[] = [
      { state: 'VALIDATED', name: 'raw-dump', path: '/runs/R1/architecture-raw.json', data: { raw: '{}' } },
      { state: 'STAGING_WRITTEN', name: 'wiki-architecture', path: '/runs/R1/architecture.md', data: { markdown: '# arch' } },
    ]
    // id-target 'architecture' substring-matches BOTH paths; viewable pool (the .md) must win.
    const hit = pickNodeArtifact(artsWithRaw, { id: 'document:architecture' })
    expect(hit?.name).toBe('wiki-architecture')
  })
})

describe('resolveStagedRel', () => {
  const entries = [
    { relPath: 'nodes/decision.real.md', nodeId: 'decision.real' },
    { relPath: 'nodes/concept_x.md', nodeId: 'concept.x' },
  ]

  test('task-style id + data.path=nodes/<node_id>.md resolves by path stem', () => {
    expect(resolveStagedRel({ id: 'task:prop-1', label: 'x', data: { path: 'nodes/decision.real.md' } }, entries))
      .toBe('nodes/decision.real.md')
  })

  test('node with no data.path resolves by node_id', () => {
    expect(resolveStagedRel({ id: 'decision.real', label: 'x' }, entries)).toBe('nodes/decision.real.md')
  })

  test('leading vault-staging/ prefix is stripped before matching', () => {
    expect(resolveStagedRel({ id: 'n', data: { path: 'vault-staging/nodes/concept_x.md' } }, entries))
      .toBe('nodes/concept_x.md')
  })

  test('a non-node project doc returns undefined so caller can use disk fallback', () => {
    expect(resolveStagedRel({ id: 'document:plan', data: { path: 'docs/plan.md' } }, entries)).toBeUndefined()
  })

  test('a proposal-json file node resolves to its rendered nodes/<id>.md (stem ignores extension)', () => {
    // A graph file-square for inbox/proposals/<id>.json must map to the staged nodes/<id>.md the lead
    // authored — same stem, different extension. Otherwise the node viewer shows "원문 없음".
    expect(resolveStagedRel(
      { id: 'file:inbox/proposals/decision.real.json', data: { path: 'inbox/proposals/decision.real.json' } },
      entries,
    )).toBe('nodes/decision.real.md')
  })
})
