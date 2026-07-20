import { describe, expect, test } from 'vitest'
import {
  FilePreviewReadResSchema, ParsedFileReferenceSchema, ResolvedFileReferenceSchema,
  filePreviewKindForPath,
} from './file-reference.js'

describe('file reference contracts', () => {
  test('validates source ranges and resolved metadata', () => {
    const parsed = ParsedFileReferenceSchema.parse({
      raw: '`src/app.py:12`', path: 'src/app.py', line: 12,
      form: 'inline_code', start: 4, end: 19,
    })
    const resolved = ResolvedFileReferenceSchema.parse({
      ...parsed, token: 'token-1', projectId: 'p1', canonicalPath: '/repo/src/app.py',
      displayPath: 'src/app.py', workspaceRoot: '/repo', kind: 'python', size: 120,
    })
    expect(resolved.line).toBe(12)
    expect(() => ParsedFileReferenceSchema.parse({ ...parsed, end: parsed.start })).toThrow()
  })

  test('classifies only the preview extension allow-list', () => {
    expect(filePreviewKindForPath('README.MD')).toBe('markdown')
    expect(filePreviewKindForPath('preview.html#section')).toBe('html')
    expect(filePreviewKindForPath('src/main.py?x=1')).toBe('python')
    expect(filePreviewKindForPath('src/main.ts')).toBeUndefined()
  })

  test('uses a discriminated read result', () => {
    expect(FilePreviewReadResSchema.parse({ ok: false, reason: 'outside project' })).toEqual({
      ok: false, reason: 'outside project',
    })
  })
})

