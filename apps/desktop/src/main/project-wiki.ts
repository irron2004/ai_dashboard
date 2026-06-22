import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type WikiGraphNode = { ref: string; type: string; title: string; relPath: string }
export type WikiGraphEdge = { from: string; to: string; type: string } & Record<string, unknown>
export type ReadWikiResult =
  | { available: true; wikiDir: string; nodes: WikiGraphNode[]; edges: WikiGraphEdge[] }
  | { available: false; reason?: string }

const FRONT = (body: string, key: string): string | undefined => {
  if (!body.startsWith('---')) return undefined
  const end = body.indexOf('\n---', 3)
  const fm = end === -1 ? '' : body.slice(3, end)
  return fm.match(new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.+)$`, 'm'))?.[1]?.trim()
}

/** Read a project's published wiki (<repo>/wiki) into graph data. First LOCAL repo whose
 *  wiki/graph/edges.jsonl exists wins. Never throws — returns {available:false} on any problem. */
export function readProjectWiki(repoPaths: readonly string[]): ReadWikiResult {
  for (const repo of repoPaths) {
    if (!repo || repo.startsWith('ssh://')) continue
    const wikiDir = join(repo, 'wiki')
    const edgesFile = join(wikiDir, 'graph', 'edges.jsonl')
    try {
      if (!existsSync(edgesFile)) continue
      const edges: WikiGraphEdge[] = []
      for (const line of readFileSync(edgesFile, 'utf8').split(/\r?\n/)) {
        const t = line.trim()
        if (!t) continue
        try {
          const e = JSON.parse(t)
          if (e && typeof e.from === 'string' && typeof e.to === 'string' && typeof e.type === 'string') edges.push(e)
        } catch { /* skip malformed line */ }
      }
      const nodes: WikiGraphNode[] = []
      for (const entry of readdirSync(wikiDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === 'graph') continue
        const type = entry.name
        const dir = join(wikiDir, type)
        let files: string[]
        try { files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'index.md' && f !== 'log.md') } catch { continue }
        for (const file of files) {
          try {
            const abs = join(dir, file)
            if (!statSync(abs).isFile()) continue
            const body = readFileSync(abs, 'utf8')
            const slug = FRONT(body, 'slug') ?? file.replace(/\.md$/i, '')
            const title = FRONT(body, 'title') ?? slug
            nodes.push({ ref: `${type}/${slug}`, type, title, relPath: `wiki/${type}/${file}`.replace(/\\/g, '/') })
          } catch { /* skip unreadable node file */ }
        }
      }
      return { available: true, wikiDir, nodes, edges }
    } catch { return { available: false, reason: 'wiki read failed' } }
  }
  return { available: false }
}
