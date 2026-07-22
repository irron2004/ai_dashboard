---
title: 세션 → Task 자동 캡처 (SP1) Implementation Plan
slug: docs-superpowers-plans-2026-06-30-session-task-capture
sources: [docs/superpowers/plans/2026-06-30-session-task-capture.md]
status: open
created: 2026-06-30
topic: [project-management]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: 에이전트 세션에서 요청-Task(세션당 1개, LLM 요약 제목) + todo-Task(TodoWrite, 상태 매핑, 자식)를 멱등 추출해 기존 ingest 파이프라인에서 TaskStore에 기록한다. Architecture: 순수 TaskExtractor 가 NormalizedSession →Task를 만들고, reconcileSessionTasks 가 TaskStore에 upsert + 사라진 todo 삭제. IngestService 에 옵셔널 onSessionParsed 훅을 추가하고 desktop container가 그 훅에 추출+기록을 배선. 요청 제목은 주입된 summarize (LlmAgent)로, 실패 시 첫 user turn 폴백. Tech Stack: TypeScript (pnpm monorepo) · zod · better-sqlit

## Progress log

- Source checklist: 0 completed, 29 remaining.
- **Global Constraints**
- **세션 타입 참고 (verbatim, @apc/shared )**
- **File Structure**
- **Task 1: TaskStore.delete** — packages/pm/src/task-store.test.ts 의 기존 describe 안에 추가(기존 테스트가 store/db를 만드는 패턴을 그대로 사용 — 같은 헬퍼로 store.create({...}) 후 삭제) (기존 테스트 상단의 store 변수명/생성 방식을 그대로 따른다. 만약 변수명이 다르면 그 이름을 쓴다.) Run: npx vitest run packages/pm/src/task-store.test.ts Expected: FAIL — store.delete is not a function . task-store.ts 의 updateStatus(..
- **Task 2: task-extractor — extractTodos + extractTasks (순수)** — Create packages/app-services/src/task-extractor.test.ts Run: npx vitest run packages/app-services/src/task-extractor.test.ts Expected: FAIL — ./task-extractor.js 없음. Create packages/app-services/src/task-extractor.ts Run: npx vitest run packages/app-services/src/task-extractor.test.ts Expected: PASS (모든 케이스).
- **Task 3: reconcileSessionTasks (upsert + stale 삭제)** — task-extractor.test.ts 에 추가(파일 상단 import에 reconcileSessionTasks , type Task 추가) Run: npx vitest run packages/app-services/src/task-extractor.test.ts Expected: FAIL — reconcileSessionTasks export 없음. task-extractor.ts 끝에 추가 Run: npx vitest run packages/app-services/src/task-extractor.test.ts Expected: PASS.
- **Task 4: IngestService.onSessionParsed 훅** — 기존 ingest-service.test.ts 는 클래스 FakeAdapter (생성자에 session, discoverSources / parseSource 로 그 세션 1개 반환)와 beforeEach 에서 만든 registry / cursors / index 를 갖고, project p1 을 repoPaths:['/work/apc'] 로 등록한다. 그 파일의 describe 안에 아래 2개 case를 추가( vi 가 import돼 있지 않으면 import 추가) ( FakeAdapter / registry / cursors / index 는 기존 파일의 정의/픽
- **Task 5: session-summarizer (LlmAgent 기반 summarize)** — Create packages/app-services/src/session-summarizer.test.ts Run: npx vitest run packages/app-services/src/session-summarizer.test.ts Expected: FAIL — ./session-summarizer.js 없음. Create packages/app-services/src/session-summarizer.ts Run: npx vitest run packages/app-services/src/session-summarizer.test.ts Expected: PASS

## Related

- Source: `docs/superpowers/plans/2026-06-30-session-task-capture.md`
