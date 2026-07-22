---
title: CLI Session Persistence + Auto-Resume — Design
slug: docs-superpowers-specs-2026-06-23-cli-session-persistence-design
sources: [docs/superpowers/specs/2026-06-23-cli-session-persistence-design.md]
status: accepted
date: 2026-06-23
topic: [agent-runtime-and-sessions]
---

## Context

데스크톱 앱은 프로젝트별로 agent별 터미널 ( ${projectId}:${agent} , agent ∈ {claude, opencode, codex})을 마운트하고, 각 PTY는 프로젝트 repoPath 에서 해당 CLI를 실행한다. 현재 PTY 세션과 "어떤 패널이 열려 있었는지"는 메모리(Map/zustand)에만 있어 앱을 닫으면 사라진다. 각 CLI는 자기 대화 세션을 디스크에 저장 하고 resume를 지원한다. 또한 packages/agents 에는 이미 claude/codex/opencode 세션 어댑터 가 있어 discoverSources() 로 세션 jsonl을 찾고 sessionId · repoPath · startedAt/endedAt 를 파싱한다. 이 인프라를 재사용해, 재시작 시 각 패널의 CLI를 resume로 다시 띄운다. findLatestSession(agent, repoPath): Promise resumeCommand(agent, { sessionId?, repoPath }): { command, args } session-store.ts sqlite(apc.db): workspace pane / app state 읽기·쓰기 (better-sqlite3) pty-manager.ts startResume(id,

## Decision

- **1. 목적 / 배경** — 데스크톱 앱은 프로젝트별로 agent별 터미널 ( ${projectId}:${agent} , agent ∈ {claude, opencode, codex})을 마운트하고, 각 PTY는 프로젝트 repoPath 에서 해당 CLI를 실행한다. 현재 PTY 세션과 "어떤 패널이 열려 있었는지"는 메모리(Map/zustand)에만 있어 앱을 닫으면 사라진다. 각 CLI는 자기 대화 세션을 디스크에 저장 하고 resume를 지원한다. 또한 packages/agents 에는 이미 claude/codex/opencode 세션 어댑터 가 있어 discoverSources() 로 세션
- **2. 결정 요약 (brainstorming)**
- **3. 단위(unit) 경계** — 각 단위 책임: @apc/agents 는 "이 agent/repo의 세션을 어떻게 찾고 어떻게 resume하는가"만, session-store 는 "무엇이 열려 있었나"만, pty-manager 는 "어떻게 띄우나"만. 서로 잘 정의된 인터페이스로 통신.
- **4. 데이터 모델 (sqlite, apc.db )**
- **5. 데이터 흐름** — 1. 패널에서 agent 실행 → PTY가 repoPath 에서 CLI 실행 → CLI가 세션 jsonl 기록. main은 was open=1 , last active 갱신. 2. 종료( app.on('before-quit') ) : 열린 패널 각각에 대해 findLatestSession(agent, repoPath) → last session id 저장, was open 스냅샷, selected project id 저장. 3. 재시작 : main이 workspace pane (was open=1) + selected project id 를 읽어 렌더러에 worksp
- **6. CLI별 resume 매핑 ( resumeCommand )** — 구현 시 각 CLI --help 로 플래그 확정. 미지원/불확실하면 "최신" 경로 우선. findLatestSession 은 @apc/agents 의 기존 discoverSources() /parse를 재사용해 repoPath 매칭 후 startedAt/endedAt 기준 최신 세션을 고른다.
- **7. 에러 처리 / 폴백**
- **8. 테스트 (TDD)**

## Consequences

- **9. 비범위 (YAGNI / 후속)** — 세션 검색/머지, 읽기전용 transcript 뷰어, 세션 이름 수동 편집, 원격(ssh) 세션 resume, 멀티 윈도우, 세션별 사용량/요약 표시.

## Related

- Source: `docs/superpowers/specs/2026-06-23-cli-session-persistence-design.md`
