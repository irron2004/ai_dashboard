---
title: 이어서(Resume) 컨텍스트 리콜 표면 Implementation Plan
slug: docs-superpowers-plans-2026-07-07-resume-recall-surface
sources: [docs/superpowers/plans/2026-07-07-resume-recall-surface.md]
status: open
created: 2026-07-07
topic: [desktop-experience]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: 프로젝트 전환 시 상단 슬라이드-인 배너로 {지난번 요약·마지막 질문·다음 할 일 메모}를 능동 제시하고, 어디서든 note-to-self를 캡처하며, 연대순 질문 히스토리를 제공한다. Architecture: 데이터는 대부분 재사용(최근 req: Task 제목 = 지난번 요약, 세션 파싱 = 마지막 질문, 기존 resume 배선). 신규는 초경량 스토어 둘( next notes , question log )뿐. 조립은 @apc/dashboard-api 의 순수 함수 buildResumeCard (세션 파싱은 주입 dep로 격리), 표면은 renderer의 슬라이드-인 배너 + drill-down 패널. Tech Stack: TypeScript, Electron, React, Zustand, node:sqlite ( DatabaseSync ), Zod,

## Progress log

- Source checklist: 0 completed, 58 remaining.
- **Global Constraints**
- **Task 1: NextNote 스키마 + NextNoteStore + 마이그레이션** — Create packages/pm/src/next-note-store.test.ts Run: npx vitest run packages/pm/src/next-note-store.test.ts Expected: FAIL — Cannot find module './next-note-store.js' (and NextNoteStore undefined). Append to packages/shared/src/schema.ts (after the Task block, before RunAgent ) In packages/pm/src/migrate.ts , inside the
- **Task 2: QuestionLogEntry 스키마 + QuestionLogStore + 마이그레이션** — Create packages/pm/src/question-log-store.test.ts Run: npx vitest run packages/pm/src/question-log-store.test.ts Expected: FAIL — Cannot find module './question-log-store.js' . Append to packages/shared/src/schema.ts (after NextNote block) In packages/pm/src/migrate.ts , inside the db.exec(\ ...\ ) block (after next no
- **Task 3: ingest → question log 배선** — Add to packages/app-services/src/ingest-service.test.ts (inside the existing top-level describe ; reuse the file's existing imports/fakes — if a fake registry/index/cursors helper exists, mirror it; otherwise this self-contained case works) If AgentIngestAdapter / NormalizedSession / IngestService are not yet imported
- **Task 4: latestSessionDetail(agents) + buildResumeCard(dashboard-api)** — Create packages/agents/src/latest-session.test.ts Run: npx vitest run packages/agents/src/latest-session.test.ts Expected: FAIL — Cannot find module './latest-session.js' . Create packages/agents/src/latest-session.ts Append to packages/agents/src/index.ts Run: npx vitest run packages/agents/src/latest-session.test.ts
- **Task 5: IPC surface (resumeCard·questionLog·nextNote CRUD)** — In apps/desktop/src/shared/ipc-contract.ts , add to the CH object (near taskSetBlockedBy ) Add to the imports at top (extend the @apc/shared import): NextNote, QuestionLogEntry . Add these type exports near the other req/res types In apps/desktop/src/renderer/api.ts , add (near taskSetBlockedBy ). Ensure imports: impor
- **Task 6: ResumeBanner + ⌘⇧N 캡처** — Create apps/desktop/src/renderer/components/ResumeBanner.test.tsx Run: cd apps/desktop && npx vitest run src/renderer/components/ResumeBanner.test.tsx; cd ../.. Expected: FAIL — Cannot find module './ResumeBanner.js' . Create apps/desktop/src/renderer/components/ResumeBanner.tsx Run: cd apps/desktop && npx vitest run s
- **Task 7: QuestionHistory 패널 + WorkspaceHome nextNote 통합** — Create apps/desktop/src/renderer/components/QuestionHistory.test.tsx Run: cd apps/desktop && npx vitest run src/renderer/components/QuestionHistory.test.tsx; cd ../.. Expected: FAIL — Cannot find module './QuestionHistory.js' . Create apps/desktop/src/renderer/components/QuestionHistory.tsx Run: cd apps/desktop && npx

## Related

- Source: `docs/superpowers/plans/2026-07-07-resume-recall-surface.md`
