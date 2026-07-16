import { CH, type HarnessNodesEvent, type WorkspaceRestore } from '../../shared/ipc-contract.js'
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
  if (model.failedRun) {
    localStorage.setItem(runsKey, JSON.stringify([model.failedRun]))
    localStorage.setItem(selectedKey, JSON.stringify(model.failedRun.runState.runId))
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
  const scenario = isFixtureScenarioName(requested) ? requested : DEFAULT_FIXTURE_SCENARIO
  const model = buildFixtureModel(scenario)
  const calls: Array<{ channel: string; payload?: unknown }> = []
  const harnessProgress = new Set<HarnessProgressCallback>()
  const harnessLogs = new Set<HarnessLogCallback>()
  const harnessNodes = new Set<HarnessNodesCallback>()
  const devLogs = new Set<DevLogCallback>()
  const devStarted = new Set<DevStartedCallback>()

  document.documentElement.dataset.apcFixture = scenario
  window.__APC_QA_FIXTURE__ = { scenario, calls }
  seedRunStorage(model)

  const selectedProject = model.selectedProjectId ? model.dashboards[model.selectedProjectId]?.project : undefined
  const selectedDashboard = model.selectedProjectId ? model.dashboards[model.selectedProjectId] : undefined

  const invoke = (channel: string, payload?: unknown): Promise<unknown> => {
    calls.push(payload === undefined ? { channel } : { channel, payload })
    const request = (payload ?? {}) as Record<string, unknown>
    switch (channel) {
      case CH.selectFolder:
        return Promise.resolve(selectedProject?.repoPaths[0] ?? 'C:\\qa\\new-project')
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
      case CH.taskSetBlockedBy:
        return Promise.resolve({ ok: true })
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
        const recentSession = {
          id: `fixture-${historyAgent}-session`,
          agent: historyAgent,
          startedAt: '2026-07-14T12:00:00.000Z',
          endedAt: '2026-07-14T13:00:00.000Z',
          branch: 'feat/fixture-history',
          preview: `${historyAgent} 대화 히스토리 화면을 검증해 줘`,
          exchanges: [
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
      case CH.nextNoteAdd:
        return Promise.resolve({ ok: true, note: { id: 'fixture-note', projectId: model.selectedProjectId, text: String(request.text ?? ''), createdAt: '2026-07-14T13:00:00.000Z', done: false } })
      case CH.nextNoteToggle:
      case CH.nextNoteDelete:
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
      case CH.harnessGetRun:
        return model.failedRun
          ? Promise.resolve({ ok: true, runState: model.failedRun.runState, artifacts: model.failedRun.artifacts })
          : Promise.resolve({ ok: false, reason: 'Fixture run not materialized' })
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
      case CH.gitCommitPush:
        return Promise.resolve({ ok: true, reason: 'Fixture git operation completed' })
      default:
        return Promise.reject(new Error(`FixtureBridge has no response for IPC channel: ${channel}`))
    }
  }

  window.apc = {
    invoke,
    startPty: () => {},
    writePty: () => {},
    killPty: () => {},
    resizePty: () => {},
    onPtyData: () => () => {},
    onPtyExit: () => () => {},
    onHarnessProgress: (listener) => subscribe(harnessProgress, listener),
    onHarnessEngineLog: (listener) => subscribe(harnessLogs, listener),
    onHarnessNodes: (listener) => subscribe(harnessNodes, listener),
    onDevHarnessLog: (listener) => subscribe(devLogs, listener),
    onDevHarnessStarted: (listener) => subscribe(devStarted, listener),
    paneOpened: () => {},
    paneClosed: () => {},
    selectProject: () => {},
    onWorkspaceRestore: (listener) => {
      const payload: WorkspaceRestore = { panes: [], selectedProjectId: model.selectedProjectId }
      const timer = window.setTimeout(() => listener(payload), 0)
      return () => window.clearTimeout(timer)
    },
  }

  return model
}
