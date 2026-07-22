---
title: "Harness 구조화 로깅 — 설계 (Phase 1: 관측 가능성)"
slug: docs-superpowers-specs-2026-06-10-harness-structured-logging-design
sources: [docs/superpowers/specs/2026-06-10-harness-structured-logging-design.md]
status: accepted
date: 2026-06-10
topic: [wiki-and-knowledge-harness]
---

## Context

근거 진단: docs/handoffs/2026-06-09-harness-codex-discovery-failure.md — stderr·exit code 유실(결함 A), 에러 메시지 800자 tail 잘림(결함 B), 실패 시 전체 출력 미보존(결함 C). 1. 엔진 호출마다 prompt·stdout·stderr·exit code·소요시간을 run 디렉터리에 성공·실패 불문 영속한다. 2. 실패 메시지에 exit code와 stderr(우선)의 양단(head+tail)을 노출하고, 전체 로그 경로를 안내한다. 3. 실행 중 엔진 출력을 실시간으로 UI에 흘려 "지금 무슨 단계에서 뭘 하는지"를 보여준다. LlmAgent → LoggingAgentRunner(신규) → RoutingAgentRunner → CliAgentRunner SshAgentRunner meta.json { ok, exitCode, command, durationMs, engine, label, sshHost?, startedAt, endedAt } 은 run 내 호출 순번(01, 02, …), 은 - (예: PROJECT SCANNED-project-discovery ). raw 는 진단용 결합 문자열로 유지하되 stderr 우선 + stdout 병기 (단락 평가로 한쪽을

## Decision

- **1. 목표 / 비목표** — 1. 엔진 호출마다 prompt·stdout·stderr·exit code·소요시간을 run 디렉터리에 성공·실패 불문 영속한다. 2. 실패 메시지에 exit code와 stderr(우선)의 양단(head+tail)을 노출하고, 전체 로그 경로를 안내한다. 3. 실행 중 엔진 출력을 실시간으로 UI에 흘려 "지금 무슨 단계에서 뭘 하는지"를 보여준다.
- **2. 아키텍처** — 엔진 호출 경로에 로깅 데코레이터 한 겹을 추가한다 은 run 내 호출 순번(01, 02, …), 은 - (예: PROJECT SCANNED-project-discovery ).
- **2.1 계약 변경 ( packages/llm-wiki/src/agent-runner.ts )**
- **2.2 CliAgentRunner ( packages/llm-wiki/src/cli-agent-runner.ts )** — raw 는 진단용 결합 문자열로 유지하되 stderr 우선 + stdout 병기 (단락 평가로 한쪽을 버리지 않음).
- **2.3 SshAgentRunner / ssh-exec.ts ( apps/desktop/src/main/ )**
- **2.4 LoggingAgentRunner (신규, packages/llm-wiki/src/logging-agent-runner.ts )** — 1. 호출 순번 증가 → logs/ - / 생성, prompt.txt 기록. 2. input.onChunk 를 래핑: 원래 콜백 호출 + 해당 스트림 로그 파일에 즉시 append (타임아웃·크래시 시에도 그 시점까지 디스크에 남도록). 3. inner 결과 수신 후 meta.json 기록, 결과 그대로 반환.
- **2.5 배선 ( packages/app-services/src/harness-service.ts , make-drivers.ts )**
- **3. 에러 메시지 ( packages/knowledge-harness/src/agents/llm-agent.ts )** — 기존 "끝 800자" 정책을 교체

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-10-harness-structured-logging-design.md`
