---
title: PM 중심 AI Agent Workbench PRD v0.2
slug: docs-superpowers-specs-2026-06-02-pm-workbench-prd-v0-2
sources: [docs/superpowers/specs/2026-06-02-pm-workbench-prd-v0.2.md]
status: accepted
date: 2026-06-02
topic: [project-management]
---

## Context

title: PM 중심 AI Agent Workbench PRD v0.2 (product framing) relation: 보완 문서 — 기술 설계의 단일 진실원은 2026-06-01-agent-project-console-design.md (PRD v0.4) 구현 상태 배너 (2026-06-02, 저장소 ground-truth 대조) 이 문서는 외부 리서치 기반 제품 프레이밍 PRD 다. 아키텍처·스택·원칙은 실제 구현과 정합하지만, 일부 데이터 모델/기능 세부는 설계 제안(미구현/P1) 이다. 혼동을 막기 위해 빌드된 것과 아직 아닌 것을 아래에 명시한다 (기술 SSOT는 2026-06-01-agent-project-console-design.md ). ✅ 구현·테스트 완료 (origin/main): Electron+React+Node BFF 셸, 12개 패키지 (shared/core/pm/harness/llm-wiki/search/vault/dashboard-api/app-services/workflow/agents/knowledge), terminal-wrapper + transcript resolver(공식 로그 우선, precedence, redaction), conflict 문서, SQLite FTS5(BM25) — 세션 인덱스( @

## Decision

- **Executive summary** — 이 제품의 목표는 PM이 여러 AI agent와 함께 프로젝트를 운영하는 "개인 작업대" 를 만드는 것이다. 핵심은 네 가지를 하나의 로컬 워크벤치로 묶는 것이다. 첫째, NexusCode 스타일의 멀티 프로젝트 대시보드 로 여러 프로젝트의 현재 상태를 한 화면에서 본다. 둘째, seCall 스타일의 LLM Wiki 메모리 로 이전 대화와 작업 결과를 Markdown·YAML frontmatter· wiki-link 중심의 Obsidian 호환 vault에 저장한다. 셋째, qmd 스타일의 로컬 검색 (Markdown vault + SQLite FTS(BM25) +
- **Product framing and design principles** — 이 제품은 "코드를 직접 많이 치는 개발자 도구"보다 PM이 작업을 분해하고, agent에게 할당하고, 결과를 리뷰하고, 다음 task를 생성하는 운영 툴 이다. 성공 지표는 IDE 기능 깊이가 아니라 프로젝트 상태 가시성 , 과거 작업 맥락 재사용성 , agent 실행 통제성 , 산출물 추적 가능성 , Obsidian 호환성 이다. 핵심 설계 원칙 여섯 가지: local-first , Obsidian-compatible , agent-agnostic (라이브는 terminal wrapper로 통일, ingest는 agent별 resolver로 정규화), PM-fir
- **Architecture**
- **High-level architecture** — 아키텍처는 UI / BFF / Domain services / Storage / Workflow orchestration 으로 나눈다. 패키지 매핑: shared (schema/contract), core (DB/registry/conflict/cursor), pm (task/review/vault writer), harness (config adapter/profile store), llm-wiki (agent runner/prompt/wiki engine), search (search index), vault (vault adapter), dashboard-api
- **TypeScript-like core interfaces**
- **Component responsibilities**
- **Recommended runtime stack** — 권장 스택은 Electron + React + TypeScript + Node BFF . 근거: 현재 저장소가 이미 이 스택; contract가 전부 TypeScript; xterm/PTY·SQLite·파일시스템·local vault·renderer-main bridge가 Electron에서 자연스러움; Obsidian 호환 + 독립 앱 경험; App 골격(사이드바·PM 홈·Harness·터미널)이 이미 존재.
- **Data, ingestion, and retrieval**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-02-pm-workbench-prd-v0.2.md`
