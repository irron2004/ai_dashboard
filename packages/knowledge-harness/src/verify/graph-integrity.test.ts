import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GraphIntegrity } from './graph-integrity.js'

const gi = new GraphIntegrity()

describe('GraphIntegrity', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kh-graph-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
  const write = (rel: string, body: string) => {
    const abs = join(dir, rel); mkdirSync(join(abs, '..'), { recursive: true }); writeFileSync(abs, body)
  }

  test('a mutually-linked pair with matching node_ids is clean', () => {
    write('a.md', '---\nnode_id: a\n---\nlinks [[b]]\n')
    write('b.md', '---\nnode_id: b\n---\nlinks [[a]]\n')
    const r = gi.validate(dir)
    expect(r.ok).toBe(true)
  })

  test('detects broken link, duplicate node_id, node_id mismatch, orphan, missing backlink', () => {
    write('a.md', '---\nnode_id: a\n---\n[[ghost]] and [[b]]\n')   // ghost = broken; a→b
    write('b.md', '---\nnode_id: b\n---\nno links here\n')          // a→b but no b→a → missing backlink; b has inbound
    write('c.md', '---\nnode_id: c\n---\nlonely\n')                 // orphan (no inbound)
    write('d1.md', '---\nnode_id: dup\n---\nx\n')                   // duplicate node_id with d2
    write('d2.md', '---\nnode_id: dup\n---\ny\n')
    write('m.md', '---\nnode_id: x\n---\nz\n')                      // stem 'm' ≠ node_id 'x' → mismatch
    const r = gi.validate(dir)
    expect(r.broken_links).toContainEqual({ from: 'a.md', to: 'ghost' })
    expect(r.duplicate_node_ids.map(d => d.node_id)).toContain('dup')
    expect(r.node_id_mismatches.map(m => m.path)).toContain('m.md')
    expect(r.orphan_nodes).toContain('c.md')
    expect(r.missing_backlinks).toContainEqual({ from: 'a.md', to: 'b.md' })
    expect(r.ok).toBe(false)
  })

  test('empty vault is clean', () => {
    expect(gi.validate(dir).ok).toBe(true)
  })
})
