---
title: Knowledge Harness — Phase 2 (Worker + Lead + Writer LLM agents + Staging) Implementation Plan
slug: docs-superpowers-plans-2026-06-02-knowledge-harness-phase2
sources: [docs/superpowers/plans/2026-06-02-knowledge-harness-phase2.md]
status: open
created: 2026-06-02
topic: [wiki-and-knowledge-harness]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: superpowers:test-driven-development. Steps use - [ ] tracking. Goal: Phase 1의 fake driver를 실제 LLM agent driver 로 교체한다. 6개 LLM agent (ProjectDiscovery, ConversationHistoryReader, DocumentIntentClassifier, KnowledgeNodeExtractor, WikiGraphLead, ObsidianWikiWriter)와 StagingVault를 구현하고, 이들을 Driver map으로 묶는 makeDrivers(deps) 팩토리로 HarnessRunner 에 주입한다. 모든 테스트는 FakeAgentRunner 로 canned JSON을 주입해 실제 LLM 호출 없이 검증한다. Architecture decision — driver factory, runner unchanged: Phase 1의 Driver 계약 ( (ctx: RunnerContext) = Promise )은 그대로 둔다. LLM agent는 vault / staging / runner 같은 더 풍부한 의존이 필요하므로, 그것을 closure로 잡는 makeD

## Progress log

- Source checklist: 0 completed, 32 remaining.
- **File Structure** — @apc/shared (파일 수정) ( ProjectDiscoveryReport , SourceInventoryReport , ConversationHistoryReport , DocumentIntentReport , GraphUpdatePlan , SharedPromotionPlan , StaleDocReport ). @apc/knowledge-harness
- **Task 1: Phase-2 report 스키마 (shared/kh-schema.ts 확장)** — git commit -m "feat(shared): kh-schema phase-2 report schemas (discovery/intent/lead plans)"
- **Task 2: package deps + preamble loader** — git commit -m "feat(knowledge-harness): preamble loader + agent deps (@apc/llm-wiki,@apc/agents,@apc/vault)"
- **Task 3: LlmAgent base** — git commit -m "feat(knowledge-harness): LlmAgent base — prompt assembly + parse to schema"
- **Task 4: 6 concrete agents (role prompts + output schema binding)** — Each agent is a thin LlmAgent subclass/factory binding a role prompt + its output schema. obsidian-wiki-writer is NOT an LlmAgent — it is a deterministic executor of an approved WritePlan (see Task 6). The other 5 are LlmAgents. document-intent-classifier.ts , knowledge-node-extractor.ts , wiki-graph-lead.ts (+ one com
- **Task 5: StagingVault** — writeDoc(relPath, body) mkdir+write under staging, diff() = spawnSync('git', ['diff','--no-index','--',vault,staging]) returning stdout (git exits 1 when differences exist — treat code 0 1 as success, else throw). git commit -m "feat(knowledge-harness): StagingVault — copy vault→staging + git diff --no-index"
- **Task 6: ObsidianWikiWriter (deterministic WritePlan executor)** — Executes an approved KhWritePlan against a StagingVault . Honors mode: proposal only (writes a .proposal.md sibling instead of overwriting). Refuses any op whose path escapes the staging vault or targets raw/ (defense in depth — PolicyGuard is the primary guard in Phase 3). op, apply() creates the first file in staging
- **Task 7: makeDrivers factory (wire agents → Driver map)** — makeDrivers(deps) returns Partial where each Driver reads its input artifact(s) from ctx.store , calls the bound agent with deps.runner + ctx.engine , and returns { artifacts: [{ name, data }] } . The WRITE/STAGING states use StagingVault+Writer. build drivers, run them through HarnessRunner.advance over a temp run dir

## Related

- Source: `docs/superpowers/plans/2026-06-02-knowledge-harness-phase2.md`
