---
title: Evidence-based Knowledge Harness (PM Memory Consolidation Harness) Design
slug: docs-superpowers-specs-2026-06-02-knowledge-harness-design
sources: [docs/superpowers/specs/2026-06-02-knowledge-harness-design.md]
status: accepted
date: 2026-06-02
topic: [wiki-and-knowledge-harness]
---

## Context

Knowledge Harness는 자동 문서 작성기가 아니다. Knowledge Harness는 evidence-based proposal system이다. 기존 이름이 단순히 Knowledge Harness 였다면, 이제는 더 정확히 즉, agent 작업 이력을 프로젝트 기억으로 승격시키는 운영 시스템 입니다. Worker agent는 지식을 쓰지 않는다. Worker agent는 evidence가 붙은 proposal만 만든다. Lead agent만 병합 판단을 하고, Writer는 승인된 plan만 실행한다. 아키텍처는 기존 agent 중심 설계에서 runtime / policy / verification 중심 설계 로 변경됩니다. │ ├── DocumentIntentClassifierAgent │ ├── ConversationHistoryReaderAgent │ ├── KnowledgeNodeExtractorAgent ├── 4. Lead / Coordinator Layer │ ├── SharedKnowledgePromoterAgent │ ├── EvidenceRequirementChecker └── 8. Memory Consolidation Layer ├── KnowledgeConsolidationAgent 처음부터 Claude/Code

## Decision

- **1. 정체성과 목적** — 기존 이름이 단순히 Knowledge Harness 였다면, 이제는 더 정확히 라고 볼 수 있습니다. 이 하네스의 목적은 단순 정리가 아닙니다. 즉, agent 작업 이력을 프로젝트 기억으로 승격시키는 운영 시스템 입니다. 핵심 원칙은 이 문장으로 요약됩니다.
- **2. 최상위 아키텍처** — 아키텍처는 기존 agent 중심 설계에서 runtime / policy / verification 중심 설계 로 변경됩니다.
- **3. MVP Agent 구성** — 처음부터 Claude/Codex/OpenCode 전용 reader를 분리하지 않고, 하나의 범용 reader로 통합 합니다.
- **기존 후보**
- **MVP 추천** — 내부 필드로 구분 이렇게 하면 초반 복잡도가 줄어듭니다.
- **4. MVP에 반드시 필요한 8개 구성** — 1. WikiGraphLeadAgent 2. ProjectDiscoveryAgent 3. DocumentIntentClassifierAgent 4. ConversationHistoryReaderAgent 5. KnowledgeNodeExtractorAgent 6. ObsidianWikiWriterAgent 7. GraphIntegrityAgent 8. PolicyGuard 특히 PolicyGuard 와 GraphIntegrityAgent 는 MVP부터 반드시 필요 합니다. 이 둘이 없으면 초반부터 위키가 오염됩니다.
- **5. 가장 먼저 파일로 만들어야 하는 것** — 프롬프트보다 먼저 규칙 파일과 스키마 를 만듭니다. 1. harness-rules.md 2. node-proposal.schema.yml 3. write-plan.schema.yml 4. feature-gates.yml 5. run-state-machine.yml Agent 프롬프트는 그 다음입니다.
- **6. Harness Rules ( harness-rules.md 초안)** — 이 파일은 모든 agent가 공통으로 읽어야 합니다.

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-02-knowledge-harness-design.md`
