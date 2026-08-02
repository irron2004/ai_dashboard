import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, test } from 'vitest'
import type { RetrievalMcpConfig } from './config.js'
import { WorkspaceRetrievalRuntime } from './runtime.js'
import { createRetrievalMcpServer } from './server.js'

const roots: string[] = []

function fixture(): { config: RetrievalMcpConfig; runtime: WorkspaceRetrievalRuntime } {
  const root = mkdtempSync(join(tmpdir(), 'retrieval-mcp-protocol-'))
  roots.push(root)
  mkdirSync(join(root, 'docs'), { recursive: true })
  mkdirSync(join(root, 'demo', 'wiki'), { recursive: true })
  writeFileSync(join(root, 'AGENTS.md'), '# Workspace\ncontrol evidence', 'utf8')
  writeFileSync(join(root, 'demo', 'AGENTS.md'), '# Demo rules', 'utf8')
  writeFileSync(join(root, 'demo', 'wiki', 'evidence.md'), '# MCP Evidence\nprotocolneedle verified source', 'utf8')
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
  const config = {
    workspaceRoot: root,
    manifestPath: join(root, 'workspace.projects.yml'),
    dbPath: join(root, '.autosci', 'cache', 'workspace-retrieval.sqlite'),
  }
  return { config, runtime: new WorkspaceRetrievalRuntime(config) }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('workspace retrieval MCP protocol', () => {
  test('lists the four primitives and searches then resolves evidence through MCP', async () => {
    const { config, runtime } = fixture()
    await runtime.refresh()
    const server = createRetrievalMcpServer(config, runtime)
    const client = new Client({ name: 'retrieval-test-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    try {
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        'get_evidence_source',
        'list_evidence_projects',
        'refresh_evidence_index',
        'search_evidence',
      ])
      expect(listed.tools.find((tool) => tool.name === 'search_evidence')?.annotations?.readOnlyHint).toBe(true)

      const searched = await client.callTool({
        name: 'search_evidence',
        arguments: { query: 'protocolneedle', project_ids: ['demo'], limit: 5 },
      }) as CallToolResult
      expect(searched.isError).not.toBe(true)
      const searchText = searched.content.find((item) => item.type === 'text')
      expect(searchText).toMatchObject({ type: 'text', text: expect.stringContaining('pmw://project/demo/') })
      const uri = /pmw:\/\/[^"\s]+/.exec(searchText?.type === 'text' ? searchText.text : '')?.[0]
      expect(uri).toBeTruthy()

      const source = await client.callTool({
        name: 'get_evidence_source',
        arguments: { uri, neighbors: 0 },
      }) as CallToolResult
      expect(source.isError).not.toBe(true)
      expect(source.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('verified source') }),
      ]))
    } finally {
      await client.close()
      await server.close()
    }
  })
})
