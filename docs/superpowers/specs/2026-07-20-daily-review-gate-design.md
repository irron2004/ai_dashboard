# Learning Gate (Daily Review Gate) 설계

- 날짜: 2026-07-20
- 상태: **M0~M1 구현 완료** (2026-07-20, M2 이후는 미구현)
- 관련: `2026-06-02-pm-workbench-prd-v0.2.md`(daily/decision 문서 유형 기계획), `2026-07-02-product-diagnosis-and-roadmap.md`

## 0. 배경과 목표

사용자는 여러 프로젝트에서 AI agent를 병렬로 운용하면서 두 가지 문제를 겪는다:

1. **변경사항 파악이 어렵다** — diff를 볼 수는 있지만, 무엇을 읽었고 무엇을 이해했는지가 남지 않는다.
2. **바쁠 때 agent 결론을 그냥 수락한다** — 나중에 flow를 따라갈 수 없고, activity만 쌓이고 experience가 쌓이지 않는다.

이 기능의 목표는 단순한 회고 기록이 아니라 **역량 축적의 강제 장치**다. 키우려는 역량:

- **키스톤: 평가·검증 엔지니어링** — agent 출력의 맞고 틀림을 정의·측정하는 능력 (반복 실수 패턴 → eval 후보)
- 시스템 설계 판단력 / 하드 디버깅 근육 / 빠른 코드 리뷰(검증 속도)
- 습관 장치: 의사결정 로그(확신도 추적), 하루 마감 롤업("판단 0개 날" 경보), 주간 보정

## 1. 설계 결정 기록 — 두 설계안의 비교와 통합

설계안 A(인박스+데일리 회고+push hook)와 설계안 B(변경 스냅샷 Review Receipt)를 비교해 통합했다.

**공통 합의 (양쪽 동일 → 그대로 채택):**

- 데일리 회고 화면은 새 주 탭. 질문은 고정 + 동적(diff 기반) 하이브리드
- 게이트 판정은 **결정론적 조건**으로만 — LLM 채점은 피드백일 뿐 차단 근거가 아님
- "모름"은 유효한 답 (감추는 것이 아니라 드러내는 것이 목적)
- 긴급 우회는 허용하되 기록하고 다음 회고의 부채로 등록
- 기존 기반(diff 엔진·세션 ingest·reviews 테이블·next_notes) 재사용 — 신규 패키지 불필요

**차이점과 결정:**

| # | 쟁점 | 안 A | 안 B | 결정 |
|---|---|---|---|---|
| D1 | 강제 지점 | push (pre-push hook, 처음부터) | commit (in-app), hook은 후속 | **A: push 지점 + hook 즉시.** agent가 하루 종일 로컬 커밋하는 워크플로에서 commit 단위 게이트는 마찰 과다. 단, receipt 재검증을 서버(메인 프로세스)가 수행하는 B의 원칙은 채택 |
| D2 | 게이트 판정 기준 | 시각 기반("회고 시각 이후 커밋 차단") | **스냅샷 hash 기반 Review Receipt** | **B: receipt 채택.** 시각 기반은 rebase/amend에 취약하고 "오전 회고로 오후 변경 승인" 문제를 남김. receipt를 push-hook과 결합(§5) |
| D3 | 낮의 결정 인박스 | 있음 (30초 판단 기록, 확신도) | 없음 | **A 유지.** 역량 축적(확신도 캘리브레이션, 판단 로그)의 핵심이자 저녁 회고 부담을 낮추는 장치. PRD의 `decision` 문서 유형과도 부합 |
| D4 | AI 요약 형식 | 3줄 요약 | 4분류(확인된 변경/추론/가정/위험) + 문장별 근거 링크 + 사용자 수정 필수 | **B 채택.** AI 원문 무수정 승인 여부도 기록 |
| D5 | teach-back 방식 | 답변 후 피드백 | AI 답 숨김(제출 전 비공개) + 질문 중요도 계층 | **B 채택** + A의 "다음날 재출제" 병합 |
| D6 | 모름 처리 | 기록 + 다음날 재출제 | critical이면 차단, minor면 학습 부채 Task 자동 생성 | **병합:** critical 미응답 시 receipt 불발급, minor 모름 → 학습 부채 Task + 재출제 |
| D7 | 회고 산출물 저장 | DB만 | vault `projects/<id>/daily/YYYY-MM-DD.md` 내보내기 | **B 채택.** repo 안에 쓰면 회고 파일이 diff를 바꿔 스냅샷을 무효화하는 순환 발생. PRD `daily/` 계획과 일치 |
| D8 | 선행 구조 교정 | 없음 | ActiveWorkspace 단일화, commit/push 분리 | **B 채택.** 코드로 검증됨(§9) |
| D9 | 주간 층 | 확신도 대조·판단 0개 경보·eval 후보 풀 | 반복 실패 패턴 분석(후순위) | **A 채택,** B의 패턴 분석을 같은 화면에 병합 |
| D10 | 명칭 | 회고 | Learning Gate / Daily Review Gate | 기능명 **Learning Gate**, UI 탭명 **회고** |

## 2. 아키텍처 개요 — 3층 구조

```
[낮]   결정 인박스     agent 결론이 카드로 쌓임. 방해 없음. 여유 시 30초 판단 기록.
         ↓
[마감]  회고 탭        증거 수집 → AI 요약(근거 링크) → teach-back → 인박스 zero
         ↓             → repo/worktree별 Review Receipt 발급
[push] pre-push hook   push 커밋 ⊆ receipt 커버리지 검사. 미커버 커밋 차단.
```

- **Receipt는 날짜가 아니라 변경 스냅샷(HEAD SHA + diff hash)에 묶인다.** 회고 후 커밋이 하나라도 추가되면 그 커밋은 미커버 상태 — 다음 회고(또는 즉석 미니 리뷰) 전까지 push 불가.
- **Daily Review = 그날 발급된 receipt들의 집계** + 마감 롤업 질문 + 주간 지표.
- 낮에 급히 push해야 하면 회고 탭의 같은 플로우를 **해당 repo만 스코프해 즉석 실행**("미니 리뷰")해 receipt를 받을 수 있다. 저녁 데일리 회고는 남은 전부를 커버하고 마감 롤업을 수행한다.

## 3. 결정 인박스 (낮, 비침투적)

**추출**: ingest의 `onSessionParsed` 훅에 `decision-extractor` 추가(기존 `session-summarizer` 패턴). 세션 transcript에서 "agent가 내린 유의미한 결론"만 추출 — 설계 선택, 임계치/스키마 변경, 의존성 추가, 삭제 결정. 단순 진행 보고 제외.

**표면**: ProjectSidebar 미처리 뱃지 + 우측 오버레이 패널(기존 `DiffPanel.tsx` 패턴, `Ctrl+Shift+R`).

```
┌──────────────────────────────────────────────┐
│ ai_english · 14:02 · 세션 "채점 파이프라인 보강"   │
│ 결론: 채점 쿼리를 단일 트랜잭션으로 묶음             │
│ 파일: queries.ts, generate.ts    [diff 보기]     │
│ ──────────────────────────────────────────── │
│ 내 판단:  [✓ 동의]  [✗ 틀렸음]  [⚑ 내일 파보기]    │
│ 확신도:  [상] [중] [하]      메모: ____________   │
│                            [대화로 점프 →]      │
└──────────────────────────────────────────────┘
```

- `[diff 보기]` → 기존 `changesDiff` 재사용 (변경 파악을 결론 단위로 분해)
- `[대화로 점프]` → 기존 `HistoryFocus`로 히스토리 탭 해당 지점 오픈 (flow 복원)
- `[✗ 틀렸음]` → "agent 틀림 잡은 횟수" 지표 + **eval 후보 풀** 자동 태깅 (키스톤 재료)
- `[⚑ 내일 파보기]` → 기존 `next_notes` 저장 → 다음날 ResumeBanner 노출 (직접 파볼 지점 예약)
- 바쁠 땐 쌓아둔다. 단 **데일리 회고 완료 조건에 "인박스 zero" 포함**.

## 4. 회고 탭 (MainTab 7번째, 데일리 마감 + 즉석 미니 리뷰 겸용)

```
[전체][홈][문서][지식][위키생성][히스토리][회고 ⛔2]
┌─────────────────────────────────────────────────┐
│ 회고 · 2026-07-20    진행: ①증거 ②요약 ③질문 ④receipt │
│ 주간: 월✅7 화✅4 수🚩0 목✅6 금⬜ · 틀림5 · 모름12%    │
│                                                 │
│ ① 오늘의 작업 증거 (자동 수집)                       │
│   ▸ ai_english (worktree: hub) 커밋3 +412/-88     │
│     세션 5 · run 2(실패 1) · 미검증 수용기준 2        │
│     [파일별 diff] [실패 transcript] [테스트 결과]     │
│   ▸ naver_blog 커밋1 +60/-12 · 세션 2              │
│                                                 │
│ ② AI 요약 초안 (수정 필수, 문장마다 근거 링크)          │
│   확인된 변경 / AI의 추론 / 미확인 가정 / 위험·미해결    │
│   [수정하기] — 무수정 승인 여부 기록됨                 │
│                                                 │
│ ③ Teach-back (AI 답은 제출 전 비공개)               │
│   [고정] 이번 변경으로 이전 동작이 어떻게 달라졌나?      │
│   [고정] 핵심 흐름을 시작점→결과로 설명하면? (UI→IPC→…) │
│   [고정] 가장 깨지기 쉬운 지점과 그걸 발견할 로그·증상은? │
│   [고정] 어떤 테스트·실행 결과가 수용기준 충족을 증명하나?│
│   [고정] agent 결론 중 직접 확인한 것 vs 아직 가정인 것?│
│   [동적] queries.ts 트랜잭션이 왜 필요했나? (diff 기반) │
│   [마감] 오늘 배운 것 1개 / 내일 깊게 팔 것 1개→notes  │
│   각 질문 [모르겠음] 가능 — critical은 차단, 그 외      │
│   학습 부채 Task 생성 + 다음날 재출제                  │
│   (중요도 기준: 고정 이해검증 5문 = critical,          │
│    동적·마감 질문 = non-critical, 생성기가 승격 가능)    │
│                                                 │
│ ④ 남은 인박스(0) ✓ → [Receipt 발급 🔓]              │
│   자동 집계: 오늘 판단 개입 7건 (0건이면 🚩 경고)       │
└─────────────────────────────────────────────────┘
```

**AI 요약 고정 항목**: 해결하려던 문제 / 실제로 변경된 동작 / 주요 데이터·호출 흐름 / 선택한 설계와 이유 / 실패 가능성과 관측 방법 / 검증한 것과 아직 가정인 것. 각 문장에 diff·대화·run·test 근거 링크.

**증거 수집원(전부 기존 기반)**: `project-changes.ts`(diff·numstat), ingest 세션(turns·filesTouched), `agent_runs`(transcript·실패 로그), tasks(acceptanceCriteria — 자동 추출 Task는 대부분 비어 있으므로 "미검증 수용기준"으로 노출), 테스트 결과(M1은 수동 첨부, 자동 수집은 후속).

## 5. Review Receipt와 push 게이트

**Receipt 스키마** — "오늘 회고했다"가 아니라 변경 내용에 바인딩:

```
ReviewReceipt {
  id, projectId, worktreePath, branch,
  reviewedHeadSha,        // 리뷰 시점 HEAD
  diffHash,               // base..HEAD 변경 내용 hash (스냅샷 동일성)
  retroId | null,         // 데일리 회고 소속 (미니 리뷰면 null)
  answeredQuestionIds[], evidenceRefs[],
  issuedAt
}
```

**pre-push hook 판정** (앱이 안 떠 있어도 동작):

1. 앱이 receipt 발급 시 `git rev-parse --git-common-dir` 아래의 APC 관리 파일에 reviewed SHA를 기록한다. worktree들은 이 상태를 공유한다. hook 설치 경로는 `core.hooksPath`를 존중한다.
2. hook은 push되는 각 커밋이 **어느 receipt의 `reviewedHeadSha`와 같거나 그 조상**인지 검사
3. 미커버 커밋 존재 → 차단: `"⛔ 리뷰되지 않은 커밋 3개. 회고 탭에서 마감하거나 미니 리뷰를 실행하세요."`
4. APC gate가 활성화되지 않은 repo는 통과한다. 사용자가 hook을 설치하거나 첫 receipt를 발급해 gate를 활성화한 뒤에는 reviewed SHA가 하나도 없어도 차단한다.
5. **우회**: `APC_GATE_SKIP="사유" git push` — 사유 필수. skip 이벤트가 `gate_events`에 기록되고 다음 회고에 부채 항목으로 자동 등록, 주간 뷰에 🚩 표시. (완전 차단은 hook 삭제로 이어진다 — 우회는 가능하되 보이게)

이 결합으로: 아침에 어제 리뷰한 커밋 push → 통과(receipt 커버). 회고 후 새 커밋 → 미커버 → 차단. rebase로 SHA가 바뀌면 → 미커버 → 재리뷰(내용이 바뀔 수 있으므로 의도된 동작). GitSyncPanel은 fetch/rebase를 먼저 끝낸 **최종 HEAD**에 대해 메인 프로세스에서 재검증한 직후 push한다(렌더러 상태를 신뢰하지 않음).

**M1은 앱 내 commit을 게이트하지 않는다.** dock 터미널의 agent 커밋과 동일하게 로컬 커밋은 자유 — 강제선은 push 하나로 통일한다. 따라서 M1은 hard security boundary가 아니라 학습을 위한 로컬 guardrail이다(`--no-verify` 등 로컬 우회는 완전히 막을 수 없음). commit gate와 PR branch protection 연동은 후속이다.

## 6. 게이트 판정 조건 (전부 결정론적)

Receipt 발급 조건:

- [ ] 메인 프로세스가 `retroPrepare` 시 저장한 대상 repo/worktree와 현재 대상이 동일
- [ ] 메인 프로세스가 저장한 `preparedHeadSha`와 발급 시점 HEAD가 동일 (렌더러가 SHA를 주장하지 않음)
- [ ] 해당 대상의 critical 질문 전부 응답 ("모름" 제외)
- [ ] 최소 1개의 검증 근거 입력 (테스트 결과·실행 로그·수동 확인 서술)
- [ ] 위험·미확인 사항 명시 (`없음`도 명시적 답으로 허용)
- [ ] Receipt에 질문 ID와 답변·근거 snapshot hash를 고정

M2부터 AI 요약 확인·수정과 동적 질문을 위 조건에 추가한다. non-critical 마감 질문 2개는 미니 리뷰 receipt를 막지 않지만 데일리 회고 완료에는 필수다.

데일리 회고 완료 조건은 준비 시 저장된 대상 repo/worktree 전부의 현재 HEAD가 해당 target receipt로 커버되고, 마감 롤업 2문에 응답한 상태다. M2부터 **인박스 zero**를 추가한다. LLM은 답변의 빈 곳을 지적하는 피드백만 제공하고 차단 권한이 없다.

## 7. 데이터 모델·서비스·IPC (기존 규약 준수)

| 위치 | 신규 |
|---|---|
| `packages/shared` | `Decision`, `ReviewReceipt`, `DailyReview`, `ReviewQuestion`, `GateEvent` 스키마 (Zod, 기존 `schema.ts` 패턴) |
| `packages/pm` | `decision-store`, `receipt-store`, `daily-review-store` + SQLite migration (`decisions`, `review_receipts`, `daily_reviews`, `review_questions`, `gate_events`) |
| `packages/app-services` | `ChangeSnapshotService`(base SHA+파일 → hash), `DailyReviewService`(diff·대화·Task·run 증거 조립), `decision-extractor` |
| `apps/desktop` | `RetroView`(회고 탭), `DecisionInboxPanel`(오버레이), GitSyncPanel 게이트 상태 표시·회고 진입 버튼, hook 설치 버튼 |
| `packages/dashboard-api` | 날짜별/프로젝트별 회고·지표 집계 (주간 뷰) |

IPC(4파일 규약: ipc-contract → preload → api → ipc.ts): `decisionsList/decisionJudge`, `retroPrepare/retroAnswer/retroComplete`, `receiptIssue/gateStatus/gateInstall`, 그리고 §9의 분리된 git 채널.

**vault 내보내기**: 완료된 회고를 앱 외부 vault `projects/<id>/daily/YYYY-MM-DD.md`로 기록(PRD `daily/` 구조), 판단 기록은 `decision` 문서로. 리뷰 대상 repo 안에 쓰지 않는다 — 회고 파일이 diff를 바꿔 스냅샷을 무효화하는 순환 방지.

## 8. 주간 뷰와 역량 매핑

회고 탭 상단 스트립 + 금요일 확장 섹션:

- **확신도 대조**: 이번 주 확신도 '하' 판단 재조회 — "지금 보니 맞았나?" → 직관 보정
- **eval 후보 풀**: `✗ 틀렸음` 태그 판단들의 반복 패턴 목록 — "자동 검증으로 만들 후보" (eval 하네스 실행 화면은 범위 밖, 여기는 재료 창고까지)
- 지표: 일별 판단 개입 수(0일 🚩), agent 틀림 잡은 횟수, 모름율, 게이트 skip 수, 학습 부채 잔량

| 역량 | 담당 장치 |
|---|---|
| 변경 파악 + 리뷰 속도 | 증거①의 diff + 동적 teach-back 질문 |
| 설계 판단력 | 인박스 판단(동의/틀림/왜) + 고정 질문 "대안은?" |
| 판단 캘리브레이션 | 확신도 기록 → 금요일 대조 |
| 하드 디버깅 | "깨지기 쉬운 지점·로그" 질문 + ⚑ 내일 파보기 예약 |
| 평가·검증 (키스톤) | ✗틀렸음 축적 → eval 후보 풀 |

## 9. 선행 구조 교정 (M0 — 코드 검증 완료)

1. **ActiveWorkspace 단일 소스화**: 활성 worktree가 AgentWorkspaceDock 로컬 상태에만 있고 GitSync는 `repoPaths[0]` 사용(`HomeView.tsx:134`). `ActiveWorkspace = { projectId, worktreePath, branch }`를 전역 store로 승격 — diff·회고·commit·터미널이 같은 경로를 보게. 이것 없이는 receipt가 엉뚱한 경로에 발급된다.
2. **commit과 push 분리**: `commitPush()`가 한 호출(`git-sync-service.ts:163`). → `commitChange` / `pushReviewed`로 분리하고 `pushReviewed`가 receipt를 서버 측에서 재검증. `createPullRequest`는 후속.

## 10. 구현 순서

- **M0** — ActiveWorkspace 단일화 + commit/push 분리 (§9)
- **M1** — 스냅샷/receipt + pre-push hook + 회고 탭(수동 질문·수동 검증 근거 첨부) : LLM 없이 성립하는 최소 루프
- **M2** — 결정 인박스(decision-extractor) + AI 요약(4분류·근거 링크) + 동적 질문 + vault 내보내기
- **M3** — 주간 보정·eval 후보 풀·학습 부채 대시보드 + 테스트 결과 자동 수집
- **후속** — PR 생성 + branch protection 연동, status-web(모바일)에 회고·게이트 노출

각 단계는 독립 배포 가능. M1까지가 MVP.

### 10.1 M0~M1 구현 결과 (2026-07-20)

- 활성 worktree를 Zustand의 단일 상태로 승격하고, Git IPC가 등록된 실제 worktree인지 재검증한다.
- Commit과 Push를 분리했다. 로컬 Commit은 자유로우며, 강제선은 의도대로 Push에만 둔다.
- 전역 `회고` 탭에서 프로젝트별 커밋·diff 통계, target 전용 critical 5문, 검증 근거, 위험·미확인 메모, 마감 2문을 저장한다.
- Receipt 발급은 렌더러가 보낸 SHA를 신뢰하지 않고, 메인 프로세스가 준비한 target·현재 HEAD·branch·답변·근거를 재검증한다. 발급 후 해당 답변과 메모는 불변 기록으로 고정된다.
- 앱 Push는 `fetch → rebase → 최종 HEAD 재검증 → push`를 따르며, rebase로 SHA가 변경되면 기존 Receipt를 재사용하지 못한다.
- pre-push hook은 `core.hooksPath`와 linked worktree의 common dir를 존중하고 기존 hook을 체인한다. 긴급 우회는 사유를 기록해 다음 회고의 부채로 노출한다.
- 검증: TypeScript typecheck, 전체 Vitest 1,155개, 브라우저 fixture QA 11개, Electron production build 통과. Windows 전용 Electron smoke는 WSL에서 플랫폼 조건으로 skip되었다.

M1은 LLM 요약·동적 질문·결정 인박스·vault 내보내기를 포함하지 않는다. 이 항목들과 commit/PR 원격 강제는 기존 로드맵대로 M2 이후 범위다.

## 11. 범위 밖 / 리스크

- eval 하네스 "실행" 화면(키스톤 본체)은 별도 설계 — 여기서는 후보 축적까지
- decision-extractor 품질(과추출/누락)은 M2에서 임계 조정 필요 — 과추출되면 인박스가 소음이 되어 습관이 죽는다
- 회고 강제가 형식화되는 순간 실패 — 지표(무수정 승인율, 모름율, skip율)를 주간 뷰에 노출해 형식화 자체를 관측 대상으로 만든다
