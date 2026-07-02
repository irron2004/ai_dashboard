import { DatabaseSync } from 'node:sqlite'
import type { Db } from '@apc/core'

/**
 * Open the desktop's sqlite file for READ-ONLY access from a standalone node
 * process (not Electron). The desktop writes concurrently; SQLite WAL allows
 * concurrent readers, so we do NOT set journal_mode here (that is a write and
 * the file is already WAL). busy_timeout lets a read wait for an in-flight
 * write instead of failing immediately with SQLITE_BUSY; the OverviewCache
 * absorbs any remaining busy errors by serving the last good snapshot.
 */
export function openReadOnlyDb(file: string): Db {
  const db = new DatabaseSync(file, { readOnly: true })
  db.exec('PRAGMA busy_timeout = 3000')
  return db
}
