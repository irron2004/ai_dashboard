import { describe, expect, test } from 'vitest'
import {
  FilePreviewReadResSchema, ParsedFileReferenceSchema, ResolvedFileReferenceSchema,
  filePreviewKindForPath, parseFileReferences,
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

describe('parseFileReferences', () => {
  test('recognizes wrappers in markdown, inline-code, quoted, then bare priority order', () => {
    const text = [
      '[설계 문서](<docs/설계 (최종).md#L14>)',
      '`C:\\Users\\홍 길동\\app.py:12:4`',
      '"\\\\wsl$\\Ubuntu\\home\\홍길동\\문서.md#L7"',
      './src/main.py:8:2,',
    ].join(' ')

    expect(parseFileReferences(text).map(({ raw, path, line, column, form }) => ({
      raw, path, line, column, form,
    }))).toEqual([
      {
        raw: '[설계 문서](<docs/설계 (최종).md#L14>)',
        path: 'docs/설계 (최종).md', line: 14, column: undefined, form: 'markdown',
      },
      {
        raw: '`C:\\Users\\홍 길동\\app.py:12:4`',
        path: 'C:\\Users\\홍 길동\\app.py', line: 12, column: 4, form: 'inline_code',
      },
      {
        raw: '"\\\\wsl$\\Ubuntu\\home\\홍길동\\문서.md#L7"',
        path: '\\\\wsl$\\Ubuntu\\home\\홍길동\\문서.md', line: 7, column: undefined, form: 'quoted',
      },
      {
        raw: './src/main.py:8:2',
        path: './src/main.py', line: 8, column: 2, form: 'bare',
      },
    ])
  })

  test('supports POSIX, drive, WSL, UNC, relative, Hangul, spaces, and balanced parentheses', () => {
    const fixtures = [
      ['/home/me/My Project/page.html#L9', '/home/me/My Project/page.html', 9],
      ['C:\\repo\\main.py', 'C:\\repo\\main.py', undefined],
      ['C:\\repo\\main.py:44', 'C:\\repo\\main.py', 44],
      ['/mnt/c/작업/wiki/README.MD#L3C2', '/mnt/c/작업/wiki/README.MD', 3],
      ['\\\\server\\share\\docs\\readme.md', '\\\\server\\share\\docs\\readme.md', undefined],
      ['docs/(draft)/설계.md', 'docs/(draft)/설계.md', undefined],
      ['(docs/foo(bar).py:5).', 'docs/foo(bar).py', 5],
      ['README.md!', 'README.md', undefined],
    ] as const

    for (const [source, path, line] of fixtures) {
      const [reference] = parseFileReferences(source)
      expect(reference, source).toMatchObject({ path, line })
      expect(source.slice(reference!.start, reference!.end), source).toBe(reference!.raw)
    }
    expect(parseFileReferences('/mnt/c/작업/wiki/README.MD#L3C2')[0]?.column).toBe(2)
  })

  test('does not mistake a Windows drive colon for a location suffix', () => {
    expect(parseFileReferences('C:\\work\\tool.py')).toMatchObject([
      { path: 'C:\\work\\tool.py', line: undefined, column: undefined },
    ])
    expect(parseFileReferences('C:/work/tool.py:31:6')).toMatchObject([
      { path: 'C:/work/tool.py', line: 31, column: 6 },
    ])
  })

  test('excludes URLs, mailto, unsupported extensions, and fenced code blocks', () => {
    const text = [
      'https://example.com/source/app.py',
      'http://example.com/README.md#L2',
      'mailto:owner@example.com',
      'src/index.ts',
      '```py',
      '/repo/hidden.py',
      '```',
      'outside.py',
    ].join('\n')

    expect(parseFileReferences(text).map((reference) => reference.path)).toEqual(['outside.py'])
  })

  test('returns sorted, non-overlapping ranges that reproduce the original source', () => {
    const forms = [
      '[문서](docs/readme.md)',
      '`src/main.py:4`',
      '"pages/demo.html"',
      '../notes/결정.md#L2',
    ]

    for (let prefixLength = 0; prefixLength < 8; prefixLength += 1) {
      const prefix = '가'.repeat(prefixLength)
      const source = `${prefix} ${forms.join(' · ')} 끝`
      const references = parseFileReferences(source)
      expect(references).toHaveLength(forms.length)
      for (let index = 0; index < references.length; index += 1) {
        const reference = references[index]!
        expect(source.slice(reference.start, reference.end)).toBe(reference.raw)
        if (index > 0) expect(reference.start).toBeGreaterThanOrEqual(references[index - 1]!.end)
      }
    }
  })
})
