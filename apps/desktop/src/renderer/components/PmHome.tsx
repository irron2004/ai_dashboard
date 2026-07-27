import { useRef, useState } from 'react'
import type { AgentRun, Task } from '@apc/shared'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { api } from '../api.js'
import { nextUp } from '@apc/dashboard-api'
import { TimelineStrip } from './TimelineStrip.js'
import { TaskBoard } from './TaskBoard.js'
import { DevHarnessPanel, type DevHarnessPanelRequest } from './DevHarnessPanel.js'
import { TaskEditorDialog } from './TaskEditorDialog.js'

type Props = { dashboard: ProjectDashboardRes; onChanged?: () => void }

const RUN_STATUS_LABEL: Record<AgentRun['status'], string> = {
  running: '실행 중',
  completed: '성공',
  failed: '실패',
}

const AGENT_LABEL: Record<AgentRun['agent'], string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  harness: 'Harness',
}

function runTime(iso: string, now = Date.now()): { label: string; local: string } {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return { label: iso, local: iso }
  const local = date.toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  const elapsed = now - date.getTime()
  if (elapsed < 0) return { label: local, local }
  if (elapsed < 60_000) return { label: '방금 전', local }
  if (elapsed < 3_600_000) return { label: `${Math.floor(elapsed / 60_000)}분 전`, local }
  if (elapsed < 86_400_000) return { label: `${Math.floor(elapsed / 3_600_000)}시간 전`, local }
  if (elapsed < 604_800_000) return { label: `${Math.floor(elapsed / 86_400_000)}일 전`, local }
  return { label: local, local }
}

function proposalDiff(canonical: Task[], proposed: Task[]) {
  const current = new Map(canonical.map((task) => [task.id, task]))
  const incoming = new Map(proposed.map((task) => [task.id, task]))
  const signature = (task: Task) => JSON.stringify({
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    blockedBy: task.blockedBy,
    acceptanceCriteria: task.acceptanceCriteria,
    source: task.source,
    contextPackage: task.contextPackage,
  })
  const added = proposed.filter((task) => !current.has(task.id))
  const changed = proposed.filter((task) => {
    const before = current.get(task.id)
    return before && signature(before) !== signature(task)
  })
  const removed = canonical.filter((task) => !incoming.has(task.id))
  return { added, changed, removed }
}

export function PmHome({ dashboard, onChanged }: Props) {
  const { project, reviewQueue, recentRuns, allTasks } = dashboard
  const [depOverrides, setDepOverrides] = useState<Record<string, string[]>>({})
  const [panelRequest, setPanelRequest] = useState<DevHarnessPanelRequest | null>(null)
  const [taskEditor, setTaskEditor] = useState<Task | 'new' | null>(null)
  const [proposalBusy, setProposalBusy] = useState<'approve' | 'discard' | null>(null)
  const [proposalMessage, setProposalMessage] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const nextActions = dashboard.nextActions
  const fileManaged = nextActions?.mode === 'managed'
  const proposal = fileManaged ? nextActions.proposal : undefined
  const proposalChanges = proposal ? proposalDiff(allTasks, proposal.tasks) : undefined
  const tasks: Task[] = allTasks.map((t) => (depOverrides[t.id] ? { ...t, blockedBy: depOverrides[t.id] } : t))
  const handleSetBlockedBy = async (taskId: string, blockedBy: string[]) => {
    const prevOverride = depOverrides[taskId]
    setDepOverrides((prev) => ({ ...prev, [taskId]: blockedBy }))
    const revert = () =>
      setDepOverrides((prev) => {
        const next = { ...prev }
        if (prevOverride !== undefined) next[taskId] = prevOverride
        else delete next[taskId]
        return next
      })
    try {
      const res = await api.taskSetBlockedBy({ projectId: project.id, taskId, blockedBy })
      if (!res.ok) {
        console.warn('taskSetBlockedBy rejected:', res.reason)
        revert()
      } else {
        if (res.pendingApproval) revert()
        onChanged?.()
      }
    } catch (err) {
      console.warn('taskSetBlockedBy failed:', err)
      revert()
    }
  }
  const upNext = nextUp(tasks)
  const taskById = new Map(allTasks.map((task) => [task.id, task]))
  const doneCount = allTasks.filter((task) => task.status === 'done').length
  const completion = allTasks.length === 0 ? 0 : Math.round((doneCount / allTasks.length) * 100)
  const requestTaskAction = (action: 'compose' | 'run', taskId: string) => {
    setPanelRequest({ requestId: ++requestSequence.current, projectId: project.id, action, taskId })
  }
  const requestTranscript = (run: AgentRun, title: string) => {
    setPanelRequest({ requestId: ++requestSequence.current, projectId: project.id, action: 'open-transcript', runId: run.id, title })
  }
  const decideProposal = async (decision: 'approve' | 'discard') => {
    if (!proposal) return
    setProposalBusy(decision)
    setProposalMessage(null)
    try {
      const req = { projectId: project.id, proposalHash: proposal.proposalHash }
      const result = decision === 'approve'
        ? await api.nextActionsApprove(req)
        : await api.nextActionsDiscard(req)
      if (!result.ok) {
        setProposalMessage(
          result.reason === 'proposal-conflict'
            ? 'next.yml이 외부에서 변경되었습니다. 최신 파일과 제안을 직접 병합해 주세요.'
            : `제안을 처리하지 못했습니다: ${result.reason ?? 'unknown'}`,
        )
        return
      }
      onChanged?.()
    } catch {
      setProposalMessage('제안을 처리하지 못했습니다. 연결을 확인해 주세요.')
    } finally {
      setProposalBusy(null)
    }
  }

  return (
    <div className="pm-home">
      <section className="pm-home__header">
        <div className="pm-home__goal">
          <h2>프로젝트 목표</h2>
          <p>{project.goal ?? '(목표 없음)'}</p>
        </div>
        {project.currentFocus && (
          <div className="pm-home__focus">
            <h2>현재 집중</h2>
            <p>{project.currentFocus}</p>
          </div>
        )}
        <div className="pm-home__progress-summary">
          <div
            className="pm-home__progress"
            role="progressbar"
            aria-label="작업 완료율"
            aria-valuemin={0}
            aria-valuemax={Math.max(allTasks.length, 1)}
            aria-valuenow={doneCount}
            aria-valuetext={`${doneCount}/${allTasks.length}개 완료`}
          >
            <span style={{ width: `${completion}%` }} />
          </div>
          <span>{doneCount}/{allTasks.length}</span>
          {reviewQueue.length > 0 && <span className="pm-home__review-badge">리뷰 {reviewQueue.length}</span>}
        </div>
        {(project.startDate || project.targetDate) && (
          <div className="pm-home__dates">
            <span>{project.startDate ?? '…'}</span>
            <span> → </span>
            <span>{project.targetDate ?? '…'}</span>
          </div>
        )}
      </section>

      {nextActions?.mode === 'error' && (
        <section className="pm-home__next-source pm-home__next-source--error" role="alert">
          <h2>next.yml을 읽을 수 없음</h2>
          <p>{nextActions.reason}</p>
          <p>SQLite 캐시로 대체하지 않았습니다. 파일을 수정한 뒤 새로고침해 주세요.</p>
        </section>
      )}

      {fileManaged && (
        <section className="pm-home__next-source" data-testid="next-yml-source">
          <div className="pm-home__section-heading">
            <h2>next.yml 단일소스</h2>
            <span title={nextActions.filePath}>
              {nextActions.projectStatus} · 갱신 {nextActions.canonicalUpdated}
            </span>
          </div>
          {nextActions.focus && <p><strong>파일 focus:</strong> {nextActions.focus}</p>}
          {nextActions.error && (
            <p className="pm-home__proposal-error" role="alert">
              제안 파일을 읽을 수 없습니다: {nextActions.error}
            </p>
          )}
          {proposal && proposalChanges && (
            <div className="pm-home__proposal" data-testid="next-yml-proposal">
              <div>
                <strong>승인 대기 제안</strong>
                <span>
                  추가 {proposalChanges.added.length} · 변경 {proposalChanges.changed.length}
                  {' · '}삭제 {proposalChanges.removed.length}
                </span>
              </div>
              {proposal.conflict && (
                <p className="pm-home__proposal-error" role="alert">
                  canonical 파일이 제안 이후 변경되었습니다. 최신 파일을 우선하며 자동 승인하지 않습니다.
                </p>
              )}
              <ul>
                {proposalChanges.added.map((task) => <li key={`add:${task.id}`}>추가 · {task.title}</li>)}
                {proposalChanges.changed.map((task) => <li key={`change:${task.id}`}>변경 · {task.title}</li>)}
                {proposalChanges.removed.map((task) => <li key={`remove:${task.id}`}>삭제 · {task.title}</li>)}
              </ul>
              <div className="pm-home__proposal-actions">
                <button
                  type="button"
                  onClick={() => void decideProposal('discard')}
                  disabled={proposalBusy !== null}
                >{proposalBusy === 'discard' ? '거절 중…' : '거절'}</button>
                <button
                  type="button"
                  onClick={() => void decideProposal('approve')}
                  disabled={proposalBusy !== null || proposal.conflict}
                >{proposalBusy === 'approve' ? '승인 중…' : '승인하고 next.yml 기록'}</button>
              </div>
            </div>
          )}
          {proposalMessage && <p className="pm-home__proposal-error" role="alert">{proposalMessage}</p>}
        </section>
      )}

      {(project.startDate || project.targetDate) && (
        <section className="pm-home__timeline">
          <h2>일정</h2>
          <TimelineStrip start={project.startDate} target={project.targetDate} tasks={allTasks} />
        </section>
      )}

      <section className="pm-home__next-up" data-testid="next-up">
        <div className="pm-home__section-heading">
          <h2>다음 할 일</h2>
          <button type="button" onClick={() => setTaskEditor('new')}>새 Task</button>
        </div>
        {upNext.length === 0 ? (
          <p className="pm-home__empty">진행할 수 있는 작업 없음</p>
        ) : (
          <ol className="pm-home__next-list">
            {upNext.map((t) => (
              <li key={t.id}>
                <span className="task-title">{t.title}</span>
                <span className={`pm-board__priority pm-board__priority--${t.priority}`}>{t.priority}</span>
                {t.dueDate && <span className="pm-board__due">{t.dueDate}</span>}
                <span className="pm-home__next-actions">
                  <button type="button" aria-label={`${t.title} 편집`} onClick={() => setTaskEditor(t)}>편집</button>
                  <button type="button" aria-label={`${t.title} 컨텍스트 조립`} onClick={() => requestTaskAction('compose', t.id)}>📋 조립</button>
                  <button type="button" aria-label={`${t.title} Harness 실행`} onClick={() => requestTaskAction('run', t.id)}>▶ Run</button>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="pm-home__board">
        <h2>태스크 보드</h2>
        <TaskBoard
          tasks={tasks}
          onSetBlockedBy={handleSetBlockedBy}
          onComposeTask={(taskId) => requestTaskAction('compose', taskId)}
          onRunTask={(taskId) => requestTaskAction('run', taskId)}
          onOpenTask={(task) => setTaskEditor(task)}
          onChanged={() => onChanged?.()}
          singleBlocker={fileManaged}
        />
      </section>

      <section className="pm-home__harness">
        <h2>실행 도구</h2>
        <DevHarnessPanel key={project.id} projectId={project.id} tasks={allTasks} request={panelRequest} />
      </section>

      <section className="pm-home__review-queue">
        <h2>리뷰 대기</h2>
        {reviewQueue.length === 0 ? (
          <p className="pm-home__empty">리뷰 대기 없음</p>
        ) : (
          <ul>
            {reviewQueue.map((t) => (
              <li key={t.id}>
                <span className="task-title">{t.title}</span>
                <span className="review-status"> [{t.reviewStatus}]</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="pm-home__recent-runs">
        <h2>최근 실행</h2>
        {recentRuns.length === 0 ? (
          <p className="pm-home__empty">최근 실행 없음</p>
        ) : (
          <ul>
            {recentRuns.map((r) => {
              const title = taskById.get(r.taskId)?.title ?? '알 수 없는 작업'
              const time = runTime(r.startedAt)
              const transcriptAvailable = r.agent === 'harness' && Boolean(r.transcriptPath)
              return (
                <li key={r.id} className="pm-home__run-item">
                  <span className="pm-home__run-task">{title}</span>
                  <span className="pm-home__run-agent">{AGENT_LABEL[r.agent]}</span>
                  <time dateTime={r.startedAt} title={time.local}>{time.label}</time>
                  <span className={`run-status pm-home__run-status--${r.status}`}>{RUN_STATUS_LABEL[r.status]}</span>
                  <button
                    type="button"
                    className="pm-home__transcript-btn"
                    aria-label={`${title} 실행 transcript 열기`}
                    disabled={!transcriptAvailable}
                    title={transcriptAvailable ? 'transcript 열기' : '이 실행에는 transcript가 없습니다'}
                    onClick={() => requestTranscript(r, title)}
                  >transcript</button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {taskEditor && (
        <TaskEditorDialog
          projectId={project.id}
          task={taskEditor === 'new' ? undefined : taskEditor}
          fileManaged={fileManaged}
          onClose={() => setTaskEditor(null)}
          onChanged={() => onChanged?.()}
        />
      )}
    </div>
  )
}
