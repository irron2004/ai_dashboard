import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, cpSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PythonKernelAdapter } from '@apc/wiki-substrate'
import { paperPack } from './paper-pack.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '../../../..')
const lockPath = join(repoRoot, 'core.lock')
const venvPython = existsSync(lockPath)
  ? join(repoRoot, JSON.parse(readFileSync(lockPath, 'utf8')).venv_python)
  : ''
// Skip when there is no venv, OR on win32 with a non-Windows (bin/) venv that cannot execute here.
const winRunnable = process.platform !== 'win32' || /[\\/]scripts[\\/]/i.test(venvPython)
const haveVenv = venvPython !== '' && existsSync(venvPython) && winRunnable
const d = haveVenv ? describe : describe.skip

const goldenWikiDir = join(repoRoot, 'packages/wiki-substrate/test/fixtures/paper-golden/wiki')

d('paperPack.validate over real kernel lint', () => {
  const substrate = new PythonKernelAdapter({ python: venvPython, cwd: repoRoot })

  function vaultWithGolden(): string {
    const root = mkdtempSync(join(tmpdir(), 'paper-pack-lint-'))
    cpSync(goldenWikiDir, join(root, 'wiki'), { recursive: true })
    return root
  }

  test('golden wiki lints green', async () => {
    const root = vaultWithGolden()
    try {
      const report = await paperPack.validate!(join(root, 'wiki'), { substrate })
      expect(report.ok).toBe(true)
      expect(report.issues).toHaveLength(0)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 30_000)

  test('a node with title removed fails the lint with issues preserved', async () => {
    const root = vaultWithGolden()
    try {
      const papers = join(root, 'wiki', 'papers')
      const md = readdirSync(papers).find((n) => n.endsWith('.md'))
      if (!md) throw new Error(`golden fixture has no .md under papers/ (${papers})`)
      const f = join(papers, md)
      writeFileSync(f, readFileSync(f, 'utf8').replace(/^title:.*\n?/m, '')) // drop the whole title line
      const report = await paperPack.validate!(join(root, 'wiki'), { substrate })
      expect(report.ok).toBe(false)
      expect(report.issues.length).toBeGreaterThan(0)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 30_000)
})
