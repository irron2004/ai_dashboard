import { describe, expect, test } from 'vitest'
import { appendBoundedLog, DEV_HARNESS_LOG_TRIM_NOTICE } from './bounded-log.js'

describe('appendBoundedLog', () => {
  test('keeps short output unchanged', () => {
    expect(appendBoundedLog('hello', ' world', 20)).toBe('hello world')
  })

  test('keeps a fixed-size tail with one visible truncation notice', () => {
    const larger = appendBoundedLog('old-output-', 'latest-output', 40)
    expect(larger).toBe('old-output-latest-output')
    const trimmed = appendBoundedLog(larger, '-and-more-data-than-the-limit', 40)
    expect(trimmed).toHaveLength(40)
    expect(trimmed.startsWith(DEV_HARNESS_LOG_TRIM_NOTICE)).toBe(true)
    expect(trimmed.endsWith('than-the-limit')).toBe(true)
  })
})
