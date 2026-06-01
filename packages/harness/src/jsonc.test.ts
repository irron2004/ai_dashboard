import { describe, expect, test } from 'vitest'
import { parseJsonc } from './jsonc.js'

describe('parseJsonc', () => {
  test('parses JSON with // and /* */ comments', () => {
    const src = `{
      // line comment
      "agent": { "build": { "model": "openai/gpt-5.5" } } /* trailing */
    }`
    expect(parseJsonc(src)).toEqual({ agent: { build: { model: 'openai/gpt-5.5' } } })
  })
  test('does not strip // inside strings', () => {
    expect(parseJsonc('{"url":"https://x.y"}')).toEqual({ url: 'https://x.y' })
  })
})
