---
title: 전 문서 → 위키 원클릭 + 커버리지(누락) 검증 설계
date: 2026-06-08
status: design-approved
author: PM (Claude)
relates-to:
  - docs/superpowers/specs/2026-06-07-product-requirements-coverage-diagnosis.md (후속 제품 방향)
  - memory/docs-to-wiki-harness-goal.md (사용자 핵심 목표)
branch: docs/knowledge-harness-pipeline-spec (또는 신규 feature 브랜치)
approach: A — 프로젝트 문서를 vault/raw/project-docs/로 materialize한 뒤, 기존 Knowledge Harness 파이프라인 위에 커버리지(문서→노드) 검증 UI를 올린다.
---

# 전 문서 → 위키 원클릭 + 커버리지 검증

## 1. 배경 / 문제

사용자 핵심 목표: **프로젝트 하위 경로의 모든 문서를 LLM 위키로 정리하고, 버튼 한 번으로 실행하며, "빠진 문서가 없는지(누락)"를 한 화면에서 검증**한다.

탐색으로 확인한 현 상태(파일 근거):
- Knowledge Harness 파이프라인(9단계)은 견고하나, **소스 입력 `vault/raw/`를 읽기만 하고 채우는 코드가 없다** (`packages/knowledge-harness/src/runtime/source-reader.ts:19-32`이 `vaultRoot/raw/`를 재귀로 읽음; 채우는 주체 없음).
- `eval-report`는 커버리지 **숫자**(`raw_sources_total / raw_sources_classified / unmapped_sources`)만 계산하고, **어떤 문서가 어떤 노드에 반영됐는지의 매핑은 없다** (`packages/knowledge-harness/src/eval/eval-report.ts`).
- 노드 제안은 근거로 원본 문서를 인용한다(`source_path`), 그리고 `EvidenceVerifier`가 그 인용을 `raw/` 파일과 대조한다 (`packages/knowledge-harness/src/verify/evidence-verifier.ts`).
- 모든 중간 산출물은 IPC로 조회 가능 (`HarnessGetRunRes.artifacts`, `apps/desktop/src/shared/ipc-contract.ts:86-87`).

**결론:** 엔진은 있다. 빠진 것은 ① 프로젝트 문서를 소스로 **모아오는 단계**, ② 문서↔노드 **매핑(커버리지) 데이터**, ③ 그걸 보여주는 **검증 화면**, ④ 셋을 잇는 **원클릭**이다.

## 2. 설계 결정 (확정)

| 항목 | 결정 |
|---|---|
| 소스 확보 | **A안** — 프로젝트 문서를 `vault/raw/project-docs/`로 복사(materialize). 기존 raw/·evidence-verifier 모델 그대로 재사용 |
| "반영됨" 정의 | 어떤 위키 노드가 그 문서를 **근거로 1개 이상 인용**하면 covered |
| "누락" 정의 | 아무 노드도 인용하지 않은 소스 문서 = unmapped(위키 미반영) |
| 1차 검증 화면 | **커버리지 매트릭스**(왼쪽 원본 문서 → 오른쪽 위키 노드, 누락 빨강 표시) |
| 트리거 | 원클릭 "전 문서로 위키 생성" = materialize → 기존 run → Coverage 화면 |

## 3. 아키텍처 / 데이터 흐름

```
[버튼] ──▶ harnessRun({ materialize: true })
            │
            ├─0  SourceMaterializer.run(repoPaths, vaultRoot)
            │      → vault/raw/project-docs/<rel> 복사 + manifest
            │
            ├─1..8  기존 HarnessRunner (9단계 파이프라인, 변경 최소)
            │      SOURCES_EXTRACTED에서 raw/ 전체를 sources로 읽음(기존)
            │
            └─끝  buildCoverageReport(sources, nodeProposals)
                   → 'coverage-report' artifact emit
                          │
[UI] HarnessDashboard ──▶ harnessGetRun → artifacts['coverage-report']
        └─ 새 "Coverage" 탭: CoverageMatrix 렌더 (문서→노드, 누락 목록)
```

- **새 IPC 채널 없음.** `HarnessRunReq`에 `materialize?: boolean` 옵션 1개만 추가(additive).
- **DB migration 없음.** 산출물은 기존 artifact 메커니즘(파일 + `HarnessGetRunRes.artifacts`)으로 흐름.

## 4. 컴포넌트

### 4.1 `SourceMaterializer` (신규, backend)
- 위치: `packages/app-services/src/source-materializer.ts` (project registry + vaultRoot 접근이 있는 계층).
- 입력: `repoPaths: string[]`, `vaultRoot: string`.
- 동작:
  1. 각 repoPath를 **재귀 스캔**(기존 `vault-fs.ts`의 readdir 재사용 가능).
  2. 문서 확장자만: `.md`, `.markdown`, `.txt`.
  3. **제외 디렉터리**: `node_modules`, `.git`, `dist`, `build`, `.worktrees`, 그리고 `vaultRoot` 자기 자신(위키를 다시 소스로 빨아들이지 않도록).
  4. 대상 위치: `<vaultRoot>/raw/project-docs/<repo-index>/<relative-path>` 로 복사.
  5. **멱등**: `raw/project-docs/`를 **먼저 비우고** 다시 채움(삭제된 문서가 사라지도록). `raw/` 의 다른 하위(사용자 수동 소스)는 건드리지 않음.
- 출력: `MaterializeManifest = { files: Array<{ rel: string; bytes: number }>; scanned: number; skipped: string[] }`.
- 안전: PolicyGuard의 raw/ 쓰기 차단은 **LLM writer**에 대한 것이고, 이 materializer는 신뢰된 외부 적재 프로세스이므로 정책과 충돌하지 않음(문서로 명시).

### 4.2 커버리지 데이터 (`coverage-report`, 신규)
- 스키마: `@apc/shared`에 `KhCoverageReportSchema` 추가.
  ```ts
  CoverageReport = {
    sources: Array<{ path: string; status: 'covered' | 'unmapped'; citedBy: string[] /* node ids */ }>
    nodes:   Array<{ id: string; title: string; cites: string[] /* source paths */ }>
    totals:  { sourcesTotal: number; covered: number; unmapped: number }
  }
  ```
- 빌더: `packages/knowledge-harness/src/eval/coverage-report.ts` — **순수 함수** `buildCoverageReport(sourcePaths: string[], nodeProposals): CoverageReport`.
  - 입력 `sourcePaths` = 그 run이 실제로 읽은 raw/ 소스 목록(이미 SOURCES_EXTRACTED에서 확보).
  - 각 노드 proposal의 evidence `source_path`를 모아 source→nodes 역매핑.
  - 어떤 노드도 인용하지 않은 source = `unmapped`.
- emit 위치: `HUMAN_REVIEW_REQUIRED` 드라이버에서 `eval-report` 옆에 `coverage-report` artifact로 추가 (`make-drivers.ts`).

### 4.3 IPC / 서비스 변경 (최소)
- `apps/desktop/src/shared/ipc-contract.ts`: `HarnessRunReq = { projectId; engine; materialize?: boolean }`.
- `packages/app-services/src/harness-service.ts`: `run()`이 `materialize === true`면 `SourceMaterializer.run(project.repoPaths, vaultRoot)`를 **파이프라인 시작 전에** 호출. (registry/vaultRoot 이미 보유.)

### 4.4 Coverage UI (신규, renderer)
- 새 컴포넌트 `apps/desktop/src/renderer/components/CoverageMatrix.tsx` — 순수 표현(props = coverage-report 데이터).
- `HarnessDashboard.tsx` 탭에 **`coverage` 추가** (markdown | graph | flow | **coverage**). run 완료 후 기본 탭을 `coverage`로.
- 새 버튼 "전 문서로 위키 생성": 스토어 `startHarnessRun`에 `materialize: true` 전달하는 액션 추가.
- 화면 구성:
```
┌─ Coverage ─ 46/50 반영 · 4 누락 ───────────────────────────┐
│  원본 문서 (50)            위키 노드 (28)                  │
│  ✓ PRD.md         ───────▶ architecture                   │
│  ✓ adr-001.md     ───┬───▶ domain-model                   │
│  ✗ notes.md        (누락)                                  │
│  ✗ scratch/tmp.md  (누락)                                  │
│ ───────────────────────────────────────────────────────── │
│  ▾ 누락 4건 (클릭 → 해당 문서 열림)                         │
│    • notes.md  • scratch/tmp.md  • old/spec-v1.md  …       │
└────────────────────────────────────────────────────────────┘
```
- 상호작용: 왼쪽 문서 클릭 → 연결 노드 하이라이트(또는 누락 표시). 상단 요약 = covered/unmapped 카운트.

## 5. 에러 / 빈 상태

| 상황 | 처리 |
|---|---|
| 문서 0개 스캔됨 | materialize manifest 비어 있음 → Coverage "스캔된 문서 없음" + 어떤 경로를 봤는지 표시 |
| run은 됐으나 coverage-report 없음(구버전 run) | "이 run에는 커버리지 데이터가 없습니다 — 다시 생성하세요" |
| 노드 0개 | 모든 소스가 unmapped로 표시(전부 누락 경고) |
| materialize 실패(경로 없음/권한) | run 시작 전 에러 surface, 파이프라인 미진입 |

## 6. 테스트

- **SourceMaterializer**: 임시 디렉터리 트리(문서/제외폴더/비문서 혼합) 스캔 → 맞는 문서만 복사, `node_modules` 등 제외, manifest 카운트 정확, 재실행 시 삭제된 문서 사라짐(멱등).
- **buildCoverageReport**: 소스 목록 + 노드 제안(evidence 포함) 주면 covered/unmapped 정확 분류, totals 일치, 아무도 인용 안 한 소스 = unmapped.
- **CoverageMatrix(UI)**: covered/unmapped 렌더, 누락 빨강/목록, 클릭 상호작용, 빈 상태.
- **(선택) e2e**: 작은 fixture 프로젝트(문서 5개, 그중 1개는 아무 노드도 인용 안 하게) → fake agents run → coverage-report가 unmapped 1건을 정확히 잡음.

## 7. 범위 밖 (YAGNI)

- 누락 문서 **자동 재처리/수정** (지금은 보여주기만).
- **문서 내부 부분 커버리지**(문단/섹션 단위) — 파일 단위로만.
- 코드 등 **비-문서 파일** 위키화.
- **CI golden 회귀 테스트**(eval 임계값 고정) — 다음 단계 후보.
- 기존 9단계 파이프라인 **로직 변경** — materialize 0단계 추가 + coverage-report emit 외 불변.

## 8. 수용 기준 (Done 정의)

1. "전 문서로 위키 생성" 버튼 클릭 시 materialize → 파이프라인 → Coverage 화면까지 한 번에 진행된다.
2. `SourceMaterializer`가 repoPaths 하위 문서를 제외 규칙대로 `raw/project-docs/`에 모으고 manifest를 남긴다(기존 raw/ 수동 소스 불변).
3. run이 `coverage-report` 산출물을 emit하고, 그것이 문서↔노드 매핑과 unmapped 목록을 담는다.
4. Coverage 탭이 매트릭스 + 누락 목록 + 요약(covered/unmapped)을 렌더하고, 누락 클릭 시 해당 문서로 이동한다.
5. 신규/기존 테스트 + `pnpm typecheck` 통과.
6. 새 IPC 채널·DB migration 없음(`materialize?` 옵션 + 산출물만 추가).
