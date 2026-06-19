import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vaultToNodeProposals, vaultToStagedDocs } from './substrate-graph-adapter.js'

function tinyVault(): string {
  const root = mkdtempSync(join(tmpdir(), 'vault-'))
  const wiki = join(root, 'wiki')
  mkdirSync(join(wiki, 'papers'), { recursive: true })
  mkdirSync(join(wiki, 'modules'), { recursive: true })
  writeFileSync(join(wiki, 'papers', 'attn.md'), '---\ntitle: Attn Paper\nslug: attn\n---\n# Attn Paper\n')
  writeFileSync(join(wiki, 'modules', 'ema.md'), '---\ntitle: EMA Attention\nslug: ema\nkind: encoder\n---\n# EMA\n')
  return wiki
}

describe('substrate-graph-adapter', () => {
  test('vaultToNodeProposals derives node-proposals from frontmatter', () => {
    const out = vaultToNodeProposals(tinyVault())
    const byId = Object.fromEntries(out.proposals.map((p) => [p.node.id, p.node]))
    expect(byId['attn']).toEqual({ id: 'attn', title: 'Attn Paper', type: 'papers' })
    expect(byId['ema']).toEqual({ id: 'ema', title: 'EMA Attention', type: 'modules' })
  })

  test('vaultToStagedDocs writes node_id/node_type frontmatter docs', () => {
    const wiki = tinyVault()
    const staging = mkdtempSync(join(tmpdir(), 'staging-'))
    const written = vaultToStagedDocs(wiki, staging)
    expect(written.length).toBe(2)
    const doc = readFileSync(join(staging, written.find((w) => w.includes('attn'))!), 'utf8')
    expect(doc).toMatch(/^node_id:\s*attn$/m)
    expect(doc).toMatch(/^node_type:\s*papers$/m)
  })
})
