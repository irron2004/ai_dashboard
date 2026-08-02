import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import { resolveRetrievalMcpConfig } from './config.js'
import { refreshWorkspaceIndex } from './workspace-index.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('retrieval MCP configuration', () => {
  test('accepts a package-manager separator and keeps the default DB outside the workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'retrieval-mcp-config-'))
    roots.push(root)

    const config = resolveRetrievalMcpConfig(['--', '--workspace-root', root], {}, root)

    expect(config.workspaceRoot).toBe(root)
    expect(config.manifestPath).toBe(join(root, 'workspace.projects.yml'))
    expect(isAbsolute(config.dbPath)).toBe(true)
    expect(relative(root, config.dbPath)).toMatch(/^\.\./)
    expect(config.dbPath).toContain(join('apc', 'workspace-retrieval'))
  })

  test('rejects an in-workspace DB outside the derived cache directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'retrieval-mcp-config-'))
    roots.push(root)
    const config = {
      workspaceRoot: root,
      manifestPath: join(root, 'workspace.projects.yml'),
      dbPath: join(root, 'retrieval.sqlite'),
    }

    await expect(refreshWorkspaceIndex(config)).rejects.toMatchObject({
      code: 'db-outside-cache',
    })
  })

  test('refuses to mutate an unrelated existing SQLite database', async () => {
    const root = mkdtempSync(join(tmpdir(), 'retrieval-mcp-config-'))
    roots.push(root)
    writeFileSync(join(root, 'AGENTS.md'), '# Rules', 'utf8')
    writeFileSync(join(root, 'workspace.projects.yml'), `version: 1
projects:
  - key: demo
    name: Demo
    path: demo
    tier: independent
    rule_doc: demo/AGENTS.md
    desc: Demo
`, 'utf8')
    const dbPath = join(tmpdir(), `unrelated-${Date.now()}-${Math.random()}.sqlite`)
    roots.push(dbPath)
    const unrelated = new DatabaseSync(dbPath)
    unrelated.exec('CREATE TABLE irreplaceable_data (value TEXT NOT NULL); INSERT INTO irreplaceable_data VALUES (\'keep\')')
    unrelated.close()

    await expect(refreshWorkspaceIndex({
      workspaceRoot: root,
      manifestPath: join(root, 'workspace.projects.yml'),
      dbPath,
    })).rejects.toMatchObject({ code: 'unowned-db' })

    const verified = new DatabaseSync(dbPath, { readOnly: true })
    expect(verified.prepare('SELECT value FROM irreplaceable_data').get()).toEqual({ value: 'keep' })
    verified.close()
  })
})
