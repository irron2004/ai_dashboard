---
title: Knowledge Harness — MVP 8-agent Pipeline 구현 설계
slug: docs-superpowers-specs-2026-06-02-knowledge-harness-pipeline-impl-design
sources: [docs/superpowers/specs/2026-06-02-knowledge-harness-pipeline-impl-design.md]
status: accepted
date: 2026-06-02
topic: [wiki-and-knowledge-harness]
---

## Context

title: Knowledge Harness — MVP 8-agent Pipeline 구현 설계 상위 설계 문서( 2026-06-02-knowledge-harness-design.md )는 제품/아키텍처 스펙이다. 이 문서는 그것을 이 모노레포에서 어떤 패키지·모듈·계약으로 구현하는지 를 고정한다. Worker는 proposal만, Lead는 merge만, Writer는 plan만, Validator는 검증만, Human이 canonical/shared 승인. Raw는 불변. KnowledgeNodeExtractor, WikiGraphLead, ObsidianWikiWriter, GraphIntegrity, PolicyGuard) + RunStateMachine + staging vault + validation + eval report. 자동 삭제/deprecate, git-worktree 기반 staging, 다중 세션 synthesis, 스케줄 실행. 기존 GenerateService (one-shot: 최신 세션 → WikiEngine 1회 호출 → current.proposal.md )는 건드리지 않는다. 새 파이프라인은 별도 패키지 @apc/knowledge-harness 로 병행하며, 아래 기존 자산을 재사용한다. package.js

## Decision

- **0. 목적과 범위** — 상위 설계 문서( 2026-06-02-knowledge-harness-design.md )는 제품/아키텍처 스펙이다. 이 문서는 그것을 이 모노레포에서 어떤 패키지·모듈·계약으로 구현하는지 를 고정한다. 핵심 원칙(상위 문서에서 그대로 계승)
- **범위 (MVP)** — KnowledgeNodeExtractor, WikiGraphLead, ObsidianWikiWriter, GraphIntegrity, PolicyGuard) + RunStateMachine + staging vault + validation + eval report. 자동 삭제/deprecate, git-worktree 기반 staging, 다중 세션 synthesis, 스케줄 실행.
- **기존 자산과의 관계** — 기존 GenerateService (one-shot: 최신 세션 → WikiEngine 1회 호출 → current.proposal.md )는 건드리지 않는다. 새 파이프라인은 별도 패키지 @apc/knowledge-harness 로 병행하며, 아래 기존 자산을 재사용한다.
- **1. 패키지 경계**
- **2. 모듈 레이아웃** — harness/ 설정 디렉터리(설계 §5)는 런타임 config 로 둔다.
- **3. Agent 계약**
- **LLM agent (6개)** — LlmAgent base가 처리 1. 프롬프트 조립 = harness-rules.md preamble + role 프롬프트 + 입력 artifact JSON. 2. ctx.runner.run({ agent: ctx.engine, prompt, timeoutMs }) . 3. unwrapAgentJson(res.output, ctx.engine) → parseStructured(json, ZodSchema) . 4. 실패 시 ok:false 를 그대로 올려 runner가 FAILED 처리. 대상: ProjectDiscovery, ConversationHistoryRea
- **결정론 agent (PolicyGuard, GraphIntegrity, 3 validators)** — 평범한 클래스로 구현하고 fixture로 단위 테스트한다.

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-02-knowledge-harness-pipeline-impl-design.md`
