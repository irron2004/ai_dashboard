---
title: "Spec — SP2: 작업↔위키 그래프 뷰"
slug: docs-superpowers-specs-2026-06-30-work-wiki-graph-design
sources: [docs/superpowers/specs/2026-06-30-work-wiki-graph-design.md]
status: accepted
date: 2026-06-30
topic: [graph-and-visualization]
---

## Context

상태: 설계(spec). 승인 후 writing-plans로 분기. 상위 맥락: 사용자 니즈 — 이전 요청 + 남은 작업을 작업↔위키 그래프 로 시각화. 3개 sub-project 중 SP2(그래프 뷰) = 헤드라인 "그래프로 보기". (SP3 실행 아이콘 PR 12; SP1 세션→Task 캡처 main 병합 @ffc82b3.) 결정 사항(브레인스토밍): 노드 = 요청-Task만 (todos = 노드 클릭 상세) · 접근법 = A (캡처에 링크 저장 + buildWorkGraphData + KnowledgeView 'work' 소스) · 엣지 = 세션이 실제로 그 위키 파일을 편집 ( filesTouched ⊇ wiki relPath suffix)했을 때만. SP1이 에이전트 세션을 pm Task로 캡처한다(요청-Task req:${projectId}:${sessionId} + 자식 todo-Task). graph-view는 이미 task 노드 타입을 가진 타입드 그래프 렌더러다: GraphNode = { id; label; type: GraphNodeType('run' 'task' 'evidence' 'file' 'document' …); shape; color; details?; data? } , GraphData = { nodes; link

## Decision

- **1. 배경** — SP1이 에이전트 세션을 pm Task로 캡처한다(요청-Task req:${projectId}:${sessionId} + 자식 todo-Task). graph-view는 이미 task 노드 타입을 가진 타입드 그래프 렌더러다: GraphNode = { id; label; type: GraphNodeType('run' 'task' 'evidence' 'file' 'document' …); shape; color; details?; data? } , GraphData = { nodes; links } , GraphVisualization({ data, onNodeClic
- **2. 목표 / 비목표**
- **3. 데이터 흐름**
- **4. 컴포넌트 / 인터페이스**
- **4.1 extractTasks 확장 (app-services/task-extractor.ts)** — 요청-Task 생성 시 linkedWikiPages: session.filesTouched 를 추가(현재 [] ). todo-Task는 불변. 기존 테스트 + 1 케이스( request.linkedWikiPages === session.filesTouched ).
- **4.2 buildWorkGraphData (graph-view, NEW)**
- **4.3 tasks IPC (desktop)**
- **4.4 KnowledgeView**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-30-work-wiki-graph-design.md`
