import { describe, expect, test } from 'vitest'
import { isHumanQuestionText, isInternalMachinePrompt } from './human-question.js'

describe('human question filtering', () => {
  test('keeps ordinary user questions', () => {
    expect(isHumanQuestionText('stock 프로젝트 이어서 봐줘')).toBe(true)
    expect(isHumanQuestionText('   ')).toBe(false)
  })

  test('filters Knowledge Harness LlmAgent prompts', () => {
    const prompt = [
      '# Knowledge Harness Rules',
      '## Role: wiki-graph-lead',
      'You are the WikiGraphLead agent. Merge the NodeProposals into the existing graph.',
      '## Input',
      '```json',
      '{"proposals":[]}',
      '```',
      '## Output',
      'Respond with ONLY a single JSON object',
    ].join('\n\n')
    expect(isInternalMachinePrompt(prompt)).toBe(true)
    expect(isHumanQuestionText(prompt)).toBe(false)
  })

  test('filters internal summarizer and wiki-generation prompts', () => {
    const titler = [
      '## Role: session-titler',
      'You summarize an agent work session into a single concise task title.',
      '## Input',
      '```json',
      '{"requests":["real user request"]}',
      '```',
      '## Output',
      'Respond with ONLY a single JSON object',
    ].join('\n\n')
    const wiki = [
      'You are a PM assistant. Summarize an AI agent work session and propose project-memory updates.',
      'Respond with ONLY a single JSON object (no prose, no code fences) with exactly these keys:',
      '## Session transcript',
      '### user',
      'real user request',
    ].join('\n')
    expect(isHumanQuestionText(titler)).toBe(false)
    expect(isHumanQuestionText(wiki)).toBe(false)
  })

  test('filters Codex-injected environment and AGENTS context stored as user turns', () => {
    const environment = '<environment_context>\n  <cwd>C:\\work\\apc</cwd>\n  <shell>powershell</shell>\n</environment_context>'
    const agents = [
      '# AGENTS.md instructions for C:\\work\\apc',
      '<INSTRUCTIONS>\nUse pnpm.\n</INSTRUCTIONS>',
      environment,
    ].join('\n\n')

    expect(isInternalMachinePrompt(environment)).toBe(true)
    expect(isInternalMachinePrompt(agents)).toBe(true)
    expect(isHumanQuestionText(environment)).toBe(false)
    expect(isHumanQuestionText(agents)).toBe(false)
  })

  test('filters Codex goal continuation context stored as a user turn', () => {
    const goal = [
      '<codex_internal_context source="goal">',
      'Continue working toward the active thread goal. The objective is internal orchestration state.',
      '</codex_internal_context>',
    ].join('\n')

    expect(isInternalMachinePrompt(goal)).toBe(true)
    expect(isHumanQuestionText(goal)).toBe(false)
  })

  test('filters Codex turn-abort and transport error records stored as user turns', () => {
    const aborted = '<turn_aborted>\nThe user interrupted the previous turn on purpose.'
    const transportError = [
      'Error response',
      'Error code: 404',
      'Message: File not found.',
      'Error code explanation: 404 - Nothing matches the given URI.',
    ].join('\n')

    expect(isHumanQuestionText(aborted)).toBe(false)
    expect(isHumanQuestionText(transportError)).toBe(false)
  })
})
