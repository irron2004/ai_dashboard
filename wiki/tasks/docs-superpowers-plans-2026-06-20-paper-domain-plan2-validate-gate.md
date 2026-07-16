---
title: "Paper Domain — Plan 2: DomainPack Validate Gate (kernel lint)"
slug: docs-superpowers-plans-2026-06-20-paper-domain-plan2-validate-gate
sources: [docs/superpowers/plans/2026-06-20-paper-domain-plan2-validate-gate.md]
status: open
created: 2026-06-20
topic: [paper-domain]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Give the DomainPack a validate(wikiDir, {substrate}) capability so a generated paper wiki can be gated by the autosci kernel lint (the authoritative paper-domain check), proven by golden(green)+broken(fail) tests — with contractDir resolution robust enough to fail loudly (not silently) when the contract is missing. Architecture: Extend the minimal DomainPack (Plan 1) with an optional validate . The paper pack delegates to a

## Progress log

- Source checklist: 0 completed, 11 remaining.
- **Global Constraints**
- **File Structure**
- **Task 1: DomainPack.validate + paperPack.validate + robust contractDir** — Run: pnpm exec vitest run packages/knowledge-harness/src/domains/paper-pack.validate.test.ts Expected: FAIL — paperPack.validate is undefined (not yet defined), so paperPack.validate!(...) throws "is not a function". In packages/knowledge-harness/src/domains/types.ts , add imports at the top and the field Add to the Do
- **Task 2: venv-gated integration test — golden lints green, broken node fails** — Run (one-time, idempotent): node scripts/bootstrap-substrate.mjs Then: pnpm exec vitest run packages/knowledge-harness/src/domains/paper-pack.lint.int.test.ts Expected: with the venv present, 2 tests PASS (golden green, broken fails with issues). Without the venv, the describe.skip reports the file as skipped — that is
- **Self-Review**
- **Follow-on plans (after Plan 2)**
- **Execution Handoff** — (see skill — offered after save)

## Related

- Source: `docs/superpowers/plans/2026-06-20-paper-domain-plan2-validate-gate.md`
