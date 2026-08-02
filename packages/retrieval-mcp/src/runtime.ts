import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { ProjectRegistry } from '@apc/core'
import { KnowledgeRetrieval, KnowledgeStore } from '@apc/knowledge'
import {
  EvidenceSourceResolver,
  KnowledgeFtsRetriever,
  RetrievalService,
  type EvidenceSourceResolveResult,
} from '@apc/retrieval'
import type { RetrievalResponse } from '@apc/shared'
import type { RetrievalMcpConfig } from './config.js'
import { refreshWorkspaceIndex, type WorkspaceIndexRefreshResult } from './workspace-index.js'

export type EvidenceProject = {
  id: string
  name: string
  rootPath: string
  documents: number
}

export type EvidenceProjectList = {
  indexedAt?: string
  workspaceRoot?: string
  projects: EvidenceProject[]
}

export type SearchEvidenceInput = {
  query: string
  projectIds?: string[]
  limit?: number
}

export class RetrievalIndexUnavailableError extends Error {
  readonly code = 'retrieval-index-unavailable'

  constructor(readonly dbPath: string) {
    super(`retrieval index is unavailable at ${dbPath}; call refresh_evidence_index first`)
    this.name = 'RetrievalIndexUnavailableError'
  }
}

function openExisting(config: RetrievalMcpConfig): DatabaseSync {
  if (!existsSync(config.dbPath)) throw new RetrievalIndexUnavailableError(config.dbPath)
  return new DatabaseSync(config.dbPath, { readOnly: true })
}

function metadata(db: DatabaseSync, key: string): string | undefined {
  try {
    return (db.prepare('SELECT value FROM workspace_retrieval_meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined)?.value
  } catch {
    return undefined
  }
}

export class WorkspaceRetrievalRuntime {
  constructor(readonly config: RetrievalMcpConfig) {}

  refresh(): Promise<WorkspaceIndexRefreshResult> {
    return refreshWorkspaceIndex(this.config)
  }

  listProjects(): EvidenceProjectList {
    const db = openExisting(this.config)
    try {
      const registry = new ProjectRegistry(db)
      const count = db.prepare(
        'SELECT COUNT(*) AS documents FROM knowledge_documents WHERE project_id = ?',
      )
      return {
        indexedAt: metadata(db, 'indexed_at'),
        workspaceRoot: metadata(db, 'workspace_root'),
        projects: registry.list().map((project) => ({
          id: project.id,
          name: project.name,
          rootPath: project.repoPaths[0] ?? '',
          documents: Number((count.get(project.id) as { documents: number }).documents),
        })),
      }
    } finally {
      db.close()
    }
  }

  async search(input: SearchEvidenceInput): Promise<RetrievalResponse> {
    const db = openExisting(this.config)
    try {
      const registry = new ProjectRegistry(db)
      const projectIds = input.projectIds ?? registry.list().map((project) => project.id)
      const service = new RetrievalService({
        registry,
        retrievers: [new KnowledgeFtsRetriever(new KnowledgeRetrieval(db))],
      })
      return await service.search({
        text: input.query,
        scope: { projectIds },
        limit: input.limit ?? 10,
        sourceKinds: ['knowledge'],
      })
    } finally {
      db.close()
    }
  }

  getSource(uri: string, neighbors = 1): EvidenceSourceResolveResult {
    const db = openExisting(this.config)
    try {
      const registry = new ProjectRegistry(db)
      const resolver = new EvidenceSourceResolver({
        registry,
        projectRoots: (projectId) => {
          const project = registry.get(projectId)
          return project ? [...project.repoPaths, ...project.vaultPaths].filter(Boolean) : []
        },
        knowledge: new KnowledgeStore(db),
        sessions: { resolveTurnContext: () => undefined },
      })
      return resolver.resolve({ uri, neighbors })
    } finally {
      db.close()
    }
  }
}
