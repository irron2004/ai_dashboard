import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed'

export type JobRecord = {
  id: string
  type: string
  status: JobStatus
  input: unknown
  result: unknown
  error: string | null
}

export type JobHandler = (input: unknown) => Promise<unknown>

/**
 * MVP job runner. Persists jobs to SQLite and runs handlers in-process.
 * Implements the WorkflowRunner contract via the generic start()/getJobStatus().
 * Plan: a TemporalWorkflowRunner can replace this behind the same surface.
 */
export class LocalWorkerRunner {
  private readonly handlers = new Map<string, JobHandler>()

  constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL,
        status     TEXT NOT NULL,
        input      TEXT NOT NULL,
        result     TEXT,
        error      TEXT
      );
    `)
  }

  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler)
  }

  async start(type: string, input: unknown): Promise<string> {
    const handler = this.handlers.get(type)
    if (!handler) throw new Error(`No handler registered for job type: ${type}`)

    const id = randomUUID()
    this.db
      .prepare('INSERT INTO jobs (id, type, status, input) VALUES (?, ?, ?, ?)')
      .run(id, type, 'running', JSON.stringify(input))

    try {
      const result = await handler(input)
      this.db
        .prepare('UPDATE jobs SET status = ?, result = ? WHERE id = ?')
        .run('completed', JSON.stringify(result ?? null), id)
    } catch (err) {
      this.db
        .prepare('UPDATE jobs SET status = ?, error = ? WHERE id = ?')
        .run('failed', err instanceof Error ? err.message : String(err), id)
    }
    return id
  }

  getJobStatus(jobId: string): JobRecord | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as
      | {
          id: string
          type: string
          status: JobStatus
          input: string
          result: string | null
          error: string | null
        }
      | undefined
    if (!row) return undefined
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      input: JSON.parse(row.input),
      result: row.result ? JSON.parse(row.result) : null,
      error: row.error,
    }
  }
}
