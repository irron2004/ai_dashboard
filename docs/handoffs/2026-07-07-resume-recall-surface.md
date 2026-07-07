# Handoff — 이어서(Resume) 컨텍스트 리콜 표면 (진단→spec→plan→구현→PR)

**날짜:** 2026-07-07
**한 줄 상태:** 사용자의 두 고통("이전에 뭘 물었는지 까먹음", "다음에 뭐 하려 했는지 까먹음")을 **전환 시 슬라이드-인 배너 + note 캡처 + 질문 히스토리**로 해소하는 기능을 진단부터 완주 — 7-task TDD를 subagent-driven(구현 Sonnet / 리뷰·게이트 Opus)로 실행, 최종 whole-branch 리뷰 통과, **PR #21 OPEN**. 전체 테스트 1018 pass/2 skip/0 fail.

이 세션은 brainstorming → spec → writing-plans → subagent-driven-development → 최종 리뷰 → finishing 흐름으로 진행. spec/plan은 `docs/superpowers/{specs,plans}/2026-07-07-resume-recall-surface*`.

---

## 1. 무엇을 만들었나 (비전 대비)

로드맵(`2026-07-02-product-diagnosis-and-roadmap.md`)의 비전 2·3("전후 작업 빠른 파악", "다음 작업 → LLM 전달")을 **UX 관점**에서 재프레이밍한 기능. 진단의 핵심: 두 고통은 같은 뿌리(**전환 시 컨텍스트 증발**)이고, 필요한 데이터는 **이미 대부분 캡처돼 있다**(질문 원문 `turn_fts`, 세션 요약 `req:` task) → 새 파이프라인이 아니라 **리콜 표면 + 초경량 human 캡처** 문제.

- **전환 시 슬라이드-인 "이어서" 배너**(`ResumeBanner`): 지난번 요약 · 마지막 질문 · 📌 다음 할 일 · [이어서 대화] · [질문 히스토리]. `selectedProjectId` 실전환에만 발화(prevRef 가드), 빈 히스토리면 억제.
- **`⌘⇧N` note-to-self** 빠른 캡처(현재 프로젝트에 append).
- **연대순 질문 히스토리** 패널(`QuestionHistory`, 프로젝트별/전체).
- 🌐 **전체 탭**(`WorkspaceHome`)에 각 프로젝트 top note 노출.

**아키텍처:** 신규 스토어 둘뿐 — `next_notes`(사용자 소유, INSERT/UPDATE/DELETE만), `question_log`(파생, 세션ID DELETE-then-INSERT 멱등). 조립은 `@apc/dashboard-api`의 순수 `buildResumeCard`(세션 파싱은 `latestSession` dep로 주입). 나머지는 전부 재사용(최근 `req:` 제목=지난번 요약, `latestSessionDetail`=마지막 질문, `openPanes.sessionId`+`resumeCommand`=이어서 대화).

---

## 2. Task별 커밋 (전부 `feat/resume-recall-surface`, base `main`@`8587daf`)

| # | Task | 커밋 | 리뷰 |
|---|---|---|---|
| — | spec + plan | `7aa67f1` `216d67a` | — |
| 1 | NextNoteStore (`@apc/pm`) | `1665304` | Opus Approved |
| 2 | QuestionLogStore (`@apc/pm`) | `63a67dc` | Opus Approved |
| 3 | ingest→question_log 배선 | `bb54d7c` | Opus Approved (c:ingestAll 무회귀) |
| 4 | latestSessionDetail + buildResumeCard | `73160a5` + fix `abf0c0f` | Opus Approved |
| 5 | IPC 표면 (5채널) | `8e283ee` | Opus Approved |
| 6 | ResumeBanner + ⌘⇧N | `d6b3e84` | Opus Approved |
| 7 | QuestionHistory + 전체 탭 note | `25f59d5` | Opus Approved |
| — | **최종 리뷰 fix wave** | `8f4e72d` | Opus Approved (재리뷰) |

진행 ledger: `.superpowers/sdd/progress.md`(gitignore 스크래치) — task별 커밋·리뷰·Minor 전부 기록.

---

## 3. 최종 whole-branch 리뷰 — Important 2건 병합 전 해소

**Critical 0.** 아키텍처 sound, 3 seam round-trip. Important 2건을 사용자 승인 후 fix wave(`8f4e72d`)로 처리:

- **I1 성능:** `q:resumeCard`가 전환마다 3엔진 세션을 **cursor 없이 전체 재스캔**(실이력 ~15s, main 프로세스) → **프로젝트별 resumeCard 캐시**(container `resumeCardCache` Map), `c:ingestAll` 핸들러 + 3 note mutation에서 무효화.
- **I2 재개:** "이어서 대화"가 `resumeTarget.sessionId`를 버리고 `restartAgent`(nonce만 bump)에 의존 → 신규 `store.resumeAgentSession(key, sessionId)`가 **openPanes[key].sessionId + restartNonce를 한 `set()`에서** 갱신 → `AgentTerminal`이 새 `resumeSessionId`로 재spawn. `App.onResume`이 이걸 호출.
- 값싼 Minor 동시 처리: `question_log` `ORDER BY ts DESC, rowid DESC`(+QuestionHistory key index) · App `fetchLog` `useCallback`.

---

## 4. ⚠️ 함정 / 학습 (다음 세션이 알아야 할 것)

- **세션 한도 중단 → ledger 복구:** Task 4 구현 중 계정 세션 한도(11:30am KST 리셋)로 서브에이전트가 중단됨. `latest-session.ts`+테스트는 디스크에 미커밋으로 남아 있었고, **ledger에 "미커밋 부분작업 보존/재개 절차"를 박아둔 덕에** 리셋 후 정확히 이어감. 부분작업은 `npx vitest run`으로 GREEN 확인 후 나머지 절반만 재디스패치.
- **IDE `<new-diagnostics>`는 RED-phase 스테일도 낸다:** module-not-found뿐 아니라 **구조적 타입 에러**(`questionLog not in IngestDeps`, `topNote not on ProjectOverview`)도 오경보로 뜸 — TDD의 실패 테스트를 먼저 쓴 시점의 스냅샷. **권위는 `pnpm typecheck`**. 커밋된 코드를 `git show`로 확인하면 실제로는 정상.
- **브리프 verbatim 테스트 코드의 implicit-any 함정:** `... as unknown as AgentIngestAdapter` 캐스트가 화살표 인자의 contextual typing을 벗겨 `pnpm typecheck`에서 TS7006. `npx vitest run`은 타입검사를 안 해서 못 잡음. 해결=인자에 명시 타입(`src: AgentSource`). **plan 테스트 코드에 `as unknown as`+무타입 화살표 인자가 있으면 typecheck까지 돌려야 안전.**
- **`latestSessionDetail`은 비-hermetic·느림:** 실제 `~/.claude`/`~/.codex`를 스캔(~15s). **테스트는 `vi.mock('@apc/agents')`로 latestSessionDetail만 스텁**(real 어댑터 클래스는 유지해 container ingest 기본값 보존). 캐시(I1) 이후에도 **실 CLI 이력 있는 기기에서 전환 스톨을 직접 확인 권장**(모킹이 가리는 부분).
- **resume/PTY seam(민감, CLAUDE.md 경고):** `AgentTerminal`은 `resumeSessionId`를 **effect body에서 읽되 dep 배열엔 없음** — 재spawn을 트리거하는 건 `restartNonce`뿐. 그래서 sessionId+nonce를 한 `set()`에서 쓰면 새 sessionId를 읽고 재개. AgentKind 열거형은 여전히 확장 금지.
- **루트 `npx vitest run`이 이제 `@apc/desktop` 포함:** 과거 핸드오프의 "apps 제외" 함정은 해소됨(vitest workspace가 apps까지 커버). 다만 전체 ~2.5분 — 타임아웃 여유 필요.

---

## 5. 리포/브랜치 상태

- **ai_dashboard** (`irron2004/ai_dashboard`): **PR #21 OPEN** — `feat/resume-recall-surface`@`8f4e72d` → `main`. 리뷰어 피드백은 이 브랜치에서 이어서 반영(worktree 없음, 일반 repo라 브랜치 유지).
- **미커밋(무관, 세션 시작 전부터):** `.npmrc` · `apps/desktop/package.json` · `apps/desktop/src/main/index.ts` · `pnpm-lock.yaml` · `pnpm-workspace.yaml` · `apps/desktop/electron-builder.yml`(??) — **패키징 관련, 이 기능과 무관해 커밋 안 함.** git 관리 여부는 사용자 결정 대기.
- 전체 테스트: **1018 pass / 2 skip / 0 fail**, `pnpm typecheck` clean.

---

## 6. 남은 작업 (Follow-up, 비차단 — PR #21 본문에도 기록)

1. **⌘⇧N이 이력 없는 새 프로젝트에서 무동작**: note 캡처가 배너 렌더에 결합(`resumeBannerOpen && resumeCard`) → resumeCard=null이면 배너 미표시. note 캡처를 배너와 분리 검토.
2. **QuestionHistory 세션 점프 미구현(spec §5.2)**: `onPick`이 `selectProject`만 하고 `entry.sessionId`로 세션 resume 안 함. I2의 `resumeAgentSession` 프리미티브 재사용하면 됨.
3. **자잘한 정리**: `question_log.record` 트랜잭션 래핑 · 미사용 import(`ipc-contract` `QuestionLogEntry`, `api.ts` `NextNote`, `ResumeBanner.test` `beforeEach`) · 신규 CSS(`question-history__*`, `workspace-card__note`) 폴리시.
4. **크로스디바이스 동기화**: 로컬 sqlite 종속 — 로드맵 P4(status-web) 읽기전용 노출과 엮이는 별도 축.
5. **로드맵 P5**(위키 관리 고도화)는 여전히 미착수 — 이 기능과 독립.
