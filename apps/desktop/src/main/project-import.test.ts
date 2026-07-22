import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importProjectSources } from './project-import.js'

describe('importProjectSources', () => {
  let root: string
  let project: string
  let sources: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'apc-project-import-'))
    project = join(root, 'project')
    sources = join(root, 'sources')
    mkdirSync(project)
    mkdirSync(sources)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('copies multiple files into the project root', async () => {
    const first = join(sources, 'one.md')
    const second = join(sources, 'two.txt')
    writeFileSync(first, '# one')
    writeFileSync(second, 'two')

    const result = await importProjectSources(project, [first, second], 'files')

    expect(result).toMatchObject({
      ok: true,
      canceled: false,
      items: [
        { sourceName: 'one.md', relativePath: 'one.md', kind: 'file', renamed: false },
        { sourceName: 'two.txt', relativePath: 'two.txt', kind: 'file', renamed: false },
      ],
    })
    expect(readFileSync(join(project, 'one.md'), 'utf8')).toBe('# one')
    expect(readFileSync(join(project, 'two.txt'), 'utf8')).toBe('two')
  })

  test('copies a folder recursively, including hidden files', async () => {
    const docs = join(sources, 'docs')
    mkdirSync(join(docs, 'nested'), { recursive: true })
    writeFileSync(join(docs, '.index'), 'hidden')
    writeFileSync(join(docs, 'nested', 'guide.md'), '# guide')

    const result = await importProjectSources(project, [docs], 'folder')

    expect(result).toMatchObject({
      ok: true,
      canceled: false,
      items: [{ relativePath: 'docs', kind: 'folder', renamed: false }],
    })
    expect(readFileSync(join(project, 'docs', '.index'), 'utf8')).toBe('hidden')
    expect(readFileSync(join(project, 'docs', 'nested', 'guide.md'), 'utf8')).toBe('# guide')
  })

  test('keeps existing entries and assigns numbered names to every collision', async () => {
    const report = join(sources, 'report.md')
    writeFileSync(report, 'new')
    writeFileSync(join(project, 'report.md'), 'existing')

    const result = await importProjectSources(project, [report, report], 'files')

    expect(result).toMatchObject({
      ok: true,
      items: [
        { relativePath: 'report (1).md', renamed: true },
        { relativePath: 'report (2).md', renamed: true },
      ],
    })
    expect(readFileSync(join(project, 'report.md'), 'utf8')).toBe('existing')
    expect(readFileSync(join(project, 'report (1).md'), 'utf8')).toBe('new')
    expect(readFileSync(join(project, 'report (2).md'), 'utf8')).toBe('new')
  })

  test('rejects an ancestor folder that would recursively contain its destination', async () => {
    const result = await importProjectSources(project, [root], 'folder')

    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.reason).toContain('상위 폴더')
  })

  test('enforces the picker kind at the filesystem boundary', async () => {
    const folder = join(sources, 'folder')
    mkdirSync(folder)

    const result = await importProjectSources(project, [folder], 'files')

    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.reason).toContain('파일이 아닙니다')
  })
})
