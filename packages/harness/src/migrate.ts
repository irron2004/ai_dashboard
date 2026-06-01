import type { Db } from '@apc/core'

export function migrateHarness(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_profile (
      task_id    TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL
    );
  `)
}
