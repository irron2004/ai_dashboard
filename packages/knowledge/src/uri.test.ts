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

  test('encodes project and path segments without losing the repository-relative path', () => {
    const uri = buildProjectDocUri('project/one', 'notes/a file #1.md')
    expect(uri).toBe('pmw://project/project%2Fone/notes/a%20file%20%231.md')
    expect(parseProjectDocUri(uri)).toEqual({ projectId: 'project/one', relPath: 'notes/a file #1.md' })
  })

  test('parses and validates the optional knowledge chunk fragment separately from relPath', () => {
    expect(parseProjectDocUri('pmw://project/p1/notes/a.md#chunk-12')).toEqual({
      projectId: 'p1', relPath: 'notes/a.md', chunkOrdinal: 12,
    })
    expect(() => parseProjectDocUri('pmw://project/p1/notes/a.md#../../secret')).toThrow(/fragment/)
  })
})
