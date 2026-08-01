import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ProjectRegistry } from '@apc/core'
import type { KnowledgeSnapshotDocument, KnowledgeStore } from '@apc/knowledge'

const DEFAULT_SCAN_LIMIT = 2000
const DEPTH_LIMIT = 12

export type KnowledgeIndexerDeps = {
  registry: ProjectRegistry
  store: KnowledgeStore
  vaultRoot: string
  scanLimit?: number
  readMarkdown?: (path: string) => string
}
export type KnowledgeReindexResult = { documents: number }

export type KnowledgeIndexScanErrorCode =
  | 'scan-limit'
  | 'depth-limit'
  | 'scan-failed'
  | 'read-failed'
  | 'duplicate-relpath'

export class KnowledgeIndexScanError extends Error {
  constructor(
    readonly code: KnowledgeIndexScanErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'KnowledgeIndexScanError'
  }
}

type ScannedFile = { root: string; path: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Build a complete, deterministic file list. Any bounded/incomplete scan fails before DB apply. */
function listMarkdownFiles(roots: readonly string[], scanLimit: number): ScannedFile[] {
  const found: ScannedFile[] = []
  const visit = (root: string, path: string, depth: number): void => {
    if (depth > DEPTH_LIMIT) {
      throw new KnowledgeIndexScanError(
        'depth-limit',
        `knowledge scan depth limit ${DEPTH_LIMIT} reached at ${path}`,
      )
    }
    let st: import('node:fs').Stats | undefined
    try {
      st = statSync(path, { throwIfNoEntry: false })
    } catch (error) {
      throw new KnowledgeIndexScanError('scan-failed', `knowledge scan failed for ${path}: ${errorMessage(error)}`)
    }
    // A project may not have created its optional internal/external vault root yet.
    if (!st) return
    if (st.isFile()) {
      if (!/\.mdx?$/i.test(path)) return
      if (found.length >= scanLimit) {
        throw new KnowledgeIndexScanError(
          'scan-limit',
          `knowledge scan limit ${scanLimit} exceeded`,
        )
      }
      found.push({ root, path })
      return
    }
    if (!st.isDirectory()) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(path, { withFileTypes: true })
    } catch (error) {
      throw new KnowledgeIndexScanError('scan-failed', `knowledge scan failed for ${path}: ${errorMessage(error)}`)
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      visit(root, join(path, entry.name), depth + 1)
    }
  }

  for (const root of roots) visit(root, root, 0)
  return found
}

export class KnowledgeIndexer {
  private readonly scanLimit: number
  private readonly readMarkdown: (path: string) => string

  constructor(private readonly deps: KnowledgeIndexerDeps) {
    this.scanLimit = deps.scanLimit ?? DEFAULT_SCAN_LIMIT
    if (!Number.isInteger(this.scanLimit) || this.scanLimit < 1) {
      throw new RangeError('knowledge scanLimit must be a positive integer')
    }
    this.readMarkdown = deps.readMarkdown ?? ((path) => readFileSync(path, 'utf8'))
  }

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
    const roots = [...new Set([...project.vaultPaths, projectVaultRoot])]

    // Read the complete source snapshot before opening the write transaction. An unreadable file,
    // duplicate locator, or bounded scan therefore leaves the previous searchable snapshot intact.
    const documentsByRelPath = new Map<string, KnowledgeSnapshotDocument & { sourcePath: string }>()
    for (const file of listMarkdownFiles(roots, this.scanLimit)) {
      const relPath = relative(file.root, file.path).split('\\').join('/')
      if (!relPath) continue
      const duplicate = documentsByRelPath.get(relPath)
      if (duplicate && duplicate.sourcePath !== file.path) {
        throw new KnowledgeIndexScanError(
          'duplicate-relpath',
          `duplicate relPath across knowledge roots: ${relPath} (${duplicate.sourcePath}, ${file.path})`,
        )
      }
      let markdown: string
      let updatedAt: string
      try {
        markdown = this.readMarkdown(file.path)
        updatedAt = statSync(file.path).mtime.toISOString()
      } catch (error) {
        throw new KnowledgeIndexScanError(
          'read-failed',
          `knowledge source read failed for ${file.path}: ${errorMessage(error)}`,
        )
      }
      documentsByRelPath.set(relPath, { relPath, markdown, updatedAt, sourcePath: file.path })
    }

    const documents = [...documentsByRelPath.values()]
      .sort((left, right) => left.relPath.localeCompare(right.relPath))
      .map(({ sourcePath: _sourcePath, ...document }) => document)
    this.deps.store.applyProjectSnapshot({
      collection: {
        id: collectionId,
        projectId,
        name: project.name,
        rootPath: projectVaultRoot,
        include: ['**/*.md', '**/*.mdx'],
        exclude: [],
        includeByDefault: true,
      },
      documents,
    })
    return documents.length
  }
}
