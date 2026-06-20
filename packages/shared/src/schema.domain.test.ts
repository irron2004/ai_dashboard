import { describe, expect, test } from 'vitest'
import { ProjectSchema } from './schema.js'

describe('ProjectSchema.domain', () => {
  test('defaults to project-docs when omitted', () => {
    const p = ProjectSchema.parse({ id: 'a', name: 'A', status: 'active', projectType: 'git' })
    expect(p.domain).toBe('project-docs')
  })
  test('accepts paper', () => {
    const p = ProjectSchema.parse({ id: 'a', name: 'A', status: 'active', projectType: 'git', domain: 'paper' })
    expect(p.domain).toBe('paper')
  })
  test('rejects an unknown domain', () => {
    expect(() => ProjectSchema.parse({ id: 'a', name: 'A', status: 'active', projectType: 'git', domain: 'nope' })).toThrow()
  })
})
