import { describe, expect, test } from 'vitest'
import { PIPELINE, canTransition, assertTransition, stepFor } from './run-state-machine.js'

describe('run-state-machine', () => {
  test('pipeline is the 9-step happy path ending at HUMAN_REVIEW_REQUIRED', () => {
    expect(PIPELINE.map(s => s.to)).toEqual([
      'PROJECT_SCANNED', 'SOURCES_EXTRACTED', 'DOCUMENTS_CLASSIFIED', 'NODE_PROPOSALS_CREATED',
      'LEAD_MERGED', 'WRITE_PLAN_CREATED', 'STAGING_WRITTEN', 'VALIDATED', 'HUMAN_REVIEW_REQUIRED',
    ])
  })

  test('forward steps along the pipeline are legal; skips are not', () => {
    expect(canTransition('CREATED', 'PROJECT_SCANNED')).toBe(true)
    expect(canTransition('NODE_PROPOSALS_CREATED', 'LEAD_MERGED')).toBe(true)
    expect(canTransition('CREATED', 'LEAD_MERGED')).toBe(false)
    expect(canTransition('SOURCES_EXTRACTED', 'CREATED')).toBe(false)
  })

  test('any state may fail, and human review may merge', () => {
    expect(canTransition('STAGING_WRITTEN', 'FAILED')).toBe(true)
    expect(canTransition('HUMAN_REVIEW_REQUIRED', 'MERGED')).toBe(true)
    expect(canTransition('CREATED', 'MERGED')).toBe(false)
  })

  test('assertTransition throws on illegal transition', () => {
    expect(() => assertTransition('CREATED', 'LEAD_MERGED')).toThrow(/illegal transition/)
  })

  test('stepFor returns the gate attached to a target state', () => {
    expect(stepFor('SOURCES_EXTRACTED')?.gate).toBe('enable_conversation_history_reader')
    expect(stepFor('PROJECT_SCANNED')?.gate).toBeUndefined()
  })
})
