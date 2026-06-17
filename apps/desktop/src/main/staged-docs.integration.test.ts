import { describe, expect, test } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { collectStagedDocs } from '@apc/app-services'
import { resolveInside } from '@apc/knowledge-harness'
import { resolveStagedRel } from '../renderer/harness-utils.js'

const REAL_RUNS_ROOT = process.env.APC_REAL_RUNS
const suite = REAL_RUNS_ROOT ? describe : describe.skip

suite('REAL staged wiki node data smoke', () => {
  const runsRoot = REAL_RUNS_ROOT as string

  function latestRunWithRealNodes(): { runId: string; docs: ReturnType<typeof collectStagedDocs>; skipped: string[] } {
    const skipped: string[] = []
    const runIds = readdirSync(runsRoot).filter((name) => name.startsWith('RUN-')).sort().reverse()
    for (const runId of runIds) {
      const docs = collectStagedDocs(runsRoot, runId)
      if (docs.some((doc) => doc.isNode)) return { runId, docs, skipped }
      skipped.push(`${runId}:${docs.length}`)
    }
    throw new Error(`No run with real staged nodes under ${runsRoot}; skipped=${skipped.join(', ')}`)
  }

  test('newest valid run lists real nodes, hides stubs, and opens a real node body', () => {
    const { runId, docs, skipped } = latestRunWithRealNodes()
    const real = docs.filter((doc) => doc.isNode)
    const stubs = docs.filter((doc) => !doc.isNode && /(^|\/)nodes\//.test(doc.relPath))
    const stagingBase = resolveInside(runsRoot, join(runId, 'vault-staging'))

    const sample = real.find((doc) => {
      const body = readFileSync(resolveInside(stagingBase, doc.relPath), 'utf8')
      return body.includes('## 핵심 주장') && body.includes('## 근거')
    })
    expect(sample, 'expected at least one real node with claims and evidence sections').toBeDefined()

    const rel = resolveStagedRel({ id: sample!.nodeId as string, label: sample!.title }, real)
    expect(rel).toBe(sample!.relPath)

    const body = readFileSync(resolveInside(stagingBase, rel as string), 'utf8')
    const withEvidence = real.filter((doc) => readFileSync(resolveInside(stagingBase, doc.relPath), 'utf8').includes('## 근거'))

    console.log(`[smoke] run=${runId} total=${docs.length} realNodes=${real.length} stubsHidden=${stubs.length} skipped=${skipped.join(',') || 'none'}`)
    console.log(`[smoke] opened ${rel} (${body.length}B) head:\n${body.slice(0, 240)}`)
    console.log(`[smoke] nodes with '## 근거': ${withEvidence.length}/${real.length}`)

    expect(real.length).toBeGreaterThan(0)
    expect(stubs.length).toBeGreaterThanOrEqual(0)
    expect(body.startsWith('---')).toBe(true)
    expect(body).toMatch(/^#\s+/m)
    expect(body).toContain('## 핵심 주장')
    expect(body).toContain('## 근거')
    expect(withEvidence.length).toBeGreaterThan(0)
  })
})
