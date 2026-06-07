---
title: 제품 요구사항 반영 현황 종합 진단 (PM Status & Requirements-Coverage Diagnosis)
date: 2026-06-07
status: diagnosis
author: PM (Claude)
baseline-prd: docs/superpowers/specs/2026-06-02-pm-workbench-prd-v0.2.md
technical-ssot: docs/superpowers/specs/2026-06-01-agent-project-console-design.md
branch: docs/knowledge-harness-pipeline-spec
git-position: main 대비 +108 commits, -0 (아직 main 머지 전), HEAD e34d6c1
method: 빌드 트랙(Plan/Phase) 진척 + PRD 수용 기준 10개 + P0/P1/P2 스코프를 실제 코드(packages/* · apps/desktop)와 1:1 대조. 308 테스트 통과 상태 기준.
---

# 제품 요구사항 반영 현황 종합 진단 (2026-06-07)

## 0. 한 줄 결론

**빌드 트랙(Plan 1–6 · KH Phase 2–4 · B2/B3)은 거의 전부 ✅ 완료지만, 그 "완료"의 스코프가 좁아 제품 수용기준(AC) 레벨에서는 4개 격차가 남는다.** 안전·증거 파이프라인(Knowledge Harness)은 명세를 추월할 만큼 견고한 반면, PM이 매일 보는 운영 화면(대시보드 통합·통합검색·하네스 config 적용)이라는 P0 기본기가 뒤처져 있다. 지금 데모하면 "엔진은 훌륭한데 계기판이 없는 차" 상태다.

---

## 1. 빌드 트랙 진척 (Plan / Phase 완료 현황)

프로토타입(Electron)을 목표로 한 Plan/Phase별 산출물 기준. 각 Plan은 자기 스코프 산출물을 인도함.

| 트랙 | 산출물 | 상태 |
|---|---|---|
| **Plan 1 — Foundation** | monorepo, `@apc/shared`(Zod), `@apc/core`(SQLite), `@apc/vault`(Obsidian), `@apc/workflow` | ✅ 완료 |
| **Plan 2 — Ingest Engine** | Claude/Codex/OpenCode 어댑터 → `NormalizedSession`, 증분 ingest, secret redaction, FTS5 | ✅ 완료 |
| **Plan 3 — LLM Wiki Engine** | `AgentRunner`, structured-output 파싱, `WikiEngine` | ✅ 완료 |
| **Plan 4 — PM Domain** | `Task`/`AgentRun`/`Review` store, review lifecycle, vault writer | ✅ 완료 |
| **Plan 5 — Harness Studio** | `OpenCodeConfigAdapter`, `AgentProfile` (parse/read 한정) | ✅ 완료 (read-only 스코프) |
| **Plan 6 — Electron UI** | 12-state machine, feature gate, artifact store, run lock, `HarnessRunner` UI | 🚧 거의 완료 (unstaged 변경 진행 중) |
| **KH Phase 2 — LLM Agents** | 6개 agent driver + `StagingVault` + `makeDrivers` | ✅ 완료 |
| **KH Phase 3 — Safety Net** | `PolicyGuard`, `SecretScanner`, `GraphIntegrity`, validators, `EvalReport` | ✅ 완료 |
| **KH Phase 4 — 화면(CLI+Service)** | `HarnessService`, `HarnessPromoteService`, CLI bin, 데스크톱 IPC 3채널 | ✅ 완료 |
| **B2 — Feature gate single-source** | single-source feature gates(`@apc/shared`) + drift guard | ✅ 완료 |
| **B3 — Safety Gates** | pre-staging 차단, op 본문 secret 스캔, evidence verify | ✅ 완료 |

> **빌드 트랙 요약:** Foundation부터 Knowledge Harness Phase 4까지 구현 완료. 실제 CLI LLM 연결(production `CliAgentRunner`)·agent 버전 서비스도 Phase 4에서 완료. 픽셀 단위 UI 마감은 진행 중(아래 §4 unstaged 변경).

---

## 2. 수용 기준(Acceptance Criteria) 스코어카드

PRD v0.2 §Acceptance criteria 10개 항목 기준. 모두 실제 코드로 대조함.

| # | 요구사항 | 상태 | 근거 / 격차 (file refs) |
|---|---|---|---|
| 1 | 한 창에서 여러 프로젝트 전환 | ✅ 완료 | `apps/desktop/src/renderer/components/ProjectSidebar.tsx` (추가/편집/삭제/SSH), `App.tsx:120` Ctrl+1–9 |
| 2 | 프로젝트가 goal/focus/task board/review queue/recent sessions 표시 | ⚠️ 부분 (가장 약함) | `PmHome.tsx`가 goal/tasks/review/runs는 렌더하지만 **timeline·milestone·진짜 task board 없음**, 그리고 **App.tsx에 연결조차 안 됨** (HarnessDashboard가 대신 표시됨) |
| 3 | Claude/Codex/OpenCode live session | ✅ 완료 | `AgentTerminal.tsx` 실제 xterm+PTY, 3탭, Shift+1/2/3, `main/pty-manager.ts` |
| 4 | 세션 종료 후 ingest → session md + wiki page | ⚠️ 부분 | session md ingest는 3개 어댑터 모두 실제 동작(`packages/agents/src/{claude,codex,opencode}-adapter.ts`). wiki page는 **staging vault에만** 생성되고 실제 vault는 human promotion 전까지 안 건드림 (MVP 의도된 정책) |
| 5 | Obsidian 호환 문서 | ✅ 완료 | `packages/vault/src/vault-adapter.ts` frontmatter(gray-matter) + `[[wiki-link]]` 추출 + golden test |
| 6 | P0 검색이 task/wiki/session **함께** 반환 | ⚠️ 부분/분리됨 | `packages/knowledge/src/retrieval.ts`(BM25)는 task/wiki/decision 등 혼합 반환. 그러나 **session 검색은 별도 FTS5 인덱스(`packages/search/src/search-index.ts`)** — 한 결과셋으로 통합 안 됨 |
| 7 | 충돌 시 덮어쓰지 않고 conflict 문서 | ✅ 완료 | `packages/core/src/conflict-manager.ts` + `app-services/src/current-promotion-service.ts` → `conflicts/<stamp>-current-conflict.md` |
| 8 | Harness Studio가 1개 provider parse/diff/validate/apply | ⚠️ 미달 | OpenCode **parse만** 됨(`packages/harness/src/opencode-config-adapter.ts`). adapter 인터페이스가 `discoverProfiles()`뿐 — **diff/validate/apply/rollback 전부 미구현** |
| 9 | task에 harness profile attach | ✅ 완료 | `packages/harness/src/task-profile-store.ts` `select/get` 테스트됨, UI `HarnessPanel` "Use" |
| 10 | renderer는 preload bridge/BFF로만 main 접근 | ✅ 완료 | `preload/index.ts` `contextBridge` + `shared/ipc-contract.ts` SSOT |

**집계: 10개 중 6개 완료 ✅ / 4개 부분·미달 ⚠️ (#2, #4, #6, #8)**

---

## 3. 두 관점의 화해 — 왜 "빌드 ✅"인데 "AC ⚠️"인가

빌드 트랙은 거의 모두 ✅인데 수용기준은 4개가 ⚠️인 게 모순처럼 보이지만 아니다. **각 Plan/Phase가 자기 스코프 산출물은 인도했으나, 그 스코프가 PRD 제품 레벨보다 좁게 잡혔기 때문**이다.

| AC 격차 | 대응 빌드 트랙 | 스코프가 좁았던 지점 |
|---|---|---|
| #2 PM 홈 통합 | Plan 6 (Electron UI) | UI가 `HarnessRunner` 중심으로 구현 → `PmHome`은 만들어졌지만 메인 뷰에 미연결, task board/timeline 미포함 |
| #4 wiki 자동 적용 | KH Phase 2/4 | staging-only 쓰기 = **의도된 MVP 정책** (안전 우선). 자동 promote는 스코프 밖 |
| #6 통합 검색 | Plan 2 + KH | session 인덱스(Plan2)와 knowledge 인덱스(KH)가 따로 진화 → 통합 결과셋은 누구 스코프도 아니었음 |
| #8 하네스 apply | Plan 5 (Harness Studio) | "read-only parse"만 스코프로 인도 → diff/validate/apply는 P1로 미루어짐 |

→ 즉 **#4는 의도된 정책(정상)**, **#2·#6·#8은 스코프 누락(메워야 할 P0 격차)**.

---

## 4. 현재 git / 운영 상태

- **브랜치:** `docs/knowledge-harness-pipeline-spec`, main 대비 **+108 / -0** → 아직 main 머지 전.
- **워크트리:** 추가 워크트리 없음 (메인 워크트리 1개).
- **unstaged 변경 10파일** (= "픽셀 UI 진행 중", Plan 6 마감):
  - `apps/desktop/src/main/{container.ts, ipc.ts, ipc.test.ts}`
  - `apps/desktop/src/renderer/{App.tsx, api.ts, app.css, store.ts}`
  - `apps/desktop/src/shared/ipc-contract.ts`
  - `packages/app-services/src/{generate-service.ts, generate-service.test.ts}`
- **결정 필요:** 이 unstaged 변경분을 **merge(커밋) / revert / 별도 stage**할지 PM 판단 필요. PR을 열기 전에 정리할 것.

### 최근 구현 단위(참고)

- `PolicyGuard` 검사 확장: non-markdown op, op 본문 내 secret 차단.
- `STAGING_WRITTEN` driver가 `writer.apply` **이전**에 구조적 검증을 수행하도록 배치 — vault 쓰기 전 차단 보장.

---

## 5. 핵심 PM 인사이트 — 깊이/넓이 불균형

이번 브랜치 엔지니어링 대부분(B1/B2/B3, 308 테스트)이 **Knowledge Harness 파이프라인 한 곳**에 집중됐다.

### 5.1 과잉 견고 (P1.5~P2급 rigor) — 명세를 추월한 영역

- 11단계 run state machine (`packages/knowledge-harness/src/runtime/run-state-machine.ts`)
- evidence chain 검증 — `EvidenceVerifier`가 raw 소스의 **실제 인용 문자열까지 대조** (`verify/evidence-verifier.ts`)
- claim→evidence 참조 무결성 (parse-level superRefine, `shared/src/kh-schema.ts`, 커밋 a5caeeb)
- 16-rule `SecretScanner` + header-less private-key body 탐지 (`policy/secret-scanner.ts`)
- pre-staging policy gate — vault 쓰기 전 secret/raw/non-md op 차단 (`runtime/make-drivers.ts:156-177`)
- GraphIntegrity / MarkdownYaml / ObsidianLink validator (`verify/*`)

→ **PRD가 P1으로 잡은 "wiki generation"을 훨씬 넘어선 수준.** 안전성·정직성은 이미 production-grade.

### 5.2 반대로 비어 있는 P0 기본기

- **#2 PM 홈 대시보드** — 제품의 "얼굴"인데 `PmHome`이 메인 뷰에 미연결. PRD 1순위 성공지표 "프로젝트 상태 가시성"이 사실상 미노출.
- **#8 Harness config diff/validate/apply** — "reviewable automation"(6대 설계원칙 중 하나)인데 read-only에 머묾.
- **#6 통합 검색** — session/knowledge 인덱스 분리로 "한 번에 같이 검색" 미충족.

---

## 6. 권고 우선순위 (다음 사이클)

| 순위 | 작업 | 수용기준 | 임팩트 / 근거 |
|---|---|---|---|
| 0 | **unstaged 변경분 정리 + main 머지 결정** | 운영 | +108 커밋 브랜치를 PR로 닫고 baseline 확정해야 다음 작업이 깔끔 |
| 1 | **PM 홈 통합 + task board** | #2 | 가장 큰 단일 격차. `PmHome`을 `App.tsx`에 연결하고 timeline/task board 추가. 데모 가치 즉시 상승 |
| 2 | **Harness config diff/validate/apply** | #8 | "reviewable automation" 원칙 충족. parse는 이미 됨 → diff/validate/apply/snapshot만 얹으면 됨 |
| 3 | **통합 검색(session+knowledge 단일 결과셋)** | #6 | 두 FTS 인덱스를 하나의 SearchResponse로 합치거나 RRF 머지 |

(P1+ wiki 파이프라인은 추가 투자보다 **유지**가 적절 — 이미 명세 초과 달성.)

---

## 7. 참고 — 이 진단의 한계

- 기준은 PRD **v0.2**(product-framing). 기술 SSOT인 `2026-06-01-agent-project-console-design.md`(v0.4)와 세부 명명 차이 존재(예: `HarnessProfile` vs 실제 `AgentProfile`, `WikiPage` 미구현 등). v0.2 배너에 이미 명시됨.
- PM 도메인(`@apc/pm`)은 Plan 4 스코프까지만 반영 — PRD v0.2 전체 기능 대비 일부는 미구현/미실증.
- "부분(⚠️)" 판정은 **의도된 MVP 정책**(예: #4 staging-only)과 **미연결/미구현**(#2 PmHome 미와이어, #8 apply 없음)을 §3에서 구분함.
- 코드 대조 시점: branch `docs/knowledge-harness-pipeline-spec`, HEAD `e34d6c1`.
