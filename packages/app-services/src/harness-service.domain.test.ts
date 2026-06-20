import { describe, expect, test } from 'vitest'
import { resolveDomainPack, buildVenvSubstrate } from './harness-service.js'

describe('resolveDomainPack', () => {
  test('paper project resolves the paper pack', () => {
    expect(resolveDomainPack('paper').id).toBe('paper')
  })
  test('undefined domain resolves project-docs', () => {
    expect(resolveDomainPack(undefined).id).toBe('project-docs')
  })
})

describe('buildVenvSubstrate', () => {
  test('returns undefined when no core.lock venv is configured', () => {
    expect(buildVenvSubstrate('/no/such/repo')).toBeUndefined()
  })
})
