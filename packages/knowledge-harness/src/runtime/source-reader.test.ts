import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SourceReader, budgetSourcesForPrompt, type SourceDoc } from './source-reader.js'

describe('SourceReader', () => {
  let vault: string
  beforeEach(() => { vault = mkdtempSync(join(tmpdir(), 'kh-src-')) })
  afterEach(() => { rmSync(vault, { recursive: true, force: true }) })
  const write = (rel: string, body: string) => {
    const abs = join(vault, rel); mkdirSync(join(abs, '..'), { recursive: true }); writeFileSync(abs, body)
  }

  test('reads every file under raw/ (any extension) with vault-relative source_path', () => {
    write('raw/sess.jsonl', 'transcript')
    write('raw/notes/config.env', 'KEY=v')
    write('concepts/n1.md', 'not a source')  // outside raw/ → ignored
    const docs = new SourceReader(vault).read()
    const byPath = Object.fromEntries(docs.map(d => [d.source_path, d.text]))
    expect(Object.keys(byPath).sort()).toEqual(['raw/notes/config.env', 'raw/sess.jsonl'])
    expect(byPath['raw/sess.jsonl']).toBe('transcript')
    expect(docs.every(d => d.source_path.startsWith('raw/'))).toBe(true)
  })

  test('returns [] when raw/ is absent', () => {
    expect(new SourceReader(vault).read()).toEqual([])
  })

  test('caps per-file text and marks the truncation', () => {
    write('raw/big.txt', 'x'.repeat(100))
    const [doc] = new SourceReader(vault, 10).read()
    expect(doc.text.startsWith('xxxxxxxxxx')).toBe(true)
    expect(doc.text).toContain('truncated at 10 bytes')
  })
})

describe('budgetSourcesForPrompt', () => {
  const mk = (id: string, len: number): SourceDoc => ({ source_id: id, source_path: `raw/${id}`, text: 'x'.repeat(len), hash: id })

  test('keeps all sources when under budget', () => {
    const sources = [mk('a', 100), mk('b', 100)]
    const r = budgetSourcesForPrompt(sources, 1_000_000)
    expect(r.dropped).toBe(0)
    expect(r.sources).toEqual(sources)
  })

  test('drops sources past the budget and stays under it', () => {
    const sources = Array.from({ length: 10 }, (_, i) => mk(`s${i}`, 1000))
    const r = budgetSourcesForPrompt(sources, 5000)
    expect(r.sources.length).toBeLessThan(10)
    expect(r.dropped).toBe(10 - r.sources.length)
    expect(JSON.stringify(r.sources).length).toBeLessThanOrEqual(5000)
  })

  test('truncates the boundary source so its path stays citable and marks it', () => {
    const sources = [mk('keep', 200), mk('big', 100_000)]
    const r = budgetSourcesForPrompt(sources, 2000)
    // 'keep' fits; 'big' is included truncated (not dropped) so its source_path remains in the prompt
    expect(r.sources.map(s => s.source_id)).toEqual(['keep', 'big'])
    expect(r.dropped).toBe(0)
    expect(r.sources[1].text).toContain('truncated: prompt size budget')
    expect(JSON.stringify(r.sources).length).toBeLessThanOrEqual(2000)
  })
})
