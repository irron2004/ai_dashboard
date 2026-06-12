# 화면 전면 재구성 — Home / Knowledge / Wiki Gen 3-탭 — 설계

- **Date**: 2026-06-12
- **Status**: 설계 구두 승인 완료(브라우저 목업 4종 검토), 스펙 리뷰 전
- **배경**: 한 화면에 너무 많은 조작 지점(Knowledge Harness 한 화면에 15개+: hero 버튼 3,
  중앙 탭 7, Runs 레일, Agent Config 패널, 툴바 4버튼)이 몰려 조잡하고, "Runs"가 뭔지,
  Run harness/전 문서로 위키 생성/Resume이 뭐가 다른지 읽히지 않는다. 그래프 노드를
  클릭해도 vault 문서는 열리지 않는다(run 아티팩트에만 매칭). 솔루션의 본래 목적 —
  **여러 프로젝트를 병행하며 md를 빠르게 파악해 에이전트에게 일을 잘 시키는 것** — 에
  화면 구조를 다시 맞춘다.

## 0. 브레인스토밍에서 확정된 결정

| 질문 | 결정 |
| --- | --- |
| 프로젝트 열면 가장 먼저 볼 것 | **current.md + 변경분 나란히** (홈) |
| 읽기와 생성의 관계 | **분리** — Knowledge(읽기 전용) / Wiki Gen(생성·검수) |
| 하단 에이전트 터미널 3개 | **접이식 하단 독** (위치 유지, 한 클릭/키로 접고 펼침) |
| "에이전트가 만든/수정한 파일" 기준 | **git 변경분** (`git status` 기반) |
| 기존 PM Home(Task Board·Timeline·Review Queue) | **홈 하단 축약 strip** + "자세히"로 펼침 |
| 전체 구조 | **A안: 3-탭 풀 분리** (vs 2-탭+마법사 B안, 정리만 C안) |
| 에이전트 설정 패널 | 슬라이드 패널이되 **하니스 구조도 자체가 설정 화면** |

## 1. 목표 / 비목표

**목표**
1. 상단 탭 3개(Home / Knowledge / Wiki Gen)로 "지금 뭘 하러 왔는지"와 화면이 1:1.
2. 평소 화면(Home·Knowledge)에서 생성·설정 UI가 보이지 않는다.
3. 그래프·트리·변경분 어디서든 md를 클릭하면 **실제 파일 내용이 열린다**.
4. 에이전트 작업으로 생긴 새 문서를 "보고 → 바로 Ingest"하는 동선.
5. 컨트롤 다이어트: hero 버튼 3 → 1, 중앙 탭 7 → (Knowledge 2모드 + Wiki Gen 검수
   서브탭 5), 상시 3컬럼 → 필요 시 슬라이드 패널.

**비목표 (후속)**
- 그래프 누적 뷰(per-run → 전 run 누적, 날짜별 추가분 필터) — 보류 이력 있음
  (`docs/handoffs/2026-06-12-…` §3). 이번엔 per-run 그래프 유지.
- 세션 로그 기반 "어느 에이전트가 이 파일을 만들었나" 배지(git+세션 결합) — 변경분
  피드는 git만으로 시작.
- 파일 워처 기반 실시간 변경분 — `/mnt/c`에서 워처 불안정(HMR도 미동작하는 환경).
  폴링/수동 갱신으로 시작.
- main 프로세스 파이프라인 로직 변경 — 신규 IPC 2개 외에는 렌더러 재배치만.

## 2. 전체 셸

```
┌──────┬──────────────────────────────────────────────────┐
│ 프로젝트│ [🏠 Home] [📖 Knowledge] [⚙ Wiki Gen ●]   🔎 ⋯ │
│ 레일  │                                                  │
│ (기존)│              탭 콘텐츠                            │
│      │                                                  │
│      ├──────────────────────────────────────────────────┤
│      │ ▲ agents — ●claude ●opencode ●codex   (접힌 독)   │
└──────┴──────────────────────────────────────────────────┘
```

- **탭 3개**: `MainPanel`의 `MainTab`을 `'home' | 'knowledge' | 'wikigen'`으로 교체.
- **글로벌 컨트롤 2개**(탭 줄 우측): `🔎` 검색(Ctrl+K, 기존 SearchModal),
  `⋯` 오버플로우 메뉴(안에 `⭳ Update`). 기존 toolbarActions의 Ingest/Generate는
  각 탭의 컨텍스트 위치로 이동(§3, §5).
- **터미널 독**: 기존 3분할 터미널 유지하되 접이식. 접으면 ~28px 바(`▲ agents` +
  에이전트별 상태 dot). attention(노랑) 상태 dot은 깜빡임. 접힘 상태는
  `localStorage('apc:dockCollapsed')`. **Shift+1/2/3은 접혀 있으면 자동으로 펼치며**
  해당 에이전트 포커스. 터미널 프로세스(xterm 세션)는 접어도 살아 있어야 함 —
  unmount가 아니라 높이 0 처리(키 유지).
- **Wiki Gen 탭 배지**: `harnessLoading`(생성 중)일 때 탭 라벨에 초록 ● 깜빡임.
- 프로젝트 사이드바(레일) 및 Ctrl+1..9, 프로젝트 미선택 placeholder는 기존 그대로.

## 3. 🏠 Home 탭

레이아웃: 좌(1.4) 문서 뷰어 / 우(1) 변경분 피드, 하단 PM strip.

**좌측 문서 뷰어**
- 기본 = 프로젝트 canonical `current.md` 렌더(없으면 "아직 없음 — ✨ 갱신 제안으로
  생성" empty state). 헤더: 파일명 + 마지막 갱신 상대시각 + `✨ 갱신 제안` 버튼.
- `✨ 갱신 제안` = 기존 Generate preflight 모달 흐름 그대로(App.tsx의
  generateModalOpen 블록을 Home으로 이관). Promote 흐름(handlePromote) 유지.
- 변경분 피드에서 파일 클릭 시 이 뷰어가 그 파일로 전환: 헤더가
  `↩ current.md` + 경로 + (미반영 md면) `Ingest now`로 바뀜. md는 렌더,
  코드 파일은 git diff 미리보기(기존 DiffViewer 재사용), 삭제 파일은 안내문.

**우측 변경분 피드**
- 데이터: 신규 `changes:list` IPC(§7). 그룹 3개: **새 문서**(untracked/added md) /
  **수정된 문서**(modified md) / **코드**(나머지). 행 = 상태(+/±/−) + 경로 +
  상대시각(mtime), md 행에는 **미반영 배지**(마지막 ingest 시각보다 mtime이 새로움).
- 헤더: `변경분` + `git · N files` + `Ingest now`(전체 일괄 — 기존 ingest()) + `⟳`.
- 갱신 시점: Home 탭 진입 시 + ⟳ 클릭 + ingest 완료 후. 워처 없음(비목표).

**하단 PM strip**
- 한 줄: 🎯 Goal · 진행률 바(완료/전체 task) · 리뷰 대기 N · "자세히 →".
- "자세히" 클릭 → strip 아래로 기존 `PmHome` 콘텐츠(Timeline/TaskBoard/ReviewQueue)
  펼침(컴포넌트 재사용, 기본 접힘, 상태 persist 불필요).

## 4. 📖 Knowledge 탭 (읽기 전용)

세그먼트 컨트롤 [문서 | 그래프] 두 모드. 생성·run 선택 UI 없음.

**문서 모드**: 좌(0.55) 문서 트리 / 우(1.8) Markdown 뷰어.
- 트리 = 두 그룹: **위키(생성됨)** — 최신 성공 run의 markdown 아티팩트(기존
  MarkdownViewer가 쓰던 소스), **프로젝트 문서** — repoPath의 md 파일 목록
  (`changes:list`와 같은 main-측 스캔 재사용 또는 단순 glob).
- 뷰어 = 기존 MarkdownViewer 렌더 재사용. 위키 링크(`[[…]]`) 클릭 → 트리에서 해당
  문서 열기(기존 handleOpenWikiLink 확장: 아티팩트 매칭 실패 시 `fs:readDoc` 폴백).

**그래프 모드**: 그래프(1.8) + 우측 peek 패널(1, 노드 클릭 시에만).
- 그래프 데이터 = 기존 `buildHarnessGraphData`(최신 성공 run 기준 — run 선택 UI가
  없으므로 "가장 최근 완료 run"을 자동 선택).
- **노드 클릭 → peek 패널에 문서 미리보기**(그래프 탐색 맥락 유지). 해석 순서:
  기존 handleNodeClick 아티팩트 매칭 → 실패 시 노드의 `data.path`로 `fs:readDoc`
  (디스크 직접 읽기) → 그래도 없으면 peek에 "원문 없음: <경로>" 표시.
  **이로써 어떤 문서 노드든 클릭하면 내용이 보인다**(기존 한계 해소).
- peek 헤더: 문서명 + `문서로 열기 ↗`(문서 모드로 전환·트리 선택) + `✕`.
- 코드 파일 노드(file 타입): 미리보기 대신 경로 + 연결된 문서 목록.

## 5. ⚙ Wiki Gen 탭 (생성·검수 전용)

레이아웃: 좌(0.6) 실행 이력 레일 / 우(1.8) run 상세. hero 헤더 없음.

**실행 이력 레일** (기존 HarnessRunList 개편)
- 명칭 "Runs" → **"실행 이력"**. 카드 = runId + 상태 배지(진행 중/리뷰 대기/실패/
  완료) + 모드·상대시각. **`↻ 이어하기`(기존 Resume)는 중단/실패 run 카드에만** 표시.
- 헤더에 단일 실행 버튼 **`▶ 위키 생성 ▾`**: 드롭다운 모드 2개 —
  **전체 문서**(기존 "전 문서로 위키 생성" = startHarnessRun(true), 기본값) /
  **최근 세션**(기존 "Run harness" = startHarnessRun()).
- 접이식 레일 패턴(44px) 기존 유지.

**run 상세** (선택된 run 기준)
- 실행 중: 단계 스테퍼(기존 WikiProgress) + 라이브 로그 tail(기존 harnessLiveTail).
- 완료/리뷰: 검수 서브탭 **요약 | Coverage | Quality | Proposals | Flow**
  (기존 CoverageMatrix/QualityPanel/ProposalsPanel/TaskFlowView 이동. 요약 = 생성
  문서 수·커버리지·품질 한 줄 + run 메타).
- **Promote 영역**: canonical proposals 목록 + Promote 버튼 + (게이트 차단 시)
  `⚠ 검증 무시` — 기존 HarnessDashboard canonical 블록과 AgentConfigPanel의
  Promote/Force/Refresh 버튼을 여기로 통합.

**⚙ 에이전트 설정 = 하니스 구조도** (run 상세 헤더의 버튼으로 여는 슬라이드 패널)
- 기존 AgentConfigPanel(우측 상시 패널)과 AgentConfigEditorPanel(Config 탭)을
  **하나의 슬라이드 패널로 통합**. 평소엔 화면에 없음.
- 패널 = 세로 파이프라인 구조도: 수집(내장) → project-discovery →
  conversation-history → document-intent → node-extractor → wiki-graph-lead →
  🛡 policy-guard(게이트 행) → 인간 리뷰/Promote(staging 안내). 각 에이전트 카드에
  엔진·모델 배지. **카드 클릭 → 패널 하단에서 해당 프롬프트(HarnessAgentPromptKey
  6종)·모델 편집**(기존 updateHarnessPrompt/updateHarnessModel).
- 게이트 행 클릭 → safety(secretScanSensitivity, evidenceRequirement)와 feature-gates
  표시·편집(기존 toggleHarnessGate, 읽기 전용 게이트는 기존 정책대로 라벨만).
- 실행 중 패널을 열면 현재 단계 카드 하이라이트(harnessProgress 상태와 단계 매핑 —
  WikiProgress와 동일 매핑 재사용).

## 6. 기존 → 신규 매핑 요약

| 기존 | 신규 위치 |
| --- | --- |
| 툴바 Ingest now | Home 변경분 피드 헤더(일괄) + 문서 뷰어 헤더(개별) |
| 툴바 ✨ Generate | Home current.md 패널 헤더 `✨ 갱신 제안` |
| 툴바 🔎 Search / ⭳ Update | 글로벌 🔎 / ⋯ 메뉴 안 |
| hero Run harness / 전 문서로 위키 생성 | Wiki Gen `▶ 위키 생성 ▾` 모드 드롭다운 |
| hero Resume | 실행 이력 카드의 `↻ 이어하기`(중단/실패 시만) |
| 중앙 탭 Markdown/Graph | Knowledge [문서|그래프] |
| 중앙 탭 Coverage/Quality/Proposals/Flow | Wiki Gen 검수 서브탭 |
| 중앙 탭 Config + 우측 AgentConfigPanel | Wiki Gen ⚙ 슬라이드 패널(구조도) |
| canonical proposals 블록 | Wiki Gen Promote 영역 |
| PmHome 전체 | Home 하단 strip + "자세히" 펼침 |
| 터미널 3분할 | 동일, 접이식 독으로 |

## 7. 신규 IPC (main 프로세스 — 이번 작업의 백엔드 전부)

1. **`changes:list`** `{ projectId } → { files: { path, status: 'new'|'modified'|'deleted', isMarkdown, mtimeMs, unreflected }[] }`
   - repoPath들에서 `git status --porcelain=v1` 실행 + mtime stat. `unreflected` =
     md이고 mtime > 마지막 ingest 시각. git 저장소가 아니면 `{ ok:false, reason }`.
2. **`fs:readDoc`** `{ projectId, relPath } → { ok, content?, reason? }`
   - **프로젝트 repoPath 내부로 정규화·검증**(realpath 후 prefix 확인 — traversal
     차단), 텍스트/md만, 512KB 상한, 초과·바이너리·부재 시 reason 반환.

둘 다 기존 ipc-contract 패턴(요청/응답 zod 스키마)으로 추가. 파이프라인·서비스 로직
변경 없음.

## 8. 에러 처리

- 변경분: git 미설치/저장소 아님 → 피드 자리에 안내문(Home의 나머지는 정상 동작).
  git 명령 실패는 토스트가 아니라 피드 내 인라인 에러 + ⟳ 재시도.
- `fs:readDoc` 실패 → 뷰어/peek 자리에 인라인 에러(경로 + 사유). 앱 전역 토스트 금지
  (읽기 실패는 국소 문제).
- 생성 파이프라인 에러는 기존 체계 유지: 실패 run 카드 + 이어하기 + `→ full logs:` 경로.
- 터미널 독: 접힌 동안 attention 발생 시 dot 깜빡임이 유일한 신호 — 기존
  agentStatus 콜백 그대로 사용.

## 9. 테스트

- 기존 데스크톱 테스트(20파일/85개)는 컴포넌트 이동에 맞춰 수선(특히
  HarnessPanel/MainPanel/PmHome 테스트의 마운트 지점).
- 신규 단위 테스트:
  1. 변경분 그룹핑·미반영 배지 계산(순수 함수로 분리해 테스트).
  2. `fs:readDoc` 경로 검증(traversal 시도, repoPath 밖, 크기 초과 거부).
  3. 노드 클릭 해석: 아티팩트 매칭 → 디스크 폴백 → 실패 시 placeholder 순서.
  4. 독/탭 상태 persist(localStorage) 및 Shift+1~3의 자동 펼침.
- 검증 절차: `pnpm run typecheck` + vitest green + 실물 Electron(CDP)으로 3탭 전환·
  변경분 클릭→Ingest·노드 클릭→peek·생성 실행→배지·독 접힘을 캡처 확인.
  (`/mnt/c` HMR 미동작 — 렌더러 변경 확인은 `pnpm dev` 재시작 필요.)

## 10. 구현 순서 (각 단계가 독립 동작 가능)

1. **셸**: MainTab 3개 + 글로벌 ⋯ 메뉴 + 터미널 접이식 독. (기존 두 탭 콘텐츠는
   임시로 Knowledge=현 HarnessDashboard, Home=현 PmHome인 채로도 앱이 돌아감)
2. **Wiki Gen 탭**: HarnessDashboard에서 생성·검수·이력·설정을 분리 이전, 버튼 통합
   (`▶ 위키 생성 ▾`), 설정 슬라이드 패널(구조도). — 기존 컴포넌트 이동 위주로 가장 쌈.
3. **Knowledge 탭**: [문서|그래프] + `fs:readDoc` IPC + 노드 peek.
4. **Home 탭**: `changes:list` IPC + 변경분 피드 + 문서 뷰어 전환 + Ingest 동선 +
   PM strip.
5. **마무리**: 구 컴포넌트/CSS 정리, 테스트 수선·신규, 실물 검증.

## 11. 참고

- 브라우저 목업: `.superpowers/brainstorm/5159-1781240570/content/`
  (ia-approaches / shell / home / knowledge / wikigen / wikigen-v2).
- 관련 핸드오프: `docs/handoffs/2026-06-12-config-collapse-node-doc-canonical-toolbar.md`
  (직전 UX 작업 — 이번 설계가 그 접이식 패턴·노드 매칭을 흡수·확장).
