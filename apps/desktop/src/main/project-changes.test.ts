import { describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listProjectChanges, markUnreflected, parsePorcelain } from './project-changes.js'

describe('parsePorcelain', () => {
  test('maps porcelain v1 statuses', () => {
    const out = [
      '?? docs/new.md',
      ' M src/store.ts',
      'M  staged.ts',
      ' D gone.md',
      'R  old.md -> renamed.md',
    ].join('\n')
    expect(parsePorcelain(out)).toEqual([
      { path: 'docs/new.md', status: 'new' },
      { path: 'src/store.ts', status: 'modified' },
      { path: 'staged.ts', status: 'modified' },
      { path: 'gone.md', status: 'deleted' },
      { path: 'renamed.md', status: 'new' },
    ])
  })

  test('handles quoted paths with spaces', () => {
    expect(parsePorcelain('?? "my doc.md"')).toEqual([{ path: 'my doc.md', status: 'new' }])
  })

  test('empty output → empty list', () => {
    expect(parsePorcelain('')).toEqual([])
  })
})

describe('markUnreflected', () => {
  const files = [
    { path: 'a.md', status: 'new' as const, isMarkdown: true, mtimeMs: 2_000_000 },
    { path: 'b.ts', status: 'modified' as const, isMarkdown: false, mtimeMs: 2_000_000 },
    { path: 'c.md', status: 'modified' as const, isMarkdown: true, mtimeMs: 500 },
  ]

  test('md newer than last ingest → unreflected; code never flagged', () => {
    // sqlite datetime('now') 포맷("YYYY-MM-DD HH:MM:SS", UTC)을 그대로 받는다
    const res = markUnreflected(files, '1970-01-01 00:00:01')
    expect(res.find((f) => f.path === 'a.md')?.unreflected).toBe(true)
    expect(res.find((f) => f.path === 'b.ts')?.unreflected).toBe(false)
    expect(res.find((f) => f.path === 'c.md')?.unreflected).toBe(false)
  })

  test('no ingest history → every md unreflected', () => {
    const res = markUnreflected(files, null)
    expect(res.find((f) => f.path === 'a.md')?.unreflected).toBe(true)
    expect(res.find((f) => f.path === 'c.md')?.unreflected).toBe(true)
  })
})

describe('listProjectChanges (integration, real git)', () => {
  test('non-git directory → ok:false with reason', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-nongit-'))
    const res = listProjectChanges([dir], null)
    expect(res.ok).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('lists untracked md with mtime in a real repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-git-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(join(dir, 'note.md'), '# n')
    utimesSync(join(dir, 'note.md'), new Date(), new Date())
    const res = listProjectChanges([dir], null)
    expect(res.ok).toBe(true)
    const f = res.files?.find((x) => x.path === 'note.md')
    expect(f?.status).toBe('new')
    expect(f?.isMarkdown).toBe(true)
    expect(f?.unreflected).toBe(true)
    expect(f?.mtimeMs).toBeGreaterThan(0)
    rmSync(dir, { recursive: true, force: true })
  })
})
