---
title: CLI Session Persistence + Auto-Resume Implementation Plan
slug: docs-superpowers-plans-2026-06-23-cli-session-persistence
sources: [docs/superpowers/plans/2026-06-23-cli-session-persistence.md]
status: open
created: 2026-06-23
topic: [agent-runtime-and-sessions]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: 앱을 닫았다 켜도 프로젝트별 CLI(claude/codex/opencode) 대화를 라이브 resume로 이어가고, 열려 있던 패널 워크스페이스를 자동 복원한다. Architecture: @apc/agents 에 세션 발견( findLatestSession )과 CLI별 resume 명령 매핑( resumeCommand )을 추가(기존 어댑터 재사용). @apc/desktop main에 sqlite 워크스페이스 스냅샷( session-store )과 PTY resume 경로를 추가하고, 종료 시 스냅샷 → 부팅 시 렌더러가 패널을 재오픈하며 각 CLI를 resume로 띄운다. Tech Stack: TypeScript, Electron, node-pty( @homebridge/node-pty-prebuilt-multiarch ), better-sqlite3

## Progress log

- Source checklist: 0 completed, 41 remaining.
- **Global Constraints**
- **Task 1: @apc/agents — resumeCommand (CLI별 resume 명령 매핑)** — Run: pnpm vitest run packages/agents/src/resume.test.ts Expected: FAIL — "Failed to resolve import './resume.js'". Run: pnpm vitest run packages/agents/src/resume.test.ts Expected: PASS (6 tests). Run each and confirm the flag exists; if a flag differs, update the mapping + test claude --help grep -E 'resume continue'
- **Task 2: @apc/agents — findLatestSession + adapterFor (repo의 최신 세션 발견)** — Run: pnpm vitest run packages/agents/src/resume.find.test.ts Expected: FAIL — findLatestSession is not exported. Run: pnpm vitest run packages/agents/src/resume.find.test.ts packages/agents/src/resume.test.ts Expected: PASS (8 tests total).
- **Task 3: desktop main — session-store (sqlite 워크스페이스 스냅샷)** — Run: pnpm vitest run apps/desktop/src/main/session-store.test.ts Expected: FAIL — cannot import ./session-store.js . Run: pnpm vitest run apps/desktop/src/main/session-store.test.ts Expected: PASS (4 tests).
- **Task 4: desktop main — pty-manager resume 경로 + StartPtyReq 확장** — Run: pnpm vitest run apps/desktop/src/main/pty-manager.resume.test.ts Expected: FAIL — start 는 5번째 인자/ deps 를 모른다(타입/런타임 에러). pty-manager.ts 수정 1. constructor에 deps 추가 2. start 시그니처에 opts 추가하고, 자동 입력 라인 구성 직전에 resume 반영 (주의: p / ssh 변수는 기존 start 본문 스코프에 이미 있다. resolveResume await가 spawn 이후로 가도록 자동입력 블록만 옮긴다.) Run: pnpm
- **Task 5: desktop main — 종료 스냅샷 + 부팅 복원 IPC** — index.ts 에서 기존 sqlite db 핸들 옆에 SessionStore를 만들고 ensureSchema, 핸들러 등록 ( projectRepoPath(projectId) 는 기존 프로젝트 저장소 조회 함수/쿼리를 사용. 컨테이너의 projects repo에서 repoPath 를 읽는다.) apps/desktop/src/preload/index.ts 에 paneOpened/paneClosed/selectProject send와 onWorkspaceRestore(cb) 구독을 추가하고, apps/desktop/src/renderer/api.ts 에 대응 메서드를
- **Task 6: desktop renderer — 워크스페이스 하이드레이트 + AgentTerminal resume** — Run: pnpm vitest run apps/desktop/src/renderer/workspace-restore.test.ts Expected: FAIL — hydrateWorkspace / openPanes 미정의. Run: pnpm vitest run apps/desktop/src/renderer/workspace-restore.test.ts Expected: PASS. Run: pnpm vitest run apps/desktop/src/renderer/workspace-restore.test.ts && pnpm typecheck Expected: PASS,
- **Notes for the implementer**

## Related

- Source: `docs/superpowers/plans/2026-06-23-cli-session-persistence.md`
