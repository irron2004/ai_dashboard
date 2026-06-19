import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename, relative } from 'node:path'

type Node = { id: string; title: string; type: string; relPath: string; body: string }

/** wiki/<type>/<slug>.md 의 frontmatter를 읽어 노드로 만든다. type = 디렉터리명(papers/modules/pipelines…). */
function readNodes(wikiDir: string): Node[] {
  const out: Node[] = []
  let types: string[]
  try { types = readdirSync(wikiDir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'graph').map((e) => e.name) }
  catch { return out }
  for (const type of types) {
    const dir = join(wikiDir, type)
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
      const body = readFileSync(join(dir, name), 'utf8')
      const fm = body.startsWith('---') ? body.slice(3, body.indexOf('\n---', 3)) : ''
      const slug = fm.match(/^slug:\s*(.+)$/m)?.[1]?.trim() ?? basename(name, '.md')
      const title = fm.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? slug
      out.push({ id: slug, title, type, relPath: `${type}/${name}`, body })
    }
  }
  return out
}

/** buildHarnessGraphData가 소비하는 node-proposals 형태로 투영. */
export function vaultToNodeProposals(wikiDir: string): { proposals: Array<{ proposal_id: string; node: { id: string; title: string; type: string } }> } {
  return { proposals: readNodes(wikiDir).map((n) => ({ proposal_id: n.id, node: { id: n.id, title: n.title, type: n.type } })) }
}

/** 각 노드를 node_id/node_type frontmatter 마크다운으로 staging에 써서 collectStagedDocs가 노드로 인식하게 한다. */
export function vaultToStagedDocs(wikiDir: string, stagingRoot: string): string[] {
  const written: string[] = []
  for (const n of readNodes(wikiDir)) {
    const rel = join('nodes', `${n.id}.md`)
    const abs = join(stagingRoot, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, `---\nnode_id: ${n.id}\nnode_type: ${n.type}\ntitle: ${n.title}\n---\n\n# ${n.title}\n`)
    written.push(rel.replace(/\\/g, '/'))
  }
  return written
}
