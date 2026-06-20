import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { PythonKernelAdapter } from '@apc/wiki-substrate'
import { paperPack } from './paper-pack.js'
import type { PaperEntityType } from './types.js'

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
const TYPES: PaperEntityType[] = ['papers', 'modules', 'pipelines', 'pipeline_trials']

d('renderNode output passes kernel lint (render -> validate round-trip)', () => {
  const substrate = new PythonKernelAdapter({ python: venvPython, cwd: repoRoot })

  test('re-rendering every golden node from its parsed fields lints green', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paper-render-'))
    try {
      const wikiDir = join(root, 'wiki')
      // Render each golden node from its parsed frontmatter via paperPack.renderNode.
      for (const type of TYPES) {
        const dir = join(goldenWikiDir, type)
        if (!existsSync(dir)) continue
        for (const name of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
          const parsed = matter(readFileSync(join(dir, name), 'utf8'))
          const slug = String(parsed.data.slug ?? name.replace(/\.md$/, ''))
          const out = paperPack.renderNode!({ type, slug, fields: parsed.data, body: parsed.content })
          const abs = join(wikiDir, out.relPath.replace(/^wiki\//, ''))
          mkdirSync(dirname(abs), { recursive: true })
          writeFileSync(abs, out.content)
        }
      }
      // Edges are out of renderNode's scope — copy the golden edge set so the graph lints intact.
      const graphSrc = join(goldenWikiDir, 'graph')
      if (existsSync(graphSrc)) cpSync(graphSrc, join(wikiDir, 'graph'), { recursive: true })

      const report = await paperPack.validate!(wikiDir, { substrate })
      expect(report.issues).toEqual([])
      expect(report.ok).toBe(true)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 30_000)
})
