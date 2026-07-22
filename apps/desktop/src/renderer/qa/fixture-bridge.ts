import type {
  AgentActivity,
  FileRefsResolveReq,
  NextNote,
  ResolvedFileReference,
  Task,
  WikiRunEvent,
} from '@apc/shared'
import {
  CH,
  type HarnessNodesEvent,
  type PtyDataEvent,
  type PtyExitEvent,
  type WorkspaceRestore,
} from '../../shared/ipc-contract.js'
import {
  buildFixtureModel,
  DEFAULT_FIXTURE_SCENARIO,
  isFixtureScenarioName,
  type FixtureModel,
  type FixtureScenarioName,
} from './fixture-data.js'

type HarnessProgressCallback = (event: { runId: string; state: string }) => void
type HarnessLogCallback = (event: { label: string; stream: 'stdout' | 'stderr'; chunk: string }) => void
type HarnessNodesCallback = (event: HarnessNodesEvent) => void
type DevLogCallback = (event: { runId: string; label: string; stream: 'stdout' | 'stderr'; chunk: string }) => void
type DevStartedCallback = (event: { runId: string; taskId: string; projectId: string }) => void
type PtyDataCallback = (event: PtyDataEvent) => void
type PtyExitCallback = (event: PtyExitEvent) => void
type AgentActivityCallback = (event: AgentActivity) => void
type HarnessActivityCallback = (event: WikiRunEvent) => void

declare global {
  interface Window {
    __APC_QA_FIXTURE__?: {
      scenario: FixtureScenarioName
      calls: Array<{ channel: string; payload?: unknown }>
    }
  }
}

function subscribe<T>(listeners: Set<T>, listener: T): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function seedRunStorage(model: FixtureModel): void {
  const projectId = model.selectedProjectId
  if (!projectId) return
  const runsKey = `harness-dashboard:runs:${projectId}`
  const selectedKey = `harness-dashboard:selected:${projectId}`
  localStorage.removeItem(runsKey)
  localStorage.removeItem(selectedKey)
  const runs = model.harnessRuns.length > 0
    ? model.harnessRuns
    : model.failedRun ? [model.failedRun] : []
  if (runs.length > 0) {
    localStorage.setItem(runsKey, JSON.stringify(runs))
    localStorage.setItem(selectedKey, JSON.stringify(runs[0]!.runState.runId))
  }
}

function graphLiveNodes(count: number): HarnessNodesEvent['nodes'] {
  return Array.from({ length: count }, (_, index) => ({
    id: `live-node-${String(index + 1).padStart(2, '0')}`,
    title: `생성 중 발견된 지식 노드 ${index + 1}`,
    type: index % 2 === 0 ? 'concept' : 'decision',
    scope: `docs/section-${index % 8}`,
  }))
}

/** Install the deterministic browser-only implementation of the preload contract before React mounts. */
export function installFixtureBridge(search = window.location.search): FixtureModel {
  const params = new URLSearchParams(search)
  const requested = params.get('fixture')
  const historyMode = params.get('history') === '1'
  const clipboardFailureMode = params.get('clipboard') === 'failure'
  const scenario = isFixtureScenarioName(requested) ? requested : DEFAULT_FIXTURE_SCENARIO
  const model = buildFixtureModel(scenario)
  const calls: Array<{ channel: string; payload?: unknown }> = []
  const harnessProgress = new Set<HarnessProgressCallback>()
  const harnessLogs = new Set<HarnessLogCallback>()
  const harnessNodes = new Set<HarnessNodesCallback>()
  const harnessActivity = new Set<HarnessActivityCallback>()
  const devLogs = new Set<DevLogCallback>()
  const devStarted = new Set<DevStartedCallback>()
  const ptyDataV2 = new Set<PtyDataCallback>()
  const ptyExitV2 = new Set<PtyExitCallback>()
  const agentActivity = new Set<AgentActivityCallback>()

  document.documentElement.dataset.apcFixture = scenario
  window.__APC_QA_FIXTURE__ = { scenario, calls }
  seedRunStorage(model)

  const selectedProject = model.selectedProjectId ? model.dashboards[model.selectedProjectId]?.project : undefined
  const fixtureHead = 'f'.repeat(40)
  const retroAnswers = new Map<string, string>()
  const retroNotes = new Map<string, { verificationEvidence: string; riskNotes: string }>()
  const retroReceipts = new Set<string>()
  const notes = new Map(Object.entries(model.notes).map(([projectId, items]) => [
    projectId,
    items.map((item) => ({ ...item })),
  ]))
  const previewTokens = new Map<string, { reference: ResolvedFileReference; content: string }>()
  let fixtureGateInstalled = false

  const projectNotes = (projectId: string): NextNote[] => {
    const existing = notes.get(projectId)
    if (existing) return existing
    const created: NextNote[] = []
    notes.set(projectId, created)
    return created
  }
  const replaceNote = (projectId: string, next: NextNote): NextNote => {
    const items = projectNotes(projectId)
    const index = items.findIndex((item) => item.id === next.id)
    if (index >= 0) items[index] = next
    else items.unshift(next)
    return next
  }
  const resolvePreviewReferences = (request: Record<string, unknown>) => {
    const projectId = String(request.projectId ?? '')
    const project = model.projects.find((item) => item.id === projectId)
    const candidates = Array.isArray(request.candidates)
      ? request.candidates as FileRefsResolveReq['candidates']
      : []
    const files = new Map(model.previewFiles.map((file) => [file.path, file]))
    const resolved: ResolvedFileReference[] = []
    const unresolved: Array<{ candidate: FileRefsResolveReq['candidates'][number]; reason: string }> = []
    for (const candidate of candidates) {
      const normalizedPath = candidate.path.replace(/\\/g, '/')
      const rejected = model.rejectedPreviewPaths[normalizedPath]
      const file = files.get(normalizedPath)
      if (!project || rejected || !file) {
        unresolved.push({
          candidate,
          reason: rejected ?? (project ? 'fixture에 등록되지 않은 파일입니다.' : '프로젝트를 찾을 수 없습니다.'),
        })
        continue
      }
      const token = `fixture-preview:${projectId}:${normalizedPath}`
      const workspaceRoot = project.repoPaths[0] ?? 'C:\\qa\\workspace'
      const reference: ResolvedFileReference = {
        ...candidate,
        path: normalizedPath,
        token,
        projectId,
        canonicalPath: `${workspaceRoot}\\${normalizedPath.replace(/\//g, '\\')}`,
        displayPath: normalizedPath,
        workspaceRoot,
        kind: file.kind,
        size: file.content.length,
      }
      previewTokens.set(token, { reference, content: file.content })
      resolved.push(reference)
    }
    return { resolved, unresolved }
  }

  const invoke = (channel: string, payload?: unknown): Promise<unknown> => {
    calls.push(payload === undefined ? { channel } : { channel, payload })
    const request = (payload ?? {}) as Record<string, unknown>
    switch (channel) {
      case CH.selectFolder:
        return Promise.resolve(selectedProject?.repoPaths[0] ?? 'C:\\qa\\new-project')
      case CH.projectImport:
        return Promise.resolve({
          ok: true,
          canceled: false,
          destination: selectedProject?.repoPaths[0] ?? 'C:\\qa\\workspace',
          items: [{ sourceName: 'fixture.md', relativePath: 'fixture.md', kind: 'file', renamed: false }],
        })
      case CH.testSsh:
        return Promise.resolve(model.config.seedFailedRun
          ? { ok: false, error: `HTTP 401 Unauthorized — ${model.longLogPath}` }
          : { ok: true })
      case CH.appUpdate:
        return Promise.resolve(model.config.seedFailedRun
          ? { ok: false, output: `$ git pull --ff-only\nHTTP 401 Unauthorized\n${model.longLogPath}` }
          : { ok: true, output: 'Already up to date.' })
      case CH.appRestart:
        return Promise.resolve(undefined)
      case CH.listProjects:
        return Promise.resolve(model.projects)
      case CH.workspaceOverview:
        return Promise.resolve(model.overview)
      case CH.projectDashboard: {
        const projectId = String(request.projectId ?? '')
        const dashboard = model.dashboards[projectId]
        return dashboard ? Promise.resolve(dashboard) : Promise.reject(new Error(`Fixture project not found: ${projectId}`))
      }
      case CH.registerProject:
      case CH.updateProject:
        return selectedProject ? Promise.resolve(selectedProject) : Promise.reject(new Error('Fixture has no project'))
      case CH.projectContextConfirm:
        return selectedProject
          ? Promise.resolve({ ok: true, project: selectedProject })
          : Promise.resolve({ ok: false, reason: 'project-not-found' })
      case CH.deleteProject:
        return Promise.resolve({ ok: true })
      case CH.search: {
        const query = String(request.query ?? '')
        return Promise.resolve({
          query,
          hits: query && selectedProject
            ? [{ kind: 'document', id: 'fixture-hit', title: `검색 결과: ${query}`, excerpt: model.longLogPath, projectId: selectedProject.id }]
            : [],
        })
      }
      case CH.listProfiles:
        return Promise.resolve([])
      case CH.tasksList:
        return Promise.resolve(model.dashboards[String(request.projectId ?? '')]?.allTasks ?? [])
      case CH.taskSetBlockedBy: {
        const taskId = String(request.taskId ?? '')
        const task = Object.values(model.dashboards).flatMap((dashboard) => dashboard.allTasks)
          .find((item) => item.id === taskId)
        if (task && Array.isArray(request.blockedBy)) task.blockedBy = request.blockedBy.map(String)
        return Promise.resolve({ ok: true })
      }
      case CH.taskCreate: {
        const projectId = String(request.projectId ?? '')
        const dashboard = model.dashboards[projectId]
        if (!dashboard) return Promise.resolve({ ok: false, reason: 'project-not-found' })
        const task: Task = {
          id: `fixture-manual-${dashboard.allTasks.length + 1}`, projectId,
          title: String(request.title ?? 'Fixture Task'), status: 'todo', assigneeType: 'human',
          priority: request.priority === 'high' || request.priority === 'low' ? request.priority : 'medium',
          acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [], reviewStatus: 'none',
          source: 'manual', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }
        dashboard.allTasks.unshift(task)
        dashboard.activeTasks.unshift(task)
        return Promise.resolve({ ok: true, task })
      }
      case CH.taskUpdate: {
        const dashboard = model.dashboards[String(request.projectId ?? '')]
        const task = dashboard?.allTasks.find((item) => item.id === String(request.taskId ?? ''))
        if (!task) return Promise.resolve({ ok: false, reason: 'task-not-found' })
        task.title = String(request.title ?? task.title)
        if (request.status === 'todo' || request.status === 'in_progress' || request.status === 'review' || request.status === 'done' || request.status === 'rejected') task.status = request.status
        if (request.priority === 'low' || request.priority === 'medium' || request.priority === 'high') task.priority = request.priority
        task.userEditedAt = new Date().toISOString()
        task.updatedAt = task.userEditedAt
        return Promise.resolve({ ok: true, task })
      }
      case CH.taskDelete: {
        const dashboard = model.dashboards[String(request.projectId ?? '')]
        const task = dashboard?.allTasks.find((item) => item.id === String(request.taskId ?? ''))
        if (!task) return Promise.resolve({ ok: false, reason: 'task-not-found' })
        task.deletedAt = new Date().toISOString()
        dashboard!.allTasks = dashboard!.allTasks.filter((item) => item.id !== task.id)
        dashboard!.activeTasks = dashboard!.activeTasks.filter((item) => item.id !== task.id)
        dashboard!.reviewQueue = dashboard!.reviewQueue.filter((item) => item.id !== task.id)
        return Promise.resolve({ ok: true, task })
      }
      case CH.resumeCard:
        return Promise.resolve(historyMode && selectedProject ? {
          project: selectedProject,
          lastSummary: '에이전트별 대화 히스토리 화면을 구성했습니다.',
          lastQuestion: { text: '세션과 질문·답변을 한 화면에서 보여 줘', ts: '2026-07-14T12:05:00.000Z', agent: 'codex' },
          nextNotes: [],
          resumeTarget: { agent: 'codex', sessionId: 'fixture-codex-session' },
          hasHistory: true,
        } : null)
      case CH.conversationHistory: {
        const historyAgent = request.agent === 'claude' || request.agent === 'opencode' ? request.agent : 'codex'
        const liveFileReferences = model.name === 'live-ux-contracts'
        const recentSession = {
          id: `fixture-${historyAgent}-session`,
          agent: historyAgent,
          startedAt: '2026-07-14T12:00:00.000Z',
          endedAt: '2026-07-14T13:00:00.000Z',
          branch: 'feat/fixture-history',
          workspacePath: selectedProject?.repoPaths[0],
          preview: `${historyAgent} 대화 히스토리 화면을 검증해 줘`,
          exchanges: liveFileReferences ? [
            {
              id: 'fixture-file-md', askedAt: '2026-07-14T12:59:00.000Z',
              question: 'docs/fixture-guide.md 파일을 오른쪽에서 열어 줘',
              answer: 'Markdown 미리보기 경로를 확인했습니다.',
            },
            {
              id: 'fixture-file-html', askedAt: '2026-07-14T12:58:00.000Z',
              question: 'reports/fixture-preview.html 파일을 안전하게 확인해 줘',
              answer: 'HTML은 sandbox iframe으로만 표시합니다.',
            },
            {
              id: 'fixture-file-py', askedAt: '2026-07-14T12:57:00.000Z',
              question: 'scripts/fixture_check.py:2 위치를 확인해 줘',
              answer: 'Python line 2로 이동합니다.',
            },
            {
              id: 'fixture-file-rejected', askedAt: '2026-07-14T12:56:00.000Z',
              question: '../outside/secrets.py 경로도 열어 줘',
              answer: '프로젝트 밖 경로는 거부해야 합니다.',
            },
          ] : [
            {
              id: 'fixture-q1',
              askedAt: '2026-07-14T12:05:00.000Z',
              question: `${historyAgent} 대화 히스토리 화면을 검증해 줘`,
              answer: '세션 목록과 질문 아코디언을 확인했습니다.\n\n- 답변 펼치기\n- 긴 텍스트 overflow 방지',
            },
            {
              id: 'fixture-q2',
              askedAt: '2026-07-14T12:55:00.000Z',
              question: `${historyAgent} 최신 질문이 먼저 보이는지 확인해 줘`,
              answer: '질문 시간을 기준으로 내림차순 정렬했습니다.',
            },
          ],
        }
        const olderSession = {
          id: `fixture-${historyAgent}-older-session`,
          agent: historyAgent,
          startedAt: '2026-06-30T10:00:00.000Z',
          endedAt: '2026-06-30T11:00:00.000Z',
          preview: `${historyAgent} 3일 이전 대화`,
          exchanges: [{
            id: 'fixture-older-q1',
            askedAt: '2026-06-30T10:05:00.000Z',
            question: `${historyAgent} 과거 질문`,
            answer: '더 불러오기를 눌렀을 때 표시되는 과거 답변입니다.',
          }],
        }
        const includeOlder = request.includeOlder === true
        return Promise.resolve({
          projectId: String(request.projectId ?? model.selectedProjectId),
          agent: historyAgent,
          // Intentionally return the older session and exchanges first so the renderer contract
          // proves that both session and question timestamps are normalized newest-first.
          sessions: includeOlder ? [olderSession, recentSession] : [recentSession],
          scannedSources: includeOlder ? 2 : 1,
          skippedSources: 0,
          truncated: !includeOlder,
        })
      }
      case CH.questionLog:
        return Promise.resolve([])
      case CH.agentActivitySnapshot: {
        const projectId = typeof request.projectId === 'string' ? request.projectId : undefined
        return Promise.resolve({
          activities: projectId
            ? model.activities.filter((activity) => activity.pane.projectId === projectId)
            : model.activities,
          asOf: new Date().toISOString(),
        })
      }
      case CH.agentQuestionReconcile: {
        const activity = model.activities.find((item) => (
          item.pane.paneId === request.paneId && item.launchId === request.launchId
        ))
        return Promise.resolve(activity ? { ok: true, activity } : { ok: false, reason: 'pane-not-found' })
      }
      case CH.nextNotesList: {
        const includeCompleted = request.includeCompleted === true
        const includeArchived = request.includeArchived === true
        const listed = projectNotes(String(request.projectId ?? '')).filter((note) => (
          (includeArchived || !note.archivedAt) && (includeCompleted || !note.done)
        ))
        return Promise.resolve({ ok: true, notes: listed })
      }
      case CH.nextNoteAdd: {
        const projectId = String(request.projectId ?? '')
        const now = new Date().toISOString()
        const note: NextNote = {
          id: `fixture-note-${projectNotes(projectId).length + 1}`, projectId,
          text: String(request.text ?? ''), createdAt: now, updatedAt: now, done: false,
        }
        replaceNote(projectId, note)
        return Promise.resolve({ ok: true, note })
      }
      case CH.nextNoteToggle: {
        const projectId = String(request.projectId ?? '')
        const note = projectNotes(projectId).find((item) => item.id === request.id)
        if (!note) return Promise.resolve({ ok: false, reason: 'note-not-found' })
        note.done = request.done === true
        note.updatedAt = new Date().toISOString()
        return Promise.resolve({ ok: true })
      }
      case CH.nextNoteDelete: {
        const projectId = String(request.projectId ?? '')
        const items = projectNotes(projectId)
        const index = items.findIndex((item) => item.id === request.id)
        if (index < 0) return Promise.resolve({ ok: false, reason: 'note-not-found' })
        items.splice(index, 1)
        return Promise.resolve({ ok: true })
      }
      case CH.nextNoteUpdate:
      case CH.nextNoteSetPinned:
      case CH.nextNoteSetLifecycle: {
        const projectId = String(request.projectId ?? '')
        const note = projectNotes(projectId).find((item) => item.id === request.noteId)
        if (!note) return Promise.resolve({ ok: false, reason: 'note-not-found' })
        if (channel === CH.nextNoteUpdate) note.text = String(request.text ?? note.text)
        if (channel === CH.nextNoteSetPinned) note.pinned = request.pinned === true
        if (channel === CH.nextNoteSetLifecycle) {
          const lifecycle = request.lifecycle
          note.done = lifecycle === 'completed'
          note.archivedAt = lifecycle === 'archived' ? new Date().toISOString() : undefined
        }
        note.updatedAt = new Date().toISOString()
        return Promise.resolve({ ok: true, note })
      }
      case CH.nextNoteConvertToTask: {
        const projectId = String(request.projectId ?? '')
        const note = projectNotes(projectId).find((item) => item.id === request.noteId)
        if (!note) return Promise.resolve({ ok: false, reason: 'note-not-found' })
        const task: Task = {
          id: note.convertedTaskId ?? `task:${projectId}:note:${note.id}`, projectId,
          title: String(request.title ?? note.text), status: 'todo', assigneeType: 'human',
          priority: request.priority === 'high' || request.priority === 'low' ? request.priority : 'medium',
          acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [], reviewStatus: 'none',
          source: 'note', sourceRef: note.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }
        note.convertedTaskId = task.id
        note.archivedAt = new Date().toISOString()
        note.updatedAt = note.archivedAt
        return Promise.resolve({ ok: true, note, task })
      }
      case CH.retroPrepare: {
        const date = String(request.date ?? '2026-07-20')
        const targets = Array.isArray(request.targets) ? request.targets as Array<{ projectId?: unknown; worktreePath?: unknown }> : []
        const projects = targets.flatMap((target) => {
          const projectId = String(target.projectId ?? '')
          const project = model.projects.find((item) => item.id === projectId)
          if (!project) return []
          const targetId = `fixture-target:${projectId}`
          const savedNotes = retroNotes.get(targetId)
          return [{
            projectId,
            name: project.name,
            repoPath: String(target.worktreePath ?? project.repoPaths[0] ?? 'C:\\qa\\workspace'),
            branch: 'feat/fixture-learning-gate',
            target: {
              id: targetId, retroId: `retro:${date}`, projectId,
              repoPath: String(target.worktreePath ?? project.repoPaths[0] ?? 'C:\\qa\\workspace'),
              branch: 'feat/fixture-learning-gate', preparedHeadSha: fixtureHead,
              preparedAt: `${date}T09:00:00.000Z`, ...savedNotes,
              ...(retroReceipts.has(targetId) ? { receiptId: `fixture-receipt:${projectId}` } : {}),
            },
            headCovered: retroReceipts.has(targetId), gateEnabled: true, hookInstalled: fixtureGateInstalled,
            lastReceiptSha: null,
            commits: [{ sha: fixtureHead, when: `${date}T10:00:00.000Z`, subject: 'feat: Learning Gate fixture flow' }],
            workingTreeFiles: 1, changedFiles: 4, additions: 48, deletions: 12, resetByHeadDrift: false,
          }]
        })
        const targetQuestionTexts = [
          '이번 변경으로 이전 동작이 어떻게 달라졌는가?',
          '가장 중요한 실행 흐름을 시작점부터 결과까지 설명해보라.',
          '가장 깨지기 쉬운 지점과 이를 발견할 로그·증상은 무엇인가?',
          '어떤 테스트나 실행 결과가 결론을 뒷받침하는가?',
          'agent가 내린 결론 중 직접 확인한 것과 아직 가정인 것은 무엇인가?',
        ]
        const targetQuestions = projects.flatMap((project) => targetQuestionTexts.map((text, index) => {
          const id = `fixture-question:${project.projectId}:${index}`
          return {
            id, retroId: `retro:${date}`, targetId: project.target.id, projectId: project.projectId,
            kind: 'template', critical: true, text, answer: retroAnswers.get(id), skipped: false,
          }
        }))
        const closingQuestions = ['오늘 배운 것 1가지는?', '내일 더 깊게 파 것 1가지는?'].map((text, index) => {
          const id = `fixture-question:closing:${index}`
          return { id, retroId: `retro:${date}`, kind: 'closing', critical: false, text, answer: retroAnswers.get(id), skipped: false }
        })
        return Promise.resolve({
          ok: true,
          retro: { id: `retro:${date}`, date, startedAt: `${date}T09:00:00.000Z` },
          questions: [...targetQuestions, ...closingQuestions], projects, skips: [], problems: [],
        })
      }
      case CH.retroAnswer:
        if (typeof request.questionId === 'string') {
          if (typeof request.answer === 'string' && request.answer.trim()) retroAnswers.set(request.questionId, request.answer.trim())
          else retroAnswers.delete(request.questionId)
        }
        return Promise.resolve({ ok: true })
      case CH.retroTargetNotes:
        retroNotes.set(String(request.targetId ?? ''), {
          verificationEvidence: String(request.verificationEvidence ?? ''),
          riskNotes: String(request.riskNotes ?? ''),
        })
        return Promise.resolve({ ok: true })
      case CH.receiptIssue: {
        const targetId = String(request.targetId ?? '')
        retroReceipts.add(targetId)
        const projectId = targetId.replace('fixture-target:', '')
        const repoPath = model.projects.find((item) => item.id === projectId)?.repoPaths[0] ?? 'C:\\qa\\workspace'
        return Promise.resolve({
          ok: true,
          receipt: {
            id: `fixture-receipt:${projectId}`, projectId, repoPath, branch: 'feat/fixture-learning-gate',
            reviewedHeadSha: fixtureHead, retroId: String(request.retroId ?? 'retro:fixture'), targetId,
            answeredQuestionIds: [...retroAnswers.keys()].filter((id) => id.includes(projectId)),
            evidenceRefs: [retroNotes.get(targetId)?.verificationEvidence ?? 'fixture evidence'],
            answerSnapshotHash: 'a'.repeat(64), issuedAt: new Date().toISOString(),
          },
        })
      }
      case CH.retroComplete:
        return Promise.resolve({ ok: true })
      case CH.gateStatus: {
        const projectId = String(request.projectId ?? model.selectedProjectId ?? '')
        const covered = retroReceipts.has(`fixture-target:${projectId}`)
        return Promise.resolve({
          ok: true, enabled: true, hookInstalled: fixtureGateInstalled, headSha: fixtureHead,
          headCovered: covered, reviewedCount: covered ? 1 : 0,
        })
      }
      case CH.gateInstall:
        fixtureGateInstalled = true
        return Promise.resolve({ ok: true })
      case CH.ingestAll:
        return Promise.resolve({ sources: 4, sessions: 8, documents: model.documents.length })
      case CH.generatePreflight:
        return Promise.resolve({
          ok: true,
          projectId: model.selectedProjectId,
          projectName: selectedProject?.name,
          categories: [],
          totalCount: model.documents.length,
          status: 'ready',
        })
      case CH.generateRun:
      case CH.generateProject:
        return Promise.resolve({ ok: true, sessionId: 'fixture-session' })
      case CH.harnessRun: {
        if (!model.config.generating) {
          return Promise.resolve({ ok: true, runId: 'fixture-run-complete', finalState: 'HUMAN_REVIEW_REQUIRED' })
        }
        window.setTimeout(() => {
          const runId = 'fixture-run-generating'
          if (model.selectedProjectId) {
            const event: WikiRunEvent = {
              version: 1, seq: 1, eventId: `${runId}:1`, runId,
              projectId: model.selectedProjectId, at: new Date().toISOString(), kind: 'run_started',
            }
            for (const listener of harnessActivity) listener(event)
          }
          for (const listener of harnessProgress) listener({ runId, state: 'SOURCES_EXTRACTED' })
          for (const listener of harnessLogs) listener({
            label: 'codex · project-discovery',
            stream: 'stdout',
            chunk: `문서와 세션을 분석 중입니다. log=${model.longLogPath || 'C:\\qa\\logs\\fixture-run.log'}\n`,
          })
          for (const listener of harnessNodes) listener({ runId, folder: 'docs', nodes: graphLiveNodes(42) })
        }, 25)
        return new Promise<never>(() => { /* deliberately in-flight for the generating fixture */ })
      }
      case CH.harnessGetRun: {
        const bundle = model.harnessRuns.find((item) => item.runState.runId === request.runId) ?? model.failedRun
        return bundle
          ? Promise.resolve({ ok: true, runState: bundle.runState, artifacts: bundle.artifacts })
          : Promise.resolve({ ok: false, reason: 'Fixture run not materialized' })
      }
      case CH.harnessListRuns: {
        const projectId = String(request.projectId ?? '')
        return Promise.resolve({
          ok: true,
          runs: model.wikiProgressRuns.filter((run) => run.projectId === projectId),
        })
      }
      case CH.harnessGetProgress: {
        const run = model.wikiProgressRuns.find((item) => item.runId === request.runId)
        return Promise.resolve(run
          ? { ok: true, summary: run.summary, events: [], active: run.active }
          : { ok: false, reason: 'Fixture progress not found' })
      }
      case CH.harnessReadLog:
        return Promise.resolve({
          ok: true,
          content: `fixture durable log for ${String(request.runId ?? '')}\n문서와 세션을 분석 중입니다.\n${model.longLogPath}`,
          nextOffset: 0,
          truncated: false,
        })
      case CH.harnessResume:
        return Promise.resolve({ ok: false, runId: String(request.runId ?? ''), reason: 'Fixture resume is read-only' })
      case CH.harnessConfirmNodes:
      case CH.harnessPromote:
      case CH.harnessPromoteCanonical:
      case CH.harnessProposePolicy:
      case CH.harnessApprovePolicy:
      case CH.harnessRevertPolicy:
        return Promise.resolve({ ok: true })
      case CH.harnessCanonicalProposals:
        return Promise.resolve([])
      case CH.harnessGetPolicy:
        return Promise.resolve({ ok: true, record: null })
      case CH.harnessReadStagedDoc:
        return Promise.resolve({ ok: false, reason: 'No staged fixture document' })
      case CH.harnessListStagedDocs:
        return Promise.resolve({ docs: [] })
      case CH.harnessReadGraphEdges:
        return Promise.resolve({ edges: [] })
      case CH.harnessExportWiki:
        return Promise.resolve({ ok: true, target: 'C:\\qa\\workspace\\wiki', files: model.documents.length })
      case CH.readProjectWiki:
        return Promise.resolve(model.wiki)
      case CH.fileRefsResolve:
        return Promise.resolve(resolvePreviewReferences(request))
      case CH.filePreviewRead: {
        const stored = previewTokens.get(String(request.token ?? ''))
        if (!stored || stored.reference.projectId !== request.projectId) {
          return Promise.resolve({ ok: false, reason: '만료되었거나 잘못된 fixture preview token입니다.' })
        }
        return Promise.resolve({ ok: true, ...stored, encoding: 'utf8' })
      }
      case CH.clipboardReadText:
        return Promise.resolve(clipboardFailureMode
          ? { ok: false, reason: 'fixture clipboard permission denied' }
          : { ok: true, text: 'fixture clipboard 한글 붙여넣기' })
      case CH.terminalGetPreferences:
        return Promise.resolve({ ok: true, preferences: { fontFamily: 'D2Coding, Cascadia Mono, monospace', fontSize: 13 } })
      case CH.terminalSetPreferences:
        return Promise.resolve({ ok: true, preferences: { fontFamily: String(request.fontFamily ?? 'D2Coding'), fontSize: Number(request.fontSize ?? 13) } })
      case CH.terminalDiagnostics:
        return Promise.resolve({
          ok: true,
          environment: { kind: 'local', term: 'xterm-256color', colorTerm: 'truecolor', locale: 'ko_KR.UTF-8', utf8: true },
          warnings: [],
        })
      case CH.devHarnessRun:
        return Promise.resolve({ ok: true, runId: 'fixture-dev-run', exitCode: 0 })
      case CH.devHarnessCancel:
        return Promise.resolve({ ok: true })
      case CH.composeContext:
        return Promise.resolve({ ok: true, prompt: '# Fixture context\n\nDeterministic QA prompt.' })
      case CH.devHarnessReadTranscript:
        return Promise.resolve({ ok: true, content: `fixture transcript\n${model.longLogPath}` })
      case CH.submitReview:
      case CH.promoteCurrent:
      case CH.selectProfile:
        return Promise.resolve({ ok: true })
      case CH.configPreview:
        return Promise.resolve({ ok: true, errors: [], diff: '' })
      case CH.configApply:
        return Promise.resolve({ ok: true, errors: [], snapshotPath: 'C:\\qa\\snapshot.json' })
      case CH.configRollback:
        return Promise.resolve({ ok: true, restoredFrom: 'C:\\qa\\snapshot.json' })
      case CH.fsReadDoc: {
        const relPath = String(request.relPath ?? 'current.md')
        return Promise.resolve({
          ok: true,
          content: `# ${relPath}\n\nFixture scenario: **${scenario}**\n\n문서 수: ${model.documents.length}`,
        })
      }
      case CH.fsListDocs:
        return Promise.resolve({ docs: model.documents })
      case CH.changesList:
        return Promise.resolve({ ok: true, files: model.changes })
      case CH.changesDiff: {
        const path = String(request.relPath ?? 'fixture.ts')
        return Promise.resolve({ ok: true, patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old fixture\n+new fixture` })
      }
      case CH.gitStatus:
        return Promise.resolve({
          ok: true,
          repoPath: selectedProject?.repoPaths[0],
          root: selectedProject?.repoPaths[0],
          branch: 'feat/fixture-browser-qa',
          detached: false,
          upstream: 'origin/feat/fixture-browser-qa',
          ahead: 1,
          behind: 0,
          hasChanges: model.changes.length > 0,
          files: model.changes.map((file) => ({ path: file.path, status: file.status === 'new' ? 'untracked' : file.status, staged: false, unstaged: true, conflict: false })),
          warnings: [],
        })
      case CH.gitWorktrees: {
        const root = selectedProject?.repoPaths[0] ?? 'C:\\qa\\workspace'
        return Promise.resolve({
          ok: true,
          worktrees: [
            { path: root, branch: 'main', head: 'fixture-main', detached: false, isMain: true },
            { path: `${root}-fixture-worktree`, branch: 'feat/fixture-browser-qa', head: 'fixture-feature', detached: false, isMain: false },
          ],
        })
      }
      case CH.gitFetch:
      case CH.gitPull:
      case CH.gitCommit:
      case CH.gitPush:
        return Promise.resolve({ ok: true, reason: 'Fixture git operation completed' })
      default:
        return Promise.reject(new Error(`FixtureBridge has no response for IPC channel: ${channel}`))
    }
  }

  window.apc = {
    invoke,
    importProjectItems: (request) => invoke(CH.projectImport, request) as ReturnType<Window['apc']['importProjectItems']>,
    startPty: (request) => {
      calls.push({ channel: CH.ptyStart, payload: request })
      if (!request.pane || !request.launchId) return
      const activity: AgentActivity = {
        pane: request.pane,
        launchId: request.launchId,
        connection: 'connected',
        phase: 'working',
        processAlive: true,
        lastActivityAt: new Date().toISOString(),
        currentLabel: 'fixture PTY 연결됨',
        revision: 1,
      }
      window.setTimeout(() => {
        for (const listener of ptyDataV2) listener({
          id: request.id,
          launchId: request.launchId!,
          data: `fixture PTY ready · ${request.pane!.paneId}\r\n`,
        })
        for (const listener of agentActivity) listener(activity)
      }, 0)
    },
    writePty: (request) => {
      calls.push({
        channel: CH.ptyInput,
        payload: { id: request.id, launchId: request.launchId, bytes: request.data.length },
      })
    },
    killPty: (request) => {
      calls.push({ channel: CH.ptyKill, payload: request })
      if (!request.launchId) return
      for (const listener of ptyExitV2) listener({
        id: request.id, launchId: request.launchId, code: 0, reason: request.reason ?? 'user',
      })
    },
    resizePty: (request) => {
      calls.push({ channel: CH.ptyResize, payload: request })
    },
    onPtyData: () => () => {},
    onPtyExit: () => () => {},
    onPtyDataV2: (listener) => subscribe(ptyDataV2, listener),
    onPtyExitV2: (listener) => subscribe(ptyExitV2, listener),
    onAgentActivity: (listener) => subscribe(agentActivity, listener),
    onHarnessProgress: (listener) => subscribe(harnessProgress, listener),
    onHarnessEngineLog: (listener) => subscribe(harnessLogs, listener),
    onHarnessNodes: (listener) => subscribe(harnessNodes, listener),
    onHarnessActivity: (listener) => subscribe(harnessActivity, listener),
    onDevHarnessLog: (listener) => subscribe(devLogs, listener),
    onDevHarnessStarted: (listener) => subscribe(devStarted, listener),
    paneOpened: (payload) => { calls.push({ channel: CH.paneOpened, payload }) },
    paneClosed: (payload) => { calls.push({ channel: CH.paneClosed, payload }) },
    selectProject: (payload) => { calls.push({ channel: CH.selectProject, payload }) },
    onWorkspaceRestore: (listener) => {
      const payload: WorkspaceRestore = { panes: [], selectedProjectId: model.selectedProjectId }
      const timer = window.setTimeout(() => listener(payload), 0)
      return () => window.clearTimeout(timer)
    },
  }

  return model
}
