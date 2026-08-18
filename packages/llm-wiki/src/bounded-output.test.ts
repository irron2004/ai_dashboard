import { describe, expect, test } from 'vitest'
import { BoundedOutputBuffer, takeUtf8Prefix, truncateOutput } from './bounded-output.js'

describe('BoundedOutputBuffer', () => {
  test('retains streamed chunks up to the byte limit and marks truncation once', () => {
    const output = new BoundedOutputBuffer(6)
    output.append('ab')
    output.append('cdef')
    output.append('ignored')
    expect(output.byteLength).toBe(6)
    expect(output.toString()).toBe('abcdef\n…[truncated at 6 bytes]\n')
  })

  test('does not split a multibyte character at the byte boundary', () => {
    expect(takeUtf8Prefix('가나', 4)).toBe('가')
    expect(truncateOutput('가나', 4)).toBe('가\n…[truncated at 4 bytes]\n')
  })

  test('keeps output unchanged when it fits', () => {
    expect(truncateOutput('hello', 5)).toBe('hello')
  })
})
