import type {
  AgentActivity,
  AgentRun,
  FilePreviewKind,
  NextNote,
  Project,
  Task,
  WikiProgressSummary,
} from '@apc/shared'
import type { WorkspaceOverview } from '@apc/dashboard-api'
import type {
  ChangesListRes,
  HarnessRunProgressDto,
  ProjectDashboardRes,
  ReadProjectWikiRes,
} from '../../shared/ipc-contract.js'
import type { HarnessRunBundle } from '../harness-utils.js'
import rawScenarios from './fixtures/scenarios.json'

export type FixtureScenarioName = keyof typeof rawScenarios
export const FIXTURE_SCENARIO_NAMES = Object.keys(rawScenarios) as FixtureScenarioName[]
export const DEFAULT_FIXTURE_SCENARIO: FixtureScenarioName = 'many-projects-docs'

type ScenarioConfig = (typeof rawScenarios)[FixtureScenarioName]

export type FixtureModel = {
  name: FixtureScenarioName
  config: ScenarioConfig
  projects: Project[]
  selectedProjectId: string | null
  dashboards: Record<string, ProjectDashboardRes>
  overview: WorkspaceOverview
  notes: Record<string, NextNote[]>
  activities: AgentActivity[]
  harnessRuns: HarnessRunBundle[]
  wikiProgressRuns: HarnessRunProgressDto[]
  previewFiles: FixturePreviewFile[]
  rejectedPreviewPaths: Record<string, string>
  documents: { relPath: string; mtimeMs: number }[]
  changes: NonNullable<ChangesListRes['files']>
  wiki: ReadProjectWikiRes
  failedRun: HarnessRunBundle | null
  longLogPath: string
}

export type FixturePreviewFile = {
  path: string
  kind: FilePreviewKind
  content: string
}

const FIXED_NOW = Date.parse('2026-07-14T13:00:00.000Z')
const PROJECT_ID_PREFIX = 'qa-project-'

const statuses: Project['status'][] = ['active', 'maintenance', 'paused', 'archived']
const taskStatuses: Task['status'][] = ['todo', 'in_progress', 'review', 'done']
const taskSources: NonNullable<Task['source']>[] = ['manual', 'conversation', 'note', 'review', 'system']

function projectAt(index: number, config: ScenarioConfig): Project {
  const n = String(index + 1).padStart(2, '0')
  const name = config.longLabels && index === 0
    ? '긴 한글 프로젝트 이름과 아주 좁은 화면에서도 버튼과 배지가 서로 겹치지 않아야 하는 품질 보증 작업공간'
    : index === 0 ? 'APC 시각 품질 보증' : `샘플 프로젝트 ${n}`
  const repo = config.seedFailedRun && index === 0
    ? 'C:\\Users\\qa-runner\\AppData\\Local\\AgentProjectConsole\\매우-긴-프로젝트-경로\\packages\\knowledge-harness\\fixtures\\auth-failure'
    : `C:\\qa\\workspace\\project-${n}`
  return {
    id: `${PROJECT_ID_PREFIX}${n}`,
    name,
    status: statuses[index % statuses.length],
    goal: config.longLabels && index === 0
      ? '긴 한글 레이블과 좁은 viewport에서도 모든 상호작용 요소가 한 줄 계약과 읽기 쉬운 간격을 유지한다.'
      : `프로젝트 ${n}의 결정적인 QA 상태를 검증한다.`,
    currentFocus: index === 0 ? 'fixture 기반 브라우저 회귀 테스트' : '문서와 실행 상태 정리',
    goalSource: index === 0 ? 'user' : 'agent',
    goalConfirmedAt: index === 0 ? '2026-07-14T11:00:00.000Z' : undefined,
    currentFocusSource: 'agent',
    currentFocusConfirmedAt: index === 0 ? '2026-07-14T11:05:00.000Z' : undefined,
    startDate: '2026-07-01',
    targetDate: '2026-08-15',
    projectType: 'git',
    domain: 'project-docs',
    repoPaths: [repo],
    vaultPaths: [],
    sourcePaths: [],
  }
}

function tasksFor(project: Project, count: number, longLabels: boolean): Task[] {
  return Array.from({ length: count }, (_, index) => {
    const status = taskStatuses[index % taskStatuses.length]
    const source = taskSources[index % taskSources.length]
    const suffix = String(index + 1).padStart(2, '0')
    return {
      id: `task:${project.id}:${suffix}`,
      projectId: project.id,
      title: longLabels && index < 3
        ? `아주 긴 한글 작업 제목 ${suffix} — 좁은 화면에서도 컨텍스트 조립과 Harness 실행 버튼이 겹치거나 줄바꿈되지 않도록 검증`
        : `QA 작업 ${suffix}: renderer 상태와 레이아웃 계약 검증`,
      status,
      assigneeType: 'agent',
      assignee: index % 2 === 0 ? 'codex' : 'harness',
      priority: index % 3 === 0 ? 'high' : index % 3 === 1 ? 'medium' : 'low',
      dueDate: `2026-07-${String(15 + (index % 12)).padStart(2, '0')}`,
      acceptanceCriteria: ['viewport overflow 없음', '인접 버튼 겹침 없음'],
      linkedWikiPages: [],
      blockedBy: [],
      reviewStatus: status === 'review' ? 'pending' : 'none',
      source,
      sourceRef: source === 'manual' ? undefined : `fixture:${source}:${suffix}`,
      createdAt: new Date(FIXED_NOW - (index + 1) * 60_000).toISOString(),
      updatedAt: new Date(FIXED_NOW - index * 30_000).toISOString(),
      userEditedAt: index === 1 ? '2026-07-14T12:45:00.000Z' : undefined,
    }
  })
}

function runsFor(project: Project, tasks: Task[]): AgentRun[] {
  return tasks.slice(0, 5).map((task, index) => ({
    id: `agent-run-${project.id}-${index + 1}`,
    taskId: task.id,
    agent: index === 0 ? 'harness' : index % 2 === 0 ? 'codex' : 'claude',
    repoPath: project.repoPaths[0] ?? '.',
    branch: 'feat/fixture-browser-qa',
    startedAt: new Date(FIXED_NOW - index * 3_600_000).toISOString(),
    endedAt: index === 0 ? undefined : new Date(FIXED_NOW - index * 3_500_000).toISOString(),
    status: index === 0 ? 'running' : index === 1 ? 'failed' : 'completed',
    transcriptPath: `${project.repoPaths[0]}\\.agent-runs\\run-${index + 1}\\transcript.log`,
  }))
}

function dashboardFor(project: Project, config: ScenarioConfig): ProjectDashboardRes {
  const tasks = tasksFor(project, config.taskCount, config.longLabels)
  const recentRuns = runsFor(project, tasks)
  return {
    project,
    activeTasks: tasks.filter((task) => task.status === 'todo' || task.status === 'in_progress'),
    reviewQueue: tasks.filter((task) => task.status === 'review'),
    recentRuns,
    allTasks: tasks,
  }
}

function notesFor(project: Project): NextNote[] {
  return [
    {
      id: `note:${project.id}:pinned`, projectId: project.id,
      text: '고정된 진행 메모', createdAt: '2026-07-14T09:00:00.000Z',
      updatedAt: '2026-07-14T12:50:00.000Z', done: false, pinned: true,
    },
    {
      id: `note:${project.id}:converted`, projectId: project.id,
      text: 'Task로 전환된 진행 메모', createdAt: '2026-07-14T09:10:00.000Z',
      updatedAt: '2026-07-14T12:40:00.000Z', done: false,
      convertedTaskId: `task:${project.id}:03`,
    },
    {
      id: `note:${project.id}:completed`, projectId: project.id,
      text: '완료한 프로젝트 메모', createdAt: '2026-07-14T09:20:00.000Z',
      updatedAt: '2026-07-14T12:30:00.000Z', done: true,
    },
    {
      id: `note:${project.id}:archived`, projectId: project.id,
      text: '보관된 프로젝트 메모', createdAt: '2026-07-14T09:30:00.000Z',
      updatedAt: '2026-07-14T12:20:00.000Z', done: false,
      archivedAt: '2026-07-14T12:20:00.000Z',
    },
  ]
}

function activitiesFor(project: Project): AgentActivity[] {
  const now = Date.now()
  const variants: Array<{
    key: string
    agent: AgentActivity['pane']['agent']
    connection: AgentActivity['connection']
    phase: AgentActivity['phase']
    processAlive: boolean
    label: string
    reason?: string
    stale?: boolean
    question?: AgentActivity['lastQuestion']
  }> = [
    {
      key: 'working', agent: 'codex', connection: 'connected', phase: 'working', processAlive: true,
      label: 'renderer fixture 검증 중',
    },
    {
      key: 'awaiting', agent: 'claude', connection: 'connected', phase: 'awaiting_user', processAlive: true,
      label: '사용자 응답 대기',
      question: {
        displayText: 'docs/fixture-guide.md를 먼저 확인할까요?',
        askedAt: new Date(now - 8_000).toISOString(), privacy: 'visible', source: 'pty',
      },
    },
    {
      key: 'idle', agent: 'opencode', connection: 'connected', phase: 'idle', processAlive: true,
      label: '다음 작업 대기',
    },
    {
      key: 'error', agent: 'codex', connection: 'error', phase: 'idle', processAlive: false,
      label: '인증 오류', reason: 'fixture-auth-failure',
      question: {
        displayText: '[민감한 질문]', askedAt: new Date(now - 18_000).toISOString(),
        privacy: 'masked', source: 'pty',
      },
    },
    {
      key: 'disconnected', agent: 'claude', connection: 'disconnected', phase: 'idle', processAlive: false,
      label: '원격 연결 종료', reason: 'transport-closed', stale: true,
    },
  ]
  return variants.map((variant, index) => {
    const lastActivityAt = new Date(now - index * 12_000).toISOString()
    return {
      pane: {
        paneId: `${project.id}:fixture:${variant.key}`,
        projectId: project.id,
        worktreePath: index < 3 ? project.repoPaths[0]! : `${project.repoPaths[0]}-fixture-${variant.key}`,
        slotId: `${variant.agent}-${index + 1}`,
        agent: variant.agent,
      },
      launchId: `fixture-launch-${variant.key}`,
      connection: variant.connection,
      phase: variant.phase,
      processAlive: variant.processAlive,
      lastActivityAt,
      currentLabel: variant.label,
      ...(variant.reason ? { reason: variant.reason } : {}),
      ...(variant.stale ? { staleSince: lastActivityAt } : {}),
      ...(variant.question ? { lastQuestion: variant.question } : {}),
      revision: index + 1,
    }
  })
}

function liveWikiRuns(project: Project): {
  bundles: HarnessRunBundle[]
  progress: HarnessRunProgressDto[]
} {
  const now = Date.now()
  const definitions: Array<{
    key: 'active' | 'quiet' | 'stalled' | 'completed' | 'failed'
    status: WikiProgressSummary['status']
    health: WikiProgressSummary['health']
    active: boolean
    lastActivityAgoMs: number
    state: HarnessRunBundle['runState']['state']
  }> = [
    { key: 'active', status: 'generating', health: 'active', active: true, lastActivityAgoMs: 2_000, state: 'DOCUMENTS_CLASSIFIED' },
    { key: 'quiet', status: 'generating', health: 'quiet', active: true, lastActivityAgoMs: 45_000, state: 'DOCUMENTS_CLASSIFIED' },
    { key: 'stalled', status: 'generating', health: 'stalled', active: true, lastActivityAgoMs: 180_000, state: 'DOCUMENTS_CLASSIFIED' },
    { key: 'completed', status: 'completed', health: 'active', active: false, lastActivityAgoMs: 60_000, state: 'HUMAN_REVIEW_REQUIRED' },
    { key: 'failed', status: 'failed', health: 'active', active: false, lastActivityAgoMs: 75_000, state: 'FAILED' },
  ]
  const bundles: HarnessRunBundle[] = []
  const progress: HarnessRunProgressDto[] = []
  for (const [index, definition] of definitions.entries()) {
    const runId = `wiki-fixture-${definition.key}`
    const startedAt = new Date(now - 600_000 - index * 60_000).toISOString()
    const lastActivityAt = new Date(now - definition.lastActivityAgoMs).toISOString()
    const terminal = definition.status === 'completed' || definition.status === 'failed'
    const failed = definition.status === 'failed'
    const summary: WikiProgressSummary = {
      runId,
      projectId: project.id,
      status: definition.status,
      health: definition.health,
      phase: failed ? 'NODE_PROPOSALS_CREATED' : 'DOCUMENTS_CLASSIFIED',
      startedAt,
      lastActivityAt,
      ...(terminal ? { endedAt: lastActivityAt } : {}),
      work: {
        total: 3,
        completed: terminal && !failed ? 3 : 1,
        inProgress: terminal ? 0 : 1,
        failed: failed ? 1 : 0,
        retries: definition.key === 'stalled' ? 1 : 0,
      },
      workers: [{
        workerId: `worker-${definition.key}`,
        folder: `docs/${definition.key}`,
        attempt: definition.key === 'stalled' ? 2 : 1,
        status: failed ? 'failed' : definition.status === 'completed' ? 'completed' : 'running',
        lastActivityAt,
        ...(failed ? { message: 'fixture worker failure' } : {}),
      }],
      nodes: [{
        workerId: `worker-${definition.key}`,
        proposalId: `proposal-${definition.key}`,
        title: `Fixture ${definition.key} node`,
        nodeType: 'ConceptNode',
        sourceFolder: `docs/${definition.key}`,
        status: terminal && !failed ? 'accepted' : 'discovered',
        discoveredAt: startedAt,
        updatedAt: lastActivityAt,
      }],
    }
    bundles.push({
      mode: 'full-docs',
      runState: {
        runId, projectId: project.id, engine: 'codex', state: definition.state,
        history: [
          { state: 'CREATED', at: startedAt },
          { state: definition.state, at: lastActivityAt },
        ],
        artifacts: {},
        ...(failed ? { error: 'fixture failed wiki run' } : {}),
      },
      artifacts: [],
    })
    progress.push({ runId, projectId: project.id, summary, active: definition.active })
  }
  return { bundles, progress }
}

function previewFiles(): FixturePreviewFile[] {
  return [
    {
      path: 'docs/fixture-guide.md',
      kind: 'markdown',
      content: '# Fixture Markdown\n\n오른쪽 미리보기에서 안전하게 렌더링됩니다.\n\n[scripts/fixture_check.py](../scripts/fixture_check.py)',
    },
    {
      path: 'reports/fixture-preview.html',
      kind: 'html',
      content: '<!doctype html><html><body><h1>Fixture HTML</h1><script>window.top.location="https://example.invalid"</script></body></html>',
    },
    {
      path: 'scripts/fixture_check.py',
      kind: 'python',
      content: 'def verify_fixture():\n    message = "Fixture Python"\n    return message\n',
    },
  ]
}

function buildOverview(projects: Project[], dashboards: Record<string, ProjectDashboardRes>): WorkspaceOverview {
  return {
    generatedAt: '2026-07-14T13:00:00.000Z',
    projects: projects.map((project, index) => {
      const dashboard = dashboards[project.id]
      return {
        project,
        activeTaskCount: dashboard.activeTasks.length,
        runningRuns: index % 3 === 0 ? dashboard.recentRuns.filter((run) => run.status === 'running') : [],
        reviewQueueCount: dashboard.reviewQueue.length,
        nextUp: dashboard.activeTasks.slice(0, 3),
        topNote: index === 0 ? 'Windows 기준 핵심 snapshot과 Electron IPC smoke를 확인한다.' : undefined,
      }
    }),
  }
}

function buildDocuments(count: number): FixtureModel['documents'] {
  return Array.from({ length: count }, (_, index) => ({
    relPath: index === 0
      ? 'current.md'
      : `docs/section-${String(index % 18).padStart(2, '0')}/architecture-and-quality-contract-${String(index).padStart(3, '0')}.md`,
    mtimeMs: FIXED_NOW - index * 60_000,
  }))
}

function buildChanges(count: number): FixtureModel['changes'] {
  return Array.from({ length: count }, (_, index) => ({
    path: index % 3 === 0
      ? `docs/매우-긴-변경-경로/fixture-browser-regression/section-${index + 1}/layout-contract-${String(index + 1).padStart(2, '0')}.md`
      : `apps/desktop/src/renderer/components/FixtureQualitySurface${String(index + 1).padStart(2, '0')}.tsx`,
    status: index % 7 === 0 ? 'new' : index % 11 === 0 ? 'deleted' : 'modified',
    isMarkdown: index % 3 === 0,
    mtimeMs: FIXED_NOW - index * 90_000,
    unreflected: index % 5 === 0,
    additions: index + 2,
    deletions: index % 4,
    binary: false,
  }))
}

function buildWiki(nodeCount: number, edgeCount: number): ReadProjectWikiRes {
  if (nodeCount === 0) return { available: false, reason: 'fixture has no project' }
  const nodes = Array.from({ length: nodeCount }, (_, index) => {
    const number = String(index + 1).padStart(3, '0')
    const type = index % 4 === 0 ? 'decision' : index % 4 === 1 ? 'concept' : index % 4 === 2 ? 'component' : 'workflow'
    return {
      ref: `${type}:fixture-node-${number}`,
      type,
      title: `Fixture 지식 노드 ${number}`,
      relPath: `wiki/${type}/fixture-node-${number}.md`,
    }
  })
  const edges = Array.from({ length: edgeCount }, (_, index) => ({
    from: nodes[index % nodes.length].ref,
    to: nodes[(index * 7 + 3) % nodes.length].ref,
    type: index % 2 === 0 ? 'depends_on' : 'relates_to',
    confidence: index % 3 === 0 ? 'high' : 'medium',
  }))
  return { available: true, wikiDir: 'C:\\qa\\vault\\wiki', nodes, edges }
}

function failedRun(project: Project, longLogPath: string): HarnessRunBundle {
  return {
    mode: 'full-docs',
    runState: {
      runId: 'wiki-qa-auth-failure-2026-07-14',
      projectId: project.id,
      engine: 'codex',
      state: 'FAILED',
      history: [
        { state: 'CREATED', at: '2026-07-14T12:20:00.000Z' },
        { state: 'FAILED', at: '2026-07-14T12:25:00.000Z' },
      ],
      artifacts: {},
      error: `HTTP 401 Unauthorized — access token expired. 자세한 로그: ${longLogPath}`,
    },
    artifacts: [],
  }
}

export function isFixtureScenarioName(value: string | null): value is FixtureScenarioName {
  return value !== null && Object.prototype.hasOwnProperty.call(rawScenarios, value)
}

export function buildFixtureModel(name: FixtureScenarioName): FixtureModel {
  const config = rawScenarios[name]
  const projects = Array.from({ length: config.projectCount }, (_, index) => projectAt(index, config))
  const dashboards = Object.fromEntries(projects.map((project) => [project.id, dashboardFor(project, config)]))
  const liveUxProject = name === 'live-ux-contracts' ? projects[0] : undefined
  const liveRuns = liveUxProject ? liveWikiRuns(liveUxProject) : { bundles: [], progress: [] }
  const longLogPath = projects[0]
    ? `${projects[0].repoPaths[0]}\\.apc\\runs\\wiki-qa-auth-failure-2026-07-14\\engine\\codex\\stderr-with-a-very-long-filename.log`
    : ''
  return {
    name,
    config,
    projects,
    selectedProjectId: projects[0]?.id ?? null,
    dashboards,
    overview: buildOverview(projects, dashboards),
    notes: Object.fromEntries(projects.map((project) => [
      project.id,
      name === 'live-ux-contracts' ? notesFor(project) : [],
    ])),
    activities: liveUxProject ? activitiesFor(liveUxProject) : [],
    harnessRuns: liveRuns.bundles,
    wikiProgressRuns: liveRuns.progress,
    previewFiles: liveUxProject ? previewFiles() : [],
    rejectedPreviewPaths: liveUxProject
      ? { '../outside/secrets.py': '프로젝트 경계를 벗어난 경로입니다.' }
      : {},
    documents: buildDocuments(config.documentCount),
    changes: buildChanges(config.changeCount),
    wiki: buildWiki(config.graphNodeCount, config.graphEdgeCount),
    failedRun: config.seedFailedRun && projects[0] ? failedRun(projects[0], longLogPath) : null,
    longLogPath,
  }
}
