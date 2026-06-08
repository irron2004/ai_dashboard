import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, migrate, type Db } from '@apc/core'
import { migratePm, TaskStore, AgentRunStore, VaultWriter } from '@apc/pm'
import { VaultAdapter } from '@apc/vault'
import { WikiEngine, FakeAgentRunner } from '@apc/llm-wiki'
import type { AgentRun, NormalizedSession } from '@apc/shared'
import { RunService } from './run-service.js'

describe('RunService.completeRun', () => {
  let db: Db; let dir: string; let tasks: TaskStore; let runs: AgentRunStore; let svc: RunService
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db); migratePm(db)
    dir = mkdtempSync(join(tmpdir(), 'apc-run-'))
    tasks = new TaskStore(db); runs = new AgentRunStore(db)
    tasks.create({ id: 'T1', projectId: 'p1', title: 't', status: 'in_progress', assigneeType: 'agent', priority: 'high', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [] })
    runs.create({ id: 'R1', taskId: 'T1', agent: 'codex', repoPath: '/p1', startedAt: '2026-06-01T10:00:00Z', status: 'running' })
    const wiki = new WikiEngine(new FakeAgentRunner([JSON.stringify({
      workSummary: 'did the thing', filesTouched: ['a.ts'], openProblems: [],
      nextTasks: [{ title: 'next', rationale: 'r' }], currentProposalMarkdown: '## Current\n- did it\n',
    })]))
    svc = new RunService({ wiki, vaultWriter: new VaultWriter(new VaultAdapter(dir)), tasks, runs })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('generates summary+proposal, completes run, flips task to review/pending', async () => {
    const run: AgentRun = runs.get('R1')!
    const session: NormalizedSession = { id: 's1', agentType: 'codex', projectId: 'p1', repoPath: '/p1', sourceMeta: { provider: 'codex', sourceKind: 'jsonl-file', rawLocator: '', sessionHeader: {} }, turns: [{ role: 'user', text: 'go', toolCalls: [] }], filesTouched: [] }
    const out = await svc.completeRun({ run, session, projectId: 'p1', engine: 'codex', currentCanonical: '', endedAt: '2026-06-01T10:30:00Z' })

    expect(out.generation.workSummary).toBe('did the thing')
    expect(out.summaryPath).toBe('projects/p1/agent-runs/R1-summary.md')
    expect(out.proposalPath).toBe('projects/p1/current.proposal.md')
    expect(runs.get('R1')!.status).toBe('completed')
    expect(runs.get('R1')!.summaryPath).toBe(out.summaryPath)
    expect(tasks.get('T1')!.status).toBe('review')
    expect(tasks.get('T1')!.reviewStatus).toBe('pending')
  })
})
