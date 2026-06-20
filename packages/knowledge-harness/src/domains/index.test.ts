import { describe, expect, test } from 'vitest'
import { domainPackFor } from './index.js'

describe('domainPackFor', () => {
  test('returns the project-docs pack with no contract dir', () => {
    const p = domainPackFor('project-docs')
    expect(p.id).toBe('project-docs')
    expect(p.contractDir).toBeUndefined()
  })
  test('returns the paper pack pointing at the paper contract', () => {
    const p = domainPackFor('paper')
    expect(p.id).toBe('paper')
    expect(p.contractDir).toMatch(/wiki-domains[\\/]paper[\\/]runtime$/)
  })
})
