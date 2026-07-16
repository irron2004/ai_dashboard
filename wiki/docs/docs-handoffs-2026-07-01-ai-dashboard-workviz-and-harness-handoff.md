---
title: "Handoff — ai dashboard 고도화: 작업-시각화 기능 + 하네스 통합"
slug: docs-handoffs-2026-07-01-ai-dashboard-workviz-and-harness-handoff
sources: [docs/handoffs/2026-07-01-ai-dashboard-workviz-and-harness-handoff.md]
topic: [wiki-and-knowledge-harness]
---

## Summary

한 줄 상태: 4개 메인 프로젝트(coin/calc/blog/ai dashboard)를 ai dashboard로 흡수하는 두 프로그램이 진행 중 — 작업-시각화 기능 (SP1·SP2 main 병합, SP3 PR 대기)과 하네스 통합 (S1 완료·main 병합, S2 지침 임베드, S3 미착수). 이 세션은 전부 brainstorming → spec → writing-plans → subagent-driven(+병렬) → 리뷰 게이트 → finishing 흐름으로 진행. 각 spec/plan은 docs/superpowers/{specs,plans}/2026-06-30- . 전체 지도: docs/superpowers/specs/2026-06-30-multi-project-integration-map.md . ai dashboard("agent-project-console")는 이미 흡수 substrate를 가짐 — ProjectRegistry (domain/repoPaths/vaultPaths/sourcePaths), DomainPack( project-docs paper ), app-services (harness/ingest/knowledge), graph-view , pm (TaskStore/AgentRunStore), apps/desktop

## Content map

- **1. 두 프로그램의 큰 그림** — 전체 지도: docs/superpowers/specs/2026-06-30-multi-project-integration-map.md . ai dashboard("agent-project-console")는 이미 흡수 substrate를 가짐 — ProjectRegistry (domain/repoPaths/vaultPaths/sourcePaths), DomainPack( project-docs paper ), app-services (harness/ingest/knowledge), graph-view , pm (TaskStore/AgentRunStore), apps/d
- **A. 작업-시각화 기능 (사용자 실워크플로 기반)** — 사용자는 프로젝트마다 병렬 에이전트 패널(Claude Code/OpenCode)로 일함. 니즈 = ① 빠른 전환/실행 ② 이전 요청+남은 작업을 작업↔위키 그래프 로 시각화. SP1/SP2/SP3로 분해
- **B. 하네스 통합 (S1/S2/S3)** — spec/plan …-harness-core-submodule-consolidation .
- **2. 남은 작업 (우선순위)** — 1. SP3 PR 12 머지 — 사용자가 push+PR(option 2)로 열어둠. 머지하면 실행 아이콘 반영. 2. S3 (콘솔이 하네스 구동) — SP1이 세션을 Task로 캡처하고 SP2가 그래프로 보여주니, 이제 콘솔에서 하네스 run을 띄우는 S3가 다음 자연스러운 축. CLI 계약은 langgraph-agent CLI CONTRACT.md 에 정의됨. 3. S2 마이그레이션 — coin/sns blog 열면 임베드된 지침이 떠서 진행(coin이 최저 난이도). 4. 나머지 통합 축 : coin→ prediction DomainPack(autosci 네이티브
- **3. ⚠️ 함정 / 학습 (다음 세션이 알아야 할 것)**
- **4. 리포/브랜치 상태**

## Related

- Source: `docs/handoffs/2026-07-01-ai-dashboard-workviz-and-harness-handoff.md`
