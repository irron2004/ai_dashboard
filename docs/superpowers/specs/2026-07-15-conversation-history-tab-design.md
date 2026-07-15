# 대화 히스토리 탭 승격 설계 — 모달에서 프로젝트 전용 화면으로

**날짜:** 2026-07-15
**참조:** [Agent QA 표면 설계](2026-07-14-agent-qa-surface-design.md) · `apps/desktop/src/main/conversation-history.ts` (fbfe5b5)
**상태:** 설계 확정 — Q/A 추출 로직은 현행 유지, 렌더러만 변경

---

## 1. 문제

fbfe5b5에서 codex/claude/opencode 세션을 읽어 Q/A로 짝지어 보여주는 `QuestionHistory`가
추가됐지만, ResumeBanner의 "질문 히스토리" 버튼으로만 열리는 **모달**이다.

- 프로젝트별 주 화면(`전체 | 홈 | 문서 | 지식 | 위키 생성`)과 동급인 상시 진입점이 없다.
- 모달 폭 제약으로 세션 리스트와 답변 본문이 좁다.
- 향후 히스토리 내 **검색**을 붙일 예정인데, 팝업은 "검색 히트 → 해당 세션·질문으로 점프"
  같은 동선을 담기 어렵다.

## 2. 결정

`QuestionHistory` 모달을 제거하고 주 화면 탭 `💬 히스토리`(`MainTab: 'history'`)로 승격한다.
Q/A 추출(`conversation-history.ts`)과 IPC(`q:conversationHistory`)는 **변경하지 않는다**.
분석(LLM 요약·분류)은 하지 않는다 — Q/A 짝짓기 그대로가 이번 범위다.

## 3. 구성

### 3.1 `ConversationHistoryView` (신규, 모달에서 추출)

`apps/desktop/src/renderer/components/ConversationHistoryView.tsx`

- 레이아웃: **툴바 행**(에이전트 탭 Codex/Claude/OpenCode — 나중에 검색 입력이 같은 행에
  추가됨) + **2단 본문**(세션 리스트 | Q/A 아코디언).
- 기존 모달의 상태·fetch·아코디언 로직을 그대로 옮긴다: 탭/프로젝트 변경 시
  `fetchHistory({ projectId, agent, limit: 40 })`, 로딩·오류·빈 상태, truncated/skipped 안내.
- CSS는 `.question-history__*` 클래스를 재사용하되 모달 전용 껍데기
  (`add-project-overlay`, dialog 크기 제약)만 벗긴다. 탭 콘텐츠 영역 전체를 쓴다.

Props:

```ts
type Props = {
  projectId: string | null
  focus: HistoryFocus | null          // 외부 주입 포커스 (아래 3.2)
  onFocusConsumed: () => void         // 포커스 반영 후 1회 초기화
  fetchHistory: (req: ConversationHistoryReq) => Promise<ConversationHistoryRes>
}
```

### 3.2 포커스 주입 — 검색 대비의 핵심 이음새

```ts
export type HistoryFocus = {
  agent: AgentType
  sessionId?: string   // 지정 시 해당 세션 선택
  exchangeId?: string  // 지정 시 해당 질문 아코디언 펼침 + 스크롤
}
```

- 상태는 `App.tsx`가 보유(`historyFocus`), `MainPanel` 경유로 뷰에 전달한다.
- 소비자 1(지금): ResumeBanner "질문 히스토리" → `setHistoryFocus({ agent })` +
  `handleMainTab('history')`.
- 소비자 2(향후): 검색 히트 클릭 → `{ agent, sessionId, exchangeId }`로 동일 경로 진입.
- 뷰는 focus를 반영한 뒤 `onFocusConsumed()`로 소거한다. focus의 sessionId가 로드된
  세션 목록에 없으면 무시하고 기본 선택(첫 세션)으로 동작한다.

### 3.3 `MainPanel` 탭 추가

- `MainTab`에 `'history'` 추가, `TABS`에 `{ id: 'history', icon: '💬', label: '히스토리' }`.
- 다른 프로젝트 탭과 동일하게 프로젝트 미선택 시 placeholder를 보인다.
- `App.tsx`의 localStorage 복원 화이트리스트(`apc:mainTab`)에 `'history'`를 추가한다.

### 3.4 모달 제거

- `App.tsx`: `historyScope` 상태, `<QuestionHistory …>` 렌더 제거.
- `QuestionHistory.tsx` 삭제(내용은 3.1로 이동), `app.css`의 모달 껍데기용 규칙만 정리.
- ResumeBanner의 `onOpenHistory` 시그니처는 유지하되 App에서 탭 전환으로 연결한다.

## 4. 데이터 흐름 (변경 없음 확인)

```text
ConversationHistoryView
└─ api.conversationHistory({ projectId, agent, limit })   ← IPC q:conversationHistory
   └─ loadConversationHistory()                            ← 파일 즉석 스캔 (ingest 불요)
      └─ toConversationSession()                           ← 사람 질문 ↔ 답변 짝짓기
```

`ConversationHistoryReq`는 객체형이라 향후 `query?: string`, `sessionIds?: string[]`
추가가 기존 호출부를 깨지 않는다. 이번 변경에서 IPC 4곳 배선은 건드리지 않는다.

## 5. 향후 검색 확장 (이번 범위 아님 — 기록만)

1. **인덱스:** `packages/search`의 `turn_fts`(FTS5)가 이미 세션 턴을 색인하지만
   `agent` 컬럼이 없다 → 검색 도입 시 컬럼 추가 + 재색인 필요.
2. **신선도:** `turn_fts`는 ingest 후에만 최신이고 히스토리 화면은 파일 즉석 스캔이라
   차이가 있다 → 검색 시점에 "검색 전 ingest 트리거" 또는 "스캔 결과 클라이언트 필터"
   중 택일.
3. **동선:** 검색 히트 → `HistoryFocus { agent, sessionId, exchangeId }` → 히스토리 탭.
   이 이음새(3.2)가 이번에 미리 준비된다. `ConversationExchange.id`는 턴 uuid 기반이라
   FTS 히트와 대응 가능해야 한다 — 검색 도입 시 uuid 없는 턴의 폴백 id
   (`question-{n}`) 안정성을 함께 검토한다.

## 6. 테스트

| 표면 | 내용 |
|---|---|
| `ConversationHistoryView.test.tsx` | 기존 `QuestionHistory.test.tsx`를 이전: 에이전트 탭 전환, 세션 선택, 아코디언 펼침, 로딩·오류·빈 상태, truncated 안내. **추가:** focus 주입 시 세션 선택·아코디언 펼침·`onFocusConsumed` 호출, 없는 sessionId 무시 |
| `MainPanel.test` (해당 파일) | `history` 탭 렌더·선택·프로젝트 미선택 placeholder |
| App 통합 | ResumeBanner "질문 히스토리" → 히스토리 탭 전환 + agent 포커스 |
| e2e fixture (`renderer-fixtures.spec.ts`) | `conversation-history` 시나리오를 dialog 기준 → 탭 기준으로 수정 (`role="dialog"` 셀렉터 제거, 탭 클릭으로 진입) |

## 7. 범위 밖

- LLM 기반 요약·주제 분류·제목 생성
- 검색 구현(입력 UI, FTS 배선, agent 컬럼) — 5절에 기록된 준비만 수행
- `conversation-history.ts`·IPC 계약·ingest 파이프라인 변경
