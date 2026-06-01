import { KnowledgeChunkSchema, KnowledgeDocumentSchema, KnowledgeSearchHitSchema, type KnowledgeSearchHit, type KnowledgeStatus } from '@apc/shared'
import type { Db } from '@apc/core'

type Row = {
  doc_id: string
  chunk_id: string
  snip: string
  rank_value: number
  id: string
  collection_id: string
  project_id: string
  uri: string
  rel_path: string
  title: string
  doc_type: string
  status: KnowledgeStatus
  hash: string
  updated_at: string
  context_text: string
  heading_path: string
  body: string
  ordinal: number
  token_estimate: number
  chunk_context_text: string
  chunk_uri: string
}

export type KnowledgeSearchOptions = { projectId: string; query: string; limit?: number }

function boost(status: KnowledgeStatus): { value: number; reasons: string[]; warnings: string[] } {
  if (status === 'canonical' || status === 'accepted') return { value: 1.0, reasons: [`status:${status}`], warnings: [] }
  if (status === 'superseded' || status === 'deprecated') return { value: -1.0, reasons: [`status:${status}`], warnings: [] }
  if (status === 'conflict') return { value: -0.25, reasons: ['status:conflict'], warnings: ['conflict-document'] }
  return { value: 0, reasons: [`status:${status}`], warnings: [] }
}

export class KnowledgeRetrieval {
  constructor(private readonly db: Db) {}

  search(opts: KnowledgeSearchOptions): KnowledgeSearchHit[] {
    const rows = this.db.prepare(`
      SELECT f.doc_id, f.chunk_id, snippet(knowledge_chunk_fts, 5, '[', ']', '…', 12) AS snip,
             bm25(knowledge_chunk_fts) AS rank_value,
             d.id, d.collection_id, d.project_id, d.uri, d.rel_path, d.title, d.doc_type, d.status, d.hash, d.updated_at, d.context_text,
             c.heading_path, c.body, c.ordinal, c.token_estimate, c.context_text AS chunk_context_text, c.uri AS chunk_uri
      FROM knowledge_chunk_fts f
      JOIN knowledge_documents d ON d.id = f.doc_id
      JOIN knowledge_chunks c ON c.id = f.chunk_id
      WHERE knowledge_chunk_fts MATCH ? AND f.project_id = ?
      ORDER BY rank_value
      LIMIT ?
    `).all(opts.query, opts.projectId, opts.limit ?? 10) as Row[]
    return rows
      .map((row) => {
        const metadata = boost(row.status)
        const baseScore = -row.rank_value
        return KnowledgeSearchHitSchema.parse({
          doc: KnowledgeDocumentSchema.parse({ id: row.id, collectionId: row.collection_id, projectId: row.project_id, uri: row.uri, relPath: row.rel_path, title: row.title, docType: row.doc_type, status: row.status, hash: row.hash, updatedAt: row.updated_at, contextText: row.context_text }),
          chunk: KnowledgeChunkSchema.parse({ id: row.chunk_id, docId: row.doc_id, projectId: row.project_id, uri: row.chunk_uri, headingPath: JSON.parse(row.heading_path), body: row.body, ordinal: row.ordinal, tokenEstimate: row.token_estimate, contextText: row.chunk_context_text }),
          score: baseScore + metadata.value,
          reasons: ['fts', ...metadata.reasons],
          warnings: metadata.warnings,
        })
      })
      .sort((a, b) => b.score - a.score)
  }
}
