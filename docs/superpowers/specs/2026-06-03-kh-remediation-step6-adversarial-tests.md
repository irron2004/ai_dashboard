---
title: KH Remediation Step 6 — Adversarial harness tests + real-LLM smoke + stale-lock recovery (E1)
date: 2026-06-03
status: spec
owner: irron2004
relates:
  - 2026-06-03-knowledge-harness-diagnosis.md
addresses: ["#10", "#32", "#33", "#35", "#37", "#38"]
---

# Step 6 — exercise the gates against the misbehavior they exist to catch

## Problem (from diagnosis)

E2E tests fed bare, perfectly-consistent JSON, so neither the LLM parse/unwrap chain nor the gates'
adversarial paths were exercised (#10/#32); the unknown-write-op drop was untested (#35); RunLock stale-lock
recovery was untested and a crashed run permanently blocked a project (#38); parse robustness against dirty
model output was thin and there was no real-LLM check (#37); and feature-gate.config asserted shipped
values without naming what they mean (#33).

## Design

- **Adversarial fixtures through makeDrivers** (`make-drivers.adversarial.test.ts`): drive full runs whose
  agent outputs simulate plausible LLM misbehavior, asserting the deterministic gates catch each:
  - claude-envelope-wrapped + ```json-fenced extractor output → still drives to HUMAN_REVIEW_REQUIRED (the
    unwrap/parse chain works end-to-end through the drivers, not just in a parse unit test).
  - a write_plan op on a canonical path with `mode:'apply'` → writer routes to `.proposal.md` (canonical
    never overwritten regardless of declared mode).
  - a write_plan op under `raw/` → skipped by the writer (reported in applied-write-report.skipped).
  - evidence whose `source_path` doesn't exist under raw/ → run FAILED (EvidenceVerifier).
  - malformed JSON (truncated object) from an agent → run FAILED with a clear parse error.
- **Writer unimplemented-op test** (#35): `update_frontmatter` / `add_backlink` parse (valid enum) but are
  skipped by the MVP writer and surfaced in `skipped[]` (typo'd verbs already fail at schema parse, step 3).
- **RunLock stale-lock recovery** (#38): write `runId\npid\ntimestamp` to the lockfile; on a contended
  acquire, reclaim the lock if its owner pid is dead OR it is older than a TTL. Tests for: live contention
  still blocks; a stale (old-timestamp) lock is reclaimed; a dead-pid lock is reclaimed.
- **Opt-in real-LLM smoke** (#37): a test gated behind `KH_REAL_LLM=1` that runs one real CLI agent and
  asserts its output parses; skipped by default so CI stays hermetic.
- **#33**: clarify in feature-gate.config.test that it asserts the SHIPPED policy values (what the harness
  ships), cross-referencing the wiring classification, so it doesn't read as proof that every flag is
  enforced by code.

## Acceptance

- [ ] Adversarial fixtures: each misbehavior is caught by the asserted gate; the envelope/fence chain works
      through makeDrivers.
- [ ] RunLock reclaims stale/dead-pid locks; live contention still blocks; unit tests for each.
- [ ] Writer skip test; opt-in real-LLM smoke present + skipped without the env flag.
- [ ] `pnpm typecheck` 0; packages + desktop suites green.
