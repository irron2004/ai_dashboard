# Handoff — PM Home 통합 (AC#2) + 진단/설계/계획 + 브랜치 push

- **Date**: 2026-06-08
- **Branch**: `docs/knowledge-harness-pipeline-spec` (HEAD=origin=`29f5c00`, 트리 clean)
- **PR**: #1 — <https://github.com/irron2004/ai_dashboard/pull/1> (`→ main`, open)

## 0. 한 줄 요약

PM으로서 **요구사항 커버리지 진단**(AC 6/10, P0 격차 #2/#6/#8)을 하고, 그중 **#2(PM 홈 가시성)를 brainstorming→spec→plan→구현(subagent team-mode dev+QA)으로 끝까지 완성**했다. 브랜치를 push하고 PR #1을 열었다.

## 1. 이번 세션에 한 일 (결과 중심)

### A. PM 진단 (문서)
- **요구사항 커버리지 진단서** 작성: PRD v0.2 수용기준 10개를 실제 코드와 1:1 대조 → **6 완료 / 4 부분·미달(#2 PM홈, #4 wiki 자동적용, #6 통합검색, #8 하네스 apply)**. 핵심 인사이트: *안전 파이프라인은 명세 초과 달성, 반면 PM 운영 화면(P0 기본기)이 정체* — 깊이/넓이 불균형.
- 빌드 트랙(Plan/Phase)·git 위치까지 통합한 종합 진단으로 확장.
- 파일: `docs/superpowers/specs/2026-06-07-product-requirements-coverage-diagnosis.md`

### B. PM Home 통합 — 설계 + 구현 (AC#2 해소) ✅ 완료
격차 #2: `PmHome`이 만들어져 있었으나 `App.tsx`에 **연결조차 안 됨**(HarnessDashboard가 main 점유), current focus·timeline·task board 누락.

확정 결정: **① main 상단 탭바 / ② 경량 파생 타임라인(새 데이터모델 없음) / ③ 읽기전용 칸반**.

구현 결과 (TDD, 각 Task team-mode = 구현→spec리뷰→코드품질리뷰, 전부 APPROVED):
- `getProjectDashboard`가 `allTasks` 반환 (additive, 기존 필드 불변)
- `TaskBoard`(읽기전용 칸반), `TimelineStrip`(project/task 날짜 파생 + `timelineAxis`/`datePct` 헬퍼)
- `PmHome` 5섹션 조합(goal·focus·timeline·board·review·runs)
- `MainPanel` 탭 — **PM Home 기본 랜딩**, Knowledge Harness는 탭으로 보존 (App.tsx 정확히 3편집, HarnessDashboard 직접 import 제거)
- CSS(클래스 기반, 인라인 grid 없음)
- spec: `docs/superpowers/specs/2026-06-07-pm-home-integration-design.md`
- plan: `docs/superpowers/plans/2026-06-07-pm-home-integration.md`

### C. 그 외
- 미커밋 WIP(**generate preflight** — source-scan 모달/카테고리 선택/서비스·IPC) 선커밋(검증 후).
- **가짜 토큰 push 차단 해결**: `docs/handoffs/2026-06-04-follow-up-catchup.md`의 SecretScanner 테스트용 가짜 Slack/Stripe 문자열(과거 `git log -S` 검증 기록)이 GitHub push protection에 오탐 → filter-branch로 그 docs 2줄만 무력화(`xoxb-REDACTED-EXAMPLE` 등), **코드는 byte-identical** 유지 후 clean push.

## 2. 커밋 (이 세션 신규, base `c7ee1ff` 위)

```
29f5c00 style(desktop): PM Home tabs/timeline/kanban styling
d1c1148 feat(desktop): MainPanel tabs — PM Home default landing, Harness as tab
b846b29 feat(desktop): PmHome composes focus, timeline, task board, review, runs
6d8a5dd feat(desktop): lightweight TimelineStrip
ff3f54b feat(desktop): read-only TaskBoard kanban
741e719 feat(dashboard-api): return allTasks
b19da08 feat(desktop): generate preflight (이전 미커밋 WIP)
183c180 docs: PM Home implementation plan
1e6c52d docs: PM Home integration design (AC#2)
3021aa1 docs: build-track progress into coverage diagnosis
4626406 docs: PM requirements-coverage diagnosis
40f7b5f docs: handoff for B2/B3 (← 기존 69fd2a4, rewrite로 SHA 변경)
```
> 주의: `40f7b5f`~`29f5c00` 12개는 filter-branch로 SHA가 바뀐 것(원본 push 전이라 origin 영향 없음). 그 아래 `a5caeeb` 이하는 불변.

- **미커밋 없음** (트리 clean).
- 로컬 잔여(정리 가능): 백업 태그 `backup/pre-secret-scrub`, filter-branch의 `refs/original/refs/heads/docs/knowledge-harness-pipeline-spec`.

## 3. 다음에 할 일 / 미완 항목

- **PR #1 CI 확인** 및 리뷰 (브랜치가 큼 → handoff/§리뷰단위 5분할 권장).
- **PM Home low-severity 후속**(비차단): ① `app.css`의 옛 `.pm-home` 블록이 신규 `<section>`에도 적용 → 시각 확인 후 정리, ② `.pm-board__card-title`/`.pm-board__due`/`.run-status` 미스타일.
- **남은 P0 격차**: #6 통합검색(session+knowledge 단일 결과셋), #8 하네스 config diff/validate/apply.
- **사용자 핵심 후속 제품 방향** (auto-memory `docs-to-wiki-harness-goal` 참조): *하위 경로 전 문서 → LLM wiki 원클릭 변환 harness*. 현재 Generate 버튼은 세션 1개만 요약, Knowledge Harness 파이프라인이 가장 근접하나 staging-only+수동 promote, 전체-트리 재귀 수집 완전성 미확인. → brainstorming부터 시작 권장.

## 4. 재현·검증 명령

```bash
# 전체 검증 (전부 green 확인됨)
pnpm typecheck                                   # root + desktop, clean
cd apps/desktop && npx vitest run                # 56/56 (11 files)
cd ../.. && npx vitest run packages/dashboard-api   # 3/3 (allTasks 포함)
npx vitest run packages/app-services             # 49/49

# 핵심 파일
apps/desktop/src/renderer/components/{PmHome,TaskBoard,TimelineStrip,MainPanel}.tsx
apps/desktop/src/renderer/App.tsx                # MainPanel 연결, mainTab 기본 'pm'
packages/dashboard-api/src/project-dashboard.ts  # allTasks
```
