import { describe, expect, test } from 'vitest'
import { AgentProfileSchema } from './harness-schema.js'

describe('AgentProfileSchema', () => {
  test('parses a full profile', () => {
    const p = AgentProfileSchema.parse({
      id: 'opencode:build', provider: 'opencode', name: 'build', scope: 'project',
      mode: 'primary', model: 'openai/gpt-5.5', description: 'builder',
      permissions: { edit: 'allow', bash: 'ask' }, tools: ['edit', 'bash'],
      rawConfigPath: '/x/.opencode/opencode.json', rawFormat: 'json',
    })
    expect(p.permissions?.bash).toBe('ask')
  })
  test('requires provider/name/scope/rawConfigPath/rawFormat; defaults mode to custom', () => {
    const p = AgentProfileSchema.parse({
      id: 'x', provider: 'opencode', name: 'x', scope: 'global',
      rawConfigPath: '/x', rawFormat: 'markdown',
    })
    expect(p.mode).toBe('custom')
  })
  test('rejects an invalid permission value', () => {
    expect(() => AgentProfileSchema.parse({
      id: 'x', provider: 'opencode', name: 'x', scope: 'global',
      permissions: { edit: 'maybe' }, rawConfigPath: '/x', rawFormat: 'json',
    })).toThrow()
  })
})
