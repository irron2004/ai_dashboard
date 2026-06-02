import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, migrate, ProjectRegistry, type Db } from '@apc/core'
import { VaultAdapter } from '@apc/vault'
import { VaultWriter } from '@apc/pm'
import { WikiEngine, FakeAgentRunner } from '@apc/llm-wiki'
import type { AgentIngestAdapter } from '@apc/agents'
import type { AgentSource, NormalizedSession, SourceCursor } from '@apc/shared'
import { GenerateService } from './generate-service.js'

function fakeAdapter(session: NormalizedSession): AgentIngestAdapter {
  return {
    agentKind: 'claude',
    async discoverSources(_c: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
      return [{ id: 'claude:s1', agentKind: 'claude', kind: 'jsonl-file', locator: '/x/s1.jsonl', mtimeMs: 100 }]
    },
    async parseSource(): Promise<{ session: NormalizedSession; position: string }> {
      return { session, position: '{}' }
    },
  }
}

describe('GenerateService', () => {
  let db: Db; let dir: string
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db)
    dir = mkdtempSync(join(tmpdir(), 'apc-gen-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('summarizes the latest matching session and writes summary + proposal', async () => {
    const registry = new ProjectRegistry(db)
    registry.register({ id: 'p1', name: 'P1', status: 'active', projectType: 'git', repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [] })
    const session: NormalizedSession = { id: 's1', agentType: 'claude', repoPath: '/work/apc', turns: [{ role: 'user', text: 'did work', toolCalls: [] }], filesTouched: [] }
    const wiki = new WikiEngine(new FakeAgentRunner([JSON.stringify({
      workSummary: 'summary', filesTouched: ['a.ts'], openProblems: [], nextTasks: [{ title: 'next', rationale: 'r' }],
      currentProposalMarkdown: '## Current\n- updated\n',
    })]))
    const svc = new GenerateService({
      adapters: [fakeAdapter(session)], registry, vault: new VaultAdapter(dir),
      vaultWriter: new VaultWriter(new VaultAdapter(dir)), wiki, now: () => '2026-06-02T00:00:00Z',
    })
    const res = await svc.generateForProject({ projectId: 'p1', engine: 'codex' })
    expect(res.ok).toBe(true)
    expect(res.generation?.workSummary).toBe('summary')
    expect(res.summaryPath).toContain('projects/p1/agent-runs/')
    expect(res.proposalPath).toBe('projects/p1/current.proposal.md')
  })

  test('ok:false with a reason when no session matches the project repoPath', async () => {
    const registry = new ProjectRegistry(db)
    registry.register({ id: 'p2', name: 'P2', status: 'active', projectType: 'git', repoPaths: ['/other'], vaultPaths: [], sourcePaths: [] })
    const session: NormalizedSession = { id: 's1', agentType: 'claude', repoPath: '/work/apc', turns: [], filesTouched: [] }
    const wiki = new WikiEngine(new FakeAgentRunner([]))
    const svc = new GenerateService({ adapters: [fakeAdapter(session)], registry, vault: new VaultAdapter(dir), vaultWriter: new VaultWriter(new VaultAdapter(dir)), wiki })
    const res = await svc.generateForProject({ projectId: 'p2', engine: 'claude' })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/no.*session/i)
  })
})
