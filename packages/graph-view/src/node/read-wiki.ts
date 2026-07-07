import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, sep } from 'node:path'

export type WikiGraphNode = { ref: string; type: string; title: string; relPath: string }
export type WikiGraphEdge = { from: string; to: string; type: string } & Record<string, unknown>
export type ReadWikiResult =
  | { available: true; wikiDir: string; nodes: WikiGraphNode[]; edges: WikiGraphEdge[] }
  | { available: false; reason?: string }

const FRONT = (body: string, key: string): string | undefined => {
  if (!body.startsWith('---')) return undefined
  const end = body.indexOf('\n---', 3)
  const fm = end === -1 ? '' : body.slice(3, end)
  return unquote(fm.match(new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.+)$`, 'm'))?.[1]?.trim())
}

function unquote(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.replace(/^['"]|['"]$/g, '')
}

function posixRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/')
}

function walkFiles(root: string): string[] {
  const out: string[] = []
  const rec = (dir: string): void => {
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      const rel = posixRel(root, abs)
      if (shouldSkip(rel)) continue
      if (entry.isDirectory()) rec(abs)
      else if (entry.isFile()) out.push(rel)
    }
  }
  rec(root)
  return out
}

function shouldSkip(rel: string): boolean {
  const first = rel.split('/')[0]
  if (['raw', 'runs', 'graph', 'agent-runs'].includes(first)) return true
  if (rel.includes('/agent-runs/')) return true
  if (rel.endsWith('.proposal.md')) return true
  return false
}

function nodeTypeAndRef(rootRel: string, body: string): { type: string; ref: string; slug: string } {
  const withoutExt = rootRel.replace(/\.(md|mdx)$/i, '')
  const parts = withoutExt.split('/').filter(Boolean)
  const slug = FRONT(body, 'slug') ?? parts.at(-1) ?? withoutExt
  if (parts.length >= 2) return { type: parts[0], ref: `${parts[0]}/${slug}`, slug }
  return { type: 'document', ref: `document/${slug}`, slug }
}

function wikiLinks(body: string): string[] {
  const out: string[] = []
  const re = /\[\[([^\]]+)\]\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(body))) {
    const target = match[1]?.split('|')[0]?.split('#')[0]?.trim()
    if (target) out.push(target)
  }
  return out
}

function addAlias(map: Map<string, string>, alias: string | undefined, ref: string): void {
  if (!alias) return
  const key = alias.replace(/\\/g, '/').replace(/\.(md|mdx)$/i, '').trim()
  if (key) map.set(key, ref)
}

function readEdges(edgesFile: string): WikiGraphEdge[] {
  const edges: WikiGraphEdge[] = []
  if (!existsSync(edgesFile)) return edges
  for (const line of readFileSync(edgesFile, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      const e = JSON.parse(t)
      if (e && typeof e.from === 'string' && typeof e.to === 'string' && typeof e.type === 'string') edges.push(e)
    } catch { /* skip malformed line */ }
  }
  return edges
}

function readWikiRoot(root: string, relPrefix: string): ReadWikiResult {
  if (!existsSync(root)) return { available: false }
  const nodes: WikiGraphNode[] = []
  const bodies = new Map<string, string>()
  const targetToRef = new Map<string, string>()

  for (const rel of walkFiles(root)) {
    if (!/\.(md|mdx)$/i.test(rel)) continue
    if (['index.md', 'log.md'].includes(basename(rel))) continue
    try {
      const abs = join(root, rel)
      if (!statSync(abs).isFile()) continue
      const body = readFileSync(abs, 'utf8')
      const { type, ref, slug } = nodeTypeAndRef(rel, body)
      const title = FRONT(body, 'title') ?? FRONT(body, 'node_id') ?? basename(rel).replace(/\.(md|mdx)$/i, '')
      const relPath = `${relPrefix}/${rel}`.replace(/\\/g, '/')
      nodes.push({ ref, type, title, relPath })
      bodies.set(ref, body)
      addAlias(targetToRef, ref, ref)
      addAlias(targetToRef, rel, ref)
      addAlias(targetToRef, relPath, ref)
      addAlias(targetToRef, rel.replace(/^[^/]+\//, ''), ref)
      addAlias(targetToRef, FRONT(body, 'slug'), ref)
      addAlias(targetToRef, FRONT(body, 'title'), ref)
      addAlias(targetToRef, FRONT(body, 'node_id'), ref)
      addAlias(targetToRef, `${type}:${slug}`, ref)
      const fmType = FRONT(body, 'type')
      if (fmType && fmType !== type) addAlias(targetToRef, `${fmType}:${slug}`, ref)
    } catch { /* skip unreadable node file */ }
  }

  const resolveRef = (value: string): string =>
    targetToRef.get(value.replace(/\\/g, '/').replace(/\.(md|mdx)$/i, '').trim()) ?? value
  const edges = readEdges(join(root, 'graph', 'edges.jsonl'))
    .map((e) => ({ ...e, from: resolveRef(e.from), to: resolveRef(e.to) }))
  const seen = new Set(edges.map((e) => `${e.from}->${e.to}:${e.type}`))
  for (const node of nodes) {
    const body = bodies.get(node.ref) ?? ''
    for (const target of wikiLinks(body)) {
      const to = targetToRef.get(target.replace(/\\/g, '/').replace(/\.(md|mdx)$/i, ''))
      if (!to || to === node.ref) continue
      const key = `${node.ref}->${to}:wiki`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from: node.ref, to, type: 'wiki' })
    }
  }

  return nodes.length || edges.length ? { available: true, wikiDir: root, nodes, edges } : { available: false }
}

/** vaultPath가 repoPath 내부면 repo-상대 prefix(파일 미리보기 fsReadDoc 호환), 아니면 디렉터리명. */
function vaultRelPrefix(repoPaths: readonly string[], vault: string): string {
  for (const repo of repoPaths) {
    if (!repo || repo.startsWith('ssh://')) continue
    const rel = relative(repo, vault)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/')
  }
  return basename(vault)
}

/** Read a project's wiki into graph data. Explicit registry vaultPaths (direct wiki roots) win;
 *  then the published `<repo>/wiki`; then internal generated docs in `<repo>/.apc-wiki`.
 *  Never throws — returns {available:false} on failure. */
export function readProjectWiki(repoPaths: readonly string[], vaultPaths: readonly string[] = []): ReadWikiResult {
  for (const vault of vaultPaths) {
    if (!vault || vault.startsWith('ssh://')) continue
    try {
      const direct = readWikiRoot(vault, vaultRelPrefix(repoPaths, vault))
      if (direct.available) return direct
    } catch { /* try next root */ }
  }
  for (const repo of repoPaths) {
    if (!repo || repo.startsWith('ssh://')) continue
    try {
      const published = readWikiRoot(join(repo, 'wiki'), 'wiki')
      if (published.available) return published
      const internal = readWikiRoot(join(repo, '.apc-wiki'), '.apc-wiki')
      if (internal.available) return internal
    } catch { return { available: false, reason: 'wiki read failed' } }
  }
  return { available: false }
}
