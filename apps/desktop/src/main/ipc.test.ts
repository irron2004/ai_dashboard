import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handlers } from './ipc.js'
import { buildContainer } from './container.js'
import { CH } from '../shared/ipc-contract.js'
import type { ProjectDashboardReq, SubmitReviewReq, ListProfilesReq } from '../shared/ipc-contract.js'
import type { AgentIngestAdapter } from '@apc/agents'
import type { AgentSource, NormalizedSession, SourceCursor } from '@apc/shared'

describe('IPC handlers (no Electron)', () => {
  let vaultDir: string
  let container: ReturnType<typeof buildContainer>

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), 'apc-ipc-'))
    container = buildContainer({ dbFile: ':memory:', vaultRoot: vaultDir })
    // seed a project and a task
    container.registry.register({
      id: 'p1', name: 'APC', status: 'active', projectType: 'git',
      repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [],
    })
    container.tasks.create({
      id: 'T1', projectId: 'p1', title: 'do work', status: 'in_progress',
      assigneeType: 'agent', priority: 'high', reviewStatus: 'none',
      acceptanceCriteria: [], linkedWikiPages: [],
    })
    container.runs.create({
      id: 'R1', taskId: 'T1', agent: 'codex', repoPath: '/work/apc',
      startedAt: '2026-06-01T10:00:00Z', status: 'running',
    })
  })

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true })
  })

  test('q:projectDashboard returns the dashboard shape', async () => {
    const h = handlers(container)
    const req: ProjectDashboardReq = { projectId: 'p1' }
    const res = await h[CH.projectDashboard](req)
    expect((res as any).project.id).toBe('p1')
    expect((res as any).activeTasks).toHaveLength(1)
    expect((res as any).activeTasks[0].id).toBe('T1')
    expect((res as any).recentRuns).toHaveLength(1)
    expect((res as any).recentRuns[0].id).toBe('R1')
  })

  test('c:submitReview transitions the task to done', async () => {
    const h = handlers(container)
    // First complete the run so review is valid context
    container.runs.complete('R1', { endedAt: '2026-06-01T11:00:00Z' })

    const req: SubmitReviewReq = {
      review: {
        id: 'rev1', taskId: 'T1', agentRunId: 'R1', reviewer: 'human',
        status: 'approved', summary: 'looks good', nextTasks: [],
      },
    }
    await h[CH.submitReview](req)
    const task = container.tasks.get('T1')
    expect(task?.status).toBe('done')
    expect(task?.reviewStatus).toBe('approved')
  })

  test('q:listProjects returns all registered projects', async () => {
    const h = handlers(container)
    const res = await h[CH.listProjects](undefined)
    expect(Array.isArray(res)).toBe(true)
    expect((res as any[]).find((p: any) => p.id === 'p1')).toBeDefined()
  })

  test('q:listProfiles reads OpenCode agent profiles from a project path', async () => {
    const projDir = mkdtempSync(join(tmpdir(), 'apc-ipc-proj-'))
    try {
      mkdirSync(join(projDir, '.opencode'), { recursive: true })
      writeFileSync(
        join(projDir, '.opencode', 'opencode.jsonc'),
        '{ "agent": { "build": { "model": "openai/gpt-5.5", "mode": "primary" } } }',
      )
      const h = handlers(container)
      const req: ListProfilesReq = { projectPath: projDir }
      const res = (await h[CH.listProfiles](req)) as any[]
      expect(res.find((p) => p.name === 'build')?.model).toBe('openai/gpt-5.5')
    } finally {
      rmSync(projDir, { recursive: true, force: true })
    }
  })

  test('c:ingestAll runs the configured adapters and indexes a resolved session', async () => {
    const session: NormalizedSession = {
      id: 's1', agentType: 'claude', repoPath: '/work/apc',
      sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '/x/s1.jsonl', sessionHeader: {} },
      turns: [{ role: 'user', text: 'design the control tower', toolCalls: [] }], filesTouched: [],
    }
    const fake: AgentIngestAdapter = {
      agentKind: 'claude',
      async discoverSources(cursorFor: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
        if (cursorFor('claude:s1')) return []
        return [{ id: 'claude:s1', agentKind: 'claude', kind: 'jsonl-file', locator: '/x/s1.jsonl', repoPath: '/work/apc' }]
      },
      async parseSource(): Promise<{ session: NormalizedSession; position: string }> {
        return { session, position: JSON.stringify({ sizeBytes: 1, mtimeMs: 1 }) }
      },
    }
    const c2 = buildContainer({ dbFile: ':memory:', vaultRoot: vaultDir, ingestAdapters: [fake] })
    c2.registry.register({ id: 'p1', name: 'APC', status: 'active', projectType: 'git', repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [] })
    const h = handlers(c2)
    const res = (await h[CH.ingestAll](undefined)) as { sources: number; sessions: number }
    expect(res).toEqual({ sources: 1, sessions: 1 })
    expect(c2.searchIndex.search('control tower', { projectId: 'p1' })).toHaveLength(1)
  })

  test('c:generateProject summarizes the latest session into a proposal', async () => {
    const session: NormalizedSession = {
      id: 's1', agentType: 'claude', repoPath: '/work/apc',
      sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '/x.jsonl', sessionHeader: {} },
      turns: [{ role: 'user', text: 'go', toolCalls: [] }], filesTouched: [],
    }
    const fake: AgentIngestAdapter = {
      agentKind: 'claude',
      async discoverSources(): Promise<AgentSource[]> {
        return [{ id: 'claude:s1', agentKind: 'claude', kind: 'jsonl-file', locator: '/x.jsonl', mtimeMs: 1 }]
      },
      async parseSource(): Promise<{ session: NormalizedSession; position: string }> {
        return { session, position: '{}' }
      },
    }
    const runner = {
      async run() {
        return {
          ok: true,
          output: JSON.stringify({ workSummary: 'did it', filesTouched: [], openProblems: [], nextTasks: [], currentProposalMarkdown: '## Current\n- x\n' }),
          raw: '',
        }
      },
    }
    const c2 = buildContainer({ dbFile: ':memory:', vaultRoot: vaultDir, ingestAdapters: [fake], agentRunner: runner })
    c2.registry.register({ id: 'p1', name: 'APC', status: 'active', projectType: 'git', repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [] })
    const res = (await handlers(c2)[CH.generateProject]({ projectId: 'p1', engine: 'claude', selectedPreflightCategoryIds: ['agent-conversations'] })) as { ok: boolean; proposalPath?: string }
    expect(res.ok).toBe(true)
    expect(res.proposalPath).toBe('projects/p1/current.proposal.md')
  })

  test('c:generateProject requires the preflight conversation category', async () => {
    const h = handlers(container)
    const res = (await h[CH.generateProject]({ projectId: 'p1', engine: 'claude' })) as { ok: boolean; reason?: string }
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/preflight/i)
  })

  test('c:generatePreflight counts only agent sources for the selected project', async () => {
    const fake: AgentIngestAdapter = {
      agentKind: 'claude',
      async discoverSources(): Promise<AgentSource[]> {
        return [
          { id: 'claude:apc', agentKind: 'claude', kind: 'jsonl-file', locator: '/x/apc.jsonl', repoPath: '/work/apc' },
          { id: 'claude:pebot', agentKind: 'claude', kind: 'jsonl-file', locator: '/x/pebot.jsonl', repoPath: '/home/hskim/work/llm-agent-v2' },
        ]
      },
      async parseSource(): Promise<{ session: NormalizedSession; position: string }> {
        throw new Error('preflight should not parse sources that already declare repoPath')
      },
    }
    const c2 = buildContainer({ dbFile: ':memory:', vaultRoot: vaultDir, ingestAdapters: [fake] })
    c2.registry.register({ id: 'p1', name: 'APC', status: 'active', projectType: 'git', repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [] })
    const res = (await handlers(c2)[CH.generatePreflight]({ projectId: 'p1' })) as { ok: boolean; categories?: Array<{ id: string; count: number }> }
    expect(res.ok).toBe(true)
    expect(res.categories?.find((category) => category.id === 'agent-conversations')?.count).toBe(1)
  })

  test('c:harnessRun → c:harnessGetRun → c:harnessPromote drive the pipeline (faked LLM)', async () => {
    const { FakeAgentRunner } = await import('@apc/llm-wiki')
    const proposals = { proposals: [{
      proposal_id: 'NP-1', proposed_by: 'extractor', created_at: '2026-06-02T00:00:00Z',
      node: { id: 'n1', type: 'ConceptNode', title: 'T' },
      evidence: [{ evidence_id: 'EV-1', source_id: 's', source_path: 'raw/a', evidence_type: 'd' }],
      claims: [{ claim_id: 'CL-1', text: 'x', evidence_ids: ['EV-1'] }],
    }] }
    const lead = {
      graph_update_plan: { created_by: 'lead' }, shared_promotion_plan: { created_by: 'lead' }, stale_doc_report: { generated_by: 'lead' },
      write_plan: { write_plan_id: 'WP-1', created_by: 'lead', operations: [{ op: 'create_file', path: 'concepts/n1.md', content: '# T\n' }] },
    }
    const runner = new FakeAgentRunner([
      JSON.stringify({ project_id: 'p1', generated_by: 'discovery' }),
      JSON.stringify({ generated_by: 'reader', session_id: 's1' }),
      JSON.stringify({ generated_by: 'classifier', documents: [{ path: 'current.md', intent: 'canonical' }] }),
      JSON.stringify(proposals),
      JSON.stringify(lead),
    ])
    // vault/ and runs/ are siblings so the staging copy never nests inside the vault
    const harnessRoot = mkdtempSync(join(tmpdir(), 'apc-harness-'))
    const harnessVault = join(harnessRoot, 'vault')
    mkdirSync(join(harnessVault, 'raw'), { recursive: true })
    writeFileSync(join(harnessVault, 'raw', 'a'), 'evidence source\n')  // A2: cited evidence source must exist

    const c2 = buildContainer({ dbFile: ':memory:', vaultRoot: harnessVault, agentRunner: runner, harnessRunsRoot: join(harnessRoot, 'runs') })
    const h = handlers(c2)

    const ran = (await h[CH.harnessRun]({ projectId: 'p1', engine: 'claude' })) as { ok: boolean; runId: string; finalState: string; reason?: string }
    expect(ran, JSON.stringify(ran)).toMatchObject({ ok: true })
    expect(ran.finalState).toBe('HUMAN_REVIEW_REQUIRED')

    const shown = (await h[CH.harnessGetRun]({ runId: ran.runId })) as { ok: boolean; runState: { state: string } }
    expect(shown.runState.state).toBe('HUMAN_REVIEW_REQUIRED')

    const promoted = (await h[CH.harnessPromote]({ runId: ran.runId })) as { ok: boolean; promoted: string[] }
    expect(promoted.ok).toBe(true)
    expect(promoted.promoted).toContain('concepts/n1.md')
    rmSync(harnessRoot, { recursive: true, force: true })
  })

  test('c:harnessPromote strict-parses its payload (rejects unknown/missing/mistyped fields)', async () => {
    const h = handlers(container)
    await expect(h[CH.harnessPromote]({ runId: 'R', bogus: 1 })).rejects.toThrow()  // unknown key
    await expect(h[CH.harnessPromote]({})).rejects.toThrow()                          // missing runId
    await expect(h[CH.harnessPromote]({ runId: 5 })).rejects.toThrow()               // non-string runId
  })
})
