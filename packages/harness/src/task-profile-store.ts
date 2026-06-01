import type { Db } from '@apc/core'

export class TaskProfileStore {
  constructor(private readonly db: Db) {}

  select(taskId: string, profileId: string): void {
    this.db.prepare('INSERT OR REPLACE INTO task_profile (task_id, profile_id) VALUES (?, ?)').run(taskId, profileId)
  }

  get(taskId: string): string | undefined {
    const row = this.db.prepare('SELECT profile_id FROM task_profile WHERE task_id = ?').get(taskId) as
      { profile_id: string } | undefined
    return row?.profile_id
  }
}
