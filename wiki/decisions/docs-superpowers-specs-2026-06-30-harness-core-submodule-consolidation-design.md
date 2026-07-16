---
title: "Spec — S1: langgraph-agent를 canonical 공유 하네스 submodule로 정식화"
slug: docs-superpowers-specs-2026-06-30-harness-core-submodule-consolidation-design
sources: [docs/superpowers/specs/2026-06-30-harness-core-submodule-consolidation-design.md]
status: accepted
date: 2026-06-30
topic: [wiki-and-knowledge-harness]
---

## Context

상태: 설계(spec). 승인 후 writing-plans로 구현 계획 분기. 상위 맥락: 2026-06-30-multi-project-integration-map.md — 4 프로젝트 → ai dashboard 고도화, ② harness/PM 표준화 축. 그 축의 ③ 통합/단일화 목표를 분해한 첫 sub-project(S1). 결정 사항(브레인스토밍): 흡수 수준 = ③ consolidate · 하네스 홈 = 독립 Python 레포 + submodule · 화해 전략 = A(anoint-and-extend) → 실측 후 "이미 존재하는 canonical( langgraph-agent main )을 정식화 + 느슨한 clone을 submodule로 전환"으로 구체화 · 레퍼런스 = calculate math · 프로젝트 콘텐츠 위치 = /.harness/ (추천, 가역). 각 프로젝트의 멀티에이전트 하네스는 이미 공유 레포 github.com/irron2004/langgraph-agent 에서 왔지만, 느슨한 nested clone 으로 들어와 드리프트 중이다. submodule이 아니라 부모 repo가 핀을 기록하지 못한다. orchestrate tmux.py · orchestrate tmux v2.py · graph.py · routing.p

## Decision

- **1. 배경 — 현재 상태(실측)** — 각 프로젝트의 멀티에이전트 하네스는 이미 공유 레포 github.com/irron2004/langgraph-agent 에서 왔지만, 느슨한 nested clone 으로 들어와 드리프트 중이다. submodule이 아니라 부모 repo가 핀을 기록하지 못한다.
- **엔진 구성( agents/ 작업트리)** — orchestrate tmux.py · orchestrate tmux v2.py · graph.py · routing.py · state.py · schemas.py · patch schema.py · apply patch.py · pm intake decision.py · pm intake schema.py · json utils.py · git utils.py · run files.py · fixture utils.py · agents up.sh · agents up cli.sh · dispatch.sh · enqueue.sh · config/graph profi
- **2. 목표 / 비목표** — 1. langgraph-agent main canonical 선언 + 상태 점검. 2. core/project 경계 확정 — 엔진은 submodule, 프로젝트 전용 콘텐츠는 프로젝트로 분리(§4). 3. calc의 nested agents/ clone → git submodule add (같은 경로 agents )로 핀 전환, 부모가 핀 기록. 4. calc 로컬 드리프트 4건 화해 — 개선분은 upstream PR, .env 는 프로젝트-로컬. 5. CLI 계약 문서화 — agents up cli.sh 입출력/종료코드(§5). S3 콘솔 seam. 6. golde
- **3. 아키텍처 개요** — 의존 방향: 프로젝트 → langgraph-agent(엔진). 콘솔(ai dashboard) → CLI 구동(S3). 역방향 결합 없음. autosci-core가 이미 이 워크스페이스에서 같은 submodule 패턴을 쓴다(공유 wiki 커널) — 일관됨.
- **4. core/project 경계 (S1의 본질 작업)** — 현재 엔진 작업트리에 프로젝트 전용 콘텐츠가 섞여 있다(예: agents/config/graph profiles.json 의 calc 전용 프로필 curriculum viewer v1 ). submodule화하려면 분리해야 한다.
- **5. CLI / 콘솔 seam 계약 (S3가 소비)** — 기존 seam: agents up.sh → agents/agents up cli.sh [--workflow ] [--graph-profile ] . S1에서 계약으로 고정·문서화 한다(코드 변경 최소, 명세화가 산출물) → S3 콘솔은 이 CLI를 shell-out하고 stdout/stderr 스트리밍 + pm AgentRunStore에 run 레코드(시작/종료/transcript 경로)만 기록하면 된다. S1은 계약 정의까지, 소비는 S3.
- **6. 마이그레이션 절차 (calc 레퍼런스, 되돌리기 쉬움)** — 1. langgraph-agent main@f46638d 상태 점검. calc 로컬 4건 분류 — agents up.sh / task spec.py /오버레이 변경 = 개선이면 upstream PR로 main 반영; .env = 프로젝트-로컬; README = 케이스별. 2. 프로젝트 전용 콘텐츠 분리: agents/config/graph profiles.json 의 calc 전용 프로필 → calc/.harness/graph profiles.json . 엔진 오버레이 경로 지원분을 upstream에 포함. 3. calc의 nested agents/ clone 제거
- **7. 테스트 / 수용 기준** — 1. calc가 핀된 submodule 경유로 오케스트레이터 end-to-end 실행. 2. 기존 calc task golden-run 패리티(전/후 동작 동일). 3. 부모 repo가 .gitmodules + submodule 핀 기록( ?? agents/ 해소). 4. 프로젝트 전용 profiles가 .harness/ 에서 로드(오버레이 동작). 5. agents/tests/ green.

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-30-harness-core-submodule-consolidation-design.md`
