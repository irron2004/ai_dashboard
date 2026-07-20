import { useEffect, useRef, useState } from 'react'
import type { WikiNodeProgress, WikiWorkerSummary } from '@apc/shared'
import {
  deriveWikiProgressView,
  formatWikiDuration,
  type WikiProgressState,
} from '../wiki-progress-state.js'
import './wiki-progress.css'

type LogResult = {
  ok: boolean
  content?: string
  reason?: string
}

type Props = {
  progress: WikiProgressState | null
  /** One-release compatibility fallback until every producer emits the durable activity stream. */
  legacyState?: string | null
  liveLabel?: string | null
  liveTail?: string[]
  onReadLog?: (runId: string) => Promise<LogResult>
  onResume?: (runId: string) => void
  now?: () => number
}

const systemNow = () => Date.now()

const WORKER_STATUS: Record<WikiWorkerSummary['status'], string> = {
  queued: '대기',
  running: '진행 중',
  completed: '완료',
  failed: '실패',
  retrying: '재시도',
}

const NODE_STATUS: Record<WikiNodeProgress['status'], string> = {
  discovered: '발견',
  accepted: '완료',
  dropped: '제외',
}

function legacyStatus(state: string | null | undefined): string {
  if (state === 'FAILED') return '실패'
  if (state === 'HUMAN_REVIEW_REQUIRED' || state === 'MERGED') return '완료'
  return '생성 중'
}

export function WikiProgress({
  progress,
  legacyState = null,
  liveLabel = null,
  liveTail = [],
  onReadLog,
  onResume,
  now = systemNow,
}: Props) {
  const [clock, setClock] = useState(() => now())
  const [showLog, setShowLog] = useState(false)
  const [logContent, setLogContent] = useState<string | null>(null)
  const [logError, setLogError] = useState<string | null>(null)
  const [logLoading, setLogLoading] = useState(false)
  const logRequest = useRef(0)
  const view = deriveWikiProgressView(progress, clock)
  const runId = progress?.runId ?? null

  useEffect(() => {
    setClock(now())
    const timer = window.setInterval(() => setClock(now()), 1_000)
    return () => window.clearInterval(timer)
  }, [now])

  useEffect(() => {
    logRequest.current += 1
    setShowLog(false)
    setLogContent(null)
    setLogError(null)
    setLogLoading(false)
  }, [runId])

  useEffect(() => () => { logRequest.current += 1 }, [])

  const toggleLog = () => {
    const next = !showLog
    setShowLog(next)
    if (!next || logContent !== null || logLoading || !runId || !onReadLog) return
    const request = ++logRequest.current
    setLogLoading(true)
    setLogError(null)
    void onReadLog(runId).then((result) => {
      if (request !== logRequest.current) return
      if (result.ok) setLogContent(result.content ?? '')
      else setLogError(result.reason ?? '상세 로그를 불러오지 못했습니다.')
    }).catch((error) => {
      if (request === logRequest.current) setLogError(String(error))
    }).finally(() => {
      if (request === logRequest.current) setLogLoading(false)
    })
  }

  if (!view) {
    const status = legacyStatus(legacyState)
    const failed = status === '실패'
    return (
      <section className={`wiki-progress${failed ? ' wiki-progress--failed' : ''}`} aria-label="위키 생성 진행">
        <header className="wiki-progress__head">
          <div className="wiki-progress__title">
            {!failed && <span className="wiki-progress__spinner" aria-hidden />}
            <span>{status}</span>
          </div>
          <span className="wiki-progress__badge">진행 기록 연결 중</span>
        </header>
        <p className="wiki-progress__empty">저장된 진행 기록을 불러오는 중입니다.</p>
        <button type="button" className="wiki-progress__toggle" onClick={toggleLog} aria-expanded={showLog}>
          상세 로그 {showLog ? '접기 ▴' : '보기 ▾'}
        </button>
        {showLog && (
          <pre className="wiki-progress__log">
            {liveTail.length ? `${liveLabel ? `[${liveLabel}]\n` : ''}${liveTail.join('\n')}` : '(아직 엔진 로그가 없습니다)'}
          </pre>
        )}
      </section>
    )
  }

  const { summary } = view
  const terminal = summary.status === 'completed' || summary.status === 'failed'
  const statusClass = `wiki-progress--${summary.status}`
  const logText = logContent ?? (liveTail.length
    ? `${liveLabel ? `[${liveLabel}]\n` : ''}${liveTail.join('\n')}`
    : '')

  return (
    <section className={`wiki-progress ${statusClass}`} aria-label="위키 생성 진행">
      <header className="wiki-progress__head">
        <div className="wiki-progress__title">
          {!terminal && <span className="wiki-progress__spinner" aria-hidden />}
          <span>{view.statusLabel}</span>
          {summary.phase && <span className="wiki-progress__phase">{summary.phase.replace(/_/g, ' ')}</span>}
        </div>
        <span className={`wiki-progress__badge wiki-progress__badge--${view.health}`}>{view.statusLabel}</span>
      </header>

      <div className="wiki-progress__timing">
        <span>경과 {formatWikiDuration(view.elapsedMs)}</span>
        <span>마지막 활동 {formatWikiDuration(view.lastActivityAgoMs)} 전</span>
      </div>

      {view.warning && (
        <div className={`wiki-progress__warning wiki-progress__warning--${view.health}`} role="status">
          <strong>{view.warning}</strong>
          <span>{view.health === 'interrupted' ? '활성 작업이 없어 이어하기가 필요합니다.' : '작업은 자동 실패 처리되지 않습니다.'}</span>
          {view.health === 'interrupted' && onResume && (
            <button type="button" onClick={() => onResume(summary.runId)}>↻ 이어하기</button>
          )}
        </div>
      )}

      <dl className="wiki-progress__counts" aria-label="작업 집계">
        <div><dt>전체 작업</dt><dd>{summary.work.total}</dd></div>
        <div><dt>완료</dt><dd>{summary.work.completed}</dd></div>
        <div><dt>진행 중</dt><dd>{summary.work.inProgress}</dd></div>
        <div><dt>실패</dt><dd>{summary.work.failed}</dd></div>
        <div><dt>재시도</dt><dd>{summary.work.retries}</dd></div>
      </dl>

      <section className="wiki-progress__group" aria-label="워커 진행">
        <div className="wiki-progress__group-head">
          <h3>폴더·워커</h3>
          <span>{summary.work.completed + summary.work.failed} / {summary.work.total}</span>
        </div>
        {summary.workers.length ? (
          <ul className="wiki-progress__workers">
            {summary.workers.map((worker) => (
              <li key={worker.workerId}>
                <span className={`wiki-progress__state-dot wiki-progress__state-dot--${worker.status}`} aria-hidden />
                <strong>{worker.folder ?? worker.workerId}</strong>
                <span>{WORKER_STATUS[worker.status]} · 시도 {worker.attempt}</span>
                {worker.message && <small>{worker.message}</small>}
              </li>
            ))}
          </ul>
        ) : <p className="wiki-progress__empty">아직 시작된 워커가 없습니다.</p>}
      </section>

      <section className="wiki-progress__group" aria-label="노드 생성 진행">
        <div className="wiki-progress__group-head">
          <h3>생성 노드</h3>
          <span>{summary.nodes.length}</span>
        </div>
        {summary.nodes.length ? (
          <ul className="wiki-progress__nodes">
            {summary.nodes.map((node) => (
              <li key={`${node.workerId}:${node.proposalId}`} className={`wiki-progress__node wiki-progress__node--${node.status}`}>
                <div>
                  <strong>{node.title}</strong>
                  <span>{node.nodeType}</span>
                </div>
                <small>{node.sourceFolder ?? node.workerId}</small>
                <span>{NODE_STATUS[node.status]}</span>
              </li>
            ))}
          </ul>
        ) : <p className="wiki-progress__empty">발견된 노드가 아직 없습니다.</p>}
      </section>

      <button type="button" className="wiki-progress__toggle" onClick={toggleLog} aria-expanded={showLog}>
        상세 로그 {showLog ? '접기 ▴' : '보기 ▾'}
      </button>
      {showLog && (
        <div className="wiki-progress__log-wrap">
          {logLoading ? <p>로그 불러오는 중…</p> : logError ? <p role="alert">{logError}</p> : (
            <pre className="wiki-progress__log">{logText || '(아직 엔진 로그가 없습니다)'}</pre>
          )}
        </div>
      )}
    </section>
  )
}
