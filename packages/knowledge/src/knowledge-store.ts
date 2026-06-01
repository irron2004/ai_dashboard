import { createHash } from 'node:crypto'
import {
  KnowledgeChunkSchema,
  KnowledgeCollectionSchema,
  KnowledgeContextNodeSchema,
  KnowledgeDocumentSchema,
  type KnowledgeChunk,
  type KnowledgeCollection,
  type KnowledgeContextNode,
  type KnowledgeDocument,
  type KnowledgeDocType,
  type KnowledgeStatus,
} from '@apc/shared'
import type { Db } from '@apc/core'
import { chunkMarkdown } from './chunker.js'
import { buildProjectDocUri } from './uri.js'

type CollectionRow = { id: string; project_id: string; name: string; root_path: string; include_globs: string; exclude_globs: string; include_by_default: number }
type ContextRow = { collection_id: string; path_prefix: string; description: string; doc_type: KnowledgeDocType; status_hint: KnowledgeStatus }
type DocRow = { id: string; collection_id: string; project_id: string; uri: string; rel_path: string; title: string; doc_type: KnowledgeDocType; status: KnowledgeStatus; hash: string; updated_at: string; context_text: string }
type ChunkRow = { id: string; doc_id: string; project_id: string; uri: string; heading_path: string; body: string; ordinal: number; token_estimate: number; context_text: string }

function hash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function docId(collectionId: string, relPath: string): string {
  return `${collectionId}:${relPath}`
}

function titleFrom(relPath: string, markdown: string): string {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? relPath.split('/').pop() ?? relPath
}

function collectionFrom(row: CollectionRow): KnowledgeCollection {
  return KnowledgeCollectionSchema.parse({ id: row.id, projectId: row.project_id, name: row.name, rootPath: row.root_path, include: JSON.parse(row.include_globs), exclude: JSON.parse(row.exclude_globs), includeByDefault: row.include_by_default === 1 })
}

function contextFrom(row: ContextRow): KnowledgeContextNode {
  return KnowledgeContextNodeSchema.parse({ collectionId: row.collection_id, pathPrefix: row.path_prefix, description: row.description, docType: row.doc_type, statusHint: row.status_hint })
}

function docFrom(row: DocRow): KnowledgeDocument {
  return KnowledgeDocumentSchema.parse({ id: row.id, collectionId: row.collection_id, projectId: row.project_id, uri: row.uri, relPath: row.rel_path, title: row.title, docType: row.doc_type, status: row.status, hash: row.hash, updatedAt: row.updated_at, contextText: row.context_text })
}

function chunkFrom(row: ChunkRow): KnowledgeChunk {
  return KnowledgeChunkSchema.parse({ id: row.id, docId: row.doc_id, projectId: row.project_id, uri: row.uri, headingPath: JSON.parse(row.heading_path), body: row.body, ordinal: row.ordinal, tokenEstimate: row.token_estimate, contextText: row.context_text })
}

export class KnowledgeStore {
  constructor(private readonly db: Db) {}

  upsertCollection(input: KnowledgeCollection): void {
    const c = KnowledgeCollectionSchema.parse(input)
    this.db.prepare(`INSERT OR REPLACE INTO knowledge_collections
      (id, project_id, name, root_path, include_globs, exclude_globs, include_by_default)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(c.id, c.projectId, c.name, c.rootPath, JSON.stringify(c.include), JSON.stringify(c.exclude), c.includeByDefault ? 1 : 0)
  }

  listCollections(projectId: string): KnowledgeCollection[] {
    const rows = this.db.prepare('SELECT * FROM knowledge_collections WHERE project_id = ? ORDER BY id').all(projectId) as CollectionRow[]
    return rows.map(collectionFrom)
  }

  upsertContext(input: KnowledgeContextNode): void {
    const c = KnowledgeContextNodeSchema.parse(input)
    this.db.prepare(`INSERT OR REPLACE INTO knowledge_contexts
      (collection_id, path_prefix, description, doc_type, status_hint) VALUES (?, ?, ?, ?, ?)`)
      .run(c.collectionId, c.pathPrefix, c.description, c.docType, c.statusHint)
  }

  contextForPath(collectionId: string, relPath: string): KnowledgeContextNode | undefined {
    const normalized = `/${relPath.replace(/^\/+/, '')}`
    const rows = this.db.prepare('SELECT * FROM knowledge_contexts WHERE collection_id = ? ORDER BY length(path_prefix) DESC').all(collectionId) as ContextRow[]
    const match = rows.find((r) => normalized === r.path_prefix || normalized.startsWith(`${r.path_prefix.replace(/\/$/, '')}/`))
    return match ? contextFrom(match) : undefined
  }

  indexMarkdownDoc(input: { collectionId: string; projectId: string; relPath: string; markdown: string; updatedAt: string }): KnowledgeDocument {
    const context = this.contextForPath(input.collectionId, input.relPath)
    const id = docId(input.collectionId, input.relPath)
    const document = KnowledgeDocumentSchema.parse({
      id,
      collectionId: input.collectionId,
      projectId: input.projectId,
      uri: buildProjectDocUri(input.projectId, input.relPath),
      relPath: input.relPath,
      title: titleFrom(input.relPath, input.markdown),
      docType: context?.docType ?? 'unknown',
      status: context?.statusHint ?? 'unknown',
      hash: hash(input.markdown),
      updatedAt: input.updatedAt,
      contextText: context?.description ?? '',
    })
    this.db.prepare(`INSERT OR REPLACE INTO knowledge_documents
      (id, collection_id, project_id, uri, rel_path, title, doc_type, status, hash, updated_at, context_text)
      VALUES (:id, :collectionId, :projectId, :uri, :relPath, :title, :docType, :status, :hash, :updatedAt, :contextText)`).run(document)
    this.db.prepare('DELETE FROM knowledge_chunks WHERE doc_id = ?').run(document.id)
    this.db.prepare('DELETE FROM knowledge_chunk_fts WHERE doc_id = ?').run(document.id)
    const insertChunk = this.db.prepare(`INSERT INTO knowledge_chunks
      (id, doc_id, project_id, uri, heading_path, body, ordinal, token_estimate, context_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const insertFts = this.db.prepare('INSERT INTO knowledge_chunk_fts (chunk_id, doc_id, project_id, title, context_text, body) VALUES (?, ?, ?, ?, ?, ?)')
    for (const draft of chunkMarkdown(input.markdown)) {
      const chunk = KnowledgeChunkSchema.parse({ id: `${document.id}#${draft.ordinal}`, docId: document.id, projectId: document.projectId, uri: `${document.uri}#chunk-${draft.ordinal}`, headingPath: draft.headingPath, body: draft.body, ordinal: draft.ordinal, tokenEstimate: draft.tokenEstimate, contextText: document.contextText })
      insertChunk.run(chunk.id, chunk.docId, chunk.projectId, chunk.uri, JSON.stringify(chunk.headingPath), chunk.body, chunk.ordinal, chunk.tokenEstimate, chunk.contextText)
      insertFts.run(chunk.id, chunk.docId, chunk.projectId, document.title, chunk.contextText, chunk.body)
    }
    return document
  }

  getDocument(id: string): KnowledgeDocument | undefined {
    const row = this.db.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(id) as DocRow | undefined
    return row ? docFrom(row) : undefined
  }

  listChunks(docIdValue: string): KnowledgeChunk[] {
    const rows = this.db.prepare('SELECT * FROM knowledge_chunks WHERE doc_id = ? ORDER BY ordinal').all(docIdValue) as ChunkRow[]
    return rows.map(chunkFrom)
  }
}
