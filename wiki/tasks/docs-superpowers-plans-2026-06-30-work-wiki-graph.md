---
title: 작업↔위키 그래프 뷰 (SP2) Implementation Plan
slug: docs-superpowers-plans-2026-06-30-work-wiki-graph
sources: [docs/superpowers/plans/2026-06-30-work-wiki-graph.md]
status: open
created: 2026-06-30
topic: [graph-and-visualization]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: 캡처된 요청-Task를 wiki 그래프 위 task 노드로 띄우고, 세션이 편집한 위키 파일에 work→wiki 엣지를 그려 KnowledgeView의 'work' 소스로 본다. Architecture: SP1 캡처에 linkedWikiPages = session.filesTouched 를 추가하고, 순수 buildWorkGraphData 가 task 노드 + suffix-match된 wiki 노드 + 엣지를 만든다. 새 tasksList IPC로 프로젝트 Task를 가져와 KnowledgeView가 'work' 소스로 렌더한다. Tech Stack: TypeScript pnpm monorepo · graph-view(순수) · Electron IPC · React(KnowledgeView) · vitest. it('sets request linkedWi

## Progress log

- Source checklist: 0 completed, 21 remaining.
- **Parallelization (개발 병렬화)**
- **Global Constraints**
- **Task 1 (PARALLEL): extractTasks — linkedWikiPages** — (기존 session() 헬퍼는 filesTouched: [] 기본 — 위처럼 override. summarize 는 기존 describe의 mock.) (요청-Task의 TaskSchema.parse({...}) 객체에만. todo-Task는 불변.)
- **Task 2 (PARALLEL): buildWorkGraphData (graph-view)** — 그리고 packages/graph-view/src/index.ts 의 build-graph export 줄에 buildWorkGraphData , type WorkTaskInput 추가 (기존 export 줄을 이 형태로 확장 — 기존 식별자 유지 + 2개 추가.)
- **Task 3 (PARALLEL): tasksList IPC** — (기존 ipc.test가 handlers / CH / container 를 import·구성하는 방식을 그대로 사용.) (a) shared/ipc-contract.ts 의 export const CH = { … } 에 추가 그리고 같은 파일에 req 타입 추가 (b) main/ipc.ts 의 handlers 맵에 추가(예: [CH.search] 핸들러 근처) 그리고 ipc.ts 상단 type import에 TasksListReq 추가. (c) renderer/api.ts 에 추가(import에 type Task from '@apc/shared' 필요 시 추가)
- **Task 4 (after T2+T3): KnowledgeView 'work' 소스** — KnowledgeView 상단 import에 buildWorkGraphData 를 @apc/graph-view 에서 추가(기존 builder import 줄 확장). graphSource state 타입을 'run' 'wiki' 에서 'run' 'wiki' 'work' 로 확장. 프로젝트 Task 로드(기존 useState/useEffect 패턴 따름) 요청-Task만 추리고 자식 todos를 data에 담아 workGraph 구성 effectiveGraph 분기에 graphSource === 'work' → workGraph 추가. graphSource 토글 UI(
- **Self-Review (작성자 체크)**

## Related

- Source: `docs/superpowers/plans/2026-06-30-work-wiki-graph.md`
