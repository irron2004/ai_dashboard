---
title: 폴더 기반 PM-워커 위키 생성
slug: docs-superpowers-specs-2026-06-16-folder-orchestrator-wiki-design
sources: [docs/superpowers/specs/2026-06-16-folder-orchestrator-wiki-design.md]
status: accepted
date: 2026-06-16
topic: [wiki-and-knowledge-harness]
---

## Context

title: 폴더 기반 PM-워커(orchestrator-workers) 위키 생성 설계 status: implemented (phases 1–5) branch: feat/workspace-vault (또는 신규 feat/folder-orchestrator) approach: 소스를 폴더 단위로 분할하고, PM(오케스트레이터)이 폴더별 역할을 분류·워커를 할당, 폴더 워커가 자기 폴더의 문서+관련 세션으로 노드를 제안, PM이 폴더 간 엣지를 해소하며 병합·검수한다. 기존 5개 에이전트를 폴더 스코프 루프로 재배치한다(신규 에이전트 최소). 현재 하니스는 모든 소스를 한 프롬프트에 직렬화하는 단발(single-shot) 구조다 SourceReader ( source-reader.ts )에 파일당 64KB 캡은 있으나 총량 캡이 없어 , 실제 규모(문서 200개) 프로젝트에서 프롬프트가 모델 토큰 윈도를 초과한다. 실측 실패 현재 임시 대응으로 budgetSourcesForPrompt (기본 200K자)가 초과분 소스를 드롭 한다 — 크래시는 막지만 커버리지 손실 (드롭된 문서는 위키에 미반영). 이는 band-aid이며 구조적 해결이 아니다. 결론: 단발 구조를 버리고, 의미 단위(폴더)로 분할하는 orchestrator-workers 구조로 전

## Decision

- **1. 배경 / 문제** — 현재 하니스는 모든 소스를 한 프롬프트에 직렬화하는 단발(single-shot) 구조다 SourceReader ( source-reader.ts )에 파일당 64KB 캡은 있으나 총량 캡이 없어 , 실제 규모(문서 200개) 프로젝트에서 프롬프트가 모델 토큰 윈도를 초과한다. 실측 실패 현재 임시 대응으로 budgetSourcesForPrompt (기본 200K자)가 초과분 소스를 드롭 한다 — 크래시는 막지만 커버리지 손실 (드롭된 문서는 위키에 미반영). 이는 band-aid이며 구조적 해결이 아니다.
- **2. 핵심 아이디어** — 평면적 청킹(바이트 단위)보다 우월한 이유: 폴더는 응집된 의미 단위 라 워커가 끊기지 않은 맥락을 받는다. 그리고 소스를 드롭하지 않는다(전 폴더 처리).
- **3. 설계 결정 (초안 — 검토 필요)**
- **4. 기존 에이전트/상태에 매핑 (재사용)** — 핵심: NODE PROPOSALS CREATED 드라이버가 단일 호출에서 폴더 fan-out 루프로 바뀌는 것 이 변경의 중심. 상태 머신·아티팩트 메커니즘은 그대로.
- **5. 아키텍처 / 데이터 흐름**
- **6. 데이터 구조 (신규/변경)** — // 워커 출력에 추가되는 필드 — PM 리듀서가 해소 type CrossFolderRef = { from node id: string to hint: string // 참조 대상 설명(타 폴더 개념/파일) evidence id?: string }
- **7. 반드시 풀어야 할 3가지 난점 + 해법(안)**
- **7.1 폴더 간 엣지 (가장 어려움)**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-16-folder-orchestrator-wiki-design.md`
