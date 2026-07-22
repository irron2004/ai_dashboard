---
title: 대화 히스토리 탭 승격 구현 플랜
slug: docs-superpowers-plans-2026-07-15-conversation-history-tab
sources: [docs/superpowers/plans/2026-07-15-conversation-history-tab.md]
status: done
created: 2026-07-15
topic: [desktop-experience]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: QuestionHistory 모달을 삭제하고 프로젝트 주 화면 탭 💬 히스토리 ( MainTab: 'history' )로 승격한다. 향후 검색이 꽂힐 HistoryFocus 주입 이음새를 함께 만든다. Architecture: 모달 내용을 ConversationHistoryView 로 추출하고, MainPanel 에 탭을 추가하며, App.tsx 의 모달 상태를 historyFocus 상태로 교체한다. main 프로세스·IPC( q:conversationHistory )·Q/A 추출 로직은 변경하지 않는다. Tech Stack: React 18 + zustand(미사용 유지), vitest + @testing-library/react (jsdom), Playwright fixture QA. Spec: docs/superpowers/specs/2026-07

## Progress log

- Source checklist: 22 completed, 0 remaining.
- **Global Constraints**
- **Task 1: ConversationHistoryView 추출 + focus 주입** — apps/desktop/src/renderer/components/ConversationHistoryView.test.tsx 생성. 기존 QuestionHistory.test.tsx 의 4개 테스트를 새 props로 이전하고 focus 테스트 2개를 추가한다 Run: npx vitest run apps/desktop/src/renderer/components/ConversationHistoryView.test.tsx Expected: FAIL — Cannot find module './ConversationHistoryView.js' 계열 오류. apps/deskto
- **Task 2: MainPanel 에 history 탭 추가** — MainPanel.test.tsx 수정 (a) mock 목록에 추가 (기존 vi.mock('./WorkspaceHome.js', …) 아래) (b) renderPanel 에 history용 prop 전달 — JSX에 fetchConversationHistory={vi.fn()} 추가. (c) 탭 순서 검증 배열을 다음으로 교체 (d) test.each 목록에 케이스 추가 (e) 키보드 내비게이션 테스트에서 End 기대값 수정 (f) history 탭도 프로젝트 필수임을 검증하는 테스트 추가 Run: npx vitest run apps/desktop/src/render
- **Task 3: App.tsx 배선 교체 + 모달 삭제 + CSS 정리** — (a) import 교체 — QuestionHistory import 제거, HistoryFocus 추가 (b) apc:mainTab 복원 화이트리스트에 'history' 추가 (line ~49) (c) historyScope 상태 제거, 교체 (d) ResumeBanner onOpenHistory 교체 (e) 에 props 추가 (f) JSX 하단의 블록(현재 527–533행) 제거. fetchConversationHistory useCallback(현재 311행)은 유지 — MainPanel로 전달된다. 주석의 "QuestionHistory's fetch effe
- **Task 4: e2e fixture 시나리오를 탭 기준으로 갱신** — 기존 dialog 기반 테스트를 다음으로 교체 주의: 바깥 page.getByRole('tab', { name: '히스토리' }) 는 MainPanel 탭, panel.getByRole('tab', …) 는 뷰 내부 에이전트 탭 — 반드시 panel 로 스코프한다. Run: pnpm --filter @apc/desktop qa:fixture Expected: conversation-history 테스트 포함 전체 PASS. (fixture가 ResumeBanner 클릭 후 탭 전환을 렌더하지 못하면 — 예: fixture 브리지가 q:projectDashboard 를
- **Task 5: 전체 검증** — Run: pnpm typecheck Expected: 오류 0 Run: pnpm --filter @apc/desktop test Expected: 전부 PASS 완료 메모: 사용자 데이터에 영향을 주지 않도록 fixture QA, 격리된 Windows Electron 스모크, App/MainPanel 통합 테스트로 아래 4개 동선을 동등 검증했다. pnpm --filter @apc/desktop dev 로 앱을 띄우고 1. 프로젝트 선택 → 💬 히스토리 탭 → 에이전트 탭 전환, 세션 선택, 질문 펼침 확인 2. ResumeBanner "질문 히스토리" 클릭 → 히스

## Related

- Source: `docs/superpowers/plans/2026-07-15-conversation-history-tab.md`
