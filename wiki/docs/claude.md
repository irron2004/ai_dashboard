---
title: CLAUDE.md — ai dashboard 운영 메모
slug: claude
sources: [CLAUDE.md]
topic: [project-architecture]
---

## Summary

pnpm test vitest workspace 전체(packages + apps/desktop), ~2.5분 pnpm typecheck 권위 있는 타입 검사 — IDE 진단은 오경보 잦음 npx vitest run 단일 파일·패턴만 실행 (repo root에서) pnpm --filter @apc/desktop dev Electron 개발 서버 (hot-reload) IDE 진단 오경보 무시 목록: @xterm/… , @apc/node:sqlite not found , @homebridge/node-pty-prebuilt-multiarch . 이것들은 선택적 네이티브 의존성 + vite-node shim 문제이며 pnpm typecheck 에서는 오류가 아닙니다. 두 서비스는 이름이 비슷하지만 독립적입니다. 위키 파이프라인 작업이면 HarnessService , 코딩 에이전트 실행이면 DevHarnessService . 값 추가 금지 — PTY 실행·SSH·resume 등 여러 곳이 이 열거형에 의존함. CH 상수는 apps/desktop/src/shared/ipc-contract.ts 단일 소스입니다. 새 채널을 추가할 때는 아래 4파일 모두 수정해야 합니다 1. apps/desktop/src/shared/ipc-contract.ts — CH

## Content map

- **명령** — 이것들은 선택적 네이티브 의존성 + vite-node shim 문제이며 pnpm typecheck 에서는 오류가 아닙니다.
- **아키텍처 핵심 — 이름 혼동 주의** — 두 서비스는 이름이 비슷하지만 독립적입니다. 위키 파이프라인 작업이면 HarnessService , 코딩 에이전트 실행이면 DevHarnessService .
- **AgentKind vs RunAgent**
- **IPC 채널 추가 시 4곳 모두 배선** — CH 상수는 apps/desktop/src/shared/ipc-contract.ts 단일 소스입니다. 새 채널을 추가할 때는 아래 4파일 모두 수정해야 합니다 1. apps/desktop/src/shared/ipc-contract.ts — CH 상수 + 요청/응답 타입 2. apps/desktop/src/preload/index.ts — contextBridge.exposeInMainWorld('apc', …) 노출 3. apps/desktop/src/renderer/api.ts — renderer 호출 함수 4. apps/desktop/src/main/ipc.ts
- **DB 패턴**
- **Task id 규약** — contextPackage 필드는 현재 sessionId 문자열입니다(향후 Context Package Composer 확장 예정).
- **커밋 컨벤션** — Conventional Commits: feat(scope) , fix(scope) , docs(scope) , chore(scope) , test(scope) . scope 예시: harness , pm , desktop , knowledge , agents .
- **주요 경로**

## Related

- Source: `CLAUDE.md`
