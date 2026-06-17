import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { resolveInside } from '@apc/knowledge-harness'

export type StagedDocEntry = {
  /** vault-staging-relative path, with forward slashes. */
  relPath: string
  /** True when leading frontmatter carries node_id, meaning a rendered node rather than a legacy stub. */
  isNode: boolean
  nodeId?: string
  nodeType?: string
  title?: string
}

const SKIP_DIRS = new Set(['raw', 'runs', 'reviews', '.git', 'node_modules'])
const MARKDOWN = /\.md$/i
const DEPTH_LIMIT = 8
const LIST_LIMIT = 5_000

export function parseStagedDoc(text: string): { nodeId?: string; nodeType?: string; title?: string } {
  const head = text.slice(0, 4096)
  let nodeId: string | undefined
  let nodeType: string | undefined

  if (head.startsWith('---')) {
    const end = head.indexOf('\n---', 3)
    const fm = end === -1 ? head : head.slice(0, end)
    nodeId = fm.match(/^node_id:\s*(.+)$/m)?.[1]?.trim()
    nodeType = fm.match(/^node_type:\s*(.+)$/m)?.[1]?.trim()
  }

  const title = head.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return { nodeId, nodeType, title }
}

export function collectStagedDocs(runsRoot: string, runId: string): StagedDocEntry[] {
  let base: string
  try {
    base = resolveInside(runsRoot, join(runId, 'vault-staging'))
  } catch {
    return []
  }

  const out: StagedDocEntry[] = []

  const visit = (dir: string, depth: number): void => {
    if (out.length >= LIST_LIMIT || depth > DEPTH_LIMIT) return

    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue

      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) visit(full, depth + 1)
        continue
      }

      if (!entry.isFile() || !MARKDOWN.test(entry.name)) continue

      let text: string
      try {
        text = readFileSync(full, 'utf8')
      } catch {
        continue
      }

      const parsed = parseStagedDoc(text)
      out.push({
        relPath: relative(base, full).split(sep).join('/'),
        isNode: !!parsed.nodeId,
        nodeId: parsed.nodeId,
        nodeType: parsed.nodeType,
        title: parsed.title,
      })
      if (out.length >= LIST_LIMIT) return
    }
  }

  visit(base, 0)
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath))
}
