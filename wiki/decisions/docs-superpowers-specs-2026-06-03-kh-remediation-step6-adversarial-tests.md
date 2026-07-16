---
title: Step 6 — exercise the gates against the misbehavior they exist to catch
slug: docs-superpowers-specs-2026-06-03-kh-remediation-step6-adversarial-tests
sources: [docs/superpowers/specs/2026-06-03-kh-remediation-step6-adversarial-tests.md]
status: accepted
date: 2026-06-03
topic: [project-architecture]
---

## Context

title: KH Remediation Step 6 — Adversarial harness tests + real-LLM smoke + stale-lock recovery (E1) addresses: [" 10", " 32", " 33", " 35", " 37", " 38"] E2E tests fed bare, perfectly-consistent JSON, so neither the LLM parse/unwrap chain nor the gates' adversarial paths were exercised ( 10/ 32); the unknown-write-op drop was untested ( 35); RunLock stale-lock recovery was untested and a crashed run permanently blocked a project ( 38); parse robustness against dirty model output was thin and there was no real-LLM check ( 37); and feature-gate.config asserted shipped values without naming what they mean ( 33). agent outputs simulate plausible

## Decision

- **Problem (from diagnosis)** — E2E tests fed bare, perfectly-consistent JSON, so neither the LLM parse/unwrap chain nor the gates' adversarial paths were exercised ( 10/ 32); the unknown-write-op drop was untested ( 35); RunLock stale-lock recovery was untested and a crashed run permanently blocked a project ( 38); parse robustness against dirty mod
- **Design** — agent outputs simulate plausible LLM misbehavior, asserting the deterministic gates catch each unwrap/parse chain works end-to-end through the drivers, not just in a parse unit test). never overwritten regardless of declared mode). skipped by the MVP writer and surfaced in skipped[] (typo'd verbs already fail at schema
- **Acceptance** — through makeDrivers.

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-03-kh-remediation-step6-adversarial-tests.md`
