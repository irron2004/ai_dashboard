---
title: LLM Wiki 생성 에이전트 스펙
slug: docs-superpowers-specs-2026-06-02-llm-wiki-agent-spec
sources: [docs/superpowers/specs/2026-06-02-llm-wiki-agent-spec.md]
status: accepted
date: 2026-06-02
topic: [wiki-and-knowledge-harness]
---

## Context

LLM Wiki 생성 에이전트의 목적은 대화/작업/결정/실험의 흔적을 읽고, evidence가 붙은 wiki proposal 을 만드는 것이다. 이 에이전트는 문서를 직접 완성하지 않는다. 대신 아래만 수행한다. Worker agent는 지식을 쓰지 않는다. Worker agent는 evidence가 붙은 proposal만 만든다. 모든 claim은 최소 하나 이상의 source reference를 가져야 한다. 2. document intent classification proposal id: "NP-YYYYMMDD-001" proposal type: create or update node LLM Wiki 생성 에이전트는 문서를 쓰는 에이전트가 아니라, evidence-backed proposal을 만드는 에이전트 다. 이 에이전트의 품질은 “얼마나 많이 썼는가”가 아니라,

## Decision

- **1. 목적** — LLM Wiki 생성 에이전트의 목적은 대화/작업/결정/실험의 흔적을 읽고, evidence가 붙은 wiki proposal 을 만드는 것이다. 이 에이전트는 문서를 직접 완성하지 않는다. 대신 아래만 수행한다. 핵심 원칙
- **2. 역할 정의**
- **Agent 이름**
- **책임 범위**
- **비책임 범위**
- **3. 입력**
- **필수 입력**
- **source 예시**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-02-llm-wiki-agent-spec.md`
