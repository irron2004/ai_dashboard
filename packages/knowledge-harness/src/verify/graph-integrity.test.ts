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
    expect(gi.validate(dir).ok).toBe(true)
  })

  test('empty vault is clean', () => {
    expect(gi.validate(dir).ok).toBe(true)
  })

  // ---- hard-fail integrity (affects ok) ----

  test('broken links are a hard failure', () => {
    write('a.md', '---\nnode_id: a\n---\n[[ghost]]\n')
    const r = gi.validate(dir)
    expect(r.broken_links).toContainEqual({ from: 'a.md', to: 'ghost' })
    expect(r.ok).toBe(false)
  })

  test('duplicate node_ids are a hard failure', () => {
    write('d1.md', '---\nnode_id: dup\n---\nx\n')
    write('d2.md', '---\nnode_id: dup\n---\ny\n')
    const r = gi.validate(dir)
    expect(r.duplicate_node_ids.map(d => d.node_id)).toContain('dup')
    expect(r.ok).toBe(false)
  })

  // ---- B3 (#30): node_id is validated against the GRAPH PLAN, not the filename stem ----

  test('a node_id differing from the filename stem is NOT a mismatch (Obsidian title ≠ id)', () => {
    write('m.md', '---\nnode_id: x\n---\nz\n')          // stem 'm' ≠ node_id 'x'
    const r = gi.validate(dir)
    expect(r.node_id_mismatches).toEqual([])
    expect(r.ok).toBe(true)
  })

  test('a node_id absent from the supplied graph plan IS a mismatch', () => {
    write('m.md', '---\nnode_id: x\n---\nz\n')
    write('p.md', '---\nnode_id: known\n---\nq\n')
    const r = gi.validate(dir, { graphNodeIds: ['known'] })  // plan knows 'known', not 'x'
    expect(r.node_id_mismatches.map(m => m.node_id)).toContain('x')
    expect(r.node_id_mismatches.map(m => m.node_id)).not.toContain('known')
    expect(r.ok).toBe(false)
  })

  // ---- B2 (#3) + #39: orphan / missing-backlink are ADVISORY, not ok-affecting ----

  test('an orphan node is reported but does NOT fail ok (incremental write)', () => {
    write('lonely.md', '---\nnode_id: c\n---\nno links, no inbound\n')
    const r = gi.validate(dir)
    expect(r.orphan_nodes).toContain('lonely.md')
    expect(r.ok).toBe(true)
  })

  test('a missing backlink is reported but does NOT fail ok', () => {
    write('a.md', '---\nnode_id: a\n---\n[[b]]\n')   // a→b, b has no b→a
    write('b.md', '---\nnode_id: b\n---\nno links\n')
    const r = gi.validate(dir)
    expect(r.missing_backlinks).toContainEqual({ from: 'a.md', to: 'b.md' })
    expect(r.ok).toBe(true)
  })

  test('a self-link does not count as inbound (#39): a self-linking doc is still an orphan', () => {
    write('s.md', '---\nnode_id: s\n---\n[[s]] points at itself\n')
    expect(gi.validate(dir).orphan_nodes).toContain('s.md')
  })
})
