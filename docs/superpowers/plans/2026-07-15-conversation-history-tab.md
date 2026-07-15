# 대화 히스토리 탭 승격 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `QuestionHistory` 모달을 삭제하고 프로젝트 주 화면 탭 `💬 히스토리`(`MainTab: 'history'`)로 승격한다. 향후 검색이 꽂힐 `HistoryFocus` 주입 이음새를 함께 만든다.

**Architecture:** 모달 내용을 `ConversationHistoryView`로 추출하고, `MainPanel`에 탭을 추가하며, `App.tsx`의 모달 상태를 `historyFocus` 상태로 교체한다. main 프로세스·IPC(`q:conversationHistory`)·Q/A 추출 로직은 변경하지 않는다.

**Tech Stack:** React 18 + zustand(미사용 유지), vitest + @testing-library/react (jsdom), Playwright fixture QA.

**Spec:** `docs/superpowers/specs/2026-07-15-conversation-history-tab-design.md`

## Global Constraints

- IPC 계약(`ConversationHistoryReq/Res`), `conversation-history.ts`, ingest, `packages/search`는 **수정 금지**.
- 타입 검사는 `pnpm typecheck`가 권위. IDE 진단의 `@xterm/…`, `node:sqlite` 오류는 오경보.
- 단일 테스트는 repo root에서 `npx vitest run <파일경로>`로 실행.
- 커밋은 Conventional Commits, scope는 `desktop`.
- UI 문구는 기존 한국어 톤 유지 (기존 모달 문구 재사용).

---

### Task 1: `ConversationHistoryView` 추출 + focus 주입

**Files:**
- Create: `apps/desktop/src/renderer/components/ConversationHistoryView.tsx`
- Create: `apps/desktop/src/renderer/components/ConversationHistoryView.test.tsx`
- (이 Task에서는 `QuestionHistory.tsx`를 아직 지우지 않는다 — Task 3에서 삭제)

**Interfaces:**
- Consumes: `ConversationHistoryReq/Res`, `ConversationSession` (`apps/desktop/src/shared/ipc-contract.ts`), `MarkdownContent` (`./MarkdownContent.js`), `AgentType` (`@apc/shared`)
- Produces (Task 2·3이 사용):
  ```ts
  export type HistoryFocus = { agent: AgentType; sessionId?: string; exchangeId?: string }
  export function ConversationHistoryView(props: {
    projectId: string | null
    focus: HistoryFocus | null
    onFocusConsumed: () => void
    fetchHistory: (req: ConversationHistoryReq) => Promise<ConversationHistoryRes>
  }): JSX.Element
  ```

**동작 계약 (기존 모달과의 차이):**
- `open`/`onClose`/`initialAgent` prop 없음. 오버레이·dialog·닫기 버튼·헤더 h2 없음.
- 루트는 `<div className="conversation-history" aria-label="대화 히스토리">`.
- 아코디언 확장 키는 `${sessionId}:${exchangeId}` (기존은 `:${index}` 접미사 포함 — focus로 exchangeId를 지정할 수 있도록 단순화).
- focus 주입: prop 수신 즉시 agent 전환 + 강제 refetch + `onFocusConsumed()` 호출. payload는 ref에 보관했다가 fetch 완료 시 세션 선택·아코디언 펼침·스크롤에 사용. 목록에 없는 `sessionId`는 무시(첫 세션 선택).

- [x] **Step 1: 실패하는 테스트 작성**

`apps/desktop/src/renderer/components/ConversationHistoryView.test.tsx` 생성. 기존 `QuestionHistory.test.tsx`의 4개 테스트를 새 props로 이전하고 focus 테스트 2개를 추가한다:

```tsx
import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AgentType } from '@apc/shared'
import type { ConversationHistoryRes } from '../../shared/ipc-contract.js'
import { ConversationHistoryView } from './ConversationHistoryView.js'

function history(agent: AgentType): ConversationHistoryRes {
  const isCodex = agent === 'codex'
  return {
    projectId: 'p1',
    agent,
    scannedSources: 2,
    skippedSources: 0,
    truncated: false,
    sessions: isCodex ? [
      {
        id: 'codex-new', agent, startedAt: '2026-07-15T10:00:00Z', endedAt: '2026-07-15T10:20:00Z',
        branch: 'feat/history', preview: '로그인 오류를 고쳐 줘',
        exchanges: [
          { id: 'q1', askedAt: '2026-07-15T10:01:00Z', question: '로그인 오류를 고쳐 줘', answer: '원인을 확인하고 **수정했습니다.**' },
          { id: 'q2', askedAt: '2026-07-15T10:10:00Z', question: '테스트도 통과해?', answer: null },
        ],
      },
      {
        id: 'codex-old', agent, startedAt: '2026-07-14T08:00:00Z', endedAt: '2026-07-14T08:10:00Z',
        preview: '이전 질문', exchanges: [{ id: 'q1', question: '이전 질문', answer: '이전 답변' }],
      },
    ] : [
      {
        id: `${agent}-one`, agent, startedAt: '2026-07-13T08:00:00Z', endedAt: '2026-07-13T08:10:00Z',
        preview: `${agent} 질문`, exchanges: [{ id: 'q1', question: `${agent} 질문`, answer: `${agent} 답변` }],
      },
    ],
  }
}

function renderView(over: Partial<Parameters<typeof ConversationHistoryView>[0]> = {}) {
  const props = {
    projectId: 'p1' as string | null,
    focus: null,
    onFocusConsumed: vi.fn(),
    fetchHistory: vi.fn(async ({ agent }: { agent: AgentType }) => history(agent)),
    ...over,
  }
  return { ...render(<ConversationHistoryView {...props} />), props }
}

describe('ConversationHistoryView', () => {
  test('선택한 에이전트의 세션을 보이고 질문을 펼치면 답변을 렌더한다', async () => {
    const { props } = renderView()

    await waitFor(() => expect(screen.getByText('질문 2개 · feat/history')).toBeTruthy())
    expect(props.fetchHistory).toHaveBeenCalledWith({ projectId: 'p1', agent: 'codex', limit: 40 })
    expect(screen.queryByText(/원인을 확인하고/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Q1 로그인 오류를 고쳐 줘/ }))

    expect(screen.getByText(/원인을 확인하고/)).toBeTruthy()
    expect(screen.getByText('수정했습니다.').tagName).toBe('STRONG')
    expect(screen.getByRole('button', { name: /^Q1 로그인 오류를 고쳐 줘/ }).getAttribute('aria-expanded')).toBe('true')
  })

  test('에이전트 탭을 전환하면 해당 에이전트 세션을 불러온다', async () => {
    const { props } = renderView()
    await waitFor(() => screen.getByText('질문 2개 · feat/history'))

    fireEvent.click(screen.getByRole('tab', { name: 'Claude' }))

    await waitFor(() => expect(screen.getAllByText('claude 질문').length).toBeGreaterThan(0))
    expect(props.fetchHistory).toHaveBeenLastCalledWith({ projectId: 'p1', agent: 'claude', limit: 40 })
    expect(screen.getByRole('tab', { name: 'Claude' }).getAttribute('aria-selected')).toBe('true')
  })

  test('다른 세션을 선택하면 질문 목록이 교체된다', async () => {
    renderView()
    await waitFor(() => screen.getByText('질문 2개 · feat/history'))

    fireEvent.click(screen.getByTitle('이전 질문'))

    expect(screen.getByRole('button', { name: /^Q1 이전 질문/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Q1 로그인 오류를 고쳐 줘/ })).toBeNull()
  })

  test('에이전트별 빈 상태를 보이고 프로젝트가 없으면 fetch하지 않는다', async () => {
    const empty = { ...history('opencode'), sessions: [] }
    const fetchHistory = vi.fn(async () => empty)
    const { rerender } = renderView({
      focus: { agent: 'opencode' }, fetchHistory,
    })
    await waitFor(() => expect(screen.getByText(/OpenCode에서 이 프로젝트의 대화를 찾지 못했습니다/)).toBeTruthy())

    fetchHistory.mockClear()
    rerender(
      <ConversationHistoryView projectId={null} focus={null} onFocusConsumed={() => {}} fetchHistory={fetchHistory} />,
    )
    expect(screen.getByText(/프로젝트를 먼저 선택/)).toBeTruthy()
    expect(fetchHistory).not.toHaveBeenCalled()
  })

  test('focus 주입 시 세션을 선택하고 질문을 펼친 뒤 소거한다', async () => {
    const { props } = renderView({ focus: { agent: 'codex', sessionId: 'codex-old', exchangeId: 'q1' } })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Q1 이전 질문/ }).getAttribute('aria-expanded')).toBe('true'))
    expect(screen.getByTitle('이전 질문').className).toContain('question-history__session--active')
    expect(props.onFocusConsumed).toHaveBeenCalled()
  })

  test('focus의 sessionId가 목록에 없으면 무시하고 첫 세션을 기본 선택한다', async () => {
    renderView({ focus: { agent: 'codex', sessionId: 'no-such-session', exchangeId: 'q9' } })

    await waitFor(() => screen.getByText('질문 2개 · feat/history'))
    expect(screen.getByTitle('로그인 오류를 고쳐 줘').className).toContain('question-history__session--active')
    expect(screen.getByRole('button', { name: /^Q1 로그인 오류를 고쳐 줘/ }).getAttribute('aria-expanded')).toBe('false')
  })
})
```

- [x] **Step 2: 실패 확인**

Run: `npx vitest run apps/desktop/src/renderer/components/ConversationHistoryView.test.tsx`
Expected: FAIL — `Cannot find module './ConversationHistoryView.js'` 계열 오류.

- [x] **Step 3: 구현**

`apps/desktop/src/renderer/components/ConversationHistoryView.tsx` 생성 (기존 `QuestionHistory.tsx`에서 추출·수정):

```tsx
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

export function ConversationHistoryView({ projectId, focus, onFocusConsumed, fetchHistory }: Props) {
  const [agent, setAgent] = useState<AgentType>('codex')
  const [result, setResult] = useState<ConversationHistoryRes | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  // focus prop은 수신 즉시 소거하되 payload는 다음 fetch가 끝날 때까지 보관한다.
  // App이 상태를 바로 비워도 세션 선택·펼침이 유실되지 않는다.
  const pendingFocus = useRef<HistoryFocus | null>(null)

  useEffect(() => {
    if (!focus) return
    pendingFocus.current = focus
    setAgent(focus.agent)
    setRetry((value) => value + 1) // agent가 같아도 강제 refetch → 아래 fetch effect가 focus를 적용
    onFocusConsumed()
  }, [focus, onFocusConsumed])

  useEffect(() => {
    if (!projectId) return
    let alive = true
    setLoading(true)
    setError(null)
    setResult(null)
    setSelectedSessionId(null)
    setExpanded(new Set())

    void fetchHistory({ projectId, agent, limit: 40 })
      .then((next) => {
        if (!alive) return
        setResult(next)
        const pf = pendingFocus.current
        pendingFocus.current = null
        const focused = pf?.sessionId
          ? next.sessions.find((session) => session.id === pf.sessionId)
          : undefined
        setSelectedSessionId(focused?.id ?? next.sessions[0]?.id ?? null)
        if (focused && pf?.exchangeId && focused.exchanges.some((x) => x.id === pf.exchangeId)) {
          const key = `${focused.id}:${pf.exchangeId}`
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
  }, [projectId, agent, fetchHistory, retry])

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
          <strong>{AGENT_LABEL[agent]}에서 이 프로젝트의 대화를 찾지 못했습니다.</strong>
          <span>선택한 프로젝트 경로에서 진행한 세션인지 확인해 주세요.</span>
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
              </>
            )}
          </section>
        </div>
      )}

      {result && (result.truncated || result.skippedSources > 0) && (
        <p className="question-history__notice">
          {result.truncated ? '최근 대화만 표시합니다.' : ''}
          {result.truncated && result.skippedSources > 0 ? ' ' : ''}
          {result.skippedSources > 0 ? `읽지 못한 세션 소스 ${result.skippedSources}개가 있습니다.` : ''}
        </p>
      )}
    </div>
  )
}
```

- [x] **Step 4: 통과 확인**

Run: `npx vitest run apps/desktop/src/renderer/components/ConversationHistoryView.test.tsx`
Expected: PASS (6 tests)

- [x] **Step 5: 커밋**

```bash
git add apps/desktop/src/renderer/components/ConversationHistoryView.tsx apps/desktop/src/renderer/components/ConversationHistoryView.test.tsx
git commit -m "feat(desktop): extract ConversationHistoryView with HistoryFocus injection"
```

---

### Task 2: `MainPanel`에 `history` 탭 추가

**Files:**
- Modify: `apps/desktop/src/renderer/components/MainPanel.tsx`
- Test: `apps/desktop/src/renderer/components/MainPanel.test.tsx`

**Interfaces:**
- Consumes: Task 1의 `ConversationHistoryView`, `HistoryFocus`
- Produces (Task 3이 사용): `MainTab`에 `'history'` 추가, `MainPanel` props 확장:
  ```ts
  historyFocus?: HistoryFocus | null
  onHistoryFocusConsumed?: () => void
  fetchConversationHistory?: (req: ConversationHistoryReq) => Promise<ConversationHistoryRes>
  ```

- [x] **Step 1: 실패하는 테스트 작성**

`MainPanel.test.tsx` 수정:

(a) mock 목록에 추가 (기존 `vi.mock('./WorkspaceHome.js', …)` 아래):

```tsx
vi.mock('./ConversationHistoryView.js', () => ({
  ConversationHistoryView: () => <div>Conversation history view</div>,
}))
```

(b) `renderPanel`에 history용 prop 전달 — `<MainPanel …>` JSX에 `fetchConversationHistory={vi.fn()}` 추가.

(c) 탭 순서 검증 배열을 다음으로 교체:

```tsx
    expect(within(tablist).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '🌐 전체', '🏠 홈', '📄 문서', '📖 지식', '⚙ 위키 생성', '💬 히스토리',
    ])
```

(d) `test.each` 목록에 케이스 추가:

```tsx
    ['history', 'Conversation history view'],
```

(e) 키보드 내비게이션 테스트에서 `End` 기대값 수정:

```tsx
    fireEvent.keyDown(home, { key: 'End' })
    expect(onTab).toHaveBeenLastCalledWith('history')
```

(f) history 탭도 프로젝트 필수임을 검증하는 테스트 추가:

```tsx
  test('history 탭은 프로젝트 선택 전에는 placeholder를 보인다', () => {
    render(
      <MainPanel tab="history" onTab={() => {}} dashboard={null} projectLoadState="unselected" fetchConversationHistory={vi.fn()} />,
    )
    expect(screen.getByRole('status').textContent).toContain('프로젝트를 선택')
    expect(screen.queryByText('Conversation history view')).toBeNull()
  })
```

- [x] **Step 2: 실패 확인**

Run: `npx vitest run apps/desktop/src/renderer/components/MainPanel.test.tsx`
Expected: FAIL — 탭 순서 불일치(`'💬 히스토리'` 없음), `history`가 `MainTab` 타입에 없음.

- [x] **Step 3: 구현**

`MainPanel.tsx` 수정:

(a) import 추가:

```tsx
import { ConversationHistoryView, type HistoryFocus } from './ConversationHistoryView.js'
import type { ConversationHistoryReq, ConversationHistoryRes, ProjectDashboardRes } from '../../shared/ipc-contract.js'
```

(참고: `ProjectDashboardRes` import는 기존 라인에 이미 있음 — `ConversationHistoryReq/Res`만 추가.)

(b) 타입·상수:

```tsx
export type MainTab = 'workspace' | 'home' | 'documents' | 'knowledge' | 'wikigen' | 'history'
```

`TABS` 배열 끝에 추가:

```tsx
  { id: 'history', icon: '💬', label: '히스토리' },
```

(c) `Props`에 추가:

```tsx
  historyFocus?: HistoryFocus | null
  onHistoryFocusConsumed?: () => void
  fetchConversationHistory?: (req: ConversationHistoryReq) => Promise<ConversationHistoryRes>
```

함수 시그니처의 구조 분해에도 `historyFocus, onHistoryFocusConsumed, fetchConversationHistory` 추가.

(d) 콘텐츠 렌더 분기 추가 (`{tab === 'wikigen' && …}` 아래):

```tsx
        {tab === 'history' && dashboard && fetchConversationHistory && (
          <ConversationHistoryView
            projectId={dashboard.project.id}
            focus={historyFocus ?? null}
            onFocusConsumed={onHistoryFocusConsumed ?? (() => {})}
            fetchHistory={fetchConversationHistory}
          />
        )}
```

- [x] **Step 4: 통과 확인**

Run: `npx vitest run apps/desktop/src/renderer/components/MainPanel.test.tsx`
Expected: PASS

- [x] **Step 5: 커밋**

```bash
git add apps/desktop/src/renderer/components/MainPanel.tsx apps/desktop/src/renderer/components/MainPanel.test.tsx
git commit -m "feat(desktop): add history main tab rendering ConversationHistoryView"
```

---

### Task 3: `App.tsx` 배선 교체 + 모달 삭제 + CSS 정리

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/app.css`
- Delete: `apps/desktop/src/renderer/components/QuestionHistory.tsx`
- Delete: `apps/desktop/src/renderer/components/QuestionHistory.test.tsx`

**Interfaces:**
- Consumes: Task 2의 `MainPanel` props(`historyFocus`, `onHistoryFocusConsumed`, `fetchConversationHistory`), Task 1의 `HistoryFocus`
- Produces: ResumeBanner "질문 히스토리" 버튼 → 히스토리 탭 전환 동선

- [x] **Step 1: App.tsx 수정**

(a) import 교체 — `QuestionHistory` import 제거, `HistoryFocus` 추가:

```tsx
import type { HistoryFocus } from './components/ConversationHistoryView.js'
```

(b) `apc:mainTab` 복원 화이트리스트에 `'history'` 추가 (line ~49):

```tsx
      if (saved === 'workspace' || saved === 'home' || saved === 'documents' || saved === 'knowledge' || saved === 'wikigen' || saved === 'history') return saved
```

(c) `historyScope` 상태 제거, 교체:

```tsx
  const [historyFocus, setHistoryFocus] = useState<HistoryFocus | null>(null)
```

(d) ResumeBanner `onOpenHistory` 교체:

```tsx
          onOpenHistory={() => {
            dismissResumeBanner()
            setHistoryFocus({ agent: resumeCard.lastQuestion?.agent ?? resumeCard.resumeTarget?.agent ?? agent })
            handleMainTab('history')
          }}
```

(e) `<MainPanel …>`에 props 추가:

```tsx
          historyFocus={historyFocus}
          onHistoryFocusConsumed={() => setHistoryFocus(null)}
          fetchConversationHistory={fetchConversationHistory}
```

(f) JSX 하단의 `<QuestionHistory …/>` 블록(현재 527–533행) 제거. `fetchConversationHistory` useCallback(현재 311행)은 **유지** — MainPanel로 전달된다. 주석의 "QuestionHistory's fetch effect"는 "ConversationHistoryView's fetch effect"로 갱신.

- [x] **Step 2: 모달 파일 삭제**

```bash
git rm apps/desktop/src/renderer/components/QuestionHistory.tsx apps/desktop/src/renderer/components/QuestionHistory.test.tsx
```

- [x] **Step 3: app.css 정리**

(a) 모달 전용 껍데기 규칙 교체 — `.question-history { width: min(1040px, …) … }` 블록(419–425행)을 다음으로 교체:

```css
.conversation-history {
  display: flex; flex-direction: column; gap: 12px;
  height: 100%; min-height: 0; padding: 12px 14px; overflow: hidden;
}
```

(b) 더 이상 렌더되지 않는 규칙 삭제: `.question-history__header`, `.question-history__header h2`, `.question-history__header p`, `.question-history__close` (426–432행).

(c) 반응형 블록(521행 부근 `@media`)에서 `.question-history { width: calc(100vw - 16px); … }`와 `.question-history__header p { display: none; }` 두 줄 삭제. `__agents`/`__content`/`__sessions` 조정은 유지.

(d) 나머지 `.question-history__*` 규칙(agents, state, content, sessions, questions, exchange, answer, notice)은 클래스명 그대로 유지 — 뷰가 재사용한다.

- [x] **Step 4: 렌더러 테스트·타입 검증**

Run: `npx vitest run apps/desktop/src/renderer`
Expected: PASS (App.test.tsx, MainPanel.test.tsx, ConversationHistoryView.test.tsx, ResumeBanner.test.tsx 등 전부. `QuestionHistory.test.tsx`는 삭제됨)

Run: `pnpm typecheck`
Expected: 오류 0 — 특히 `QuestionHistory` 잔여 참조 없음 확인.

- [x] **Step 5: 커밋**

```bash
git add -A apps/desktop/src/renderer
git commit -m "feat(desktop): promote conversation history to a main tab and remove the modal"
```

---

### Task 4: e2e fixture 시나리오를 탭 기준으로 갱신

**Files:**
- Modify: `apps/desktop/e2e/fixture/renderer-fixtures.spec.ts` (conversation-history 테스트, 현재 100–116행)

**Interfaces:**
- Consumes: Task 3의 ResumeBanner → 히스토리 탭 동선, `role="tabpanel"` 컨테이너

- [x] **Step 1: 테스트 수정**

기존 dialog 기반 테스트를 다음으로 교체:

```ts
test('conversation-history: 히스토리 탭에서 에이전트 선택, 세션 목록, 질문 답변 펼치기를 렌더한다', async ({ page }) => {
  await page.goto('/?fixture=many-projects-docs&history=1')
  await expect(page.locator('html')).toHaveAttribute('data-apc-fixture', 'many-projects-docs')
  await page.getByRole('button', { name: '질문 히스토리' }).click()

  await expect(page.getByRole('tab', { name: '히스토리' })).toHaveAttribute('aria-selected', 'true')
  const panel = page.getByRole('tabpanel')
  await expect(panel.getByRole('tab', { name: 'Codex' })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.locator('.question-history__session')).toHaveCount(1)
  await panel.getByRole('button', { name: /^Q1 codex 대화 히스토리 화면을 검증해 줘/ }).click()
  await expect(panel.getByRole('region', { name: 'Q1 답변' })).toContainText('세션 목록과 질문 아코디언을 확인했습니다.')

  await panel.getByRole('tab', { name: 'Claude' }).click()
  await expect(panel.getByText('claude 대화 히스토리 화면을 검증해 줘').first()).toBeVisible()
  await expectElementContained(panel)
  await expectViewportContained(page)
})
```

주의: 바깥 `page.getByRole('tab', { name: '히스토리' })`는 MainPanel 탭, `panel.getByRole('tab', …)`는 뷰 내부 에이전트 탭 — 반드시 `panel`로 스코프한다.

- [x] **Step 2: fixture QA 실행**

Run: `pnpm --filter @apc/desktop qa:fixture`
Expected: conversation-history 테스트 포함 전체 PASS. (fixture가 ResumeBanner 클릭 후 탭 전환을 렌더하지 못하면 — 예: fixture 브리지가 `q:projectDashboard`를 해당 프로젝트로 응답하지 않아 placeholder가 뜨는 경우 — fixture 데이터에서 해당 프로젝트의 dashboard 응답이 있는지 `e2e/fixture` 구성을 확인하고 보강한다.)

- [x] **Step 3: 커밋**

```bash
git add apps/desktop/e2e/fixture/renderer-fixtures.spec.ts
git commit -m "test(desktop): move conversation-history fixture QA from dialog to history tab"
```

---

### Task 5: 전체 검증

**Files:** 없음 (검증 전용)

- [x] **Step 1: 타입 검사**

Run: `pnpm typecheck`
Expected: 오류 0

- [x] **Step 2: desktop 테스트 전체**

Run: `pnpm --filter @apc/desktop test`
Expected: 전부 PASS

- [x] **Step 3: 수동 스모크 (superpowers:verification-before-completion)**

완료 메모: 사용자 데이터에 영향을 주지 않도록 fixture QA, 격리된 Windows Electron 스모크,
App/MainPanel 통합 테스트로 아래 4개 동선을 동등 검증했다.

`pnpm --filter @apc/desktop dev`로 앱을 띄우고:
1. 프로젝트 선택 → `💬 히스토리` 탭 → 에이전트 탭 전환, 세션 선택, 질문 펼침 확인
2. ResumeBanner "질문 히스토리" 클릭 → 히스토리 탭으로 전환 + 해당 에이전트 선택 확인
3. 프로젝트 미선택 상태에서 히스토리 탭 → placeholder 확인
4. 앱 재시작 → `apc:mainTab` 복원으로 히스토리 탭이 유지되는지 확인

- [x] **Step 4: 잔여 검증 커밋 (필요 시)**

수동 스모크에서 수정이 나왔다면 `fix(desktop): …`으로 커밋.
