---
title: Diff 패널 Implementation Plan
slug: docs-superpowers-plans-2026-07-14-diff-panel
sources: [docs/superpowers/plans/2026-07-14-diff-panel.md]
status: open
created: 2026-07-14
topic: [desktop-experience]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: 어느 탭에서든 Ctrl+Shift+D(또는 툴바 ± 버튼)로 우측 Diff 패널을 열어, 변경 파일 목록을 +N −N 스탯과 함께 보고 클릭으로 unified diff를 펼쳐 본다. Architecture: 기존 changesList / changesDiff IPC 채널을 그대로 쓰되 응답만 확장한다(신규 채널 없음 → 4곳 배선 규칙 해당 없음). main의 project-changes.ts 에 numstat 파싱·untracked 줄 수 계산·삭제 파일 diff를 추가하고, renderer에 DiffPanel.tsx 하나를 신설해 App.tsx에 배선한다. diff 렌더링은 기존 parseUnifiedDiff 재사용. Tech Stack: Electron IPC, git CLI( status --porcelain , diff --numstat ), R

## Progress log

- Source checklist: 0 completed, 34 remaining.
- **Global Constraints**
- **Task 1: parseNumstat — numstat 출력 파싱** — project-changes.test.ts 의 parsePorcelain describe 아래에 추가 Run: npx vitest run project-changes Expected: FAIL — parseNumstat is not a function (또는 export 없음) project-changes.ts 의 parsePorcelain 아래에 추가 주의: Step 1의 import에 countUntrackedAdditions 가 이미 있으므로 Task 2 전까지 테스트 파일이 import 에러가 난다면, Task 2까지 구현 후 함께 통과시켜도 된다. 순서대로
- **Task 2: countUntrackedAdditions — untracked 파일 줄 수** — Run: npx vitest run project-changes Expected: FAIL — countUntrackedAdditions is not a function project-changes.ts 상단 import에 readFileSync 추가 parseNumstat 아래에 추가 Run: npx vitest run project-changes Expected: countUntrackedAdditions 4개 PASS
- **Task 3: listProjectChanges 에 증감량 병합 + 계약 확장** — listProjectChanges (integration, real git) describe에 추가 Run: npx vitest run project-changes Expected: FAIL — additions 가 undefined ChangedFile 타입 확장 ( project-changes.ts:6 ) listProjectChanges 본문 교체 (repo 루프 안) ipc-contract.ts 의 ChangesListRes files 원소 확장 Run: npx vitest run project-changes ipc.test Expected: 전부 PASS (
- **Task 4: diffProjectFile 삭제 파일 지원** — diffProjectFile (integration, real git) describe에 추가 Run: npx vitest run project-changes Expected: FAIL — ok: false, reason: 파일을 찾을 수 없음: gone.md diffProjectFile 교체 Run: npx vitest run project-changes Expected: diffProjectFile 4개 전부 PASS — 특히 기존 untracked / missing 테스트가 그대로 통과해야 한다
- **Task 5: DiffPanel 컴포넌트** — Run: npx vitest run DiffPanel Expected: FAIL — Cannot find module './DiffPanel.js' app.css 끝에 추가 Run: npx vitest run DiffPanel Expected: 6개 테스트 전부 PASS
- **Task 6: App 배선 — 툴바 버튼 + Ctrl+Shift+D** — App.test.tsx 에 추가 (기존 mock 구조 안에서 — changesList 가 mock api Proxy에 없으면 기본 { ok: true } 반환으로 충분) 주의: App.test.tsx의 기존 렌더 셋업(projects/store mock)을 그대로 따른다. 기존 테스트가 render( ) 에 별도 준비가 필요하면 그 패턴을 복사할 것. Run: npx vitest run App.test Expected: FAIL — dialog 없음 import 추가 state 추가 ( searchOpen 옆) 단축키 effect 추가 (기존 Ctrl+Shift+N
- **Task 7: 최종 검증** — Run: pnpm typecheck Expected: exit 0 (IDE 진단 오경보는 무시 — CLAUDE.md) Run: pnpm test Expected: 전부 PASS (~2.5분) Run: pnpm --filter @apc/desktop dev 확인 목록 1. 아무 탭에서 Ctrl+Shift+D → 우측 패널 열림, 파일별 +N −N 표시 2. 파일 클릭 → diff 펼침 (추가=초록, 삭제=빨강), 재클릭 접힘 3. 삭제 파일 클릭 → 전체 - patch 표시 4. binary 파일에 binary 뱃지 5. Esc·✕ 닫기, ⟳ 새로고침 6. 프로젝트 미

## Related

- Source: `docs/superpowers/plans/2026-07-14-diff-panel.md`
