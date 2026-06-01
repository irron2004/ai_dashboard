import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { parseStructured } from './parse-structured.js'

const S = z.object({ a: z.number(), b: z.string() })

describe('parseStructured', () => {
  test('parses bare JSON', () => {
    expect(parseStructured('{"a":1,"b":"x"}', S)).toEqual({ a: 1, b: 'x' })
  })
  test('parses JSON inside a ```json fence with surrounding prose', () => {
    const raw = 'Here is the result:\n```json\n{"a":2,"b":"y"}\n```\nDone.'
    expect(parseStructured(raw, S)).toEqual({ a: 2, b: 'y' })
  })
  test('parses JSON embedded in prose without fences', () => {
    expect(parseStructured('blah {"a":3,"b":"z"} trailing', S)).toEqual({ a: 3, b: 'z' })
  })
  test('throws a clear error when no valid JSON is present', () => {
    expect(() => parseStructured('no json here', S)).toThrow(/no JSON object/i)
  })
  test('throws when JSON is present but fails schema validation', () => {
    expect(() => parseStructured('{"a":"not a number","b":"x"}', S)).toThrow()
  })
})
