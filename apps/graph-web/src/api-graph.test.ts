import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { handleGraphRequest } from './api-graph.js'

function wiki(): string {
  const repo = mkdtempSync(join(tmpdir(), 'gw-'))
  const w = join(repo, 'wiki'); mkdirSync(join(w, 'graph'), { recursive: true }); mkdirSync(join(w, 'papers'), { recursive: true })
  writeFileSync(join(w, 'graph', 'edges.jsonl'), JSON.stringify({ from: 'papers/a', to: 'papers/b', type: 'rel' }) + '\n')
  writeFileSync(join(w, 'papers', 'a.md'), '---\ntitle: A\n---\n')
  writeFileSync(join(w, 'papers', 'b.md'), '---\ntitle: B\n---\n')
  return repo
}

describe('handleGraphRequest', () => {
  test('returns available graph data for a wiki repo dir', () => {
    const res = handleGraphRequest(wiki())
    expect(res.status).toBe(200)
    expect(res.body.available).toBe(true)
    if (res.body.available) { expect(res.body.edges).toHaveLength(1); expect(res.body.nodes).toHaveLength(2) }
  })
  test('returns available:false (200) when WIKI_DIR is missing/unset', () => {
    const res = handleGraphRequest(undefined)
    expect(res.body.available).toBe(false)
  })
})
