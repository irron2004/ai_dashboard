---
title: "S1: langgraph-agent 공유 하네스 submodule 정식화 — Implementation Plan"
slug: docs-superpowers-plans-2026-06-30-harness-core-submodule-consolidation
sources: [docs/superpowers/plans/2026-06-30-harness-core-submodule-consolidation.md]
status: open
created: 2026-06-30
topic: [wiki-and-knowledge-harness]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: 느슨한 nested clone으로 흩어진 공유 하네스 irron2004/langgraph-agent 를 정식 git submodule로 규격화하고, calculate math를 레퍼런스로 전환해 동작 패리티를 증명한다. Architecture: 엔진(orchestrator)은 langgraph-agent 에 단일 진실원으로 두고 각 프로젝트가 agents/ 경로에 핀된 submodule로 소비한다. 프로젝트 전용 graph profile은 엔진 밖 /.harness/graph profiles.json 오버레이로 분리하며, 엔진은 이 오버레이를 기본 프로필 위에 per-key 병합한다. 콘솔(ai dashboard) 구동은 기존 agents up cli.sh CLI seam을 통해 후속 spec(S3)에서 붙인다. Tech Stack: Python 3 (엔

## Progress log

- Source checklist: 0 completed, 26 remaining.
- **Global Constraints**
- **Phase A — 엔진(langgraph-agent) 변경**
- **Task 1: calc 로컬 드리프트(task tier 기능) upstream + .env 위생** — calc가 로컬에서만 들고 있던 4개 변경을 분류·정식화한다: task spec.py · agents up.sh · README.md = task tier (lightweight/complex) 기능(엔진 개선 → 커밋), .env = 프로젝트-로컬(추적 해제). Run Expected: task spec.py (+ task tier 필드), agents up.sh (+ TASK TIER / normalize task tier ), README.md , .env 4개만 수정됨. Run Expected: .env 가 staged-deletion, working copy
- **Task 2: .harness/graph profiles.json 오버레이 메커니즘 (TDD)** — 엔진이 기본(non-explicit) 경로일 때 $ROOT/.harness/graph profiles.json 을 엔진 기본 프로필 위에 per-key 병합하도록 한다. 명시적 --graph-profiles-path 는 종전대로 그 파일만 사용. Create calculate math/agents/tests/test load graph profiles overlay.py Run: cd /mnt/c/Users/irron/Desktop/my/ruahverce/calculate math/agents && python -m pytest tests/test load graph
- **Task 3: 엔진 config에서 프로젝트 전용 프로필 제거** — agents/config/graph profiles.json 에 섞인 calc 전용 프로필( curriculum viewer v1 , curriculum research 3r )을 엔진에서 분리한다. 제거분 JSON은 Phase B(Task 4)에서 calc/.harness/ 로 재배치하므로 임시 백업 파일 로 보존한다. Run Expected: engine keys now: 목록에 curriculum 없음. backed up: = ['curriculum viewer v1', 'curriculum research 3r'] . Run: python -m pytest t
- **하네스 CLI 계약 (agents up cli.sh)** — 콘솔(ai dashboard, S3)이 이 하네스를 구동할 때 의존하는 안정 계약. 변경 시 SemVer 주의.
- **진입점** — agents up cli.sh [--workflow ] [--graph-profile ] (프로젝트 루트의 thin agents up.sh 가 이를 호출)
- **입력**

## Related

- Source: `docs/superpowers/plans/2026-06-30-harness-core-submodule-consolidation.md`
