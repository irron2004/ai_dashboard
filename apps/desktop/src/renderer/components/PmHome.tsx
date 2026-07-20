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

export function PmHome({ dashboard, onChanged }: Props) {
  const { project, reviewQueue, recentRuns, allTasks } = dashboard
  const [depOverrides, setDepOverrides] = useState<Record<string, string[]>>({})
  const [panelRequest, setPanelRequest] = useState<DevHarnessPanelRequest | null>(null)
  const [taskEditor, setTaskEditor] = useState<Task | 'new' | null>(null)
  const requestSequence = useRef(0)
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
      const res = await api.taskSetBlockedBy({ taskId, blockedBy })
      if (!res.ok) {
        console.warn('taskSetBlockedBy rejected:', res.reason)
        revert()
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
          onClose={() => setTaskEditor(null)}
          onChanged={() => onChanged?.()}
        />
      )}
    </div>
  )
}
