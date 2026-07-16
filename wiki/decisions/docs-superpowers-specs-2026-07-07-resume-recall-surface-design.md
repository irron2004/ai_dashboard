---
title: "Spec — 이어서(Resume): 컨텍스트 리콜 표면"
slug: docs-superpowers-specs-2026-07-07-resume-recall-surface-design
sources: [docs/superpowers/specs/2026-07-07-resume-recall-surface-design.md]
status: accepted
date: 2026-07-07
topic: [desktop-experience]
---

## Context

상태: 설계 확정 (brainstorming 승인) → writing-plans 대상 기준 커밋: main @ baca170 (P0~P4 머지 후) 사용자는 여러 프로젝트를 병렬로 진행하며 프로젝트 간 전환이 잦다. 전환할 때 컨텍스트가 증발 한다 — 구체적으로 두 고통 1. "이전에 내가 뭘 물었는지 까먹는다" — 마지막에 에이전트에게 무엇을 묻고 있었는지 재구성하려면 터미널 스크롤백을 뒤져야 함. 2. "다음에 뭐 하려 했는지 까먹는다" — 다른 프로젝트를 하다 오면 직전에 "다음엔 이거"라고 정해둔 것이 날아감. 두 고통은 같은 뿌리 하나 (전환 시 리콜 실패)이며, 다행히 필요한 데이터는 이미 대부분 캡처돼 있다. 따라서 이 작업은 새 파이프라인이 아니라 "리콜 표면(view) + 초경량 human 메모 캡처" 문제다. human intent 캡처. 자동추출 Task와 의도적으로 분리 (status/AC/priority 없는 초경량). // schema (packages/shared/src/schema.ts): DB snake case, TS camelCase id: string // note:${projectId}:${ulid} NextNoteStore (TaskStore 패턴 미러): CREATE TABLE IF NOT EXISTS n

## Decision

- **1. 동기 (사용자 실고통)** — 사용자는 여러 프로젝트를 병렬로 진행하며 프로젝트 간 전환이 잦다. 전환할 때 컨텍스트가 증발 한다 — 구체적으로 두 고통 1. "이전에 내가 뭘 물었는지 까먹는다" — 마지막에 에이전트에게 무엇을 묻고 있었는지 재구성하려면 터미널 스크롤백을 뒤져야 함. 2. "다음에 뭐 하려 했는지 까먹는다" — 다른 프로젝트를 하다 오면 직전에 "다음엔 이거"라고 정해둔 것이 날아감. 두 고통은 같은 뿌리 하나 (전환 시 리콜 실패)이며, 다행히 필요한 데이터는 이미 대부분 캡처돼 있다. 따라서 이 작업은 새 파이프라인이 아니라 "리콜 표면(view) + 초경량 human 메모
- **현재 상태 진단 (근거)**
- **2. 목표 / 비목표**
- **3. 데이터 모델** — 대부분 재사용 . 신규는 작은 것 두 개.
- **3.1 next notes 스토어 ( packages/pm/src/next-note-store.ts )** — human intent 캡처. 자동추출 Task와 의도적으로 분리 (status/AC/priority 없는 초경량). NextNoteStore (TaskStore 패턴 미러): CREATE TABLE IF NOT EXISTS next notes(...) , add(projectId, text) , listByProject(projectId, {includeDone?}) , toggleDone(id, done) , delete(id) . migratePm 에 CREATE 추가.
- **3.2 question log ( packages/pm/src/question-log-store.ts )** — turn fts 가 시간순 정렬을 못 하므로(FTS5 랭킹 전용) 연대순 브라우징용 최소 사이드카. QuestionLogStore.record(session: NormalizedSession) : 해당 세션의 user turns를 기록. listRecent({projectId?, limit}) : ORDER BY ts DESC .
- **4. 조립 + IPC**
- **4.1 buildResumeCard ( packages/dashboard-api/src/resume-card.ts )** — buildWorkspaceOverview / nextUp 와 같은 집. 순수 조립 — 세션 파싱( findLatestSession )은 부수효과(fs·sqlite 읽기)라 dep로 주입. hasHistory === false 이면 renderer가 배너를 띄우지 않음 (빈 카드 방지 — 첫 오픈 프로젝트).

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-07-07-resume-recall-surface-design.md`
