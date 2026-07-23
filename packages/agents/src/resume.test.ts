// packages/agents/src/resume.test.ts
import { describe, test, expect } from 'vitest'
import { adapterFor, resumeCommand } from './resume.js'

describe('resumeCommand', () => {
  test('claude with sessionId → --resume <id>', () => {
    expect(resumeCommand('claude', { sessionId: 'abc' })).toEqual({ command: 'claude', args: ['--resume', 'abc'] })
  })
  test('claude without sessionId → --continue (latest)', () => {
    expect(resumeCommand('claude', {})).toEqual({ command: 'claude', args: ['--continue'] })
  })
  test('codex with sessionId → resume <id>', () => {
    expect(resumeCommand('codex', { sessionId: 'x' })).toEqual({ command: 'codex', args: ['resume', 'x'] })
  })
  test('codex without sessionId → resume --last', () => {
    expect(resumeCommand('codex', {})).toEqual({ command: 'codex', args: ['resume', '--last'] })
  })
  test('opencode with sessionId → --session <id>', () => {
    expect(resumeCommand('opencode', { sessionId: 's' })).toEqual({ command: 'opencode', args: ['--session', 's'] })
  })
  test('opencode without sessionId → --continue', () => {
    expect(resumeCommand('opencode', {})).toEqual({ command: 'opencode', args: ['--continue'] })
  })

  test('reuses default adapters so source discovery caches span project lookups', () => {
    expect(adapterFor('claude')).toBe(adapterFor('claude'))
    expect(adapterFor('codex')).toBe(adapterFor('codex'))
  })
})
