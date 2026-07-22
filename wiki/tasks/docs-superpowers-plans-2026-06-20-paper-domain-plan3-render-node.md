---
title: "Paper Domain — Plan 3: paperPack.renderNode (typed node → vault md)"
slug: docs-superpowers-plans-2026-06-20-paper-domain-plan3-render-node
sources: [docs/superpowers/plans/2026-06-20-paper-domain-plan3-render-node.md]
status: open
created: 2026-06-20
topic: [paper-domain]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Give the paper DomainPack a deterministic renderNode(node) → { relPath, content } that writes a typed paper node to the autosci vault layout ( wiki/ / .md with contract YAML frontmatter), proven by a render→validate round-trip: rendering every golden node's data and linting the result stays green (composing Plan 2's validate ). Architecture: renderNode is pure and contract-agnostic — it takes a typed node { type, slug, fiel

## Progress log

- Source checklist: 0 completed, 12 remaining.
- **Global Constraints**
- **File Structure**
- **Task 1: renderNode + types + gray-matter dependency** — In packages/knowledge-harness/package.json , add to dependencies (match the version already resolved in the monorepo — packages/vault / packages/harness use gray-matter ; use the SAME version range they declare, e.g. "gray-matter": "^4.0.3" ) Then install (links from the existing store — no new download): pnpm install
- **Task 2: venv-gated render→validate round-trip over the golden nodes** — Run: pnpm exec vitest run packages/knowledge-harness/src/domains/paper-pack.render-validate.int.test.ts Expected: on a machine with the (runnable) venv — 1 test PASS (rendered golden lints green). On native Windows with the Linux venv — the file is reported skipped (exit 0), which is acceptable here; the controller run
- **Self-Review**
- **Follow-on plans (after Plan 3)**
- **Execution Handoff** — (see skill — offered after save)

## Related

- Source: `docs/superpowers/plans/2026-06-20-paper-domain-plan3-render-node.md`
