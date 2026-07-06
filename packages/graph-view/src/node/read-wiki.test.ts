import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readProjectWiki } from './read-wiki.js'

function makeWiki(): string {
  const repo = mkdtempSync(join(tmpdir(), 'pw-'))
  const wiki = join(repo, 'wiki')
  mkdirSync(join(wiki, 'graph'), { recursive: true })
  mkdirSync(join(wiki, 'papers'), { recursive: true })
  mkdirSync(join(wiki, 'methods'), { recursive: true })
  writeFileSync(join(wiki, 'graph', 'edges.jsonl'), [
    JSON.stringify({ from: 'papers/transformer', to: 'methods/self-attention', type: 'uses_method', confidence: 'high' }),
    '',
    '{ broken',
    JSON.stringify({ from: 'papers/transformer', type: 'missing-to' }),
  ].join('\n'))
  writeFileSync(join(wiki, 'papers', 'transformer.md'), '---\nslug: transformer\ntitle: Attention Is All You Need\n---\nbody')
  writeFileSync(join(wiki, 'methods', 'self-attention.md'), '---\ntitle: Self-Attention\n---\nbody')
  writeFileSync(join(wiki, 'index.md'), '# index')  // must be skipped (not a node)
  return repo
}

describe('readProjectWiki', () => {
  test('reads nodes + well-formed edges, skips malformed lines and index.md', () => {
    const repo = makeWiki()
    const res = readProjectWiki([repo])
    expect(res.available).toBe(true)
    if (!res.available) return
    expect(res.edges).toHaveLength(1)
    expect(res.edges[0]).toMatchObject({ from: 'papers/transformer', to: 'methods/self-attention', type: 'uses_method', confidence: 'high' })
    const refs = res.nodes.map((n) => n.ref).sort()
    expect(refs).toEqual(['methods/self-attention', 'papers/transformer'])
    const t = res.nodes.find((n) => n.ref === 'papers/transformer')
    expect(t).toMatchObject({ type: 'papers', title: 'Attention Is All You Need', relPath: 'wiki/papers/transformer.md' })
    expect(res.nodes.some((n) => n.ref.startsWith('index'))).toBe(false)
  })

  test('available:false when no wiki docs exist, and skips ssh repos — never throws', () => {
    expect(readProjectWiki([mkdtempSync(join(tmpdir(), 'pw-empty-'))]).available).toBe(false)
    expect(readProjectWiki(['ssh://me@host/home/me/proj']).available).toBe(false)
    expect(readProjectWiki([]).available).toBe(false)
  })

  test('reads a published LLM wiki without edges.jsonl and derives wiki-link edges', () => {
    const repo = mkdtempSync(join(tmpdir(), 'pw-llm-'))
    const wiki = join(repo, 'wiki')
    mkdirSync(join(wiki, 'concepts'), { recursive: true })
    writeFileSync(join(wiki, 'current.md'), '# Current\n\nSee [[concepts/router]] and [[Router]].')
    writeFileSync(join(wiki, 'concepts', 'router.md'), '---\ntitle: Router\n---\n# Router\n')

    const res = readProjectWiki([repo])
    expect(res.available).toBe(true)
    if (!res.available) return
    expect(res.nodes.map((n) => n.ref).sort()).toEqual(['concepts/router', 'document/current'])
    expect(res.edges).toContainEqual({ from: 'document/current', to: 'concepts/router', type: 'wiki' })
    expect(res.nodes.find((n) => n.ref === 'document/current')?.relPath).toBe('wiki/current.md')
  })

  test('falls back to internal .apc-wiki docs but skips raw source copies', () => {
    const repo = mkdtempSync(join(tmpdir(), 'pw-internal-'))
    mkdirSync(join(repo, '.apc-wiki', 'concepts'), { recursive: true })
    mkdirSync(join(repo, '.apc-wiki', 'raw', 'project-docs', '0'), { recursive: true })
    writeFileSync(join(repo, '.apc-wiki', 'concepts', 'engine.md'), '---\ntitle: Engine\n---\n# Engine\n')
    writeFileSync(join(repo, '.apc-wiki', 'raw', 'project-docs', '0', 'source.md'), '# Source copy')

    const res = readProjectWiki([repo])
    expect(res.available).toBe(true)
    if (!res.available) return
    expect(res.nodes).toHaveLength(1)
    expect(res.nodes[0]).toMatchObject({ ref: 'concepts/engine', relPath: '.apc-wiki/concepts/engine.md' })
  })
})
