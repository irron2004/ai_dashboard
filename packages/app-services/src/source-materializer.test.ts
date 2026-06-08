import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { materializeProjectDocs } from './source-materializer.js'

let root: string
beforeEach(() => {
  root = join(process.cwd(), `.tmp-materializer-${process.pid}-${Math.floor(performance.now())}`)
  mkdirSync(root, { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('materializeProjectDocs', () => {
  test('copies docs recursively, skips excluded dirs and non-doc files', () => {
    const repo = join(root, 'repo'); const vault = join(root, 'vault')
    mkdirSync(join(repo, 'sub'), { recursive: true })
    mkdirSync(join(repo, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(repo, 'PRD.md'), '# prd')
    writeFileSync(join(repo, 'sub', 'notes.txt'), 'notes')
    writeFileSync(join(repo, 'image.png'), 'x')                 // non-doc → skipped
    writeFileSync(join(repo, 'node_modules', 'pkg', 'readme.md'), 'noise')  // excluded dir → skipped

    const manifest = materializeProjectDocs([repo], vault)

    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'PRD.md'))).toBe(true)
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'sub', 'notes.txt'))).toBe(true)
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'image.png'))).toBe(false)
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'node_modules', 'pkg', 'readme.md'))).toBe(false)
    expect(manifest.files.map((f) => f.rel).sort()).toEqual(['project-docs/0/PRD.md', 'project-docs/0/sub/notes.txt'])
    expect(readFileSync(join(vault, 'raw', 'project-docs', '0', 'PRD.md'), 'utf8')).toBe('# prd')
  })

  test('is idempotent: a removed source disappears on the next run', () => {
    const repo = join(root, 'repo'); const vault = join(root, 'vault')
    mkdirSync(repo, { recursive: true })
    writeFileSync(join(repo, 'a.md'), 'a'); writeFileSync(join(repo, 'b.md'), 'b')
    materializeProjectDocs([repo], vault)
    rmSync(join(repo, 'b.md'))
    materializeProjectDocs([repo], vault)
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'a.md'))).toBe(true)
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'b.md'))).toBe(false)
  })
})
