import type { Db } from '@apc/core'

export function migrateKnowledge(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_collections (
      id                 TEXT PRIMARY KEY,
      project_id         TEXT NOT NULL,
      name               TEXT NOT NULL,
      root_path          TEXT NOT NULL,
      include_globs      TEXT NOT NULL DEFAULT '["**/*.md"]',
      exclude_globs      TEXT NOT NULL DEFAULT '[]',
      include_by_default INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS knowledge_contexts (
      collection_id TEXT NOT NULL,
      path_prefix   TEXT NOT NULL,
      description   TEXT NOT NULL,
      doc_type      TEXT NOT NULL DEFAULT 'unknown',
      status_hint   TEXT NOT NULL DEFAULT 'unknown',
      PRIMARY KEY (collection_id, path_prefix),
      FOREIGN KEY (collection_id) REFERENCES knowledge_collections(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id            TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      project_id    TEXT NOT NULL,
      uri           TEXT NOT NULL,
      rel_path      TEXT NOT NULL,
      title         TEXT NOT NULL,
      doc_type      TEXT NOT NULL DEFAULT 'unknown',
      status        TEXT NOT NULL DEFAULT 'unknown',
      hash          TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      context_text  TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (collection_id) REFERENCES knowledge_collections(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id             TEXT PRIMARY KEY,
      doc_id         TEXT NOT NULL,
      project_id     TEXT NOT NULL,
      uri            TEXT NOT NULL,
      heading_path   TEXT NOT NULL DEFAULT '[]',
      body           TEXT NOT NULL,
      ordinal        INTEGER NOT NULL,
      token_estimate INTEGER NOT NULL,
      context_text   TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (doc_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunk_fts
      USING fts5(chunk_id, doc_id, project_id, title, context_text, body);

    CREATE INDEX IF NOT EXISTS idx_knowledge_documents_project ON knowledge_documents(project_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_project ON knowledge_chunks(project_id);
  `)
}
