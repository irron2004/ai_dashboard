import { describe, expect, test, beforeAll } from 'vitest'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PythonKernelAdapter } from './python-kernel-adapter.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '../../..')
const lockPath = join(repoRoot, 'core.lock')
const haveVenv = existsSync(lockPath)
const d = haveVenv ? describe : describe.skip

d('PythonKernelAdapter (real kernel)', () => {
  let python: string
  // The kernel derives entity paths from contractDir.parent/wiki/.
  // We use paper-golden/runtime (symlink to wiki-domains/paper/runtime) so
  // that contractDir.parent = paper-golden and the kernel finds paper-golden/wiki/.
  const goldenRoot = resolve(here, '../test/fixtures/paper-golden')
  const goldenContractDir = join(goldenRoot, 'runtime')
  const goldenWiki = join(goldenRoot, 'wiki')

  beforeAll(() => { python = join(repoRoot, JSON.parse(readFileSync(lockPath, 'utf8')).venv_python) })

  test('lint passes on the golden vault', async () => {
    const a = new PythonKernelAdapter({ python, cwd: repoRoot })
    const r = await a.lint({ contractDir: goldenContractDir, wikiDir: goldenWiki })
    expect(r.ok).toBe(true)
    expect(r.issues).toEqual([])
  })

  test('lint reports issues on a broken copy', async () => {
    // Build a temp project root: tmp/wiki/ (broken) + tmp/runtime (symlink to contract)
    const tmp = mkdtempSync(join(tmpdir(), 'paper-broken-'))
    cpSync(goldenWiki, join(tmp, 'wiki'), { recursive: true })
    // Symlink the contract dir so kernel can find it as contractDir.parent = tmp
    symlinkSync(join(repoRoot, 'wiki-domains/paper/runtime'), join(tmp, 'runtime'))
    // Remove a required field (title) from one paper
    const papersDir = join(tmp, 'wiki', 'papers')
    const f = join(papersDir, readdirSync(papersDir).find((n) => n.endsWith('.md'))!)
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^title:.*$/m, ''))
    const a = new PythonKernelAdapter({ python, cwd: repoRoot })
    const r = await a.lint({ contractDir: join(tmp, 'runtime'), wikiDir: join(tmp, 'wiki') })
    expect(r.ok).toBe(false)
    expect(r.issues.length).toBeGreaterThan(0)
  })
})
