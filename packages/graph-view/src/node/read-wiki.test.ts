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

  test('resolves kernel-style colon refs in edges.jsonl to file nodes', () => {
    const repo = mkdtempSync(join(tmpdir(), 'pw-colon-'))
    const wiki = join(repo, 'wiki')
    mkdirSync(join(wiki, 'modules'), { recursive: true })
    mkdirSync(join(wiki, 'pipelines'), { recursive: true })
    mkdirSync(join(wiki, 'graph'), { recursive: true })
    writeFileSync(join(wiki, 'modules', 'attention-embedding.md'), '---\ntitle: AE\nslug: attention-embedding\n---\n')
    writeFileSync(join(wiki, 'pipelines', 'p1.md'), '---\ntitle: P1\n---\n')
    writeFileSync(join(wiki, 'graph', 'edges.jsonl'),
      JSON.stringify({ from: 'pipelines:p1', to: 'modules:attention-embedding', type: 'uses_module' }) + '\n' +
      JSON.stringify({ from: 'pipelines:p1', to: 'papers:unknown', type: 'pipeline_from_paper' }) + '\n')

    const res = readProjectWiki([repo])
    expect(res.available).toBe(true)
    if (!res.available) return
    expect(res.edges).toContainEqual(expect.objectContaining({ from: 'pipelines/p1', to: 'modules/attention-embedding', type: 'uses_module' }))
    // 해석 실패한 ref는 원본 유지 → 다운스트림에서 유령 노드로 표시
    expect(res.edges).toContainEqual(expect.objectContaining({ from: 'pipelines/p1', to: 'papers:unknown' }))
  })

  test('resolves colon refs whose type prefix comes from frontmatter type (coin company_graph style)', () => {
    const repo = mkdtempSync(join(tmpdir(), 'pw-fmtype-'))
    const wiki = join(repo, 'wiki')
    mkdirSync(join(wiki, 'company_graph'), { recursive: true })
    mkdirSync(join(wiki, 'graph'), { recursive: true })
    writeFileSync(join(wiki, 'company_graph', '000660.KS.md'), '---\ntype: company_graph_node\nticker: "000660.KS"\n---\n')
    writeFileSync(join(wiki, 'company_graph', '005930.KS.md'), '---\ntype: company_graph_node\n---\n')
    writeFileSync(join(wiki, 'graph', 'edges.jsonl'),
      JSON.stringify({ from: 'company_graph_node:000660.KS', to: 'company_graph_node:005930.KS', type: 'candidate_comention' }) + '\n')

    const res = readProjectWiki([repo])
    expect(res.available).toBe(true)
    if (!res.available) return
    expect(res.edges).toContainEqual(expect.objectContaining({ from: 'company_graph/000660.KS', to: 'company_graph/005930.KS', type: 'candidate_comention' }))
  })
})
