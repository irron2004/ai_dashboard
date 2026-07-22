---
title: "Spec — SP1: 세션 → Task 자동 캡처 (하이브리드)"
slug: docs-superpowers-specs-2026-06-30-session-task-capture-design
sources: [docs/superpowers/specs/2026-06-30-session-task-capture-design.md]
status: accepted
date: 2026-06-30
topic: [project-management]
---

## Context

상태: 설계(spec). 승인 후 writing-plans로 분기. 상위 맥락: 사용자 니즈 — 프로젝트 빠른 전환 + 이전 요청+남은 작업 시각화(작업↔위키 그래프) . 3개 sub-project 중 SP1(작업 자동 캡처) = 그래프/보드의 연료. (SP3 실행 아이콘 완료(PR 12); SP2 작업↔위키 그래프 뷰는 후속.) 결정 사항(브레인스토밍): 캡처 = 하이브리드 (Todos + 세션당 요청) · 요청 단위 = 세션당 1개·LLM 요약 제목 · 통합 = 접근법 A (기존 ingest 파이프라인에 추출 스텝 추가) · 요청-Task status = 자식 todo 파생 . 데스크톱은 이미 ingest() (store) → IngestService.ingestAll(adapters) 로 각 프로젝트의 에이전트 세션을 발견·파싱(cursor 증분) 해 검색/knowledge에 인덱싱한다. @apc/agents 의 claude/codex/opencode 어댑터가 세션을 NormalizedSession ( NormalizedTurn[] , 각 turn에 toolCalls: {name, input, ...}[] )으로 통일한다. Claude Code의 TodoWrite 는 toolCalls 에 { name:'TodoWrite', input:{ t

## Decision

- **1. 배경** — 데스크톱은 이미 ingest() (store) → IngestService.ingestAll(adapters) 로 각 프로젝트의 에이전트 세션을 발견·파싱(cursor 증분) 해 검색/knowledge에 인덱싱한다. @apc/agents 의 claude/codex/opencode 어댑터가 세션을 NormalizedSession ( NormalizedTurn[] , 각 turn에 toolCalls: {name, input, ...}[] )으로 통일한다. Claude Code의 TodoWrite 는 toolCalls 에 { name:'TodoWrite', input:{
- **2. 목표 / 비목표**
- **3. 아키텍처 / 데이터 흐름** — IngestService 는 onSessionParsed?: (session: NormalizedSession, projectId: string) = Promise 옵셔널 훅만 갖는다(pm/TaskStore에 의존하지 않음 — 디커플). 데스크톱 container.ts 가 그 훅에 task 추출+기록을 연결한다.
- **4. 컴포넌트 / 식별자**
- **5. 상태 파생 / LLM / 에러**
- **6. 컴포넌트 경계 / 변경 파일**
- **7. 테스트** — packages/app-services vitest(node 환경, LLM/IO 모킹). 1. mapTodoStatus : 3개 매핑(pending→todo, in progress→in progress, completed→done). 2. extractTodos : 세션에 TodoWrite toolCall이 2개면 마지막 것 사용; 각 todo content/status 매핑; 빈 content 스킵; TodoWrite 없으면 [] . 3. extractTasks : 요청-Task id= req:${pid}:${sid} , title=mock summarize 반환값

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-30-session-task-capture-design.md`
