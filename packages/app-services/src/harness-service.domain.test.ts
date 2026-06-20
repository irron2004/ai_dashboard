import { describe, expect, test } from 'vitest'
import { resolveDomainPack } from './harness-service.js'

describe('resolveDomainPack', () => {
  test('paper project resolves the paper pack', () => {
    expect(resolveDomainPack('paper').id).toBe('paper')
  })
  test('undefined domain resolves project-docs', () => {
    expect(resolveDomainPack(undefined).id).toBe('project-docs')
  })
})
