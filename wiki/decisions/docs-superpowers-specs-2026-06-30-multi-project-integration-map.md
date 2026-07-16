---
title: Multi-Project Integration Map — 4 프로젝트 → ai dashboard 고도화
slug: docs-superpowers-specs-2026-06-30-multi-project-integration-map
sources: [docs/superpowers/specs/2026-06-30-multi-project-integration-map.md]
status: accepted
date: 2026-06-30
topic: [project-management]
---

## Context

상태: 설계 지도(map). 축별 상세 스펙은 후속 문서로 분기. 목적: 사용자의 4개 메인 프로젝트(coin / calculate math / blog / ai dashboard)에서 나온 기능·산출물을 ai dashboard("agent-project-console")로 흡수해 고도화한다. 각 프로젝트를 도메인 으로 콘솔에 끼우는 것이 골격이며, 이는 그린필드가 아니라 이미 존재하는 추상화의 슬롯을 채우는 작업 이다. 주의: blog의 GitHub irron2004/blog 는 로컬 my/sns blog (codex 콘텐츠 생성 파이프라인)와 별개 다. 후자는 업스트림 생성기일 가능성. ProjectRegistry (packages/core/src/project-registry.ts) ← 각 프로젝트 = 1 row ├ domain: 'project-docs' 'paper' ← DomainPack 키 (★ 확장 지점) └ sourcePaths[] → 소스 문서 · 하네스 설정 app-services (packages/app-services) harness-service(fanout/interactive/workspace) · generate-service · ingest-service · knowledge-indexer · current-pro

## Decision

- **1. 네 프로젝트 현재 상태**
- **2. ai dashboard = 흡수 substrate (이미 파인 슬롯)**
- **3. 3축 통합 매핑 (확정 방향)**
- **축별 플러그 지점 / 난이도**
- **4. 핵심 통찰** — 1. substrate는 이미 있다 — ProjectRegistry + DomainPack 이 정확히 이 통합용 구조. 신규 도메인 = 추출기+렌더러+validator 세트. 2. coin이 최저 난이도 진입점 — 동일 autosci 커널이라 ① 위키 인제스트가 거의 경로 연결. 3. harness 흡수가 횡단 레버리지 — 네 프로젝트 공통 → 한 번 표준화하면 전 프로젝트 콘솔 구동·전환(= ai dashboard 본래 목적). 4. 포맷 이질성이 유일한 마찰 — calc(폴더MD)·blog(콘텐츠)는 substrate 어댑터가 필요.
- **5. 후속 분기 (축별 상세 스펙)** — 각 축은 별도 spec으로 분기하여 brainstorming → writing-plans 흐름으로 진행

## Consequences

- **5. 후속 분기 (축별 상세 스펙)** — 각 축은 별도 spec으로 분기하여 brainstorming → writing-plans 흐름으로 진행

## Related

- Source: `docs/superpowers/specs/2026-06-30-multi-project-integration-map.md`
