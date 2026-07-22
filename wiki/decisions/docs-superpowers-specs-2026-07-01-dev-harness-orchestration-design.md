---
title: "Spec — S3: 콘솔이 멀티에이전트 dev 하네스를 구동"
slug: docs-superpowers-specs-2026-07-01-dev-harness-orchestration-design
sources: [docs/superpowers/specs/2026-07-01-dev-harness-orchestration-design.md]
status: accepted
date: 2026-07-01
topic: [wiki-and-knowledge-harness]
---

## Context

상태: 설계(spec). 승인 후 writing-plans로 구현 계획 분기. 상위 맥락: 2026-06-30-multi-project-integration-map.md · 2026-06-30-harness-core-submodule-consolidation-design.md — 하네스 통합 트랙의 세 번째 sub-project. S1(canonical submodule 정식화)·S2(나머지 마이그레이션)에 이어, 콘솔이 그 하네스를 실제로 구동 하는 마지막 축. 스코프 제약(이 세션): 변경은 ai dashboard + autosci-core 내부로만 . langgraph-agent agents/CLI CONTRACT.md 는 읽기 전용 외부 seam 으로만 소비(코드 수정 금지). coin/calc/blog 통합( 4/ 5/ 6)·superproject 포인터 정리는 범위 밖. S1에서 agents up cli.sh 의 입출력/종료코드를 CLI CONTRACT.md 로 고정했다. S3는 그 계약의 소비자 다. 목표: 콘솔에서 프로젝트의 task를 선택해 멀티에이전트 하네스를 띄우고 , 실시간 로그를 보고, 실행 이력을 AgentRunStore 에 남긴다. CLI CONTRACT.md seam만 의존한다. 1. DevHarnessService

## Decision

- **1. 배경 — 실측** — S1에서 agents up cli.sh 의 입출력/종료코드를 CLI CONTRACT.md 로 고정했다. S3는 그 계약의 소비자 다. ai dashboard 콘솔 실측 구조
- **2. 목표 / 비목표** — 1. DevHarnessService (신규, app-services) — projectId+taskId로 하네스 CLI를 shell-out, run 레코드 기록, 로그 스트리밍. 2. HarnessCli (신규, 주입식 spawner) — CLI CONTRACT.md 입출력/종료코드 어댑터. spawn DI로 테스트. 3. AgentRun 기록 — start 시 create(status='running') , 종료 시 complete / fail (+ transcriptPath ). 4. 로그 스트리밍 — stdout/stderr를 renderer live tail
- **3. 고려한 대안과 결정 (보고서용 후보 분석)**
- **결정 1 — dev-orchestration의 위치 ⭐**
- **결정 2 — CLI 호출 방식**
- **결정 3 — 프로세스 모델** — 계약( CLI CONTRACT.md )은 "실행 중 stdout/stderr 스트리밍 + 종료코드 0/비0"을 보장한다. → 블로킹 프로세스로 취급 (스트리밍하다 exit code로 종료). tmux 내부에 attach하지 않는다("본 계약 외 내부 구현에 의존하지 않는다"). CLI가 detach하면 프로젝트측 계약 위반 으로 S3 밖에서 수정.
- **결정 4 — agent 필드** — AgentKind 에 단일 에이전트만 있어 오케스트레이터 run을 표현 못 함.
- **결정 5 — 인프라 하드닝 방식** — 루트 vitest.config.ts 의 include 가 packages/ · scripts/ 만 포함 → apps/desktop 누락(SP1 회귀 원인).

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-07-01-dev-harness-orchestration-design.md`
