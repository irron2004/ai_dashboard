---
title: "보고서 — S3: 콘솔이 멀티에이전트 dev 하네스를 구동"
slug: docs-handoffs-2026-07-01-s3-dev-harness-report
sources: [docs/handoffs/2026-07-01-s3-dev-harness-report.md]
topic: [wiki-and-knowledge-harness]
---

## Summary

PR: irron2004/ai dashboard 15 ( feat/dev-harness-orchestration ) 흐름: brainstorming → spec → writing-plans → executing-plans(inline TDD) → finishing(PR) → opus 통합 리뷰 → 리뷰 반영. 참조: spec docs/superpowers/specs/2026-07-01-dev-harness-orchestration-design.md · plan docs/superpowers/plans/2026-07-01-dev-harness-orchestration.md . 이 문서는 요청대로 ① 고려한 후보와 추천 이유 ② opus 통합 리뷰에서 나온 지적과 조치 를 정리한다. ai dashboard 콘솔에서 프로젝트 task를 골라 멀티에이전트 코딩 하네스(langgraph-agent agents up cli.sh )를 띄우고 , 로그를 live 스트리밍하며, 실행 이력을 AgentRunStore 에 기록한다. SP1/2/3(세션→Task→그래프)·S1/S2(하네스 통합)를 닫는 키스톤. 스코프: 변경은 ai dashboard 내부로만. langgraph-agent agents/CLI CONTRACT.md 는 읽기 전용 외부 seam(코드 미

## Content map

- **0. 무엇을 만들었나** — ai dashboard 콘솔에서 프로젝트 task를 골라 멀티에이전트 코딩 하네스(langgraph-agent agents up cli.sh )를 띄우고 , 로그를 live 스트리밍하며, 실행 이력을 AgentRunStore 에 기록한다. SP1/2/3(세션→Task→그래프)·S1/S2(하네스 통합)를 닫는 키스톤.
- **1. 설계 결정 — 고려한 후보와 추천 이유** — 원칙: 임시방편이 아니라 장기적으로 이득인 방향 (사용자 요구).
- **결정 1 — dev-orchestration의 위치**
- **결정 2 — CLI 호출 방식**
- **결정 3 — 프로세스 모델** — 계약이 "실행 중 stdout/stderr 스트리밍 + 종료코드"를 보장 → 블로킹 프로세스로 취급, tmux 내부 attach 안 함 ("본 계약 외 내부 구현 미의존"). CLI가 detach하면 프로젝트측 계약 위반으로 S3 밖에서 수정.
- **결정 4 — run 레코드의 agent 필드 ⭐(리뷰 중 정제)** — AgentRun.agent 에 'harness' 가 필요.
- **결정 5 — 인프라 하드닝** — 루트 vitest.config.ts 가 apps/desktop 을 제외 → SP1 회귀를 검증에서 놓쳤던 함정.
- **2. 구현 요약 (TDD, task별 커밋)** — 1. vitest.workspace.ts — 루트 test가 apps/desktop도 실행(SP1 회귀 함정 제거). 2. RunAgent enum(+harness) + AgentRunStore.fail() . 3. DevHarnessCli — CLI CONTRACT 어댑터(주입식 spawn, stream/exit/timeout/cancel). 4. DevHarnessService — run 생명주기(create→complete/fail) + transcript + 로그 fan-out + cancel. 5. devHarness IPC — CH.devHarnessRun

## Related

- Source: `docs/handoffs/2026-07-01-s3-dev-harness-report.md`
