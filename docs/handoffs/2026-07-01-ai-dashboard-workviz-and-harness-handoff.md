# Handoff — ai_dashboard 고도화: 작업-시각화 기능 + 하네스 통합

**날짜:** 2026-07-01
**한 줄 상태:** 4개 메인 프로젝트(coin/calc/blog/ai_dashboard)를 ai_dashboard로 흡수하는 두 프로그램이 진행 중 — **작업-시각화 기능**(SP1·SP2 main 병합, SP3 PR 대기)과 **하네스 통합**(S1 완료·main 병합, S2 지침 임베드, S3 미착수).

이 세션은 전부 brainstorming → spec → writing-plans → subagent-driven(+병렬) → 리뷰 게이트 → finishing 흐름으로 진행. 각 spec/plan은 `docs/superpowers/{specs,plans}/2026-06-30-*`.

---

## 1. 두 프로그램의 큰 그림

전체 지도: `docs/superpowers/specs/2026-06-30-multi-project-integration-map.md`.
ai_dashboard("agent-project-console")는 이미 흡수 substrate를 가짐 — `ProjectRegistry`(domain/repoPaths/vaultPaths/sourcePaths), DomainPack(`project-docs`|`paper`), `app-services`(harness/ingest/knowledge), `graph-view`, `pm`(TaskStore/AgentRunStore), `apps/desktop`(Electron).

### A. 작업-시각화 기능 (사용자 실워크플로 기반)
사용자는 프로젝트마다 병렬 에이전트 패널(Claude Code/OpenCode)로 일함. 니즈 = ① 빠른 전환/실행 ② 이전 요청+남은 작업을 **작업↔위키 그래프**로 시각화. SP1/SP2/SP3로 분해:

- **SP3 — 에이전트 dock ▶/⏹ 실행 아이콘** · **PR #12 OPEN(미병합)**. dock 헤더에 시작/재시작/중지 아이콘(store `restartNonce`/`restartAgent`/`stopAgent`, AgentTerminal 재spawn, AgentDockHeader, ⏹→idle 가드). spec/plan `…-agent-launch-icon*`.
- **SP1 — 세션→Task 자동 캡처** · **MERGED (PR #13, main)**. ingest 파이프라인에서 세션을 Task로: 요청-Task 1개(LLM 요약 제목) + todo-Task N개(최신 TodoWrite, 상태 매핑, 자식). `pm/TaskStore.delete`, `app-services/{task-extractor,session-summarizer}`, `IngestService.onSessionParsed` 훅, container 배선. 멱등(`req:`/`todo:` id + INSERT OR REPLACE + reconcile). spec/plan `…-session-task-capture*`.
- **SP2 — 작업↔위키 그래프 뷰** · **MERGED (PR #14, main)**. KnowledgeView **'Work' 그래프 소스**: 요청-Task 노드 + 세션이 **실제 편집한 위키 파일**에 work→wiki 엣지(`filesTouched` ⊇ wiki `relPath` suffix), 노드 클릭 시 todos. `extractTasks.linkedWikiPages=filesTouched`, graph-view `buildWorkGraphData`, `tasksList` IPC. spec/plan `…-work-wiki-graph*`.

### B. 하네스 통합 (S1/S2/S3)
spec/plan `…-harness-core-submodule-consolidation*`.
- **S1 — langgraph-agent를 canonical 공유 하네스 submodule로 정식화** · **완료, langgraph-agent main @ `5d1aa2f`**. coin/calc/sns_blog의 `agents/`가 사실 `irron2004/langgraph-agent`의 느슨한 clone이었음 → calc를 핀된 submodule로 전환(calc `origin/main`에 커밋). **주의:** langgraph-agent origin/main이 3개월 묵은 RED였음(드리프트 커밋이 `parse_qa_result`/`DEFAULT_WRITER_TEMPLATE` 드롭) → green인 f46638d 라인을 force-push로 main 교체(옛 커밋 304c1d0/3dbd9d5 SHA로 복구 가능). 엔진에 `.harness/graph_profiles.json` 오버레이 + `CLI_CONTRACT.md`(S3 seam) 추가.
- **S2 — 나머지 프로젝트 마이그레이션** · **각 프로젝트에 지침 임베드(로컬 커밋, unpushed)**. coin(`feature/stockview-screen` ca187ee), sns_blog(`master` d96ed36), english_egg(`main` e2ab1e0)에 `HARNESS_SUBMODULE_MIGRATION.md` + CLAUDE.md 포인터. coin=클린 전환, sns_blog=stale master+22 salvage, english_egg=icme 계보라 "채택 여부 결정".
- **S3 — 콘솔이 하네스 구동** · **미착수**. ai_dashboard `harness-service`에 dev-오케스트레이션 모드 추가 → `CLI_CONTRACT.md` seam shell-out + `pm` AgentRunStore 기록 + 로그 스트리밍.

---

## 2. 남은 작업 (우선순위)

1. **SP3 PR #12 머지** — 사용자가 push+PR(option 2)로 열어둠. 머지하면 실행 아이콘 반영.
2. **S3 (콘솔이 하네스 구동)** — SP1이 세션을 Task로 캡처하고 SP2가 그래프로 보여주니, 이제 콘솔에서 하네스 run을 *띄우는* S3가 다음 자연스러운 축. CLI 계약은 langgraph-agent `CLI_CONTRACT.md`에 정의됨.
3. **S2 마이그레이션** — coin/sns_blog 열면 임베드된 지침이 떠서 진행(coin이 최저 난이도).
4. **나머지 통합 축**: coin→`prediction` DomainPack(autosci 네이티브, 최저 난이도) · calc→폴더MD+graph.json→substrate 어댑터 · blog(irron2004/blog, Astro/`.claude/skills`)→knowledge/토픽 그래프.
5. **SP 후속(non-blocking)**: SP2 `touchedWikiNode` 내부 구분자 정규화(네이티브 Windows 백슬래시 — WSL2엔 무관) · SP2 todo 노드화/라이브/graph-web 'work' 소스 · SP1 slug 충돌 시 near-dup todo 드롭 · SP1 onSessionParsed catch 무로그.

---

## 3. ⚠️ 함정 / 학습 (다음 세션이 알아야 할 것)

- **루트 `pnpm test`는 `apps/**`를 제외**(include=`packages/**`, `scripts/**`). **apps/desktop 테스트는 `apps/desktop`에서 `npx vitest run`으로 따로 돌려야 함.** 이걸 몰라 SP1이 ingest 경로에 넣은 LLM summarize가 `c:ingestAll` ipc 테스트를 타임아웃시키는 회귀를 검증에서 놓쳐 main에 병합됨(SP2에서 발견·수정). **인프라 개선 후보: 루트 test에 apps/ 포함 또는 CI가 양쪽 다 실행.**
- **typecheck 권위:** 이 레포의 IDE `<new-diagnostics>`는 자주 오경보(잘못된 tsconfig로 `@xterm`/`@apc/*`/`node:sqlite` 등을 not-found 처리). 권위 = 루트 `pnpm typecheck`(또는 `tsc -p apps/desktop/tsconfig.json`).
- **langgraph-agent main을 force-push로 교체**했음(S1). coin/calc는 f46638d(ancestor)라 ff 무손실. 옛 main(3dbd9d5) 커밋은 SHA로 복구 가능. langgraph-agent는 CRLF/LF 혼재 이력 있음 — submodule 전환 시 EOL 주의.
- **Task id 규약(SP1/SP2):** 요청 `req:${projectId}:${sessionId}` · todo `todo:${projectId}:${sessionId}:${slug(content)}`. `contextPackage`=sessionId. 요청-Task status는 자식 todo 파생(미완 있으면 in_progress).
- **work→wiki 엣지 의미:** 세션이 *실제로 그 위키 파일을 편집*했을 때만(filesTouched suffix-match relPath). 소스코드만 만진 작업은 isolated 노드.

---

## 4. 리포/브랜치 상태

- **ai_dashboard** (`irron2004/ai_dashboard`): `main` @ `d09ebdf`(SP1+SP2 병합). SP3 = PR #12 open. 로컬 클론은 병합된 feature 브랜치에 머물 수 있음 → `git checkout main && git pull`로 동기화.
- **langgraph-agent** (`irron2004/langgraph-agent`): `main` @ `5d1aa2f`(green canonical).
- **calc** (`irron2004/calculate_math`): `main` @ `62fcff7`(agents submodule 전환 + 사용자 curriculum 작업, push됨).
- **coin/sns_blog/english_egg**: S2 지침 로컬 커밋(unpushed).
- **ruahverce superproject**: submodule 포인터(coin/ai_dashboard-main 등)는 아직 옛 커밋 — 필요 시 별도 갱신.
- 진행 ledger: `<repo>/.superpowers/sdd/progress.md`(gitignore 스크래치).
