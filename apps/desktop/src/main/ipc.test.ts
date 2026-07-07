import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handlers } from './ipc.js'
import { buildContainer } from './container.js'
import { CH } from '../shared/ipc-contract.js'
import type { ProjectDashboardReq, SubmitReviewReq, ListProfilesReq, NextNoteAddRes } from '../shared/ipc-contract.js'
import { latestSessionDetail, type AgentIngestAdapter } from '@apc/agents'
import type { AgentSource, NormalizedSession, SourceCursor, QuestionLogEntry } from '@apc/shared'
import type { ResumeCard } from '@apc/dashboard-api'

// resumeCard's container impl calls the REAL latestSessionDetail, which scans this machine's actual
// ~/.claude, ~/.codex, ~/.opencode session history (no per-project scoping at discovery time — see
// packages/agents/src/latest-session.ts). On a dev box with real CLI history that makes an unmocked
// call scan thousands of real files (~15s, non-hermetic). Keep the real adapter classes (ClaudeAdapter
// etc. — buildContainer's default ingestAdapters need them) but stub latestSessionDetail so resumeCard
// tests are fast and deterministic; individual tests below override it via mockResolvedValueOnce.
vi.mock('@apc/agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@apc/agents')>()
  return { ...actual, latestSessionDetail: vi.fn(async () => null) }
})

describe('IPC handlers (no Electron)', () => {
  let vaultDir: string
  let container: ReturnType<typeof buildContainer>

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), 'apc-ipc-'))
    container = buildContainer({ dbFile: ':memory:', vaultRoot: vaultDir })
    // seed a project and a task
    container.registry.register({
      id: 'p1', name: 'APC', status: 'active', projectType: 'git', domain: 'project-docs',
      repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [],
    })
    container.tasks.create({
      id: 'T1', projectId: 'p1', title: 'do work', status: 'in_progress',
      assigneeType: 'agent', priority: 'high', reviewStatus: 'none',
      acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [],
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

  test('c:devHarnessRun returns ok:false for a project without repoPaths (no spawn)', async () => {
    container.registry.register({
      id: 'np', name: 'NoRepo', status: 'active', projectType: 'git', domain: 'project-docs',
      repoPaths: [], vaultPaths: [], sourcePaths: [],
    })
    const h = handlers(container)
    const res = await h[CH.devHarnessRun]({ projectId: 'np', taskId: 'T1' })
    expect(res).toMatchObject({ ok: false })
  })

  test('c:devHarnessCancel returns ok:false for an unknown run', async () => {
    const h = handlers(container)
    const res = await h[CH.devHarnessCancel]({ runId: 'nope' })
    expect(res).toMatchObject({ ok: false })
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
    // SP1 wired session→Task capture into ingest (onSessionParsed → summarize via the agentRunner).
    // Without a fake runner this would spawn a real CLI and time out — inject a fast FakeAgentRunner.
    const { FakeAgentRunner } = await import('@apc/llm-wiki')
    const c2 = buildContainer({ dbFile: ':memory:', vaultRoot: vaultDir, ingestAdapters: [fake], agentRunner: new FakeAgentRunner(['{"title":"design the control tower"}']) })
    c2.registry.register({ id: 'p1', name: 'APC', status: 'active', projectType: 'git', domain: 'project-docs', repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [] })
    const h = handlers(c2)
    const res = (await h[CH.ingestAll](undefined)) as { sources: number; sessions: number; documents: number }
    expect(res).toEqual({ sources: 1, sessions: 1, documents: 0 })
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
    c2.registry.register({ id: 'p1', name: 'APC', status: 'active', projectType: 'git', domain: 'project-docs', repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [] })
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
    c2.registry.register({ id: 'p1', name: 'APC', status: 'active', projectType: 'git', domain: 'project-docs', repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [] })
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

  test('q:fsReadDoc reads a doc under the project vault dir and rejects traversal', async () => {
    const h = handlers(container)
    const projDir = join(vaultDir, 'projects', 'p1')
    mkdirSync(projDir, { recursive: true })
    writeFileSync(join(projDir, 'current.md'), '# now')

    const ok = await h[CH.fsReadDoc]({ projectId: 'p1', relPath: 'current.md' })
    expect(ok).toEqual({ ok: true, content: '# now' })

    const bad = await h[CH.fsReadDoc]({ projectId: 'p1', relPath: '../../etc/passwd.md' })
    expect((bad as { ok: boolean }).ok).toBe(false)
  })

  test('c:harnessListStagedDocs lists real staged nodes through the IPC handler', async () => {
    const harnessRoot = mkdtempSync(join(tmpdir(), 'apc-harness-list-'))
    try {
      const c2 = buildContainer({ dbFile: ':memory:', vaultRoot: join(harnessRoot, 'vault'), harnessRunsRoot: join(harnessRoot, 'runs') })
      const h = handlers(c2)
      const dir = join(harnessRoot, 'runs', 'RUN-1', 'vault-staging', 'nodes')
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'decision.real.md'),
        '---\nnode_id: decision.real\nnode_type: DecisionNode\n---\n# Real Title\n\nbody',
      )
      writeFileSync(join(dir, 'old-stub.md'), 'DecisionNode markdown stub one-liner.')

      const res = await h[CH.harnessListStagedDocs]({ runId: 'RUN-1' }) as { docs: Array<{ relPath: string; isNode: boolean; nodeId?: string }> }
      expect(res.docs.find((d) => d.relPath === 'nodes/decision.real.md'))
        .toMatchObject({ isNode: true, nodeId: 'decision.real' })
      expect(res.docs.find((d) => d.relPath === 'nodes/old-stub.md')).toMatchObject({ isNode: false })
    } finally {
      rmSync(harnessRoot, { recursive: true, force: true })
    }
  })

  test('q:fsListDocs lists docs from existing repo roots', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'apc-repo-'))
    writeFileSync(join(repo, 'notes.md'), 'n')
    container.registry.update({ ...container.registry.get('p1')!, repoPaths: [repo] })
    const h = handlers(container)
    const res = await h[CH.fsListDocs]({ projectId: 'p1' }) as { docs: { relPath: string }[] }
    expect(res.docs.map((d) => d.relPath)).toContain('notes.md')
    rmSync(repo, { recursive: true, force: true })
  })

  test('q:changesList returns ok:false for a project whose repo is not a git dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-nongit2-'))
    container.registry.update({ ...container.registry.get('p1')!, repoPaths: [dir] })
    const h = handlers(container)
    const res = await h[CH.changesList]({ projectId: 'p1' }) as { ok: boolean }
    expect(res.ok).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('q:changesList lists an untracked md as unreflected in a real repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-git3-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(join(dir, 'note.md'), '# hi')
    container.registry.update({ ...container.registry.get('p1')!, repoPaths: [dir] })
    const h = handlers(container)
    const res = await h[CH.changesList]({ projectId: 'p1' }) as { ok: boolean; files?: { path: string; unreflected?: boolean }[] }
    expect(res.ok).toBe(true)
    // ingest_cursors is empty → cutoff null → every md is unreflected
    expect(res.files?.find((f) => f.path === 'note.md')?.unreflected).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('q:changesList returns ok:false for an unknown project', async () => {
    const h = handlers(container)
    const res = await h[CH.changesList]({ projectId: 'missing' }) as { ok: boolean; reason?: string }
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('project not found')
  })

  test('q:changesDiff returns the untracked file as a patch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-gitdiff-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(join(dir, 'doc.md'), '# added\n')
    container.registry.update({ ...container.registry.get('p1')!, repoPaths: [dir] })
    const h = handlers(container)
    const res = await h[CH.changesDiff]({ projectId: 'p1', relPath: 'doc.md' }) as { ok: boolean; patch?: string }
    expect(res.ok).toBe(true)
    expect(res.patch).toContain('+# added')
    rmSync(dir, { recursive: true, force: true })
  })

  test('q:changesDiff returns ok:false for an unknown project', async () => {
    const h = handlers(container)
    const res = await h[CH.changesDiff]({ projectId: 'missing', relPath: 'x.md' }) as { ok: boolean; reason?: string }
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('project not found')
  })

  test('c:harnessProposePolicy routes to container.harnessProposePolicy', async () => {
    let called = false
    let calledWith: unknown = undefined
    const fakeContainer = {
      ...container,
      harnessProposePolicy: async (req: unknown) => {
        called = true
        calledWith = req
        return { ok: true as const }
      },
    }
    const h = handlers(fakeContainer as any)
    const payload = { projectId: 'p1', engine: 'claude' as const }
    const res = await h[CH.harnessProposePolicy](payload)
    expect(called).toBe(true)
    expect(calledWith).toEqual(payload)
    expect((res as { ok: boolean }).ok).toBe(true)
  })

  test('c:harnessProposePolicy rejects an unknown engine (strict parse)', async () => {
    const h = handlers(container as any)
    await expect(h[CH.harnessProposePolicy]({ projectId: 'p1', engine: 'evil' })).rejects.toThrow()
  })

  test.each([
    ['harnessApprovePolicy', CH.harnessApprovePolicy, 'harnessApprovePolicy'],
    ['harnessGetPolicy', CH.harnessGetPolicy, 'harnessGetPolicy'],
    ['harnessRevertPolicy', CH.harnessRevertPolicy, 'harnessRevertPolicy'],
  ] as const)('%s routes {projectId} to its container method', async (_name, channel, method) => {
    let calledWith: unknown = undefined
    const fakeContainer = { ...container, [method]: (req: unknown) => { calledWith = req; return { ok: true as const } } }
    const h = handlers(fakeContainer as any)
    const res = await h[channel]({ projectId: 'p1' })
    expect(calledWith).toEqual({ projectId: 'p1' })
    expect((res as { ok: boolean }).ok).toBe(true)
  })

  test('q:workspaceOverview aggregates active count + running runs across projects', async () => {
    const h = handlers(container)
    const res = await h[CH.workspaceOverview]({}) as import('@apc/dashboard-api').WorkspaceOverview
    const p1 = res.projects.find((p) => p.project.id === 'p1')!
    expect(p1.activeTaskCount).toBe(1)
    expect(p1.runningRuns.map((r) => r.id)).toEqual(['R1'])
    expect(typeof res.generatedAt).toBe('string')
  })

  test('q:tasksList returns the project tasks', async () => {
    container.tasks.create({ id: 'req:p1:s1', projectId: 'p1', title: 't', status: 'done', assigneeType: 'agent', priority: 'medium', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [], reviewStatus: 'none' })
    const h = handlers(container)
    const res = (await h[CH.tasksList]({ projectId: 'p1' })) as { id: string }[]
    expect(res.map((t) => t.id)).toContain('req:p1:s1')
  })

  test('c:taskSetBlockedBy persists deps, and rejects self-reference + direct cycle', async () => {
    const h = handlers(container)
    container.tasks.create({
      id: 'T2', projectId: 'p1', title: 'dep', status: 'todo',
      assigneeType: 'agent', priority: 'medium', reviewStatus: 'none',
      acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [],
    })
    expect(await h[CH.taskSetBlockedBy]({ taskId: 'T1', blockedBy: ['T2'] })).toEqual({ ok: true })
    expect(container.tasks.get('T1')?.blockedBy).toEqual(['T2'])

    expect(await h[CH.taskSetBlockedBy]({ taskId: 'T1', blockedBy: ['T1'] }))
      .toMatchObject({ ok: false, reason: 'self-reference' })

    await h[CH.taskSetBlockedBy]({ taskId: 'T1', blockedBy: [] })      // clear
    await h[CH.taskSetBlockedBy]({ taskId: 'T2', blockedBy: ['T1'] })  // T2 now blocked by T1
    expect(await h[CH.taskSetBlockedBy]({ taskId: 'T1', blockedBy: ['T2'] }))
      .toMatchObject({ ok: false, reason: 'cycle' })
  })
  test('c:taskSetBlockedBy strict-parses its payload', async () => {
    const h = handlers(container)
    await expect(h[CH.taskSetBlockedBy]({ taskId: 'T1', blockedBy: 'nope' })).rejects.toThrow()   // non-array
    await expect(h[CH.taskSetBlockedBy]({ taskId: 'T1', blockedBy: [], extra: 1 })).rejects.toThrow() // unknown key
    await expect(h[CH.taskSetBlockedBy]({ blockedBy: [] })).rejects.toThrow()                     // missing taskId
  })

  test('q:composeContext assembles a prompt from task + parent + acceptance criteria + wiki excerpt', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const repo = mkdtempSync(join(tmpdir(), 'apc-cc-repo-'))
    mkdirSync(join(repo, 'docs'), { recursive: true })
    writeFileSync(join(repo, 'docs', 'spec.md'), '# Spec\nimportant detail here')
    container.registry.register({
      id: 'p2', name: 'X', status: 'active', projectType: 'git', domain: 'project-docs',
      repoPaths: [repo], vaultPaths: [], sourcePaths: [],
    })
    container.tasks.create({
      id: 'req:p2:s1', projectId: 'p2', title: '상위 요청', status: 'todo', assigneeType: 'agent',
      priority: 'medium', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [],
    })
    container.tasks.create({
      id: 'todo:p2:s1:1', projectId: 'p2', title: '하위 작업', status: 'todo', assigneeType: 'agent',
      priority: 'medium', reviewStatus: 'none', parentTaskId: 'req:p2:s1',
      acceptanceCriteria: ['빌드 통과', '테스트 green'], linkedWikiPages: ['docs/spec.md'], blockedBy: [],
    })
    const h = handlers(container)
    const res = await h[CH.composeContext]({ projectId: 'p2', taskId: 'todo:p2:s1:1' }) as { ok: boolean; prompt?: string }
    expect(res.ok).toBe(true)
    expect(res.prompt).toContain('하위 작업')
    expect(res.prompt).toContain('상위 요청')
    expect(res.prompt).toContain('빌드 통과')
    expect(res.prompt).toContain('docs/spec.md')
    expect(res.prompt).toContain('important detail here')
  })

  test('q:composeContext returns ok:false for an unknown task', async () => {
    const h = handlers(container)
    const res = await h[CH.composeContext]({ projectId: 'p1', taskId: 'nope' }) as { ok: boolean }
    expect(res.ok).toBe(false)
  })

  test('q:composeContext strips CRLF frontmatter from wiki excerpt (F1)', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'apc-crlf-'))
    mkdirSync(join(repo, 'docs'), { recursive: true })
    // File uses CRLF line endings in the YAML frontmatter block
    writeFileSync(join(repo, 'docs', 'crlf.md'), '---\r\nkey: val\r\n---\r\nBODY text here')
    container.registry.register({
      id: 'pcrlf', name: 'CRLFTest', status: 'active', projectType: 'git', domain: 'project-docs',
      repoPaths: [repo], vaultPaths: [], sourcePaths: [],
    })
    container.tasks.create({
      id: 'crlf:pcrlf:1', projectId: 'pcrlf', title: 'crlf task', status: 'todo', assigneeType: 'agent',
      priority: 'medium', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: ['docs/crlf.md'], blockedBy: [],
    })
    const h = handlers(container)
    const res = await h[CH.composeContext]({ projectId: 'pcrlf', taskId: 'crlf:pcrlf:1' }) as { ok: boolean; prompt?: string }
    expect(res.ok).toBe(true)
    // Body must appear in the excerpt
    expect(res.prompt).toContain('BODY text here')
    // Frontmatter key must NOT leak into the composed prompt
    expect(res.prompt).not.toContain('key: val')
    rmSync(repo, { recursive: true, force: true })
  })

  test('q:devHarnessReadTranscript returns transcript content for a recorded run', async () => {
    // Transcript must live inside the harnessRunsRoot (default: sibling of vaultDir named apc-harness-runs).
    // The containment guard rejects paths outside it, so we compute the default root and write there.
    const runsRoot = join(vaultDir, '..', 'apc-harness-runs')
    mkdirSync(join(runsRoot, 'RUN9'), { recursive: true })
    const tp = join(runsRoot, 'RUN9', 'transcript.log')
    writeFileSync(tp, 'build log line')
    container.runs.create({
      id: 'RUN9', taskId: 'T1', agent: 'harness', repoPath: '/x',
      startedAt: '2026-06-01T00:00:00Z', status: 'completed', transcriptPath: tp,
    })
    const h = handlers(container)
    const res = await h[CH.devHarnessReadTranscript]({ runId: 'RUN9' }) as { ok: boolean; content?: string }
    expect(res.ok).toBe(true)
    expect(res.content).toContain('build log line')
    rmSync(runsRoot, { recursive: true, force: true })
  })

  test('q:devHarnessReadTranscript ok:false when the run or transcript is missing', async () => {
    const h = handlers(container)
    const res = await h[CH.devHarnessReadTranscript]({ runId: 'missing' }) as { ok: boolean }
    expect(res.ok).toBe(false)
  })

  test('q:composeContext skips summary when summaryPath traverses outside vault (F4)', async () => {
    // Write a "sensitive" file just outside the vault root
    const secretFile = join(vaultDir, '..', 'f4-secret.txt')
    writeFileSync(secretFile, 'F4 SECRET CONTENT')
    // Complete R1 with a traversal summaryPath
    container.runs.complete('R1', { endedAt: '2026-06-01T11:00:00Z', summaryPath: '../f4-secret.txt' })
    const h = handlers(container)
    const res = await h[CH.composeContext]({ projectId: 'p1', taskId: 'T1' }) as { ok: boolean; prompt?: string }
    // compose must succeed (summary skipped, not an error)
    expect(res.ok).toBe(true)
    // Sensitive content must NOT appear in the composed prompt
    expect(res.prompt).not.toContain('F4 SECRET CONTENT')
    rmSync(secretFile)
  })

  test('q:devHarnessReadTranscript rejects transcriptPath outside runsRoot (F5)', async () => {
    // Write a "sensitive" file outside the harnessRunsRoot
    const secretFile = join(vaultDir, '..', 'f5-secret.txt')
    writeFileSync(secretFile, 'F5 SECRET CONTENT')
    container.runs.create({
      id: 'EVIL_RUN', taskId: 'T1', agent: 'harness', repoPath: '/x',
      startedAt: '2026-06-01T00:00:00Z', status: 'completed', transcriptPath: secretFile,
    })
    const h = handlers(container)
    const res = await h[CH.devHarnessReadTranscript]({ runId: 'EVIL_RUN' }) as { ok: boolean; content?: string }
    expect(res.ok).toBe(false)
    expect(res.content).toBeUndefined()
    rmSync(secretFile)
  })

  test('c:nextNoteAdd → q:resumeCard surfaces it; c:nextNoteToggle/Delete manage its lifecycle', async () => {
    const h = handlers(container)
    const add = await h[CH.nextNoteAdd]({ projectId: 'p1', text: '7/10 상장 반영' }) as NextNoteAddRes
    expect(add.ok).toBe(true)
    const noteId = add.note!.id

    const card = await h[CH.resumeCard]({ projectId: 'p1' }) as ResumeCard | null
    expect(card?.nextNotes.map((n) => n.text)).toContain('7/10 상장 반영')
    expect(card?.hasHistory).toBe(true)

    const toggled = await h[CH.nextNoteToggle]({ id: noteId, done: true })
    expect(toggled).toEqual({ ok: true })
    // listByProject defaults to excluding done notes, so a toggled-done note drops out of the card.
    const afterToggle = await h[CH.resumeCard]({ projectId: 'p1' }) as ResumeCard | null
    expect(afterToggle?.nextNotes.map((n) => n.text)).not.toContain('7/10 상장 반영')

    const deleted = await h[CH.nextNoteDelete]({ id: noteId })
    expect(deleted).toEqual({ ok: true })
  })

  test('q:resumeCard returns null for an unknown project', async () => {
    const h = handlers(container)
    const res = await h[CH.resumeCard]({ projectId: 'nope' })
    expect(res).toBeNull()
  })

  test('q:resumeCard extracts the last non-empty user turn from the latest session', async () => {
    vi.mocked(latestSessionDetail).mockResolvedValueOnce({
      agent: 'codex',
      session: {
        id: 's9', agentType: 'codex', repoPath: '/work/apc',
        sourceMeta: { provider: 'codex', sourceKind: 'jsonl-file', rawLocator: '/x', sessionHeader: {} },
        startedAt: '2026-07-01T00:00:00Z',
        turns: [
          { role: 'user', text: '첫 질문', timestamp: '2026-07-01T00:00:01Z', toolCalls: [] },
          { role: 'assistant', text: '답변', toolCalls: [] },
          { role: 'user', text: '   ', toolCalls: [] }, // whitespace-only → must be skipped
          { role: 'user', text: '마지막 질문', timestamp: '2026-07-01T00:05:00Z', toolCalls: [] },
        ],
        filesTouched: [],
      },
    })
    const h = handlers(container)
    const card = await h[CH.resumeCard]({ projectId: 'p1' }) as ResumeCard | null
    expect(card?.lastQuestion).toEqual({ text: '마지막 질문', ts: '2026-07-01T00:05:00Z', agent: 'codex' })
    expect(card?.resumeTarget).toEqual({ agent: 'codex', sessionId: 's9' })
  })

  test('q:resumeCard caches per project — a second read for the same project skips latestSessionDetail', async () => {
    const h = handlers(container)
    const before = vi.mocked(latestSessionDetail).mock.calls.length
    await h[CH.resumeCard]({ projectId: 'p1' })
    expect(vi.mocked(latestSessionDetail).mock.calls.length).toBe(before + 1) // cache miss → builds, calls once
    await h[CH.resumeCard]({ projectId: 'p1' })
    expect(vi.mocked(latestSessionDetail).mock.calls.length).toBe(before + 1) // cache hit → no additional call
  })

  test('c:nextNoteAdd invalidates the resumeCard cache so the new note shows up on the next read', async () => {
    const h = handlers(container)
    const before = await h[CH.resumeCard]({ projectId: 'p1' }) as ResumeCard | null
    expect(before?.nextNotes.map((n) => n.text)).not.toContain('캐시 무효화 확인 노트')
    const callsAfterFirstRead = vi.mocked(latestSessionDetail).mock.calls.length

    await h[CH.nextNoteAdd]({ projectId: 'p1', text: '캐시 무효화 확인 노트' })
    const after = await h[CH.resumeCard]({ projectId: 'p1' }) as ResumeCard | null
    expect(after?.nextNotes.map((n) => n.text)).toContain('캐시 무효화 확인 노트')
    // the cache was cleared by nextNoteAdd, so this read had to rebuild (not served stale from cache)
    expect(vi.mocked(latestSessionDetail).mock.calls.length).toBe(callsAfterFirstRead + 1)
  })

  test('c:ingestAll invalidates the resumeCard cache for all projects', async () => {
    // Use a fresh container with NO ingest adapters so ingestAll is a fast no-op — the default
    // ClaudeAdapter/CodexAdapter/OpenCodeAdapter would otherwise scan this machine's real ~/.claude etc.
    const c2 = buildContainer({ dbFile: ':memory:', vaultRoot: vaultDir, ingestAdapters: [] })
    c2.registry.register({ id: 'p1', name: 'APC', status: 'active', projectType: 'git', domain: 'project-docs', repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [] })
    const h = handlers(c2)

    const before = vi.mocked(latestSessionDetail).mock.calls.length
    await h[CH.resumeCard]({ projectId: 'p1' })
    expect(vi.mocked(latestSessionDetail).mock.calls.length).toBe(before + 1)
    await h[CH.resumeCard]({ projectId: 'p1' })
    expect(vi.mocked(latestSessionDetail).mock.calls.length).toBe(before + 1) // cache hit, still

    const res = await h[CH.ingestAll](undefined) as { sources: number; sessions: number; documents: number }
    expect(res).toEqual({ sources: 0, sessions: 0, documents: 0 })

    await h[CH.resumeCard]({ projectId: 'p1' })
    expect(vi.mocked(latestSessionDetail).mock.calls.length).toBe(before + 2) // ingest cleared the cache → rebuilt
  })

  test('q:questionLog surfaces recorded user turns after ingest', async () => {
    const session: NormalizedSession = {
      id: 'qs1', agentType: 'claude', repoPath: '/work/apc',
      sourceMeta: { provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '/x/qs1.jsonl', sessionHeader: {} },
      turns: [{ role: 'user', text: '질문 있어요?', toolCalls: [] }], filesTouched: [],
    }
    const fake: AgentIngestAdapter = {
      agentKind: 'claude',
      async discoverSources(cursorFor: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
        if (cursorFor('claude:qs1')) return []
        return [{ id: 'claude:qs1', agentKind: 'claude', kind: 'jsonl-file', locator: '/x/qs1.jsonl', repoPath: '/work/apc' }]
      },
      async parseSource(): Promise<{ session: NormalizedSession; position: string }> {
        return { session, position: JSON.stringify({ sizeBytes: 1, mtimeMs: 1 }) }
      },
    }
    const { FakeAgentRunner } = await import('@apc/llm-wiki')
    const c2 = buildContainer({ dbFile: ':memory:', vaultRoot: vaultDir, ingestAdapters: [fake], agentRunner: new FakeAgentRunner(['{"title":"질문 있어요"}']) })
    c2.registry.register({ id: 'p1', name: 'APC', status: 'active', projectType: 'git', domain: 'project-docs', repoPaths: ['/work/apc'], vaultPaths: [], sourcePaths: [] })
    const h = handlers(c2)
    await h[CH.ingestAll](undefined)
    const log = await h[CH.questionLog]({ projectId: 'p1' }) as QuestionLogEntry[]
    expect(log.map((e) => e.text)).toContain('질문 있어요?')
  })
})
