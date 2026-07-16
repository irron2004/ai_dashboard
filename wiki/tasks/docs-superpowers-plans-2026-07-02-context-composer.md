---
title: "P2 — LLM 핸드오프: Context Package Composer + dev-run 가시성 (Implementation Plan)"
slug: docs-superpowers-plans-2026-07-02-context-composer
sources: [docs/superpowers/plans/2026-07-02-context-composer.md]
status: open
created: 2026-07-02
topic: [project-management]
---

## Summary

For the implementing developer (Sonnet): REQUIRED SUB-SKILL — use superpowers:subagent-driven-development (or superpowers:executing-plans ) to implement this plan task by task, in order . Steps use checkbox ( - [ ] ) syntax for tracking. Follow TDD: write the failing test first, run it to confirm RED, implement the minimum to go GREEN, then commit. You see ONLY this plan — everything you need is here. PM이 task 하나를 골라 컨텍스트 패키지 {제목 · 상위 요청 배경 · 수용 기준 · linkedWikiPages 발췌 · 직전 세션 요약}를 하나의 Markdown 프롬프트로 결정론적으로 조립 하고, 이를 ① dock 에이전트 터미널(pty)에 주입하거나 ② 복사해서 넘길 수 있다. 부가로 dev-harness run이 시작 즉시 runId를 ack ( devHarness:started 이벤트)하고, 완료된 dev-run의 tra

## Progress log

- Source checklist: 0 completed, 46 remaining.
- **Goal** — PM이 task 하나를 골라 컨텍스트 패키지 {제목 · 상위 요청 배경 · 수용 기준 · linkedWikiPages 발췌 · 직전 세션 요약}를 하나의 Markdown 프롬프트로 결정론적으로 조립 하고, 이를 ① dock 에이전트 터미널(pty)에 주입하거나 ② 복사해서 넘길 수 있다. 부가로 dev-harness run이 시작 즉시 runId를 ack ( devHarness:started 이벤트)하고, 완료된 dev-run의 transcript를 모달로 열람 할 수 있다. 제품 근거: docs/handoffs/2026-07-02-product-diagnosis-a
- **Architecture**
- **Tech Stack** — TypeScript · Node fs · Electron IPC( ipcMain.handle / webContents.send / contextBridge ) · React 18 + Zustand(터치 안 함) · Vitest 2(+ @testing-library/react , jsdom for .test.tsx ) · Zod(IPC 경계 검증).
- **Global Constraints**
- **Task 1: 순수 조립기 composeContextPackage (app-services)**
- **Task 2: composeContext IPC (contract + main 수집기 + handler + api)** — CH 객체에서 devHarnessCancel: 'c:devHarnessCancel', 아래에 append 파일 하단 DevHarnessLogEvent 타입 근처에 append 파일 상단 import 조정 nextId() 아래(파일 상단부 유틸 근처)에 상수 + 헬퍼 추가 devHarnessCancel 정의 아래에 메서드 추가 Container 타입에 devHarnessCancel: ... 아래에 append return { ... } 객체에서 devHarnessRun, devHarnessCancel, 옆에 composeContext, 추가. 타입 import 목록에
- **Task 3: dev-harness started ack ( devHarness:started 이벤트)** — run 시그니처를 확장 this.deps.runs.create({ ... }) 호출 직후 (그 다음 줄)에 추가 CH 객체의 devHarnessLog: 'devHarness:log', 아래에 append DevHarnessLogEvent 타입 아래에 append 타입 import 목록에 DevHarnessStartedEvent 추가. buildContainer opts 타입에 emitDevHarnessLog? 아래로 append devHarnessRun 정의를 3번째 인자 포함으로 교체 타입 import 목록에 DevHarnessStartedEvent 추가. Wind
- **Task 4: devHarnessReadTranscript IPC (transcript 읽기)** — CH 객체에서 (Task 2에서 넣은) composeContext: 'q:composeContext', 아래에 타입 섹션( ComposeContextRes 근처)에 상단 import에 openSync, readSync, closeSync 추가: import { readdirSync, statSync, readFileSync, openSync, readSync, closeSync } from 'node:fs' . 타입 import에 DevHarnessReadTranscriptReq, DevHarnessReadTranscriptRes 추가. capExcerpt 근처에 상

## Related

- Source: `docs/superpowers/plans/2026-07-02-context-composer.md`
