import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, test } from 'vitest'
import { WorkspaceRetrievalRuntime } from './runtime.js'

const roots: string[] = []
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url))

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('retrieval MCP STDIO process', () => {
  test('serves an indexed source without writing protocol noise to stdout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'retrieval-mcp-stdio-'))
    roots.push(root)
    mkdirSync(join(root, 'demo', 'wiki'), { recursive: true })
    writeFileSync(join(root, 'AGENTS.md'), '# Workspace\ncontrol evidence', 'utf8')
    writeFileSync(join(root, 'demo', 'AGENTS.md'), '# Demo rules', 'utf8')
    writeFileSync(join(root, 'demo', 'wiki', 'evidence.md'), '# STDIO Evidence\nstdio-process-needle', 'utf8')
    writeFileSync(join(root, 'workspace.projects.yml'), `version: 1
projects:
  - key: demo
    name: Demo
    path: demo
    tier: independent
    rule_doc: demo/AGENTS.md
    wiki: demo/wiki
    desc: Demo project
`, 'utf8')
    const dbPath = join(root, '.autosci', 'cache', 'workspace-retrieval.sqlite')
    await new WorkspaceRetrievalRuntime({
      workspaceRoot: root,
      manifestPath: join(root, 'workspace.projects.yml'),
      dbPath,
    }).refresh()

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        '--import',
        'tsx',
        cliPath,
        'serve',
        '--workspace-root',
        root,
        '--db',
        dbPath,
      ],
      cwd: repoRoot,
      stderr: 'pipe',
    })
    const client = new Client({ name: 'stdio-process-test', version: '1.0.0' })
    await client.connect(transport)
    try {
      const result = await client.callTool({
        name: 'search_evidence',
        arguments: { query: 'stdio-process-needle', project_ids: ['demo'] },
      }) as CallToolResult

      expect(result.isError).not.toBe(true)
      expect(result.content).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('pmw://project/demo/wiki/evidence.md#chunk-0'),
        }),
      ]))
    } finally {
      await client.close()
    }
  }, 15_000)
})
