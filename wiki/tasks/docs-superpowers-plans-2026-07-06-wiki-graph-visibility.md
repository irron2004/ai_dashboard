---
title: Wiki Graph Visibility Implementation Plan
slug: docs-superpowers-plans-2026-07-06-wiki-graph-visibility
sources: [docs/superpowers/plans/2026-07-06-wiki-graph-visibility.md]
status: open
created: 2026-07-06
topic: [graph-and-visualization]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: ai dashboard 그래프 뷰어가 4개 프로젝트(autosci-core, coin, calculate math, ai dashboard)의 실제 위키를 찾아서 시각화할 수 있게 한다. Architecture: 그래프 뷰어의 위키 리더( read-wiki.ts )는 현재 /wiki → /.apc-wiki 만 탐색하고, edges.jsonl의 커널 형식 ref( type:slug , 콜론)를 노드 ref( type/slug , 슬래시)에 매핑하지 못한다. (1) edges.jsonl ref를 노드 별칭 테이블로 해석하고, (2) registry의 vaultPaths 를 직접 위키 루트로 읽도록 배선하고, (3) 양쪽 DB(WSL/Windows)에 4개 프로젝트를 올바른 경로로 등록하고, (4) coin의 wiki-kernel.yaml 드리프트를 해소한다.

## Progress log

- Source checklist: 0 completed, 19 remaining.
- **Global Constraints**
- **배경 (구현자가 알아야 할 사실)**
- **Task 1: 상속받은 read-wiki 개선 커밋 + 커널 콜론 ref 해석** — 작업 트리에는 이전 세션이 남긴 미커밋 read-wiki 개선(전체 트리 걷기, 위키링크 엣지 합성, .apc-wiki 폴백 + 테스트 2개)이 이미 있다. 이것이 이 플랜의 기반이므로 먼저 그대로 커밋한다. read-wiki.test.ts 의 describe('readProjectWiki', ...) 블록 안에 추가 예상: 새 테스트 2개 FAIL ( from: 'pipelines:p1' 이 그대로 남아 있어서), 기존 5개 PASS. read-wiki.ts — nodeTypeAndRef 가 slug도 반환하도록 변경 readWikiRoot 의 노드 루프에서 콜론
- **Task 2: registry vaultPaths를 직접 위키 루트로 읽기 + container 배선** — read-wiki.test.ts 에 추가 예상: 새 테스트 2개가 컴파일 오류 또는 FAIL (2번째 인자 미지원). read-wiki.ts — import에 isAbsolute 추가 readProjectWiki 교체 container.ts 의 readProjectWikiQuery 교체
- **Task 3: 프로젝트 등록 정리 (WSL+Windows DB) + 실데이터 스모크** — 스크래치 디렉터리에 register-projects.py 로 저장 후 python3 register-projects.py 실행. 이름(name) 기준 upsert — 이미 있으면 경로만 갱신, 없으면 INSERT. 다른 행은 건드리지 않는다.
- **WSL DB (WSL에서 실행하는 앱용 — /mnt/c 경로)** — upsert(WSL, "ai dash", [f"{L}/ai dashboard-main"], []) upsert(WSL, "stock", [f"{L}/coin"], [f"{L}/coin/data/hypotheses/wiki"]) upsert(WSL, "autosci", [f"{L}/autosci-core"], [f"{L}/autosci-core/research/wiki"]) upsert(WSL, "calculate math", [f"{L}/calculate math"], [f"{L}/calculate math/02 데이터/curriculum wiki"])
- **Windows DB (Windows에서 실행하는 앱용 — C:\ 경로). stock은 기존 행 갱신.** — upsert(WIN, "ai dash", [f"{W}\\ai dashboard-main"], []) upsert(WIN, "stock", [f"{W}\\coin"], [f"{W}\\coin\\data\\hypotheses\\wiki"]) upsert(WIN, "autosci", [f"{W}\\autosci-core"], [f"{W}\\autosci-core\\research\\wiki"]) upsert(WIN, "calculate math", [f"{W}\\calculate math"], [f"{W}\\calculate math\\02 데이터\\curriculum w
- **Task 4: coin wiki-kernel.yaml 드리프트 해소 + 레거시 vault 표기** — 판정 규칙

## Related

- Source: `docs/superpowers/plans/2026-07-06-wiki-graph-visibility.md`
