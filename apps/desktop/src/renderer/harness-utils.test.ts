import { describe, expect, test } from 'vitest'
import { appendTailLines, isRunResumable, runModeLabel, stageForState, STRUCTURE_STAGES } from './harness-utils.js'

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
