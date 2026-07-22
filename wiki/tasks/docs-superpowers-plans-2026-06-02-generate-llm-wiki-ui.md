---
title: Generate / LLM Wiki UI Implementation Plan
slug: docs-superpowers-plans-2026-06-02-generate-llm-wiki-ui
sources: [docs/superpowers/plans/2026-06-02-generate-llm-wiki-ui.md]
status: open
created: 2026-06-02
topic: [wiki-and-knowledge-harness]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox ( - [ ] ) syntax. Goal: Add a desktop Generate action: pick an engine → summarize the project's latest agent session → write a work summary + current.proposal.md to the vault → review → Promote to canonical current.md . Architecture: Make CliAgentRunner stdin-based + Windows-safe. Add @apc/app-services GenerateService (latest-session → WikiEngine → VaultWriter ). Wire a generateProject IPC + a Generate button + ModelPicker modal + result panel in the renderer; Promote reuses CurrentPromotionServ

## Progress log

- Source checklist: 0 completed, 26 remaining.
- **Task 1: CliAgentRunner — stdin prompt + Windows-safe spawn**
- **Task 2: @apc/app-services GenerateService**
- **Task 3: container injectable runner + generateProject IPC** — In container.ts : buildContainer opts gains agentRunner?: AgentRunner (default new CliAgentRunner() ); build wiki = new WikiEngine(agentRunner) ; add generate: new GenerateService({ adapters: ingestAdapters, registry, vault, vaultWriter, wiki }) and expose generate on Container . (Reuse the existing vaultWriter / wiki
- **Task 4: renderer api + store** — (Import AgentType from @apc/shared ; define/import GenerateProjectRes from the contract — add the result type to ipc-contract.ts .)
- **Task 5: Generate button + ModelPicker + result panel**
- **Definition of Done**
- **Deferred (P1+)**

## Related

- Source: `docs/superpowers/plans/2026-06-02-generate-llm-wiki-ui.md`
