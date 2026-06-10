import { describe, expect, test } from 'vitest'
import { appendTailLines } from './harness-utils.js'

describe('appendTailLines', () => {
  test('keeps only the last `max` lines', () => {
    expect(appendTailLines([], 'a\nb\nc\nd', 3)).toEqual(['b', 'c', 'd'])
  })
  test('merges a partial chunk into the previous last line', () => {
    const first = appendTailLines([], 'hel')
    expect(appendTailLines(first, 'lo\nworld')).toEqual(['hello', 'world'])
  })
  test('handles CRLF', () => {
    expect(appendTailLines([], 'a\r\nb')).toEqual(['a', 'b'])
  })
})
