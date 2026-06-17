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
  test('copies docs recursively, skips excluded dirs and non-doc files', async () => {
    const repo = join(root, 'repo'); const vault = join(root, 'vault')
    mkdirSync(join(repo, 'sub'), { recursive: true })
    mkdirSync(join(repo, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(repo, 'PRD.md'), '# prd')
    writeFileSync(join(repo, 'sub', 'notes.txt'), 'notes')
    writeFileSync(join(repo, 'image.png'), 'x')                 // non-doc → skipped
    writeFileSync(join(repo, 'node_modules', 'pkg', 'readme.md'), 'noise')  // excluded dir → skipped

    const manifest = await materializeProjectDocs([repo], vault)

    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'PRD.md'))).toBe(true)
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'sub', 'notes.txt'))).toBe(true)
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'image.png'))).toBe(false)
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'node_modules', 'pkg', 'readme.md'))).toBe(false)
    expect(manifest.files.map((f) => f.rel).sort()).toEqual(['project-docs/0/PRD.md', 'project-docs/0/sub/notes.txt'])
    expect(readFileSync(join(vault, 'raw', 'project-docs', '0', 'PRD.md'), 'utf8')).toBe('# prd')
  })

  test('never ingests our own .apc-wiki internal vault or wiki/ output as project docs', async () => {
    const repo = join(root, 'repo'); const vault = join(root, 'vault')
    mkdirSync(join(repo, '.apc-wiki', 'raw'), { recursive: true })
    mkdirSync(join(repo, 'wiki', 'concepts'), { recursive: true })
    writeFileSync(join(repo, 'real.md'), '# real')
    writeFileSync(join(repo, '.apc-wiki', 'raw', 'prior-source.md'), 'internal')   // must not re-ingest
    writeFileSync(join(repo, 'wiki', 'concepts', 'published.md'), 'output')        // must not re-ingest

    const manifest = await materializeProjectDocs([repo], vault)

    expect(manifest.files.map((f) => f.rel)).toEqual(['project-docs/0/real.md'])
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', '.apc-wiki', 'raw', 'prior-source.md'))).toBe(false)
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'wiki', 'concepts', 'published.md'))).toBe(false)
  })

  test('is idempotent: a removed source disappears on the next run', async () => {
    const repo = join(root, 'repo'); const vault = join(root, 'vault')
    mkdirSync(repo, { recursive: true })
    writeFileSync(join(repo, 'a.md'), 'a'); writeFileSync(join(repo, 'b.md'), 'b')
    await materializeProjectDocs([repo], vault)
    rmSync(join(repo, 'b.md'))
    await materializeProjectDocs([repo], vault)
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'a.md'))).toBe(true)
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'b.md'))).toBe(false)
  })

  test('preserves other raw/ content (only clears raw/project-docs)', async () => {
    const repo = join(root, 'repo'); const vault = join(root, 'vault')
    mkdirSync(repo, { recursive: true })
    writeFileSync(join(repo, 'a.md'), 'a')
    // a manually-curated source the user placed under raw/ (NOT under project-docs)
    mkdirSync(join(vault, 'raw', 'manual'), { recursive: true })
    writeFileSync(join(vault, 'raw', 'manual', 'keep.md'), 'keep me')

    await materializeProjectDocs([repo], vault)

    expect(existsSync(join(vault, 'raw', 'manual', 'keep.md'))).toBe(true)      // untouched
    expect(readFileSync(join(vault, 'raw', 'manual', 'keep.md'), 'utf8')).toBe('keep me')
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'a.md'))).toBe(true)
  })

  test('does not pull the vault back into raw/ when a repoPath contains the vault', async () => {
    const repo = join(root, 'repo'); const vault = join(repo, 'vault')   // vault lives INSIDE the repo
    mkdirSync(join(vault, 'raw', 'project-docs', '0'), { recursive: true })
    writeFileSync(join(repo, 'real-doc.md'), 'real')
    writeFileSync(join(vault, 'generated-wiki.md'), 'generated')          // a doc inside the vault

    await materializeProjectDocs([repo], vault)

    // the real project doc is materialized…
    expect(existsSync(join(vault, 'raw', 'project-docs', '0', 'real-doc.md'))).toBe(true)
    // …but nothing from inside the vault was treated as a source (no generated-wiki.md copied in)
    const manifest = await materializeProjectDocs([repo], vault)
    expect(manifest.files.some((f) => f.rel.includes('generated-wiki'))).toBe(false)
  })

  test('ssh:// repoPath is fetched via the injected fetcher into raw/project-docs/<i>/', async () => {
    const vault = join(root, 'vault')
    const fetchRemoteDocs = async (repoPath: string) => {
      expect(repoPath).toBe('ssh://user@host/home/x/repo')
      return [
        { absPath: '/home/x/repo/docs/contracts/product-contract.md', content: '# contract' }, // inside repo
        { absPath: '/home/x/CLAUDE.md', content: 'parent guide' },                              // ancestor → context
        { absPath: '/home/x/.claude/projects/-home-x-repo/memory/MEMORY.md', content: 'mem' },  // memory → context
      ]
    }
    const manifest = await materializeProjectDocs(['ssh://user@host/home/x/repo'], vault, { fetchRemoteDocs })

    // inside-repo doc → project-docs/<i>/<repo-relative>
    expect(readFileSync(join(vault, 'raw', 'project-docs', '0', 'docs', 'contracts', 'product-contract.md'), 'utf8')).toBe('# contract')
    // out-of-repo files → context/<absolute-path>
    expect(readFileSync(join(vault, 'raw', 'context', 'home', 'x', 'CLAUDE.md'), 'utf8')).toBe('parent guide')
    expect(readFileSync(join(vault, 'raw', 'context', 'home', 'x', '.claude', 'projects', '-home-x-repo', 'memory', 'MEMORY.md'), 'utf8')).toBe('mem')
    expect(manifest.files.map((f) => f.rel).sort()).toEqual([
      'context/home/x/.claude/projects/-home-x-repo/memory/MEMORY.md',
      'context/home/x/CLAUDE.md',
      'project-docs/0/docs/contracts/product-contract.md',
    ])
    expect(manifest.scanned).toBe(3)
  })

  test('ssh:// repoPath with no fetcher is recorded in skipped (not silently dropped)', async () => {
    const vault = join(root, 'vault')
    const manifest = await materializeProjectDocs(['ssh://user@host/home/x/repo'], vault)
    expect(manifest.files).toEqual([])
    expect(manifest.skipped.some((s) => s.includes('no ssh fetcher'))).toBe(true)
  })

  test('mixes local and remote repoPaths by index', async () => {
    const repo = join(root, 'repo'); const vault = join(root, 'vault')
    mkdirSync(repo, { recursive: true })
    writeFileSync(join(repo, 'local.md'), 'L')
    const fetchRemoteDocs = async () => [{ absPath: '/p/remote.md', content: 'R' }]
    await materializeProjectDocs([repo, 'ssh://h/p'], vault, { fetchRemoteDocs })
    expect(readFileSync(join(vault, 'raw', 'project-docs', '0', 'local.md'), 'utf8')).toBe('L')   // index 0 = local
    expect(readFileSync(join(vault, 'raw', 'project-docs', '1', 'remote.md'), 'utf8')).toBe('R')  // index 1 = remote (base /p)
  })
})
