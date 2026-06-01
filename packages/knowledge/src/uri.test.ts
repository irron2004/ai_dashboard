import { describe, expect, test } from 'vitest'
import { buildProjectDocUri, parseProjectDocUri } from './uri.js'

describe('pmw project document URIs', () => {
  test('builds and parses a project document URI', () => {
    const uri = buildProjectDocUri('p1', 'decisions/ADR-001.md')
    expect(uri).toBe('pmw://project/p1/decisions/ADR-001.md')
    expect(parseProjectDocUri(uri)).toEqual({ projectId: 'p1', relPath: 'decisions/ADR-001.md' })
  })

  test('rejects non-project URIs', () => {
    expect(() => parseProjectDocUri('qmd://notes/foo.md')).toThrow(/Unsupported pmw URI/)
  })
})
