import { describe, expect, test } from 'vitest'
import { buildEngineArgs, engineArgsShell } from './engine-options.js'

describe('buildEngineArgs', () => {
  test('no options → no flags', () => {
    expect(buildEngineArgs('codex')).toEqual([])
    expect(buildEngineArgs('claude', {})).toEqual([])
  })

  test('codex: model, reasoning effort (config override), sandbox, approval', () => {
    expect(buildEngineArgs('codex', {
      model: 'gpt-5.5', reasoningEffort: 'medium', sandbox: 'workspace-write', approval: 'never',
    })).toEqual([
      '--model', 'gpt-5.5',
      '-c', 'model_reasoning_effort="medium"',
      '--sandbox', 'workspace-write',
      '--ask-for-approval', 'never',
    ])
  })

  test('claude: model + permission-mode; reasoning/sandbox are ignored (not claude flags)', () => {
    expect(buildEngineArgs('claude', {
      model: 'claude-opus-4-8', permissionMode: 'acceptEdits',
      reasoningEffort: 'high', sandbox: 'read-only', approval: 'never',
    })).toEqual(['--model', 'claude-opus-4-8', '--permission-mode', 'acceptEdits'])
  })

  test('opencode: model only', () => {
    expect(buildEngineArgs('opencode', { model: 'anthropic/claude', sandbox: 'read-only' }))
      .toEqual(['--model', 'anthropic/claude'])
  })

  test('extraArgs are appended verbatim as an escape hatch', () => {
    expect(buildEngineArgs('codex', { model: 'gpt-5.5', extraArgs: ['--foo', 'bar'] }))
      .toEqual(['--model', 'gpt-5.5', '--foo', 'bar'])
  })
})

describe('engineArgsShell', () => {
  test('empty when no options', () => {
    expect(engineArgsShell('codex')).toBe('')
  })

  test('shell-quotes each arg (the config override keeps its inner quotes)', () => {
    expect(engineArgsShell('codex', { reasoningEffort: 'high', sandbox: 'workspace-write' }))
      .toBe(` '-c' 'model_reasoning_effort="high"' '--sandbox' 'workspace-write'`)
  })

  test("escapes embedded single quotes safely", () => {
    expect(engineArgsShell('codex', { extraArgs: ["it's"] })).toBe(` 'it'\\''s'`)
  })
})
