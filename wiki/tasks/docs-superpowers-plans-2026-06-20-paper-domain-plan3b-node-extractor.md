---
title: "Paper Domain — Plan 3b: paper node extractor (LLM → TypedNode[])"
slug: docs-superpowers-plans-2026-06-20-paper-domain-plan3b-node-extractor
sources: [docs/superpowers/plans/2026-06-20-paper-domain-plan3b-node-extractor.md]
status: open
created: 2026-06-20
topic: [paper-domain]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: A makePaperNodeExtractor agent that, given source documents, emits { nodes: TypedNode[] } conforming to the paper contract — by injecting the contract (entities/edges/conventions) into the LLM prompt and parsing the response with a PaperNodeSchema . This is the generation half that Plan 3's renderNode writes and Plan 2's validate gates. Architecture: Mirror the existing makeKnowledgeNodeExtractor (an LlmAgent with a ROLE st

## Progress log

- Source checklist: 0 completed, 13 remaining.
- **Global Constraints**
- **File Structure**
- **Task 1: PaperNodeSchema + loadPaperContractText** — Run: pnpm exec vitest run packages/knowledge-harness/src/agents/paper-node-extractor.test.ts Expected: FAIL — module ./paper-node-extractor.js does not exist. Run: pnpm exec vitest run packages/knowledge-harness/src/agents/paper-node-extractor.test.ts Expected: PASS (6 tests). Run: node node modules/typescript/bin/tsc
- **Task 2: makePaperNodeExtractor (contract-injecting LlmAgent)** — Run: pnpm exec vitest run packages/knowledge-harness/src/agents/paper-node-extractor.test.ts Expected: FAIL — makePaperNodeExtractor is not exported. Replace the trailing void (...) placeholder line in paper-node-extractor.ts with (Keep the PaperEntityType import only if still referenced; otherwise remove it — ENTITY T
- **Self-Review**
- **Follow-on (Plan 4)** — Wire it all: materialize raw/ (autosci-read ingest, extend WikiSubstrate.checkSources → parsed text); make-drivers selects the paper pack when domain==='paper' — NODE PROPOSALS CREATED runs makePaperNodeExtractor , STAGING WRITTEN calls domainPack.renderNode per node + builds wiki/graph/edges.jsonl from typed edges, VA
- **Execution Handoff** — (see skill — offered after save)

## Related

- Source: `docs/superpowers/plans/2026-06-20-paper-domain-plan3b-node-extractor.md`
