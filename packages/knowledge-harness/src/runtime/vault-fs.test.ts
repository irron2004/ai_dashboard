import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { listMarkdown, isCanonical, isRaw, resolveInside } from './vault-fs.js'

describe('vault-fs', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kh-vfs-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  test('listMarkdown returns nested .md absolute paths; missing dir → []', () => {
    mkdirSync(join(dir, 'a'), { recursive: true })
    writeFileSync(join(dir, 'a', 'x.md'), '#')
    writeFileSync(join(dir, 'y.txt'), 'no')
    expect(listMarkdown(join(dir, 'nope'))).toEqual([])
    // listMarkdown returns OS-native absolute paths (back-slashes on Windows); normalize the separator
    // before comparing so the assertion holds on every platform this app ships to.
    expect(listMarkdown(dir).map(p => p.slice(dir.length + 1).split(sep).join('/'))).toContain('a/x.md')
  })

  test('isCanonical matches current.md / PRD.md / ADR-*.md anywhere in the path', () => {
    expect(isCanonical('current.md')).toBe(true)
    expect(isCanonical('projects/p1/PRD.md')).toBe(true)
    expect(isCanonical('decisions/ADR-001-foo.md')).toBe(true)
    expect(isCanonical('concepts/n1.md')).toBe(false)
    expect(isCanonical('not-current.md.bak')).toBe(false)
  })

  test('isCanonical / isRaw normalize Windows backslash separators', () => {
    // single backslashes in the JS literal = one backslash at runtime (a Windows-style path)
    expect(isCanonical('projects\\p1\\PRD.md')).toBe(true)
    expect(isRaw('a\\raw\\x.md')).toBe(true)
    expect(isRaw('raw/x.md')).toBe(true)
    expect(isRaw('raw\\x.md')).toBe(true)
    expect(isRaw('concepts/n1.md')).toBe(false)
  })

  test('resolveInside allows the base + nested paths but rejects sibling-prefix and ../ escapes', () => {
    expect(resolveInside(dir, 'a/x.md')).toBe(join(resolve(dir), 'a', 'x.md'))
    expect(resolveInside(dir, '.')).toBe(resolve(dir))
    expect(() => resolveInside(dir, '../escape.md')).toThrow(/escapes/)
    // sibling dir sharing the prefix (the bug a plain startsWith would miss)
    expect(() => resolveInside(join(dir, 'vault'), '../vault-evil/x.md')).toThrow(/escapes/)
  })
})
