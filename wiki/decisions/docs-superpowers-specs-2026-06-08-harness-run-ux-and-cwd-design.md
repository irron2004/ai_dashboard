---
title: Harness run 사용성 + 엔진 cwd 수정
slug: docs-superpowers-specs-2026-06-08-harness-run-ux-and-cwd-design
sources: [docs/superpowers/specs/2026-06-08-harness-run-ux-and-cwd-design.md]
status: accepted
date: 2026-06-08
topic: [wiki-and-knowledge-harness]
---

## Context

title: Harness run 사용성 + 엔진 CLI 실행 위치(cwd) 수정 설계 trigger: 사용자가 "전 문서로 위키 생성" 클릭 → 긴 무반응 후 "Promote failed: run is FAILED, expected HUMAN REVIEW REQUIRED". 실제 원인 = project-discovery failed: agent runner returned not-ok . branch: docs/knowledge-harness-pipeline-spec (또는 신규 feature 브랜치) "전 문서로 위키 생성"(= startHarnessRun(true) )을 누르면 9단계 파이프라인 전체가 한 번의 블로킹 호출로 돌고, 그중 5단계가 엔진 CLI(claude/codex/opencode)를 spawn하는 LLM 호출이다. 사용자 보고를 코드로 진단한 결과 4가지 실제 결함이 확인됐다. 1. 실패 사유가 깡통 메시지 — LlmAgent.run ( packages/knowledge-harness/src/agents/llm-agent.ts:32 )이 !res.ok 일 때 agent runner returned not-ok 만 던진다. 정작 CliAgentRunner 는 실제 원인( res.raw = stderr/spawn 에러, 예 s

## Decision

- **1. 배경 / 진단** — "전 문서로 위키 생성"(= startHarnessRun(true) )을 누르면 9단계 파이프라인 전체가 한 번의 블로킹 호출로 돌고, 그중 5단계가 엔진 CLI(claude/codex/opencode)를 spawn하는 LLM 호출이다. 사용자 보고를 코드로 진단한 결과 4가지 실제 결함이 확인됐다. 1. 실패 사유가 깡통 메시지 — LlmAgent.run ( packages/knowledge-harness/src/agents/llm-agent.ts:32 )이 !res.ok 일 때 agent runner returned not-ok 만 던진다. 정작 CliAgentR
- **2. 범위 (확정)** — 이번 작업 = (d) 실패 사유 살리기 + (e) cwd 수정 + (b) Coverage 탭 상태 표시 + (c) promote 가드 . (a) 실시간 단계 진행바는 다음 작업(성공 run이 가능해진 뒤)으로 분리.
- **3. 변경 설계**
- **(d) 실패 사유에 실제 CLI 에러 포함 — LlmAgent.run** — !res.ok 일 때 엔진명 + res.raw (앞 300자)를 포함해 던진다 → FAILED 사유가 project-discovery failed (claude): spawn claude ENOENT 처럼 actionable해진다.
- **(e) 엔진 CLI를 프로젝트 폴더(cwd)에서 실행 — cwd 배선**
- **(b) Coverage 탭에 run 상태/실패 표시 — HarnessDashboard.tsx** — coverage 탭 본문을 우선순위 분기로 교체 1. harnessLoading → "⏳ 위키 생성 중… (수 분 소요 — 단계별 LLM 호출)" 2. else coverageData → 3. else currentRun?.runState.state === 'FAILED' → "❌ 실패: {currentRun.runState.error ?? '원인 미상'}" 4. else → 기존 placeholder ( RunState 에 state · error? 존재 — kh-schema.ts:159-168 .)
- **(c) promote 가드 — HarnessDashboard.tsx + AgentConfigPanel**
- **4. 테스트**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-08-harness-run-ux-and-cwd-design.md`
