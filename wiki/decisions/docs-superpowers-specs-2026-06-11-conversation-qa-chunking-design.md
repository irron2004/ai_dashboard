---
title: "대화 세션 → Q&A raw 청킹 — 설계"
slug: docs-superpowers-specs-2026-06-11-conversation-qa-chunking-design
sources: [docs/superpowers/specs/2026-06-11-conversation-qa-chunking-design.md]
status: accepted
date: 2026-06-11
topic: [agent-runtime-and-sessions]
---

## Context

너무 커서(64KB 캡에 잘리고, NODE PROPOSALS 단계 timeout 유발) 위키 입력으로 부적합 — 세션을 시간순 Q&A 단위 파일 로 쪼개 raw/ 에 materialize하면 추출기가 특정 문답을 1. "전 문서로 위키 생성" 버튼 하나로, 현재 프로젝트에서 진행된 claude/codex/opencode 세션이 자동으로 raw/conversations/ / /NNNq a.txt 로 청킹된다. 2. 각 파일은 Q&A 한 쌍: user 질문 + assistant 답변 텍스트 + 툴콜 한 줄 요약(스타일 B). 3. 멱등: 재실행 시 raw/conversations/ 를 비우고 다시 만든다(삭제된 세션은 사라짐). 단, 본 기능의 세션 수 상한(§5)이 입력 폭주를 1차 완화한다. 기존 인제스트 어댑터( @apc/agents : ClaudeAdapter/CodexAdapter/OpenCodeAdapter — 세션 발견·파싱·redact· NormalizedSession 정규화가 이미 구현됨)를 재사용 하고, 그 출력을 Q&A 파일로 materialize하는 레이어만 신설한다. [adapters].discoverSources+parseSource (기존, @apc/agents) │ NormalizedSession{ repoPath, tu

## Decision

- **1. 목표 / 비목표** — 1. "전 문서로 위키 생성" 버튼 하나로, 현재 프로젝트에서 진행된 claude/codex/opencode 세션이 자동으로 raw/conversations/ / /NNNq a.txt 로 청킹된다. 2. 각 파일은 Q&A 한 쌍: user 질문 + assistant 답변 텍스트 + 툴콜 한 줄 요약(스타일 B). tool result 본문(노이즈)은 제외한다. 3. 멱등: 재실행 시 raw/conversations/ 를 비우고 다시 만든다(삭제된 세션은 사라짐). 단, 본 기능의 세션 수 상한(§5)이 입력 폭주를 1차 완화한다.
- **2. 아키텍처** — 기존 인제스트 어댑터( @apc/agents : ClaudeAdapter/CodexAdapter/OpenCodeAdapter — 세션 발견·파싱·redact· NormalizedSession 정규화가 이미 구현됨)를 재사용 하고, 그 출력을 Q&A 파일로 materialize하는 레이어만 신설한다.
- **2.1 신설 파일 ( packages/app-services/src/conversation-materializer.ts )** — 단위 시작 전까지의 모든 turn( assistant / tool , 그리고 빈 텍스트 user turn — claude jsonl에서 tool result는 user role 메시지로 오므로 새 Q가 아니라 현재 단위의 answers에 속한다)을 answers 로 묶는다. 첫 단위 시작 전의 turn( system 등)은 스킵. 답이 없는 마지막 user turn도 단위가 된다(미해결 질문 = open problem 신호). Bash → Bash: ; 그 외 → 만. isError 면 (error) 접미. tool result (name === 'tool resul
- **2.2 배선** — new HarnessService({ …, conversationAdapters: ingestAdapters }) 로 주입. 테스트/CLI처럼 어댑터가 없으면 자동으로 건너뜀(하위호환).
- **3. 에러 처리** — 시크릿: turn text/resultText는 어댑터가 redact하지만 tool use.input은 raw — 본 레이어가 툴 요약 라인에 redact()를 적용한다.
- **4. 테스트 (TDD)** — 운반)은 새 Q가 아니라 현재 단위에 합류 / trailing 무응답 user 단위화. 이전 파일 제거) / maxSessions 컷 / 어댑터 throw 시 skipped 기록·정상 반환. raw/conversations/ / /001q a.txt 존재.
- **5. 결정 기록** — 최근 세션 우선이 품질·비용·timeout 모두에 안전. 필요 시 옵션으로 상향.
- **6. 핵심 파일**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-11-conversation-qa-chunking-design.md`
