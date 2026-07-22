---
title: 에이전트 실행 아이콘 (▶/⏹) Implementation Plan
slug: docs-superpowers-plans-2026-06-30-agent-launch-icon
sources: [docs/superpowers/plans/2026-06-30-agent-launch-icon.md]
status: open
created: 2026-06-30
topic: [desktop-experience]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: desktop dock의 각 에이전트 헤더에 ▶(시작/재시작)·⏹(중지) 아이콘 버튼을 추가해 프로젝트 에이전트 세션을 한 클릭으로 제어한다. Architecture: 신규 엔진 없음. 기존 PTY IPC( startPty / killPty )와 pty-manager의 same-id kill+respawn을 재사용. store에 세션별 restartNonce 를 추가하고, AgentTerminal 이 그 nonce를 spawn effect deps로 받아 재spawn한다. 새 프레젠테이션 컴포넌트 AgentDockHeader 로 헤더를 추출(테스트 가능화)하고 App.tsx가 배선한다. Tech Stack: React 18 + zustand(store) + xterm(터미널) + Electron IPC. 테스트 = vitest(jsdom) + @testi

## Progress log

- Source checklist: 0 completed, 22 remaining.
- **Global Constraints**
- **File Structure**
- **Task 1: store — restartNonce + restartAgent/stopAgent** — Create apps/desktop/src/renderer/agent-run-controls.test.tsx Run (in apps/desktop ): npx vitest run src/renderer/agent-run-controls.test.tsx Expected: FAIL — restartNonce / restartAgent / stopAgent 가 ApcStore 에 없음(타입/런타임 에러). store.ts 의 type ApcStore = { 안, setAgentStatus(...) 선언 근처(~L73)에 추가 create ((set, get) = ({ 초기
- **Task 2: AgentTerminal — restartNonce prop → 재spawn** — Create apps/desktop/src/renderer/components/AgentTerminal.test.tsx Run (in apps/desktop ): npx vitest run src/renderer/components/AgentTerminal.test.tsx Expected: FAIL — restartNonce 가 deps에 없어 두 번째 렌더에서 effect가 재실행되지 않음 → startPty 1회만 호출( expected 2, got 1 ). AgentTerminalProps 타입(L9–18)에 한 줄 추가(예: resumeSessionId 줄 아
- **Task 3: AgentDockHeader — ▶/⏹ 헤더 컴포넌트 (NEW)** — Create apps/desktop/src/renderer/components/AgentDockHeader.test.tsx Run (in apps/desktop ): npx vitest run src/renderer/components/AgentDockHeader.test.tsx Expected: FAIL — 모듈 ./AgentDockHeader.js 가 없음(import 에러). Create apps/desktop/src/renderer/components/AgentDockHeader.tsx Run (in apps/desktop ): npx vitest run sr
- **Task 4: App.tsx 배선 — 헤더 교체 + restartNonce 전달** — App.tsx 상단 import 블록(예: import { AgentTerminal } from './components/AgentTerminal.js' 근처, ~L7)에 추가 컴포넌트 함수 본문 상단, 기존 } = useStore() (~L32) 바로 아래에 추가 아래 기존 블록을 다음으로 교체 같은 dock 블록의 (L383–393)에서 agent={a} 줄 아래에 prop 추가 Run (레포 루트): pnpm typecheck Expected: PASS (0 errors) — AgentDockHeader props· restartNonce 타입 정합. Run (
- **Self-Review (작성자 체크)**

## Related

- Source: `docs/superpowers/plans/2026-06-30-agent-launch-icon.md`
