import { describe, expect, test } from 'vitest'
import { chunkMarkdown } from './chunker.js'

describe('chunkMarkdown', () => {
  test('keeps heading context on chunks', () => {
    const chunks = chunkMarkdown(`# Current\n\nIntro text\n\n## Decision\n\nUse SQLite FTS5.`, { targetTokens: 8 })
    expect(chunks.map((c) => c.headingPath.join(' > '))).toContain('Current > Decision')
  })

  test('does not split inside fenced code blocks', () => {
    const chunks = chunkMarkdown([
      '# Notes',
      '',
      '```ts',
      'const a = 1',
      'const b = 2',
      'const c = 3',
      '```',
      '',
      'After code.',
    ].join('\n'), { targetTokens: 4 })
    expect(chunks.some((c) => c.body.includes('```ts') && c.body.includes('```'))).toBe(true)
  })
})
