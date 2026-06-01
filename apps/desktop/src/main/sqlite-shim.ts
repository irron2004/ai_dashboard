// Electron-build-only shim. electron.vite.config.ts aliases 'node:sqlite' to this file
// for the main process, because Electron's bundled Node may not include the built-in
// node:sqlite. We back the exact DatabaseSync surface our engine packages use
// (`new DatabaseSync(path, {readOnly?})`, `.exec`, `.prepare().run/get/all`, `.close`)
// with better-sqlite3 (native; rebuilt for the Electron ABI via `electron-rebuild`).
//
// SQL across the codebase uses `:name` placeholders bound with bare-key objects and
// positional `?` — both supported identically by better-sqlite3, so no query changes.
import Database from 'better-sqlite3'

export class DatabaseSync {
  private readonly db: Database.Database

  constructor(path: string, opts?: { readOnly?: boolean }) {
    this.db = new Database(path, { readonly: opts?.readOnly ?? false })
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  prepare(sql: string): Database.Statement {
    return this.db.prepare(sql)
  }

  close(): void {
    this.db.close()
  }
}

export default { DatabaseSync }
