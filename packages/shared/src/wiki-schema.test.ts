import { describe, expect, test } from 'vitest'
import { WikiGenerationSchema, NextTaskCandidateSchema } from './wiki-schema.js'

describe('WikiGenerationSchema', () => {
  test('parses a full generation payload', () => {
    const g = WikiGenerationSchema.parse({
      workSummary: 'Implemented the ingest adapters.',
      filesTouched: ['packages/agents/src/claude-adapter.ts'],
      openProblems: ['OpenCode tool-call parsing not done'],
      nextTasks: [{ title: 'Parse OpenCode tool calls', rationale: 'tool calls are dropped today' }],
      currentProposalMarkdown: '## Current\n- adapters done\n',
    })
    expect(g.nextTasks[0].title).toContain('OpenCode')
  })
  test('applies array defaults', () => {
    const g = WikiGenerationSchema.parse({ workSummary: 'x' })
    expect(g.filesTouched).toEqual([])
    expect(g.nextTasks).toEqual([])
  })
  test('NextTaskCandidate requires a title', () => {
    expect(() => NextTaskCandidateSchema.parse({ rationale: 'x' })).toThrow()
  })
})
