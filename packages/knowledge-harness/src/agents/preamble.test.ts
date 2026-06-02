import { describe, expect, test } from 'vitest'
import { loadPreamble } from './preamble.js'

describe('preamble', () => {
  test('loads the shipped harness-rules.md and includes the Immutable Sources rule', () => {
    const p = loadPreamble()
    expect(p).toContain('Immutable Sources')
    expect(p).toContain('raw/')
  })
})
