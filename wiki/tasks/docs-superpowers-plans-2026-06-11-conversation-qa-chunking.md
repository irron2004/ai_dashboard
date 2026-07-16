---
title: "대화 세션 → Q&A raw 청킹 Implementation Plan"
slug: docs-superpowers-plans-2026-06-11-conversation-qa-chunking
sources: [docs/superpowers/plans/2026-06-11-conversation-qa-chunking.md]
status: open
created: 2026-06-11
topic: [agent-runtime-and-sessions]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: claude/codex/opencode 세션을 현재 프로젝트 기준으로 골라 raw/conversations/ / /NNNq a.txt Q&A 단위 파일로 materialize하고, "전 문서로 위키 생성" 버튼의 materialize 단계에 통합한다. Architecture: 기존 인제스트 어댑터( @apc/agents )를 재사용해 NormalizedSession 을 얻고, app-services에 신설하는 conversation-materializer.ts (순수 함수 3개 + materializer 1개)가 Q&A 파일을 기록한다. HarnessService.run 의 materialize 블록과 데스크톱 container.ts 에 배선한다. Tech Stack: TypeScript, vitest, Node fs. 신규 의존성 없음 ( @apc/ag

## Progress log

- Source checklist: 0 completed, 19 remaining.
- **Task 1: 순수 함수 3개 — groupQaUnits / formatQaFile / sessionMatchesProject** — packages/app-services/src/conversation-materializer.test.ts 생성 Run: pnpm vitest run packages/app-services/src/conversation-materializer.test.ts Expected: FAIL — 모듈 없음. packages/app-services/src/conversation-materializer.ts 생성 (Task 2에서 materializer가 추가될 파일 — 이번 태스크는 순수 함수 3개와 타입만) Run: pnpm vitest run packages/app-serv
- **Task 2: materializeConversations** — 테스트 파일 상단 import에 추가 파일 끝에 describe 추가 Run: pnpm vitest run packages/app-services/src/conversation-materializer.test.ts Expected: 신규 6개 FAIL ( materializeConversations 미정의), 기존 13개 PASS. conversation-materializer.ts 상단 import 교체/추가 파일 끝에 추가 Run: pnpm vitest run packages/app-services/src/conversation-materializer.test.t
- **Task 3: HarnessService 배선** — harness-service.test.ts — 상단 import에 추가 (기존 import와 병합, 중복 금지) 파일 끝에 describe 추가 (이 테스트 파일에는 mkdtempSync / mkdirSync / existsSync / readFileSync / tmpdir / join / FakeAgentRunner / HarnessService 가 이미 import돼 있음 — 확인 후 없는 것만 추가.) Run: pnpm vitest run packages/app-services/src/harness-service.test.ts Expected: 신규 1번 테스트
- **Task 4: 데스크톱 컨테이너 주입 + 전체 회귀 + push** — container.ts 의 HarnessService 생성부(현재 ~205행) 를 다음으로 교체 ( ingestAdapters 는 153행에서 이미 정의됨 — 선언 순서상 HarnessService보다 앞) Run: pnpm vitest run (루트, packages 전체) → 전부 PASS. Run: pnpm --filter @apc/desktop exec vitest run → 전부 PASS. Run: pnpm run typecheck → exit 0. 앱 재시작 → "전 문서로 위키 생성" 클릭 → /raw/conversations/claude/ /001q a

## Related

- Source: `docs/superpowers/plans/2026-06-11-conversation-qa-chunking.md`
