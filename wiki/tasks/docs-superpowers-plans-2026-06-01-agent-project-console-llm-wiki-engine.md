---
title: Agent Project Console — LLM Wiki Engine Implementation Plan (Plan 3 of 6)
slug: docs-superpowers-plans-2026-06-01-agent-project-console-llm-wiki-engine
sources: [docs/superpowers/plans/2026-06-01-agent-project-console-llm-wiki-engine.md]
status: open
created: 2026-06-01
topic: [wiki-and-knowledge-harness]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox ( - [ ] ) syntax. Goal: Generate a structured work summary, a current.md update proposal, and next-task candidates from a NormalizedSession , by calling an installed agent CLI headless with a user-selected engine — behind an AgentRunner abstraction so the engine and exact CLI command are injectable (and the hard logic — prompt building, JSON extraction, timeout — is fully testable without any agent installed). Architecture: @apc/llm-wiki defines AgentRunner (run a prompt on one engine, get text

## Progress log

- Source checklist: 0 completed, 35 remaining.
- **File Structure** — Add @apc/llm-wiki alias to vitest.config.ts .
- **Task 1: Wiki contracts in @apc/shared**
- **Task 2: AgentRunner interface + FakeAgentRunner** — packages/llm-wiki/package.json packages/llm-wiki/src/index.ts (Export only ./agent-runner.js for now; add the rest in their tasks.)
- **Task 3: parseStructured — robust JSON extraction + validation**
- **Task 4: CliAgentRunner — spawn a command template (real-subprocess test)**
- **Task 5: Prompt builders (pure functions)**
- **Task 6: WikiEngine — orchestrate runner + prompt + parse**
- **Definition of Done (Plan 3)**

## Related

- Source: `docs/superpowers/plans/2026-06-01-agent-project-console-llm-wiki-engine.md`
