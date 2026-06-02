import { describe, expect, test } from 'vitest'
import { HARNESS_VERSION } from './index.js'

describe('knowledge-harness package', () => {
  test('exposes a version constant', () => {
    expect(HARNESS_VERSION).toBe('0.0.0')
  })
})
