import { describe, expect, test } from 'vitest'
import { extractSourceExcerpt } from './source-excerpt.js'

const TEXT = [
  'line one', 'line two', 'line three', 'line four', 'line five',
  'line six', 'the QUICK  brown fox', 'line eight', 'line nine',
  'line ten', 'line eleven', 'line twelve', 'line thirteen',
].join('\n')

describe('extractSourceExcerpt', () => {
  test('finds a quote despite whitespace and case drift, returning line and ±5 lines of context', () => {
    const r = extractSourceExcerpt(TEXT, 'The quick brown fox')
    expect(r.matched).toBe(true)
    expect(r.line).toBe(7)
    expect(r.excerpt.split('\n')[0]).toBe('line two')
    expect(r.excerpt.split('\n').at(-1)).toBe('line twelve')
  })

  test('clamps the window at file boundaries', () => {
    const r = extractSourceExcerpt(TEXT, 'line one')
    expect(r.matched).toBe(true)
    expect(r.line).toBe(1)
    expect(r.excerpt.split('\n')[0]).toBe('line one')
  })

  test('returns the file head unmatched when the quote is absent or empty', () => {
    const missing = extractSourceExcerpt(TEXT, 'not in the file at all')
    expect(missing.matched).toBe(false)
    expect(missing.line).toBeUndefined()
    expect(missing.excerpt.split('\n')[0]).toBe('line one')
    expect(extractSourceExcerpt(TEXT, undefined).matched).toBe(false)
    expect(extractSourceExcerpt(TEXT, '   ').matched).toBe(false)
  })
})
