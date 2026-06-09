import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ProjectRegistry } from '@apc/core'
import type { KnowledgeStore } from '@apc/knowledge'

const SCAN_LIMIT = 2000
const DEPTH_LIMIT = 12

export type KnowledgeIndexerDeps = { registry: ProjectRegistry; store: KnowledgeStore; vaultRoot: string }
export type KnowledgeReindexResult = { documents: number }

export class KnowledgeIndexer {
  constructor(private readonly deps: KnowledgeIndexerDeps) {}

  reindexAll(): KnowledgeReindexResult {
    let documents = 0
    for (const project of this.deps.registry.list()) documents += this.reindexProject(project.id)
    return { documents }
  }

  reindexProject(projectId: string): number {
    const project = this.deps.registry.get(projectId)
    if (!project) return 0
    const collectionId = `project:${projectId}`
    const projectVaultRoot = join(this.deps.vaultRoot, 'projects', projectId)
    this.deps.store.upsertCollection({
      id: collectionId, projectId, name: project.name,
      rootPath: projectVaultRoot, include: ['**/*.md', '**/*.mdx'], exclude: [], includeByDefault: true,
    })
    // clearProject must run AFTER upsertCollection: upsertCollection's INSERT OR REPLACE cascades
    // doc/chunk deletes but leaves orphaned FTS rows; clearProject (deletes FTS by project_id) cleans them.
    this.deps.store.clearProject(projectId)
    let count = 0
    const roots = [...new Set([...project.vaultPaths, projectVaultRoot])]
    for (const root of roots) {
      for (const file of listMarkdownFiles(root)) {
        let markdown: string
        let updatedAt: string
        try {
          markdown = readFileSync(file, 'utf8')
          updatedAt = statSync(file).mtime.toISOString()
        } catch {
          continue
        }
        const relPath = relative(root, file).split('\\').join('/')
        if (!relPath) continue
        this.deps.store.indexMarkdownDoc({ collectionId, projectId, relPath, markdown, updatedAt })
        count++
      }
    }
    return count
  }
}

function listMarkdownFiles(root: string): string[] {
  const found: string[] = []
  const visit = (path: string, depth: number): void => {
    if (found.length >= SCAN_LIMIT || depth > DEPTH_LIMIT) return
    let st: import('node:fs').Stats | undefined
    try { st = statSync(path, { throwIfNoEntry: false }) } catch { return }
    if (!st) return
    if (st.isFile()) { if (/\.mdx?$/i.test(path)) found.push(path); return }
    if (!st.isDirectory()) return
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(path, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      visit(join(path, entry.name), depth + 1)
      if (found.length >= SCAN_LIMIT) return
    }
  }
  visit(root, 0)
  return found
}
