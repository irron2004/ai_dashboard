# Handoff — S3 하네스 구동 + 팀 모드 로드맵 P0~P4 완주

**날짜:** 2026-07-02
**한 줄 상태:** S3(콘솔이 dev 하네스 구동, PR #15)에 이어 제품 진단 후 **팀 모드**(Sonnet 개발 / Opus 계획·리뷰 / Fable 검수)로 로드맵 **P0~P4를 하루에 완주** — PR #16~20 전부 main 머지, CI 5연속 green. 남은 축은 **P5(위키 관리 고도화)**와 follow-up 목록.

---

## 1. 이번 세션이 한 일 (시간순)

| 항목 | 산출물 | 상태 |
|---|---|---|
| SP3 실행 아이콘 | PR #12 머지 | ✅ |
| **S3 — 콘솔이 멀티에이전트 dev 하네스 구동** | PR #15 (DevHarnessCli/DevHarnessService/RunAgent/devHarness IPC/DevHarnessPanel) + opus 통합리뷰 4버그 수정 | ✅ 보고서: `2026-07-01-s3-dev-harness-report.md` |
| superproject/서브모듈 잔여물 정리 | evidence-verifier 픽스·viewer 레이아웃 커밋, 포인터 bump | ✅ |
| **제품 진단** (비전 대비) | `2026-07-02-product-diagnosis-and-roadmap.md` — P0~P5 로드맵 | ✅ |
| **P0 기반** | PR #16 — README·CLAUDE.md·GitHub Actions CI | ✅ |
| **P1 Task 의존성 모델** | PR #17 — blockedBy/차단 badge/blocks 엣지/다음 할 일 | ✅ 리뷰수정 2 |
| **P2 Context Composer** | PR #18 — composeContext/pty 주입/started ack/transcript 뷰 | ✅ 리뷰수정 4 |
| **P3 멀티프로젝트 홈** | PR #19 — buildWorkspaceOverview/🌐 전체 탭/사이드바 뱃지 | ✅ 리뷰 APPROVE 무수정 |
| **P4 status-web** | PR #20 — 읽기전용 원격 상태 서버(`pnpm status-web`) | ✅ 리뷰수정 3(CRITICAL 1) |

계획 문서: `docs/superpowers/plans/2026-07-02-{task-dependencies,context-composer,multiproject-home,status-web}.md` (전부 Opus 작성, 실코드 포함 TDD plan).

## 2. 팀 모드 워크플로 (검증됨 — 재사용 권장)

```
Wave 1: Opus 계획 N개 병렬 (이음새는 오케스트레이터가 계약으로 고정)
Wave 2: Sonnet 구현 (TDD, task별 커밋) — 브랜치별
Wave 3: Opus 리뷰(커밋 SHA 고정 범위, read-only) ∥ 다음 Sonnet 구현(스택 브랜치) 병렬
Wave 4: Sonnet 리뷰수정 → Fable 최종 게이트(전체 스위트 직접 실행) → PR 머지 → CI 확인
```
- 같은 체크아웃 공유 시: 리뷰어는 `git show <sha>:<path>`로만 읽게 강제(워킹트리 신뢰 금지), 구현자는 destructive git 금지.
- 스택 브랜치(P2 on P1, P4 on P3) + append-style 추가로 병합 충돌 0회.
- 리뷰가 잡은 실버그: P1 재인제스트 데이터 소실(HIGH), P2 CRLF frontmatter 유출, P4 **서버 미기동 CRITICAL**(테스트 977개가 못 잡은 무테스트 경로) — 전부 리뷰어가 재현 실증.

## 3. ⚠️ 함정 / 학습

- **vite-node 런처의 argv 함정**: 비-`--script` 모드에서 `process.argv[1]`이 vite-node.mjs로 남음 → `import.meta.url === argv[1]` auto-run 가드는 사장됨. 해법 = 무조건 실행하는 전용 `run.ts` 엔트리 + **런처를 실제 스폰하는 스모크 테스트**. `--script`는 `--config`를 버리므로 금지.
- **`INSERT OR REPLACE` 재클로버 패턴(재발성)**: SP1 재인제스트가 사용자 설정 `blockedBy`를 초기화했음(P1 리뷰). 이 코드베이스에서 upsert에 새 컬럼을 추가하면 **재생성 경로가 기존 값을 보존하는지** 반드시 확인(existingTitle 패턴 미러링).
- **CRLF**: frontmatter/개행 정규식은 항상 `\r?\n`. Windows산 파일이 실사용 입력임.
- **IDE 진단은 계속 오경보**(new module not found 등) — 권위는 `pnpm typecheck`. CLAUDE.md에 문서화됨.
- **CI**: `.github/workflows/ci.yml` — Node 24 + pnpm 9.15.9, 캐시 워밍 후 ~50s. venv/APC_REAL_RUNS 게이트 스위트는 자동 skip.
- **task-deps 헬퍼는 이제 `@apc/dashboard-api`** (renderer 아님 — P3에서 이동).

## 4. 남은 작업

1. **P5 — 위키 관리 고도화**: in-app 편집→re-promote, stale 노드 감지, coin→`prediction` DomainPack 흡수(**coin 잠금 해제 필요** — 사용자 지시 대기).
2. **Follow-up (비차단, 메모리에도 기록)**: pty 주입/붙여넣기 bracketed paste · KnowledgeView가 req: task만 그래프에 올림(todo: blocks 엣지 미표시) · 대시보드 자동 re-fetch(현재 낙관적 오버레이+수동 새로고침) · 사이드바 뱃지는 전체 탭 첫 오픈 전까지 빈값 · status-web TLS 없음(신뢰 LAN 전용, 시작 시 경고) · MainPanel이 프로젝트 선택 시에만 렌더(전체 탭 접근 제약).
3. **superproject 잔여**: coin 내부 미커밋 2건(.gitignore/AGENTS.md — 보류 지시), 미추적 개인 폴더(boardgame/toon/ruahverce vault/_cleanup.bat) — git 관리 여부 사용자 결정 대기.

## 5. 리포/브랜치 상태

- **ai_dashboard** `main` @ `baca170`(PR #20 머지). PR #12·15~20 전부 MERGED. CI green.
- **status-web 사용법**: `docs/status-web.md` — `pnpm status-web -- --db <경로>`, 토큰 자동생성/`APC_STATUS_TOKEN`, 폰 접근은 `--host 0.0.0.0` 옵트인.
- **langgraph-agent**: 미수정(읽기 전용 CLI_CONTRACT seam 유지).
- **ruahverce superproject** `hub` @ `33f1f8a` — 포인터 최신(이 핸드오프 커밋 후 1회 더 bump 필요).
- 세션 메모리: `ai-dashboard-roadmap-progress` — P0~P4 완료 상태 기록됨.
