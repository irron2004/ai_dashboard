import { describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  countUntrackedAdditions,
  diffProjectFile,
  listProjectChanges,
  markUnreflected,
  parseNumstat,
  parsePorcelain,
} from './project-changes.js'

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

describe('parseNumstat', () => {
  test('일반 라인 → 증감 카운트', () => {
    const out = '12\t3\tsrc/app.ts\n0\t7\tdocs/gone.md\n'
    const result = parseNumstat(out)
    expect(result.get('src/app.ts')).toEqual({ additions: 12, deletions: 3 })
    expect(result.get('docs/gone.md')).toEqual({ additions: 0, deletions: 7 })
  })

  test('binary(-\\t-) → null 카운트', () => {
    expect(parseNumstat('-\t-\tassets/logo.png\n').get('assets/logo.png')).toEqual({
      additions: null,
      deletions: null,
    })
  })

  test('rename 두 형태 모두 새 경로 기준', () => {
    const result = parseNumstat('5\t2\told.md => new.md\n1\t1\tpackages/{pm => pm2}/src/x.ts\n')
    expect(result.get('new.md')).toEqual({ additions: 5, deletions: 2 })
    expect(result.get('packages/pm2/src/x.ts')).toEqual({ additions: 1, deletions: 1 })
  })

  test('빈 출력 → 빈 Map', () => {
    expect(parseNumstat('').size).toBe(0)
  })
})

describe('countUntrackedAdditions', () => {
  test('텍스트 파일 → 줄 수 (개행 없는 마지막 줄 포함)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-count-'))
    writeFileSync(join(dir, 'a.md'), 'one\ntwo\nthree')
    expect(countUntrackedAdditions(join(dir, 'a.md'))).toBe(3)
    rmSync(dir, { recursive: true, force: true })
  })

  test('빈 파일 → 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-count-'))
    writeFileSync(join(dir, 'empty.md'), '')
    expect(countUntrackedAdditions(join(dir, 'empty.md'))).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test('NUL 바이트 포함(binary) → null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-count-'))
    writeFileSync(join(dir, 'bin.dat'), Buffer.from([0x41, 0x00, 0x42]))
    expect(countUntrackedAdditions(join(dir, 'bin.dat'))).toBe(null)
    rmSync(dir, { recursive: true, force: true })
  })

  test('없는 파일 → null', () => {
    expect(countUntrackedAdditions(join(tmpdir(), 'apc-none', 'nope.md'))).toBe(null)
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

  test('modified 파일에 +/− 카운트, untracked에 줄 수가 붙는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-numstat-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(join(dir, 'doc.md'), 'a\nb\nc\n')
    execFileSync('git', ['add', 'doc.md'], { cwd: dir })
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir })
    writeFileSync(join(dir, 'doc.md'), 'a\nX\nY\nc\n')
    writeFileSync(join(dir, 'fresh.md'), 'one\ntwo\n')

    const res = listProjectChanges([dir], null)
    expect(res.ok).toBe(true)
    expect(res.files?.find((f) => f.path === 'doc.md')).toMatchObject({ additions: 2, deletions: 1 })
    expect(res.files?.find((f) => f.path === 'fresh.md')).toMatchObject({ additions: 2, deletions: 0 })
    rmSync(dir, { recursive: true, force: true })
  })

  test('빈 repo(HEAD 없음)에서도 untracked 카운트가 나온다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-nohead-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(join(dir, 'a.md'), 'x\n')
    const res = listProjectChanges([dir], null)
    expect(res.ok).toBe(true)
    expect(res.files?.find((f) => f.path === 'a.md')?.additions).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('diffProjectFile (integration, real git)', () => {
  // commit without relying on a global git identity
  const commit = (cwd: string, msg: string) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg], { cwd })

  test('untracked file → patch shows the whole file as additions (--no-index fallback)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-diff-untracked-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(join(dir, 'fresh.md'), '# brand new\nline two\n')
    const res = diffProjectFile([dir], 'fresh.md')
    expect(res.ok).toBe(true)
    expect(res.patch).toContain('+# brand new')
    expect(res.patch).toContain('+line two')
    rmSync(dir, { recursive: true, force: true })
  })

  test('tracked + modified file → patch is the HEAD diff', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-diff-tracked-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(join(dir, 'doc.md'), 'original\n')
    execFileSync('git', ['add', 'doc.md'], { cwd: dir })
    commit(dir, 'init')
    writeFileSync(join(dir, 'doc.md'), 'changed\n')
    const res = diffProjectFile([dir], 'doc.md')
    expect(res.ok).toBe(true)
    expect(res.patch).toContain('-original')
    expect(res.patch).toContain('+changed')
    rmSync(dir, { recursive: true, force: true })
  })

  test('tracked + deleted file → patch includes deleted content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-diff-deleted-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(join(dir, 'gone.md'), 'goodbye\nlast line\n')
    execFileSync('git', ['add', 'gone.md'], { cwd: dir })
    commit(dir, 'init')
    rmSync(join(dir, 'gone.md'))

    const res = diffProjectFile([dir], 'gone.md')
    expect(res.ok).toBe(true)
    expect(res.patch).toContain('-goodbye')
    expect(res.patch).toContain('-last line')
    rmSync(dir, { recursive: true, force: true })
  })

  test('file absent from every repo → ok:false with reason', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-diff-missing-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    const res = diffProjectFile([dir], 'nope.md')
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('nope.md')
    rmSync(dir, { recursive: true, force: true })
  })
})
