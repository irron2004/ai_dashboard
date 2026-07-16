---
title: Wiki 노드 뷰잉 + 잔재 stub 청소 — 설계
slug: docs-superpowers-specs-2026-06-17-wiki-node-viewing-and-stub-cleanup-design
sources: [docs/superpowers/specs/2026-06-17-wiki-node-viewing-and-stub-cleanup-design.md]
status: accepted
date: 2026-06-17
topic: [wiki-and-knowledge-harness]
---

## Context

상태: 설계 승인 대기 → (승인 시) 구현 계획(writing-plans)으로 이 설계는 사용자와의 brainstorming 대화에서 나왔다. 흐름을 그대로 남긴다 — 결론만큼 경로 가 중요하기 때문이다. 1. 출발점(불만): "사용성이 매우 떨어진다. wiki가 잘 생성됐는지도 모르겠고, 노드를 누르면 '허용되지 않는 경로'라고 뜬다. 고치라는 게 아니라, 한 번에 너무 많은 기능을 만들어서 어디서부터 잡아야 할지 모르겠다." 2. 툴의 정체성: "PM도 사용하는 vibe coding 툴" + "ontology 구축 harness". 3. 북극성(이상): task 하나를 누르면 그 task의 코드 변경(git diff) + 작업 내용(handoff·대화) + 거기서 정리된 지식(wiki)이 한 화면에 모이고, LLM이 그 wiki를 읽고 답한다. 4. 추가 요구(가독성): 노드가 많이 생기니 폴더별 필터, 폴더/task별 군집 배치 등 가독성 작업이 필요. 5. 진짜 핵심 페인: "결정적으로, 지금 문서가 잘 생성되고 있나? 대화에서 내용이 잘 추출되고 있나? 이게 안 보여서 확신이 없다." 6. 우선순위 선택: 사용자는 "내용 채우기가 우선"이라고 판단. 7. 코드·데이터를 직접 깐 결과 — 전제가 뒤집힘: 현재 코드는 이미 진짜 문서를 잘

## Decision

- **0. 대화 요약 (이 스펙에 이르기까지)** — 이 설계는 사용자와의 brainstorming 대화에서 나왔다. 흐름을 그대로 남긴다 — 결론만큼 경로 가 중요하기 때문이다. 1. 출발점(불만): "사용성이 매우 떨어진다. wiki가 잘 생성됐는지도 모르겠고, 노드를 누르면 '허용되지 않는 경로'라고 뜬다. 고치라는 게 아니라, 한 번에 너무 많은 기능을 만들어서 어디서부터 잡아야 할지 모르겠다." 2. 툴의 정체성: "PM도 사용하는 vibe coding 툴" + "ontology 구축 harness". 3. 북극성(이상): task 하나를 누르면 그 task의 코드 변경(git diff) + 작업 내용(hand
- **1. 문제 정의** — 사용자는 wiki harness가 제대로 동작하는지 확신할 수 없다 . 두 가지 증상 두 증상 모두 "생성·추출 품질이 눈에 안 보인다" 는 한 가지 근본 불안으로 수렴한다.
- **2. 진단 (코드 + 실제 데이터 증거)** — 데이터 위치: Windows ~/AppData/Roaming/@apc/desktop/apc-harness-runs (live). Linux ~/.config/@apc/desktop 는 stale.
- **2.1 엔진은 동작하고, 내용도 이미 잘 채워진다**
- **2.2 결정적 증거 — 구버전 vs 현재 코드** — chamber leak shared loader contract.md (2443 B)는 frontmatter + 핵심 주장 4개 + 근거 4건(대화·문서 인용)을 갖춘 완전한 문서다 — 사용자의 "대화에서 잘 추출됐나"에 직접 답한다.
- **2.3 그래서 두 증상의 진짜 원인**
- **3. 요구사항**
- **기능 요구**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-17-wiki-node-viewing-and-stub-cleanup-design.md`
