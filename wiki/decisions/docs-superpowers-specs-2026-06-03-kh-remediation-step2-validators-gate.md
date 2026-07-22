---
title: Step 2 — deterministic verification that actually means something
slug: docs-superpowers-specs-2026-06-03-kh-remediation-step2-validators-gate
sources: [docs/superpowers/specs/2026-06-03-kh-remediation-step2-validators-gate.md]
status: accepted
date: 2026-06-03
topic: [project-architecture]
---

## Context

title: KH Remediation Step 2 — Make validators gate (B1) + fix false-failing rules (B2/B3) addresses: [" 3", " 6", " 25", " 30", " 58", " 39"] invalid-markdown output is silently promotable. "Verification" is advisory-only. node has no inbound link yet, so it's flagged an orphan → ok=false on every run. (An existing e2e even asserts the new node is an orphan.) So you cannot gate on graph .ok without first fixing this. the filename is the title and node id is a separate stable id; they routinely differ → false-positive on every doc with a node id. The spec means: a doc's node id must be consistent with the graph plan , not an accident, not an

## Decision

- **Problem (from diagnosis)** — invalid-markdown output is silently promotable. "Verification" is advisory-only. node has no inbound link yet, so it's flagged an orphan → ok=false on every run. (An existing e2e even asserts the new node is an orphan.) So you cannot gate on graph .ok without first fixing this. the filename is the title and node id is
- **Design**
- **graph-integrity.ts — separate hard-fail integrity from completeness warnings** — validate(vaultDir, opts?: { graphNodeIds?: string[] }) . (two docs claim one id), node id mismatches . orphan nodes and missing backlinks . A freshly-written, not-yet-linked node is legitimately an orphan; blocking on it would block every run. Still surfaced in the report for human review. update plan's node ops[].node
- **make-drivers VALIDATED — feed the plan's node ids** — Extract node ops[].node id from the LEAD MERGED graph-update-plan artifact and pass as graphNodeIds to graph.validate(stagingRoot, { graphNodeIds }) .
- **harness-promote-service — gate on validation (B1)** — gate() blocks promotion when any of graph/markdown/link reports is !ok , unless allowInvalid (mirrors the existing allowSecrets override; the run still completes to HUMAN REVIEW REQUIRED so the human sees the reports — promotion is what's blocked). Thread allowInvalid through promote() / promoteCanonical() → HarnessSer
- **Acceptance** — against the plan, not the filename; self-links don't mask orphans. Unit tests for each. overrides) — the boundary is now an asserted invariant.

## Consequences

- **harness-promote-service — gate on validation (B1)** — gate() blocks promotion when any of graph/markdown/link reports is !ok , unless allowInvalid (mirrors the existing allowSecrets override; the run still completes to HUMAN REVIEW REQUIRED so the human sees the reports — promotion is what's blocked). Thread allowInvalid through promote() / promoteCanonical() → HarnessSer

## Related

- Source: `docs/superpowers/specs/2026-06-03-kh-remediation-step2-validators-gate.md`
