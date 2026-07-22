---
title: 전 문서 → 위키 원클릭 + 커버리지 검증
slug: docs-superpowers-specs-2026-06-08-docs-to-wiki-coverage-design
sources: [docs/superpowers/specs/2026-06-08-docs-to-wiki-coverage-design.md]
status: accepted
date: 2026-06-08
topic: [wiki-and-knowledge-harness]
---

## Context

title: 전 문서 → 위키 원클릭 + 커버리지(누락) 검증 설계 branch: docs/knowledge-harness-pipeline-spec (또는 신규 feature 브랜치) approach: A — 프로젝트 문서를 vault/raw/project-docs/로 materialize한 뒤, 기존 Knowledge Harness 파이프라인 위에 커버리지(문서→노드) 검증 UI를 올린다. 사용자 핵심 목표: 프로젝트 하위 경로의 모든 문서를 LLM 위키로 정리하고, 버튼 한 번으로 실행하며, "빠진 문서가 없는지(누락)"를 한 화면에서 검증 한다. 결론: 엔진은 있다. 빠진 것은 ① 프로젝트 문서를 소스로 모아오는 단계 , ② 문서↔노드 매핑(커버리지) 데이터 , ③ 그걸 보여주는 검증 화면 , ④ 셋을 잇는 원클릭 이다. [버튼] ──▶ harnessRun({ materialize: true }) ├─0 SourceMaterializer.run(repoPaths, vaultRoot) │ → vault/raw/project-docs/ 복사 + manifest ├─1..8 기존 HarnessRunner (9단계 파이프라인, 변경 최소) │ SOURCES EXTRACTED에서 raw/ 전체를 sources로 읽음(기존) └─끝 buildCover

## Decision

- **1. 배경 / 문제** — 사용자 핵심 목표: 프로젝트 하위 경로의 모든 문서를 LLM 위키로 정리하고, 버튼 한 번으로 실행하며, "빠진 문서가 없는지(누락)"를 한 화면에서 검증 한다. 탐색으로 확인한 현 상태(파일 근거)
- **2. 설계 결정 (확정)**
- **3. 아키텍처 / 데이터 흐름**
- **4. 컴포넌트**
- **4.1 SourceMaterializer (신규, backend)** — 1. 각 repoPath를 재귀 스캔 (기존 vault-fs.ts 의 readdir 재사용 가능). 2. 문서 확장자만: .md , .markdown , .txt . 3. 제외 디렉터리 : node modules , .git , dist , build , .worktrees , 그리고 vaultRoot 자기 자신(위키를 다시 소스로 빨아들이지 않도록). 4. 대상 위치: /raw/project-docs/ / 로 복사. 5. 멱등 : raw/project-docs/ 를 먼저 비우고 다시 채움(삭제된 문서가 사라지도록). raw/ 의 다른 하위(사용자 수동 소스)는 건드
- **4.2 커버리지 데이터 ( coverage-report , 신규)**
- **4.3 IPC / 서비스 변경 (최소)**
- **4.4 Coverage UI (신규, renderer)**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-08-docs-to-wiki-coverage-design.md`
