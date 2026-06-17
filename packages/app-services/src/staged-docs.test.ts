import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectStagedDocs, parseStagedDoc } from './staged-docs.js'

describe('parseStagedDoc', () => {
  test('extracts node_id/node_type from frontmatter and the first H1', () => {
    const out = parseStagedDoc('---\nnode_id: decision.real\nnode_type: DecisionNode\n---\n# Real Title\n\nbody')
    expect(out).toEqual({ nodeId: 'decision.real', nodeType: 'DecisionNode', title: 'Real Title' })
  })

  test('returns no nodeId for a stub one-liner without frontmatter', () => {
    expect(parseStagedDoc('DecisionNode markdown stub.').nodeId).toBeUndefined()
  })
})

describe('collectStagedDocs', () => {
  let runsRoot: string
  const runId = 'RUN-TEST'

  beforeEach(() => {
    runsRoot = mkdtempSync(join(tmpdir(), 'apc-staged-'))
    const nodes = join(runsRoot, runId, 'vault-staging', 'nodes')
    mkdirSync(nodes, { recursive: true })
    writeFileSync(
      join(nodes, 'decision.real.md'),
      '---\nnode_id: decision.real\nnode_type: DecisionNode\n---\n# Real Title\n\nbody',
    )
    writeFileSync(join(nodes, 'old-stub.md'), 'DecisionNode markdown stub one-liner.')
    const raw = join(runsRoot, runId, 'vault-staging', 'raw', 'conversations')
    mkdirSync(raw, { recursive: true })
    writeFileSync(join(raw, 'ignore.md'), '# should be skipped')
  })

  afterEach(() => {
    rmSync(runsRoot, { recursive: true, force: true })
  })

  test('lists markdown docs and flags real node vs stub', () => {
    const docs = collectStagedDocs(runsRoot, runId)
    expect(docs.find((d) => d.relPath === 'nodes/decision.real.md'))
      .toMatchObject({ isNode: true, nodeId: 'decision.real', nodeType: 'DecisionNode', title: 'Real Title' })
    expect(docs.find((d) => d.relPath === 'nodes/old-stub.md')).toMatchObject({ isNode: false })
  })

  test('skips the raw/ subtree', () => {
    expect(collectStagedDocs(runsRoot, runId).some((d) => d.relPath.startsWith('raw/'))).toBe(false)
  })

  test('returns [] when the staging dir is missing', () => {
    expect(collectStagedDocs(runsRoot, 'NO-SUCH-RUN')).toEqual([])
  })

  test('returns [] for a runId that escapes runsRoot', () => {
    expect(collectStagedDocs(runsRoot, '../../etc')).toEqual([])
  })
})
