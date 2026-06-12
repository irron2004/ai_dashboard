import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listProjectDocs, readProjectDoc } from './project-files.js'

describe('project-files', () => {
  let root: string
  let outside: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'apc-files-'))
    outside = mkdtempSync(join(tmpdir(), 'apc-outside-'))
    mkdirSync(join(root, 'docs'))
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(root, 'docs', 'plan.md'), '# plan')
    writeFileSync(join(root, 'README.md'), '# readme')
    writeFileSync(join(root, 'node_modules', 'pkg', 'x.md'), 'should not list')
    writeFileSync(join(root, 'app.ts'), 'code')
    writeFileSync(join(outside, 'secret.md'), 'secret')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  test('readProjectDoc reads a doc inside the first matching root', () => {
    const res = readProjectDoc([root], 'docs/plan.md')
    expect(res).toEqual({ ok: true, content: '# plan' })
  })

  test('rejects path traversal out of the root', () => {
    const res = readProjectDoc([root], `../${outside.split('/').pop()}/secret.md`)
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/허용되지 않는 경로|outside/i)
  })

  test('rejects absolute paths outside the roots', () => {
    const res = readProjectDoc([root], join(outside, 'secret.md'))
    expect(res.ok).toBe(false)
  })

  test('rejects symlink escaping the root', () => {
    try { symlinkSync(join(outside, 'secret.md'), join(root, 'link.md')) } catch { return /* symlink 권한 없으면 skip */ }
    const res = readProjectDoc([root], 'link.md')
    expect(res.ok).toBe(false)
  })

  test('rejects non-text extensions and oversized files', () => {
    expect(readProjectDoc([root], 'app.ts').ok).toBe(false)
    writeFileSync(join(root, 'big.md'), 'x'.repeat(513 * 1024))
    const res = readProjectDoc([root], 'big.md')
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/크기|size/i)
  })

  test('missing file returns ok:false (not throw)', () => {
    expect(readProjectDoc([root], 'docs/nope.md').ok).toBe(false)
  })

  test('listProjectDocs lists md files excluding node_modules/.git', () => {
    const docs = listProjectDocs([root])
    const paths = docs.map((d) => d.relPath).sort()
    expect(paths).toEqual(['README.md', 'docs/plan.md'])
    expect(docs[0].mtimeMs).toBeGreaterThan(0)
  })
})
