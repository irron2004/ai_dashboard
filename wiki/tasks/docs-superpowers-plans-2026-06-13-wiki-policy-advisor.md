---
title: Wiki Policy Advisor Implementation Plan
slug: docs-superpowers-plans-2026-06-13-wiki-policy-advisor
sources: [docs/superpowers/plans/2026-06-13-wiki-policy-advisor.md]
status: open
created: 2026-06-13
topic: [wiki-and-knowledge-harness]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Add an on-demand agent that proposes a project-tailored wiki preamble from the base harness rules + a ProjectDiscoveryReport; a human reviews/approves it, and approved policies are injected into that project's wiki-generation runs while the PolicyGuard safety floor stays inviolable. Architecture: "Locked governance + tailoring body." The per-project file never stores governance — only an advisor-authored tailoring section.

## Progress log

- Source checklist: 0 completed, 49 remaining.
- **Prerequisites (every task)** — All commands run from the repo root with the Node 22 toolchain on PATH (this repo's dev toolchain is not on the default WSL PATH)
- **File Structure**
- **Task 1: KhProjectPolicyProposal schema** — Add to packages/shared/src/kh-schema.test.ts (inside the existing top-level describe , after the ProjectDiscoveryReport defaults test). Also add KhProjectPolicyProposalSchema to the import list at the top of the file. Run: pnpm vitest run packages/shared/src/kh-schema.test.ts Expected: FAIL — KhProjectPolicyProposalSch
- **Task 2: makeWikiPolicyAdvisor agent** — Append to packages/knowledge-harness/src/agents/agents.test.ts (inside the existing describe('concrete agents', …) ). Add makeWikiPolicyAdvisor to the existing from './index.js' import. Run: pnpm vitest run packages/knowledge-harness/src/agents/agents.test.ts Expected: FAIL — makeWikiPolicyAdvisor is not exported / not
- **Task 3: runtime/wiki-policy.ts — render, store, resolve** — This is the heart of the safety guarantee. Pure functions over fs + JSON — no LLM, no new dependency. The governance block is NEVER stored here. Create packages/knowledge-harness/src/runtime/wiki-policy.test.ts Run: pnpm vitest run packages/knowledge-harness/src/runtime/wiki-policy.test.ts Expected: FAIL — cannot resol
- **Task 4: HarnessService — propose/approve/get/revert + run injection** — Append to packages/app-services/src/harness-service.test.ts . Match the file's existing setup (it already builds a HarnessService with a FakeAgentRunner and temp vaultRoot / runsRoot ; reuse that helper/pattern — read the top of the file first). Add this describe Ensure mkdtempSync , tmpdir , join , FakeAgentRunner , H
- **Task 5: IPC — contract, container, handler map** — Read apps/desktop/src/main/ipc.test.ts first to match its style (it builds the handler map from a fake container and asserts a channel routes to a method). Add a test that the new channel routes through Adapt makeFakeContainer / buildHandlers /import names to whatever the existing test file already uses (do not invent
- **Task 6: Renderer API client + store actions** — In apps/desktop/src/renderer/api.ts , add to the imported contract types and add four methods alongside harnessRun If store.ts has a sibling test (check for store.test.ts ), add a test there; otherwise add a focused test file apps/desktop/src/renderer/store.policy.test.ts that mocks api and asserts the action updates s

## Related

- Source: `docs/superpowers/plans/2026-06-13-wiki-policy-advisor.md`
