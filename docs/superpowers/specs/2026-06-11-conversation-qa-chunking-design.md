# 대화 세션 → Q&A raw 청킹 — 설계

- **Date**: 2026-06-11
- **Status**: 승인 대기 (설계 구두 승인 완료, 스펙 리뷰 전)
- **배경**: 사용자는 claude/codex/opencode 대화를 위키의 1차 소스로 쓰고 싶다. 세션 통째는
  너무 커서(64KB 캡에 잘리고, NODE_PROPOSALS 단계 timeout 유발) 위키 입력으로 부적합 —
  세션을 **시간순 Q&A 단위 파일**로 쪼개 `raw/`에 materialize하면 추출기가 특정 문답을
  세밀한 근거(evidence)로 인용할 수 있다.

## 1. 목표 / 비목표

**목표**
1. "전 문서로 위키 생성" 버튼 하나로, **현재 프로젝트에서 진행된** claude/codex/opencode
   세션이 자동으로 `raw/conversations/<engine>/<sessionId>/NNNq_a.txt`로 청킹된다.
2. 각 파일은 Q&A 한 쌍: user 질문 + assistant 답변 텍스트 + 툴콜 한 줄 요약(스타일 B).
   tool_result 본문(노이즈)은 제외한다.
3. 멱등: 재실행 시 `raw/conversations/`를 비우고 다시 만든다(삭제된 세션은 사라짐).

**비목표 (후속)**
- 세션 선택 UI(체크박스), 기간 필터.
- SSH 원격 호스트의 세션 수집(현재 로컬 어댑터 3개만).
- NODE_PROPOSALS timeout 자체의 해결(타임아웃 상향/입력 샘플링은 별도 이슈) —
  단, 본 기능의 세션 수 상한(§5)이 입력 폭주를 1차 완화한다.

## 2. 아키텍처

기존 인제스트 어댑터(`@apc/agents`: ClaudeAdapter/CodexAdapter/OpenCodeAdapter — 세션
발견·파싱·redact·`NormalizedSession` 정규화가 이미 구현됨)를 **재사용**하고, 그 출력을
Q&A 파일로 materialize하는 레이어만 신설한다.

```
[adapters].discoverSources+parseSource          (기존, @apc/agents)
        │  NormalizedSession{ repoPath, turns[{role,text,timestamp,toolCalls}] }
        ▼
materializeConversations (신설, @apc/app-services)
  ├─ sessionMatchesProject(session, repoPaths)   # 경로 정규화 매칭
  ├─ groupQaUnits(turns)                         # 순수: 시간순 Q&A 묶기
  ├─ formatQaFile(unit)                          # 순수: 스타일 B 마크다운
  └─ write raw/conversations/<engine>/<sessionId>/NNNq_a.txt
        ▼
SourceReader.read()                              (기존) → 파일당 SourceDoc 1개
        ▼
conversation-history-reader / knowledge-node-extractor가 세밀한 source_path 인용
```

### 2.1 신설 파일 (`packages/app-services/src/conversation-materializer.ts`)

```ts
export type QaUnit = { q: NormalizedTurn; answers: NormalizedTurn[] }
export type ConversationManifest = { sessions: number; files: number; skipped: string[] }

export function groupQaUnits(turns: NormalizedTurn[]): QaUnit[]
export function formatQaFile(unit: QaUnit): string
export function sessionMatchesProject(session: NormalizedSession, repoPaths: string[]): boolean
export async function materializeConversations(opts: {
  adapters: AgentIngestAdapter[]
  repoPaths: string[]
  vaultRoot: string
  maxSessions?: number   // default 10
}): Promise<ConversationManifest>
```

- **`groupQaUnits`**: **텍스트가 비어있지 않은 `user` turn**에서만 새 단위가 시작되고, 다음
  단위 시작 전까지의 모든 turn(`assistant`/`tool`, 그리고 **빈 텍스트 user turn** — claude
  jsonl에서 tool_result는 user role 메시지로 오므로 새 Q가 아니라 현재 단위의 answers에
  속한다)을 `answers`로 묶는다. 첫 단위 시작 전의 turn(`system` 등)은 스킵. 답이 없는
  마지막 user turn도 단위가 된다(미해결 질문 = open problem 신호).
- **`formatQaFile`**: 스타일 B —

  ```markdown
  ## Q (user, 2026-06-10T15:22:01Z)
  <user turn 텍스트 전문>

  ## A (assistant)
  <assistant turn 텍스트들, 빈 줄로 연결>

  ### tools
  - Edit packages/.../llm-agent.ts
  - Bash: pnpm vitest run … (error)
  ```

  - 툴콜 요약 규칙: `name`이 Edit/Write/MultiEdit/NotebookEdit/Read → `<name> <input.file_path>`;
    Bash → `Bash: <input.command 앞 80자>`; 그 외 → `<name>` 만. `isError`면 ` (error)` 접미.
    `tool_result`(name === 'tool_result') 호출은 **요약에서도 제외**(원 호출 쪽에 이미 표시됨).
  - 답이 없는 단위는 `## A` 대신 `## A (no answer recorded)` 한 줄.
  - timestamp 없으면 헤더에서 생략.
- **`sessionMatchesProject`**: 세션 `repoPath`(없으면 `worktreePath`)와 프로젝트 `repoPaths`를
  정규화해 **같거나 하위 경로**면 매칭. 정규화: `\`→`/`, `C:/`→`/mnt/c/`(드라이브 일반화),
  소문자화, 끝 `/` 제거. `ssh://` repoPath는 로컬 세션과 매칭되지 않음(스킵).
- **`materializeConversations`**: 시작 시 `<vaultRoot>/raw/conversations/`를 `rmSync`로 비움
  (멱등 — `materializeProjectDocs`와 동일 패턴). 어댑터별 discover→parse, 매칭 세션을
  `endedAt` 내림차순 정렬 후 **최신 `maxSessions`개만**(기본 10 — SourceReader가 raw 전체를
  프롬프트에 넣으므로 입력 폭주 방지) materialize. 어댑터/세션 단위 실패는 try/catch로
  `skipped`에 기록하고 계속(절대 run을 죽이지 않음). `discoverSources`에는 `() => undefined`
  커서를 넘겨 **항상 전체 세션**을 보게 한다(인제스트 커서와 독립).
- 파일명: `String(i + 1).padStart(3, '0') + 'q_a.txt'` (001부터, 사전식=시간순).
  세션 디렉터리명: `sessionId`에서 `[^A-Za-z0-9._-]`를 `_`로 치환(경로 안전).

### 2.2 배선

- `HarnessServiceDeps`에 `conversationAdapters?: AgentIngestAdapter[]` 추가.
- `HarnessService.run()`의 기존 materialize 블록 확장:

  ```ts
  if (input.materialize && input.repoPaths?.length) {
    materializeProjectDocs(input.repoPaths, this.deps.vaultRoot)
    if (this.deps.conversationAdapters?.length) {
      await materializeConversations({
        adapters: this.deps.conversationAdapters,
        repoPaths: input.repoPaths, vaultRoot: this.deps.vaultRoot,
      })
    }
  }
  ```

- 데스크톱 `container.ts`: 이미 만들어 둔 `ingestAdapters`(153행)를
  `new HarnessService({ …, conversationAdapters: ingestAdapters })`로 주입.
  테스트/CLI처럼 어댑터가 없으면 자동으로 건너뜀(하위호환).

## 3. 에러 처리

| 상황 | 동작 |
|---|---|
| 어댑터 discover/parse 실패 | 해당 소스만 `skipped`에 기록, 계속 |
| 파일 쓰기 실패 | 해당 파일만 skip + 기록 |
| 매칭 세션 0개 | `raw/conversations/` 빈 채로 정상 진행 (위키는 project-docs만으로 생성) |
| sessionId 충돌(치환 후 동일) | 뒤에 `-2`, `-3` 접미 |

시크릿: 어댑터가 이미 `redact()` 적용 — 본 레이어는 추가 처리 없음.

## 4. 테스트 (TDD)

- `groupQaUnits`: Q-A-A-Q-A → 2단위 / 선두 system 스킵 / **빈 텍스트 user turn(tool_result
  운반)은 새 Q가 아니라 현재 단위에 합류** / trailing 무응답 user 단위화.
- `formatQaFile`: 스타일 B 산출 / tool_result 제외 / isError 표시 / timestamp 생략 케이스.
- `sessionMatchesProject`: `C:\foo\bar` ↔ `/mnt/c/foo/bar` / 하위 경로 / 불일치 / ssh:// 스킵.
- `materializeConversations`: fake 어댑터 2개로 — 매칭 세션만 / 001·002 번호 / 멱등(재실행 시
  이전 파일 제거) / maxSessions 컷 / 어댑터 throw 시 skipped 기록·정상 반환.
- `harness-service.test.ts`: `materialize: true` + fake conversationAdapters → run 후
  `raw/conversations/<engine>/<session>/001q_a.txt` 존재.

## 5. 결정 기록

- **세션 범위**: 현재 프로젝트(repoPaths 일치) 세션만 (사용자 선택 A).
- **파일 단위**: Q&A 쌍 + 툴콜 한 줄 요약, tool_result 본문 제외 (사용자 선택 B).
- **소스 위치**: 도구 기본 세션 위치(어댑터 기본값) 그대로.
- **트리거**: 별도 버튼 없이 기존 "전 문서로 위키 생성"의 materialize 단계에 통합.
- **maxSessions=10 기본**: SourceReader가 raw 전체를 LLM 입력에 넣는 현 구조에서
  최근 세션 우선이 품질·비용·timeout 모두에 안전. 필요 시 옵션으로 상향.

## 6. 핵심 파일

```
packages/app-services/src/conversation-materializer.ts        # 신설 (3 순수 함수 + materializer)
packages/app-services/src/conversation-materializer.test.ts   # 신설
packages/app-services/src/harness-service.ts                  # deps + materialize 블록 확장
packages/app-services/src/harness-service.test.ts             # 배선 테스트 추가
apps/desktop/src/main/container.ts                            # conversationAdapters: ingestAdapters 주입
packages/agents/src/{claude,codex,opencode}-adapter.ts        # 재사용 (수정 없음)
packages/knowledge-harness/src/runtime/source-reader.ts       # 재사용 (수정 없음)
```
