import { afterEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunArtifactStore } from '@apc/knowledge-harness'
import { FakeAgentRunner } from '@apc/llm-wiki'
import { slug } from '@apc/app-services'
import { RunStateSchema, type AgentSource, type NormalizedSession, type SourceCursor } from '@apc/shared'
import type { AgentIngestAdapter } from '@apc/agents'
import { buildContainer } from './container.js'
import { handlers } from './ipc.js'
import { CH } from '../shared/ipc-contract.js'

const PROJECT_ID = 'live-ux-recovery'
const SESSION_ID = 'session-recovery'

function sessionWithTodos(status: 'pending' | 'completed' = 'pending'): NormalizedSession {
  return {
    id: SESSION_ID,
    agentType: 'claude',
    repoPath: '',
    sourceMeta: {
      provider: 'claude', sourceKind: 'jsonl-file', rawLocator: '/fixture/recovery.jsonl', sessionHeader: {},
    },
    turns: [
      { role: 'user', text: '복구 계약을 구현해 줘', toolCalls: [] },
      {
        role: 'assistant', text: '', toolCalls: [{
          name: 'TodoWrite',
          input: { todos: [
            { content: '자동 편집 대상', status },
            { content: '자동 삭제 대상', status },
          ] },
        }],
      },
    ],
    filesTouched: [],
  }
}

class ReplayAdapter implements AgentIngestAdapter {
  readonly agentKind = 'claude' as const
  revision = 1

  constructor(public session: NormalizedSession, private readonly repoPath: string) {
    this.session.repoPath = repoPath
  }

  async discoverSources(_cursorFor: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
    return [{
      id: `claude:${SESSION_ID}`,
      agentKind: 'claude',
      kind: 'jsonl-file',
      locator: '/fixture/recovery.jsonl',
      repoPath: this.repoPath,
      mtimeMs: this.revision,
    }]
  }

  async parseSource(): Promise<{ session: NormalizedSession; position: string }> {
    return { session: this.session, position: JSON.stringify({ revision: this.revision }) }
  }
}

function seedWikiRun(
  runsRoot: string,
  input: {
    runId: string
    startedAt: string
    state: 'HUMAN_REVIEW_REQUIRED' | 'FAILED' | 'PROJECT_SCANNED'
    outcome: 'completed' | 'failed' | 'interrupted'
  },
): void {
  const store = new RunArtifactStore(join(runsRoot, input.runId), {
    eventId: (seq) => `${input.runId}:${seq}`,
  })
  store.init()
  store.saveRunState(RunStateSchema.parse({
    runId: input.runId,
    projectId: PROJECT_ID,
    engine: 'codex',
    state: input.state,
  }))
  const base = { runId: input.runId, projectId: PROJECT_ID }
  store.appendProgressEventSync({ ...base, at: input.startedAt, kind: 'run_started' })
  store.appendProgressEventSync({ ...base, at: input.startedAt, kind: 'work_planned', total: 1 })

  if (input.outcome === 'completed') {
    store.appendProgressEventSync({
      ...base, at: input.startedAt, kind: 'worker_completed', workerId: 'docs', folder: 'docs', attempt: 1,
    })
    store.appendProgressEventSync({ ...base, at: input.startedAt, kind: 'run_completed' })
  } else if (input.outcome === 'failed') {
    store.appendProgressEventSync({
      ...base, at: input.startedAt, kind: 'worker_failed', workerId: 'src', folder: 'src', attempt: 2,
      message: 'fixture failure',
    })
    store.appendProgressEventSync({ ...base, at: input.startedAt, kind: 'run_failed', message: 'fixture failure' })
  } else {
    store.appendProgressEventSync({
      ...base, at: input.startedAt, kind: 'engine_request_started', workerId: 'waiting-worker',
    })
  }
}

describe('file DB live UX recovery', () => {
  let root = ''
  const databases: Array<{ close(): void }> = []

  afterEach(() => {
    for (const database of databases.splice(0)) {
      try { database.close() } catch { /* already closed by the restart boundary */ }
    }
    if (root) rmSync(root, { recursive: true, force: true })
    root = ''
  })

  test('restores context, user task decisions, note lifecycle, sanitized activity, and wiki journals', async () => {
    root = mkdtempSync(join(tmpdir(), 'apc-live-ux-recovery-'))
    const dbFile = join(root, 'apc.db')
    const vaultRoot = join(root, 'vault')
    const runsRoot = join(root, 'runs')
    const repoPath = join(root, 'repo')
    mkdirSync(vaultRoot, { recursive: true })
    mkdirSync(repoPath, { recursive: true })

    let nowMs = Date.parse('2026-07-20T10:00:00Z')
    const now = () => nowMs
    const tick = () => { nowMs += 1_000 }
    const adapter = new ReplayAdapter(sessionWithTodos(), repoPath)
    const first = buildContainer({
      dbFile,
      vaultRoot,
      harnessRunsRoot: runsRoot,
      ingestAdapters: [adapter],
      agentRunner: new FakeAgentRunner(['{"title":"복구 계약 구현"}']),
      now,
    })
    databases.push(first.db)

    first.registry.register({
      id: PROJECT_ID,
      name: 'Live UX recovery',
      status: 'active',
      projectType: 'git',
      domain: 'project-docs',
      goal: '사용자가 확정한 복구 목표',
      repoPaths: [repoPath],
      vaultPaths: [],
      sourcePaths: [],
    })
    expect(first.registry.proposeContext(PROJECT_ID, 'currentFocus', '에이전트가 제안한 재시작 검증'))
      .toMatchObject({ ok: true })
    const firstHandlers = handlers(first)
    tick()
    expect(await firstHandlers[CH.projectContextConfirm]({ projectId: PROJECT_ID, field: 'currentFocus' }))
      .toMatchObject({ ok: true })

    expect(await firstHandlers[CH.ingestAll](undefined)).toMatchObject({ sources: 1, sessions: 1 })
    const editedTaskId = `todo:${PROJECT_ID}:${SESSION_ID}:${slug('자동 편집 대상')}`
    const deletedTaskId = `todo:${PROJECT_ID}:${SESSION_ID}:${slug('자동 삭제 대상')}`
    const manual = await firstHandlers[CH.taskCreate]({
      projectId: PROJECT_ID, title: '사용자 수동 작업', status: 'todo', priority: 'medium',
    }) as { ok: boolean; task?: { id: string } }
    expect(manual.ok).toBe(true)
    tick()
    expect(await firstHandlers[CH.taskUpdate]({
      projectId: PROJECT_ID,
      taskId: editedTaskId,
      title: '사용자가 편집한 자동 작업',
      status: 'review',
      priority: 'high',
    })).toMatchObject({ ok: true })
    tick()
    expect(await firstHandlers[CH.taskDelete]({ projectId: PROJECT_ID, taskId: deletedTaskId }))
      .toMatchObject({ ok: true })

    const addNote = async (text: string) => {
      tick()
      const result = await firstHandlers[CH.nextNoteAdd]({ projectId: PROJECT_ID, text }) as {
        ok: boolean; note?: { id: string }
      }
      expect(result.ok).toBe(true)
      return result.note!.id
    }
    const activeNoteId = await addNote('고정된 진행 메모')
    const completedNoteId = await addNote('완료한 메모')
    const archivedNoteId = await addNote('보관한 메모')
    const convertedNoteId = await addNote('Task로 전환할 메모')
    expect(await firstHandlers[CH.nextNoteSetPinned]({
      projectId: PROJECT_ID, noteId: activeNoteId, pinned: true,
    })).toMatchObject({ ok: true })
    expect(await firstHandlers[CH.nextNoteSetLifecycle]({
      projectId: PROJECT_ID, noteId: completedNoteId, lifecycle: 'completed',
    })).toMatchObject({ ok: true })
    expect(await firstHandlers[CH.nextNoteSetLifecycle]({
      projectId: PROJECT_ID, noteId: archivedNoteId, lifecycle: 'archived',
    })).toMatchObject({ ok: true })
    const converted = await firstHandlers[CH.nextNoteConvertToTask]({
      projectId: PROJECT_ID, noteId: convertedNoteId, priority: 'high',
    }) as { ok: boolean; task?: { id: string } }
    expect(converted).toMatchObject({ ok: true, task: { source: 'note', sourceRef: convertedNoteId } })

    const pane = {
      paneId: 'recovery-pane', projectId: PROJECT_ID, worktreePath: repoPath,
      slotId: 'codex-recovery', agent: 'codex' as const,
    }
    first.activityCoordinator.handle({ type: 'start', pane, launchId: 'recovery-launch' })
    first.activityCoordinator.handle({ type: 'spawn', paneId: pane.paneId, launchId: 'recovery-launch' })
    expect(first.liveQuestions.submit({
      paneId: pane.paneId,
      launchId: 'recovery-launch',
      text: 'password=hunter2를 설정 파일에 넣을까요?',
    })).toMatchObject({ ok: true, question: { displayText: '[민감한 질문]', privacy: 'masked' } })

    seedWikiRun(runsRoot, {
      runId: 'RUN-2026-07-20-completed', startedAt: '2026-07-20T10:10:00Z',
      state: 'HUMAN_REVIEW_REQUIRED', outcome: 'completed',
    })
    seedWikiRun(runsRoot, {
      runId: 'RUN-2026-07-20-failed', startedAt: '2026-07-20T10:20:00Z',
      state: 'FAILED', outcome: 'failed',
    })
    seedWikiRun(runsRoot, {
      runId: 'RUN-2026-07-20-interrupted', startedAt: '2026-07-20T10:30:00Z',
      state: 'PROJECT_SCANNED', outcome: 'interrupted',
    })

    first.db.close()

    adapter.session = sessionWithTodos('completed')
    adapter.session.repoPath = repoPath
    adapter.revision += 1
    tick()
    const restarted = buildContainer({
      dbFile,
      vaultRoot,
      harnessRunsRoot: runsRoot,
      ingestAdapters: [adapter],
      agentRunner: new FakeAgentRunner([]),
      now,
    })
    databases.push(restarted.db)
    try {
      const restartedHandlers = handlers(restarted)
      expect(restarted.registry.get(PROJECT_ID)).toMatchObject({
        goal: '사용자가 확정한 복구 목표',
        goalSource: 'user',
        goalConfirmedAt: expect.any(String),
        currentFocus: '에이전트가 제안한 재시작 검증',
        currentFocusSource: 'agent',
        currentFocusConfirmedAt: expect.any(String),
      })

      expect(await restartedHandlers[CH.ingestAll](undefined)).toMatchObject({ sources: 1, sessions: 1 })
      expect(restarted.tasks.get(manual.task!.id)).toMatchObject({ title: '사용자 수동 작업', source: 'manual' })
      expect(restarted.tasks.get(editedTaskId)).toMatchObject({
        title: '사용자가 편집한 자동 작업', status: 'review', priority: 'high',
        source: 'conversation', userEditedAt: expect.any(String),
      })
      expect(restarted.tasks.get(deletedTaskId)).toBeUndefined()
      expect(restarted.tasks.getIncludingDeleted(deletedTaskId)).toMatchObject({
        source: 'conversation', deletedAt: expect.any(String), userEditedAt: expect.any(String),
      })

      const listedNotes = await restartedHandlers[CH.nextNotesList]({
        projectId: PROJECT_ID, includeCompleted: true, includeArchived: true,
      }) as { ok: boolean; notes?: Array<{
        id: string; text: string; done: boolean; pinned: boolean; archivedAt?: string; convertedTaskId?: string
      }> }
      expect(listedNotes.ok).toBe(true)
      const notesById = new Map(listedNotes.notes!.map((note) => [note.id, note]))
      expect(notesById.get(activeNoteId)).toMatchObject({ done: false, pinned: true })
      expect(notesById.get(completedNoteId)).toMatchObject({ done: true, pinned: false })
      expect(notesById.get(archivedNoteId)).toMatchObject({ done: false, archivedAt: expect.any(String) })
      expect(notesById.get(convertedNoteId)).toMatchObject({
        convertedTaskId: converted.task!.id, archivedAt: expect.any(String),
      })
      expect(restarted.tasks.get(converted.task!.id)).toMatchObject({
        source: 'note', sourceRef: convertedNoteId, priority: 'high',
      })
      expect(restarted.noteTasks.convert({ projectId: PROJECT_ID, noteId: convertedNoteId }))
        .toMatchObject({ ok: true, alreadyConverted: true, task: { id: converted.task!.id } })

      const activity = await restartedHandlers[CH.agentActivitySnapshot]({ projectId: PROJECT_ID }) as {
        activities: Array<{
          connection: string; processAlive: boolean; reason?: string
          lastQuestion?: { displayText: string; privacy: string }
        }>
      }
      expect(activity.activities).toEqual([expect.objectContaining({
        connection: 'disconnected', processAlive: false, reason: 'app-restart',
        lastQuestion: expect.objectContaining({ displayText: '[민감한 질문]', privacy: 'masked' }),
      })])
      expect(JSON.stringify(activity)).not.toContain('hunter2')

      const runs = await restartedHandlers[CH.harnessListRuns]({ projectId: PROJECT_ID, limit: 10 }) as {
        ok: boolean
        runs?: Array<{ runId: string; active: boolean; summary: { status: string; health: string } }>
      }
      expect(runs.ok).toBe(true)
      expect(runs.runs?.map((run) => run.runId)).toEqual([
        'RUN-2026-07-20-interrupted',
        'RUN-2026-07-20-failed',
        'RUN-2026-07-20-completed',
      ])
      expect(runs.runs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          runId: 'RUN-2026-07-20-completed', active: false,
          summary: expect.objectContaining({ status: 'completed' }),
        }),
        expect.objectContaining({
          runId: 'RUN-2026-07-20-failed', active: false,
          summary: expect.objectContaining({ status: 'failed' }),
        }),
        expect.objectContaining({
          runId: 'RUN-2026-07-20-interrupted', active: false,
          summary: expect.objectContaining({ status: 'waiting', health: 'interrupted' }),
        }),
      ]))

      for (const [runId, status, lastEvent] of [
        ['RUN-2026-07-20-completed', 'completed', 'run_completed'],
        ['RUN-2026-07-20-failed', 'failed', 'run_failed'],
        ['RUN-2026-07-20-interrupted', 'waiting', 'engine_request_started'],
      ] as const) {
        const replay = await restartedHandlers[CH.harnessGetProgress]({ runId }) as {
          ok: boolean; active?: boolean; summary?: { status: string; health: string }; events?: Array<{ kind: string }>
        }
        expect(replay).toMatchObject({ ok: true, active: false, summary: { status } })
        if (runId.endsWith('interrupted')) expect(replay.summary?.health).toBe('interrupted')
        expect(replay.events?.at(-1)?.kind).toBe(lastEvent)
      }
    } finally {
      restarted.db.close()
    }
  })
})
