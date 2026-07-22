---
title: Knowledge Harness — Holistic Problem Diagnosis
slug: docs-superpowers-specs-2026-06-03-knowledge-harness-diagnosis
sources: [docs/superpowers/specs/2026-06-03-knowledge-harness-diagnosis.md]
status: accepted
date: 2026-06-03
topic: [wiki-and-knowledge-harness]
---

## Context

title: Knowledge Harness — Holistic Problem Diagnosis (team-mode review) method: multi-agent team review (6 dimensions → adversarial verify → synthesis), workflow wf 46a7620f-d0c, 69 agents Scope. A problem-focused team-mode review of the ENTIRE knowledge-harness implementation (~79 commits, branch docs/knowledge-harness-pipeline-spec ). Unlike the seven earlier narrow review rounds — which each verified that a specific change was locally correct — this pass looked at the whole system adversarially for weaknesses. 62 problems raised, 58 confirmed (1 critical, 9 high, 28 medium, 20 low). The 267 passing tests prove a FakeAgentRunner echoing pe

## Decision

- **Overall verdict: well-tested skeleton, NOT production-ready** — The 267 passing tests prove a FakeAgentRunner echoing perfect canned JSON flows through the state machine. They do not test the thing the product exists to do (turn real sources into evidence-backed wiki content) or the gates meant to make that safe. The system is safe today only because it writes to a staging vault an
- **Three systemic weaknesses (cut across everything)** — 1. The evidence chain is decorative. No source-ingestion boundary exists — agents are fed only a projectId string or another agent's (already-fabricated) report; no agent reads a real file, transcript, or vault doc, and no code ever verifies a cited source path / quote or summary is real. The AgentIngestAdapter → Norma
- **Blockers vs nice-to-haves (bottom line)** — doesn't gate + false-fails on every run), C1/C2 (UI lies), D1 (packaged Electron app won't boot), D2 (no typecheck), E1 (tests don't exercise the real job). Until these are fixed, the "evidence-based, deterministic-safety" value proposition is unverified and partly false . staging + human-promotion containment, so they
- **Recommended sequencing** — 1. D1 + D2 first — a packaged app that won't boot is the most concrete failure; a typecheck step stops silent drift. Cheap and high-value. 2. B1–B3 — make the deterministic validators actually gate (and fix the orphan/node id rules so they don't false-fail every run), so "verification" means something. 3. Schema harden
- **Full confirmed-problem list (58)**
- **CRITICAL**
- **HIGH**
- **MEDIUM**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-03-knowledge-harness-diagnosis.md`
