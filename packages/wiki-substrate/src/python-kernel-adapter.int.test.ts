import { describe, expect, test } from 'vitest'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PythonKernelAdapter } from './python-kernel-adapter.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '../../..')
const lockPath = join(repoRoot, 'core.lock')
const venvPython = existsSync(lockPath)
  ? join(repoRoot, JSON.parse(readFileSync(lockPath, 'utf8')).venv_python)
  : ''
const haveVenv = venvPython !== '' && existsSync(venvPython)
const d = haveVenv ? describe : describe.skip

d('PythonKernelAdapter (real kernel)', () => {
  const python = venvPython
  // The golden wiki fixtures live under test/fixtures/paper-golden/wiki.
  // The runtime contract lives at wiki-domains/paper/runtime in the repo.
  // Both are copied into a tmp sibling layout so contractDir.parent == tmp
  // and the kernel resolves pages from tmp/wiki — no symlinks needed.
  const goldenWiki = resolve(here, '../test/fixtures/paper-golden/wiki')

  test('lint passes on the golden vault', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'paper-vault-'))
    cpSync(join(repoRoot, 'wiki-domains/paper/runtime'), join(tmp, 'runtime'), { recursive: true })
    cpSync(goldenWiki, join(tmp, 'wiki'), { recursive: true })
    const a = new PythonKernelAdapter({ python, cwd: repoRoot })
    const r = await a.lint({ contractDir: join(tmp, 'runtime'), wikiDir: join(tmp, 'wiki') })
    expect(r.ok).toBe(true)
    expect(r.issues).toEqual([])
  })

  test('lint reports issues on a broken copy', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'paper-vault-'))
    cpSync(join(repoRoot, 'wiki-domains/paper/runtime'), join(tmp, 'runtime'), { recursive: true })
    cpSync(goldenWiki, join(tmp, 'wiki'), { recursive: true })
    // Remove a required field (title) from one paper to trigger a lint issue
    const papersDir = join(tmp, 'wiki', 'papers')
    const f = join(papersDir, readdirSync(papersDir).find((n) => n.endsWith('.md'))!)
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^title:.*$/m, ''))
    const a = new PythonKernelAdapter({ python, cwd: repoRoot })
    const r = await a.lint({ contractDir: join(tmp, 'runtime'), wikiDir: join(tmp, 'wiki') })
    expect(r.ok).toBe(false)
    expect(r.issues.length).toBeGreaterThan(0)
  })
})
