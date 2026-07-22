---
title: Wiki Policy Advisor — 설계 문서
slug: docs-superpowers-specs-2026-06-13-wiki-policy-advisor-design
sources: [docs/superpowers/specs/2026-06-13-wiki-policy-advisor-design.md]
status: accepted
date: 2026-06-13
topic: [wiki-and-knowledge-harness]
---

## Context

Origin: 사용자 요청 (2026-06-12, 3-tab restructure 중). 핸드오프 docs/handoffs/2026-06-12-ui-three-tab-restructure-impl.md §"Known limitations" 4. 관련: harness/harness-rules.md (DEFAULT PREAMBLE 원본), packages/knowledge-harness/src/policy/policy-guard.ts (결정론적 게이트) 지금은 모든 프로젝트가 단일 고정 정책( DEFAULT PREAMBLE = harness/harness-rules.md 의 8개 하네스 규칙)을 공유한다. 이 규칙은 모든 LLM 에이전트 프롬프트의 맨 앞에 주입된다( LlmAgent.buildPrompt , packages/knowledge-harness/src/agents/llm-agent.ts:17 ). Wiki Policy Advisor 는 base 하네스 규칙 + 프로젝트 발견(discovery) 신호를 입력으로 받아, 그 프로젝트 성격에 맞춘 wiki 정책을 제안하는 새 worker agent다. 사람이 리뷰·승인하면 이후 해당 프로젝트의 wiki 생성 런에 적용된다. 예: 연구 프로젝트 → ExperimentNode 우선; 라이브러리 →

## Decision

- **1. 목적** — 지금은 모든 프로젝트가 단일 고정 정책( DEFAULT PREAMBLE = harness/harness-rules.md 의 8개 하네스 규칙)을 공유한다. 이 규칙은 모든 LLM 에이전트 프롬프트의 맨 앞에 주입된다( LlmAgent.buildPrompt , packages/knowledge-harness/src/agents/llm-agent.ts:17 ). 예: 연구 프로젝트 → ExperimentNode 우선; 라이브러리 → canonical = API 문서 + ADR.
- **2. 핵심 결정 (브레인스토밍 확정)**
- **3. 핵심 아키텍처 — "잠긴 거버넌스 + 맞춤 본문"** — 가장 중요한 안전 불변식. 프로젝트 파일은 거버넌스를 절대 담지 않는다. 결과 1. 프로젝트 파일이 변조돼도 텍스트를 추가 만 할 수 있고 규칙 1–8을 제거·변경 할 수 없다 (구조적 보장). 2. PolicyGuard ( policy/policy-guard.ts )는 프롬프트 텍스트와 무관하게 evidence 필수·shared≥2·raw 쓰기 금지·삭제 금지·markdown-only·canonical proposal only를 코드로 강제한다. 3. 사용자가 "전체 preamble"을 보는 경험은 합성 미리보기 로 제공한다. 바닥 보장은 저장 구조에서 나온다.
- **4. 컴포넌트**
- **4.1 새 스키마 — KhProjectPolicyProposalSchema** — 위치: packages/shared/src/kh-schema.ts (기존 KH 스키마 옆). 기존 스키마처럼 모든 리스트/문자열에 .default() 부여.
- **4.2 새 worker agent — makeWikiPolicyAdvisor** — 위치: packages/knowledge-harness/src/agents/wiki-policy-advisor.ts ; agents/index.ts 에 export 추가. makeProjectDiscovery 패턴( agents/project-discovery.ts )을 그대로 따른다. 입력( run({ input }) ): { base preamble: string, discovery: KhProjectDiscoveryReport } .
- **4.3 합성·해석 (순수 함수, Node)** — 위치: packages/knowledge-harness/src/agents/wiki-policy.ts (또는 policy/ ). LLM 비의존, 전부 결정론적 → 단위 테스트 용이. 구조 필드 + tailoring markdown → 단일 Project Tailoring (advisor) 마크다운 섹션. node type priorities 는 불릿, canonical definition / scan scope notes 는 소제목. /projects/ /wiki-policy.md 를 읽어 frontmatter 파싱
- **4.4 저장 파일 형식 — projects/ /wiki-policy.md** — Obsidian/마크다운+frontmatter 관례를 따른다.

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-13-wiki-policy-advisor-design.md`
