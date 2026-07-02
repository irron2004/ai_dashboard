# 진단 — ai_dashboard: 비전 대비 현재 상태와 향후 개발 로드맵

**날짜:** 2026-07-02
**기준 커밋:** main @ `a801c56`
**비전(사용자 정의):**
1. 개인 llm-wiki를 **구축부터 관리까지** 하는 툴
2. 여러 프로젝트 동시 진행 시 **전후 작업을 빠르게 파악**하는 화면
3. PM 툴처럼 전후작업을 파악하고 **다음 작업을 LLM에게 빠르게 전달**
4. **원격접속** 가능
5. **여러 프로젝트를 전환**하며 작업
6. 시각화·위키 생성은 autosci-core에서 착안

---

## 1. 현재 구조 (실측)

```
apps/
  desktop      Electron 앱 — 3탭(Home/Knowledge/Wiki Gen) + 프로젝트별 에이전트 dock(pty 터미널)
  graph-web    그래프 전용 웹 뷰어 (브라우저)
packages/ (15개)
  core         ProjectRegistry(domain/repoPaths/ssh)·Db(sqlite)
  pm           TaskStore·AgentRunStore·ReviewService
  knowledge-harness  위키 생성 파이프라인(discovery→extract→verify→graph→HUMAN_REVIEW→promote)
  llm-wiki     엔진 러너(claude/codex/opencode CLI), 로깅
  app-services HarnessService(위키)·DevHarnessService(S3, dev 하네스)·ingest·task-extractor
  graph-view   그래프 데이터 빌더(work↔wiki 포함)
  agents       세션 인제스트 어댑터 + resume 명령
  wiki-substrate  autosci-core 커널 어댑터(PythonKernelAdapter)
  search/vault/harness(config)/workflow/dashboard-api/shared/knowledge
```

핵심 데이터 흐름: 에이전트 세션(~/.claude 등) → ingest → 검색 인덱스 + **SP1 세션→Task 캡처**(req:/todo:) → **SP2 work↔wiki 그래프** → PmHome/KnowledgeView. 위키는 HarnessService가 소스 materialize→LLM 파이프라인→HUMAN_REVIEW→promote→`<repo>/.apc-wiki`+`wiki/` export. **S3(어제 머지)**로 콘솔이 dev 하네스를 직접 구동.

---

## 2. 비전 대비 진단

| # | 비전 | 상태 | 근거 |
|---|---|---|---|
| 1 | llm-wiki **구축** | 🟢 강함 | 파이프라인 완성: materialize(로컬+ssh)→추출→증거검증→그래프→인간승인→promote→export. 정책(propose/approve), 멱등 ledger, 도메인팩(project-docs/paper) |
| 1' | llm-wiki **관리** | 🟡 반쪽 | promote/정책/canonical 충돌관리 있음. 그러나 **in-app 편집·버전롤백·stale 노드 감지 없음** — promote 이후 큐레이션은 파일 직접 수정 |
| 2 | 전후 작업 빠른 파악 | 🟡 반쪽 | SP1 캡처+SP2 그래프+TimelineStrip은 있으나 **task 간 선행/후행(dependency) 모델 자체가 없음**(parentTaskId=요청→todo 계층뿐). "전후"를 그릴 데이터가 없다 |
| 3 | 다음 작업 → LLM 전달 | 🟡 반쪽 | S3로 task→하네스 run 가능, dock 터미널+resume 있음. 그러나 **task의 컨텍스트(제목·AC·linked wiki·직전 세션 요약)를 프롬프트로 조립해 주입하는 flow 없음**. `contextPackage`는 sessionId 문자열뿐 |
| 4 | 원격접속 | 🟠 절반 미만 | **ssh:// 프로젝트**(원격 저장소의 문서·대화 fetch, 원격 엔진 실행, workspace vault push/pull)는 잘 됨. 그러나 **대시보드 자체는 Electron 전용** — 폰/다른 PC에서 상태 확인 불가(graph-web은 그래프만) |
| 5 | 프로젝트 전환 작업 | 🟢 강함 | ProjectSidebar + 프로젝트별 dock 유지(MAX_KEPT_DOCKS) + pane 복원 + SP3 ▶/⏹ |
| 6 | autosci-core 착안 | 🟢 완료 | wiki-substrate 어댑터, paper 도메인, edges.jsonl 그래프 — 계약 기반으로 잘 격리됨 |

### 구조적 문제 (기능 외)
- **문서화 공백**: README가 제목 1줄. **CLAUDE.md 부재**(리뷰 에이전트도 확인) → 새 세션/협업자의 온보딩 비용이 매번 발생. 이 규모(15패키지)에서 가장 싼 고효율 투자.
- **CI 부재**: PR checks가 비어 있음. 회귀 방어가 "로컬에서 pnpm test 돌렸는가"에 의존 — SP1 회귀가 실제로 이렇게 새어나갔던 전력.
- **DB 단일 로컬 sqlite**: task/run 기록이 기기 종속. workspace vault는 위키만 동기화 — 원격접속 비전과 충돌하는 지점.
- **dev-run 가시성**: S3 run 이력은 `agent_runs`에 쌓이나 PmHome recentRuns 리스트뿐, transcript 열람 UI 없음. run 시작 ack 부재(S3 리뷰 follow-up).

---

## 3. 개선점 (우선순위)

1. **Task 의존성 모델** — `blockedBy: string[]` 한 필드 추가가 비전 2·3의 뿌리. 이것 없이는 "전후 파악"도 "다음 작업 선정"도 그래프가 아니라 사람 머리에 있음.
2. **Context Package Composer** — task 선택 → {제목, 수용기준, linkedWikiPages 발췌, 직전 세션 요약} 조립 → ① dock 터미널에 주입 or ② DevHarness run 인자로. "PM이 다음 작업을 LLM에게 전달"의 실체.
3. **크로스 프로젝트 홈** — 전 프로젝트의 {진행중 task, 실행중 run, 리뷰 대기}를 한 화면에. 현재는 전부 선택 프로젝트 단위.
4. **읽기전용 웹 대시보드** — dashboard-api를 HTTP로 노출(graph-web 패턴 재사용) → 폰/원격에서 상태 확인. 쓰기(승인/실행)는 후속.
5. **README + CLAUDE.md + CI** — 즉시, 저비용.
6. **위키 관리 루프** — in-app 편집→re-promote, stale 감지(소스 변경 후 미갱신 노드 표시).

## 4. 향후 개발 Plan (단계별)

| Phase | 내용 | 산출물 | 난이도 |
|---|---|---|---|
| **P0 기반** (즉시) | README·CLAUDE.md 작성, GitHub Actions CI(test+typecheck) | 문서 2 + workflow 1 | 하 |
| **P1 전후관계** | Task `blockedBy` 스키마+store+IPC → TaskBoard 차단표시 → SP2 그래프에 task→task 엣지 → "다음 할 일"(unblocked 최우선) 위젯 | 의존성 모델 end-to-end | 중 |
| **P2 LLM 핸드오프** | Context Package Composer(조립기+미리보기) → dock 주입(pty write)+DevHarness 연동, run 시작 ack·dev-run transcript 뷰 | task→prompt→agent 원클릭 | 중 |
| **P3 멀티프로젝트 홈** | 전 프로젝트 집계 API(dashboard-api 확장)+홈 화면, 프로젝트 뱃지(실행중/리뷰대기) | cross-project overview | 중 |
| **P4 원격 대시보드** | dashboard-api HTTP 서버(읽기전용, 토큰 인증)+웹 UI(graph-web 확장), 이후 승인/실행 액션 | 폰에서 상태 확인 | 중상 |
| **P5 위키 관리 고도화** | in-app 편집+re-promote, stale 노드 감지, coin→`prediction` 도메인 등 흡수 확대 | 위키 수명주기 완결 | 상 |

**추천 순서: P0 → P1 → P2.** P1·P2가 "PM 대시보드" 비전의 심장이고, P0는 반나절 비용으로 이후 모든 작업의 안전망. P3~P5는 각각 독립 spec으로 진행(기존 SDD 흐름).

---

## 5. 참고 — 잘 되어 있는 것 (유지)
- 계약 기반 격리: CLI_CONTRACT seam(S3), wiki-substrate 어댑터, DomainPack — 확장축이 전부 계약으로 열려 있음.
- 멱등성 습관: req:/todo: id, INSERT OR REPLACE+reconcile, sourceLedger.
- 테스트 문화: 173 파일/900 테스트, vitest workspace로 apps까지 커버(어제 수리).
- ssh 프로젝트 1급 지원: 원격 소스·대화·엔진·vault 전부 원격 기준으로 동작.
