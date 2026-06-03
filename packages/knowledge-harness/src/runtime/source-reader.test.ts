import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SourceReader } from './source-reader.js'

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
