---
title: 제품 요구사항 반영 현황 진단 (PM Requirements-Coverage Diagnosis)
date: 2026-06-07
status: diagnosis
author: PM (Claude)
baseline-prd: docs/superpowers/specs/2026-06-02-pm-workbench-prd-v0.2.md
technical-ssot: docs/superpowers/specs/2026-06-01-agent-project-console-design.md
branch: docs/knowledge-harness-pipeline-spec
method: PRD 수용 기준 10개 + P0/P1/P2 스코프를 실제 코드(packages/* · apps/desktop)와 1:1 대조. 308 테스트 통과 상태 기준.
---

# 제품 요구사항 반영 현황 진단 (2026-06-07)

## 0. 한 줄 결론

**안전·증거 파이프라인(Knowledge Harness)은 명세를 추월할 만큼 견고하지만, PM이 매일 보는 운영 화면(대시보드 통합·통합검색·하네스 config 적용)이라는 P0 기본기가 뒤처져 있다.** 지금 데모하면 "엔진은 훌륭한데 계기판이 없는 차" 상태다.

---

## 1. 수용 기준(Acceptance Criteria) 스코어카드

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

## 2. 핵심 PM 인사이트 — 깊이/넓이 불균형

이번 브랜치의 엔지니어링 대부분(B1/B2/B3 커밋, 308 테스트)이 **Knowledge Harness 파이프라인 한 곳**에 집중됐다.

### 2.1 과잉 견고 (P1.5~P2급 rigor) — 명세를 추월한 영역

- 11단계 run state machine (`packages/knowledge-harness/src/runtime/run-state-machine.ts`)
- evidence chain 검증 — `EvidenceVerifier`가 raw 소스의 **실제 인용 문자열까지 대조** (`verify/evidence-verifier.ts`)
- claim→evidence 참조 무결성 (parse-level superRefine, `shared/src/kh-schema.ts`, 커밋 a5caeeb)
- 16-rule `SecretScanner` + header-less private-key body 탐지 (`policy/secret-scanner.ts`)
- pre-staging policy gate — vault 쓰기 전에 secret/raw/non-md op 차단 (`runtime/make-drivers.ts:156-177`)
- GraphIntegrity / MarkdownYaml / ObsidianLink validator (`verify/*`)

→ **PRD가 P1으로 잡은 "wiki generation"을 훨씬 넘어선 수준.** 안전성·정직성은 이미 production-grade.

### 2.2 반대로 비어 있는 P0 기본기

- **#2 PM 홈 대시보드** — 제품의 "얼굴"인데 `PmHome`이 메인 뷰(`App.tsx`)에 연결조차 안 됨. PRD가 1순위 성공지표로 꼽은 "프로젝트 상태 가시성"이 사실상 미노출. timeline/milestone/task board 미구현.
- **#8 Harness config diff/validate/apply** — "reviewable automation"(6대 설계원칙 중 하나)인데 read-only에 머묾. config editing의 diff/validate/apply/rollback 전부 없음.
- **#6 통합 검색** — session 인덱스와 knowledge 인덱스가 분리되어 "한 번에 같이 검색" 미충족.

### 2.3 진단

엔지니어링 노력이 **"안전 파이프라인 깊이 파기"에 쏠리고, "PM 운영 화면 넓이 채우기"는 정체**됐다. 다음 사이클의 방향은 깊이 추가가 아니라 **P0 격차 메우기**로 돌리는 것이 제품 가치상 옳다.

---

## 3. 권고 우선순위 (다음 사이클)

| 순위 | 작업 | 수용기준 | 임팩트 / 근거 |
|---|---|---|---|
| 1 | **PM 홈 통합 + task board** | #2 | 가장 큰 단일 격차. `PmHome`을 `App.tsx`에 연결하고 timeline/task board 추가. 데모 가치 즉시 상승 |
| 2 | **Harness config diff/validate/apply** | #8 | "reviewable automation" 원칙 충족. parse는 이미 됨 → diff/validate/apply/snapshot만 얹으면 됨 |
| 3 | **통합 검색(session+knowledge 단일 결과셋)** | #6 | 두 FTS 인덱스를 하나의 SearchResponse로 합치거나 RRF 머지 |

(P1+ wiki 파이프라인은 추가 투자보다 **유지**가 적절 — 이미 명세 초과 달성.)

---

## 4. 참고 — 이 진단의 한계

- 기준은 PRD **v0.2**(product-framing). 기술 SSOT인 `2026-06-01-agent-project-console-design.md`(v0.4)와 세부 명명 차이 존재(예: `HarnessProfile` vs 실제 `AgentProfile`, `WikiPage` 미구현 등). v0.2 배너에 이미 명시됨.
- "부분(⚠️)" 판정은 대부분 **의도된 MVP 정책**(예: #4 staging-only 쓰기)이거나 **미연결/미구현**(#2 PmHome 미와이어, #8 apply 없음)으로 구분됨 — 위 표의 근거 칼럼 참조.
- 코드 대조 시점: branch `docs/knowledge-harness-pipeline-spec`, HEAD `69fd2a4`.
