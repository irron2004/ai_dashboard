import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentType } from '@apc/shared'
import type {
  ConversationHistoryReq,
  ConversationHistoryRes,
  ConversationSession,
} from '../../shared/ipc-contract.js'
import { MarkdownContent } from './MarkdownContent.js'

const HISTORY_AGENTS: AgentType[] = ['codex', 'claude', 'opencode']
const AGENT_LABEL: Record<AgentType, string> = {
  codex: 'Codex',
  claude: 'Claude',
  opencode: 'OpenCode',
}

/** 외부(ResumeBanner, 향후 검색 히트)에서 히스토리 탭을 특정 지점으로 여는 포커스.
 * sessionId/exchangeId는 향후 검색이 "히트 → 해당 질문으로 점프"에 사용한다. */
export type HistoryFocus = {
  agent: AgentType
  sessionId?: string
  exchangeId?: string
}

type Props = {
  projectId: string | null
  focus: HistoryFocus | null
  onFocusConsumed: () => void
  fetchHistory: (req: ConversationHistoryReq) => Promise<ConversationHistoryRes>
}

function dateTime(iso: string | undefined): string {
  if (!iso) return '시간 정보 없음'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString([], {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function timeOnly(iso: string | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sortTime(value: string | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function newestFirst(result: ConversationHistoryRes): ConversationHistoryRes {
  return {
    ...result,
    sessions: result.sessions
      .map((session) => ({
        ...session,
        exchanges: [...session.exchanges].sort((left, right) => sortTime(right.askedAt) - sortTime(left.askedAt)),
      }))
      .sort((left, right) =>
        sortTime(right.endedAt ?? right.startedAt) - sortTime(left.endedAt ?? left.startedAt)),
  }
}

export function ConversationHistoryView({ projectId, focus, onFocusConsumed, fetchHistory }: Props) {
  const [agent, setAgent] = useState<AgentType>('codex')
  const [result, setResult] = useState<ConversationHistoryRes | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [olderScope, setOlderScope] = useState<string | null>(null)
  // focus prop은 수신 즉시 소거하되 payload는 다음 fetch가 끝날 때까지 보관한다.
  // App이 상태를 바로 비워도 세션 선택·펼침이 유실되지 않는다.
  const pendingFocus = useRef<HistoryFocus | null>(null)

  useEffect(() => {
    if (!focus) return
    pendingFocus.current = focus
    setAgent(focus.agent)
    setOlderScope(focus.sessionId && projectId ? `${projectId}:${focus.agent}` : null)
    setRetry((value) => value + 1)
    onFocusConsumed()
  }, [focus, onFocusConsumed, projectId])

  const scopeKey = projectId ? `${projectId}:${agent}` : null
  const includeOlder = scopeKey !== null && olderScope === scopeKey

  useEffect(() => {
    if (!projectId) return
    let alive = true
    setLoading(true)
    setError(null)
    setResult(null)
    setSelectedSessionId(null)
    setExpanded(new Set())

    void fetchHistory({ projectId, agent, ...(includeOlder ? { includeOlder: true } : {}) })
      .then((next) => {
        if (!alive) return
        const sorted = newestFirst(next)
        setResult(sorted)
        const pending = pendingFocus.current
        pendingFocus.current = null
        const focused = pending?.sessionId
          ? sorted.sessions.find((session) => session.id === pending.sessionId)
          : undefined
        setSelectedSessionId(focused?.id ?? sorted.sessions[0]?.id ?? null)
        if (focused && pending?.exchangeId && focused.exchanges.some((exchange) => exchange.id === pending.exchangeId)) {
          const key = `${focused.id}:${pending.exchangeId}`
          setExpanded(new Set([key]))
          requestAnimationFrame(() => {
            document.getElementById(`conversation-exchange-${key}`)?.scrollIntoView?.({ block: 'center' })
          })
        }
      })
      .catch((reason: unknown) => {
        if (alive) setError(errorMessage(reason))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [projectId, agent, fetchHistory, retry, includeOlder])

  const selectedSession = useMemo<ConversationSession | null>(() => {
    return result?.sessions.find((session) => session.id === selectedSessionId) ?? result?.sessions[0] ?? null
  }, [result, selectedSessionId])

  const toggleAnswer = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="conversation-history" aria-label="대화 히스토리">
      <div className="question-history__toolbar">
        <div className="question-history__agents" role="tablist" aria-label="대화 에이전트">
          {HISTORY_AGENTS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={agent === item}
              className={agent === item ? 'question-history__agent-tab question-history__agent-tab--active' : 'question-history__agent-tab'}
              onClick={() => setAgent(item)}
            >
              {AGENT_LABEL[item]}
            </button>
          ))}
        </div>
        {projectId && result && !includeOlder && !loading && (
          <button
            type="button"
            className="question-history__load-more"
            onClick={() => { if (scopeKey) setOlderScope(scopeKey) }}
          >
            3일 이전 대화 더 불러오기
          </button>
        )}
      </div>

      {!projectId ? (
        <div className="question-history__state">프로젝트를 먼저 선택해 주세요.</div>
      ) : loading ? (
        <div className="question-history__state" role="status">{AGENT_LABEL[agent]} 대화를 불러오는 중…</div>
      ) : error ? (
        <div className="question-history__state question-history__state--error" role="alert">
          <strong>대화를 불러오지 못했습니다.</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button>
        </div>
      ) : !result?.sessions.length ? (
        <div className="question-history__state">
          <strong>
            {includeOlder
              ? `${AGENT_LABEL[agent]}에서 이 프로젝트의 대화를 찾지 못했습니다.`
              : `${AGENT_LABEL[agent]}에서 최근 3일 대화를 찾지 못했습니다.`}
          </strong>
          <span>{includeOlder ? '선택한 프로젝트 경로에서 진행한 세션인지 확인해 주세요.' : '과거 세션은 위의 더 불러오기로 확인할 수 있습니다.'}</span>
        </div>
      ) : (
        <div className="question-history__content">
          <aside className="question-history__sessions" aria-label={`${AGENT_LABEL[agent]} 세션 목록`}>
            <div className="question-history__section-title">
              <span>세션</span><span>{result.sessions.length}</span>
            </div>
            <ol>
              {result.sessions.map((session) => {
                const active = selectedSession?.id === session.id
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      className={active ? 'question-history__session question-history__session--active' : 'question-history__session'}
                      aria-pressed={active}
                      title={session.preview}
                      onClick={() => { setSelectedSessionId(session.id); setExpanded(new Set()) }}
                    >
                      <span className="question-history__session-date">{dateTime(session.endedAt ?? session.startedAt)}</span>
                      <span className="question-history__session-preview">{session.preview}</span>
                      <span className="question-history__session-count">질문 {session.exchanges.length}개{session.branch ? ` · ${session.branch}` : ''}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </aside>

          <section className="question-history__questions" aria-label="질문과 답변">
            {selectedSession && (
              <>
                <header className="question-history__questions-header">
                  <div>
                    <strong>{dateTime(selectedSession.endedAt ?? selectedSession.startedAt)}</strong>
                    <span>{AGENT_LABEL[selectedSession.agent]} · 질문 {selectedSession.exchanges.length}개</span>
                  </div>
                </header>
                {selectedSession.exchanges.length === 0 ? (
                  <div className="question-history__no-questions">이 세션에는 표시할 사용자 질문이 없습니다.</div>
                ) : (
                  <ol>
                    {selectedSession.exchanges.map((exchange, index) => {
                      const key = `${selectedSession.id}:${exchange.id}`
                      const isExpanded = expanded.has(key)
                      const answerId = `conversation-answer-${index}`
                      const askedAt = timeOnly(exchange.askedAt)
                      return (
                        <li
                          key={key}
                          id={`conversation-exchange-${key}`}
                          className={isExpanded ? 'question-history__exchange question-history__exchange--open' : 'question-history__exchange'}
                        >
                          <button
                            type="button"
                            className="question-history__question"
                            aria-expanded={isExpanded}
                            aria-controls={answerId}
                            onClick={() => toggleAnswer(key)}
                          >
                            <span className="question-history__qmark">Q{index + 1}</span>
                            <span className="question-history__question-text">{exchange.question}</span>
                            {askedAt && <span className="question-history__question-time">{askedAt}</span>}
                            <span className="question-history__chevron" aria-hidden="true">⌄</span>
                          </button>
                          {isExpanded && (
                            <div id={answerId} className="question-history__answer" role="region" aria-label={`Q${index + 1} 답변`}>
                              <span className="question-history__amark">A</span>
                              <div className="question-history__answer-body">
                                {exchange.answer
                                  ? <MarkdownContent markdown={exchange.answer} onOpenWikiLink={() => { /* history is read-only */ }} />
                                  : <p className="question-history__no-answer">기록된 답변이 없습니다.</p>}
                              </div>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {result && result.skippedSources > 0 && (
        <p className="question-history__notice">
          읽지 못한 세션 소스 {result.skippedSources}개가 있습니다.
        </p>
      )}
    </div>
  )
}
