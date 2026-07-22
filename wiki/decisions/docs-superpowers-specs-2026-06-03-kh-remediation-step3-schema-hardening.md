---
title: Step 3 — make the Zod contract the first structural gate
slug: docs-superpowers-specs-2026-06-03-kh-remediation-step3-schema-hardening
sources: [docs/superpowers/specs/2026-06-03-kh-remediation-step3-schema-hardening.md]
status: accepted
date: 2026-06-03
topic: [project-architecture]
---

## Context

title: KH Remediation Step 3 — Schema hardening (structural rejection of empty/typo/hallucinated output) addresses: [" 11", " 19", " 20", " 28", " 29", " 31", " 36", " 49"] Pervasive .default() and bare z.string() let structurally-degenerate LLM output validate as "valid" empty path / id / title ( 11, 20, 36), free-form op / scope strings that bypass the op-allowlist and the shared-promotion floor ( 28, 31, 49), and an unvalidated engine cast to AgentType ( 19). The "parseStructured blocks hallucination" claim is only true if the schema actually rejects these. KhClaim.{claim id,text} , KhNodeProposal.{proposal id,proposed by,created at} , nod

## Decision

- **Problem (from diagnosis)** — Pervasive .default() and bare z.string() let structurally-degenerate LLM output validate as "valid" empty path / id / title ( 11, 20, 36), free-form op / scope strings that bypass the op-allowlist and the shared-promotion floor ( 28, 31, 49), and an unvalidated engine cast to AgentType ( 19). The "parseStructured block
- **Design — tighten load-bearing identity/op/scope fields (defense-in-depth, not single-point)** — KhClaim.{claim id,text} , KhNodeProposal.{proposal id,proposed by,created at} , node.{id,type,title} , KhWriteOp.path , KhGraphUpdatePlan.node ops[].node id . Typo'd/unknown verbs now fail at parse (loud), while the recognized-but-forbidden delete file still parses so PolicyGuard blocks it with a clean message (keeps t
- **Acceptance** — unknown engine . Unit tests assert each rejection (and that valid canned shapes still parse).

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-03-kh-remediation-step3-schema-hardening.md`
