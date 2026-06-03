---
title: KH Remediation Step 2 — Make validators gate (B1) + fix false-failing rules (B2/B3)
date: 2026-06-03
status: spec
owner: irron2004
relates:
  - 2026-06-03-knowledge-harness-diagnosis.md
addresses: ["#3", "#6", "#25", "#30", "#58", "#39"]
---

# Step 2 — deterministic verification that actually means something

## Problem (from diagnosis)

- **#6 / #25 / B1** — graph/markdown/link validators compute `.ok`, but **nothing reads it**. Broken-graph /
  invalid-markdown output is silently promotable. "Verification" is advisory-only.
- **#3 / B2** — the orphan rule is incompatible with an incremental write pipeline: every freshly-authored
  node has no inbound link yet, so it's flagged an orphan → `ok=false` on *every* run. (An existing e2e even
  asserts the new node is an orphan.) So you cannot gate on graph `.ok` without first fixing this.
- **#30 / B3** — `node_id_mismatch` compares frontmatter `node_id` against the **filename stem**. In Obsidian
  the filename is the title and `node_id` is a separate stable id; they routinely differ → false-positive on
  every doc with a node_id. The spec means: a doc's `node_id` must be consistent with the **graph plan**, not
  the filename.
- **#58** — tests confirm rather than challenge the advisory behavior; the blocking-vs-advisory boundary is
  an accident, not an asserted invariant.
- **#39** (cheap, related) — self-links (`A→A`) currently count as inbound, masking orphan detection.

## Design

### graph-integrity.ts — separate hard-fail integrity from completeness warnings

`validate(vaultDir, opts?: { graphNodeIds?: string[] })`.

- **Hard-fail (affect `ok`)** — genuine corruption: `broken_links` (dangling `[[X]]`), `duplicate_node_ids`
  (two docs claim one id), `node_id_mismatches`.
- **Advisory (reported, do NOT affect `ok`)** — graph-completeness signals expected mid-authoring:
  `orphan_nodes` and `missing_backlinks`. A freshly-written, not-yet-linked node is legitimately an orphan;
  blocking on it would block every run. Still surfaced in the report for human review.
- **`node_id_mismatches` re-defined** — a doc whose frontmatter `node_id` is **not present in the graph
  update plan's `node_ops[].node_id` set** (cross-artifact inconsistency). Only checked when a non-empty
  plan id-set is supplied; with no plan ids (stub plan) the check is skipped (can't validate against nothing)
  — never the old filename-stem comparison.
- **#39** — exclude self-edges (`idOf(from) === idOf(to)`) when computing inbound for orphans.

### make-drivers VALIDATED — feed the plan's node ids

Extract `node_ops[].node_id` from the LEAD_MERGED `graph-update-plan` artifact and pass as
`graphNodeIds` to `graph.validate(stagingRoot, { graphNodeIds })`.

### harness-promote-service — gate on validation (B1)

`gate()` blocks promotion when any of graph/markdown/link reports is `!ok`, **unless `allowInvalid`**
(mirrors the existing `allowSecrets` override; the run still completes to HUMAN_REVIEW_REQUIRED so the human
sees the reports — promotion is what's blocked). Thread `allowInvalid` through `promote()` /
`promoteCanonical()` → `HarnessService` → IPC contract, alongside `allowSecrets`.

## Acceptance

- [ ] graph-integrity: orphan/missing-backlink advisory; broken-link/dup/mismatch hard-fail; node_id checked
      against the plan, not the filename; self-links don't mask orphans. Unit tests for each.
- [ ] VALIDATED passes the plan's node ids to the graph validator.
- [ ] promote()/promoteCanonical() refuse a run whose graph/md/link report is `!ok` unless `allowInvalid`.
- [ ] #58 contract test: an explicit test asserting validation failures BLOCK promotion (and `allowInvalid`
      overrides) — the boundary is now an asserted invariant.
- [ ] `pnpm typecheck` 0; packages + desktop suites green.
