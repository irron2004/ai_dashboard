import { describe, expect, test } from 'vitest'
import { parseLintOutput } from './parse-lint-output.js'

describe('parseLintOutput', () => {
  test('clean run (exit 0, no issue lines) is ok with no issues', () => {
    const r = parseLintOutput('INFO lint: 0 issue(s)\n', 0)
    expect(r.ok).toBe(true)
    expect(r.issues).toEqual([])
    expect(r.exit_code).toBe(0)
  })

  test('issue lines are parsed and mark the report not ok', () => {
    const stdout = [
      '  - [edge json] wiki/graph/edges.jsonl:3: Expecting value',
      '  - papers/x.md: missing required field "title"',
      'INFO lint: 2 issue(s)',
    ].join('\n')
    const r = parseLintOutput(stdout, 1)
    expect(r.ok).toBe(false)
    expect(r.exit_code).toBe(1)
    expect(r.issues).toEqual([
      '[edge json] wiki/graph/edges.jsonl:3: Expecting value',
      'papers/x.md: missing required field "title"',
    ])
  })
})
