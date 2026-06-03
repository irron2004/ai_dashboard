---
title: KH Remediation Step 3 — Schema hardening (structural rejection of empty/typo/hallucinated output)
date: 2026-06-03
status: spec
owner: irron2004
relates:
  - 2026-06-03-knowledge-harness-diagnosis.md
addresses: ["#11", "#19", "#20", "#28", "#29", "#31", "#36", "#49"]
---

# Step 3 — make the Zod contract the first structural gate

## Problem (from diagnosis)

Pervasive `.default()` and bare `z.string()` let structurally-degenerate LLM output validate as "valid":
empty `path`/`id`/`title` (#11, #20, #36), free-form `op`/`scope` strings that bypass the op-allowlist and
the shared-promotion floor (#28, #31, #49), and an unvalidated `engine` cast to `AgentType` (#19). The
"parseStructured blocks hallucination" claim is only true if the schema actually rejects these.

## Design — tighten load-bearing identity/op/scope fields (defense-in-depth, not single-point)

- **Identity `.min(1)`** (empty is meaningless): `KhEvidence.{evidence_id,source_id,source_path,evidence_type}`,
  `KhClaim.{claim_id,text}`, `KhNodeProposal.{proposal_id,proposed_by,created_at}`,
  `node.{id,type,title}`, `KhWriteOp.path`, `KhGraphUpdatePlan.node_ops[].node_id`.
- **`KhWriteOp.op` → `z.enum`** (#31/#49): `['create_file','update_frontmatter','add_backlink','append_section','delete_file']`.
  Typo'd/unknown verbs now fail at parse (loud), while the recognized-but-forbidden `delete_file` still
  parses so PolicyGuard blocks it with a clean message (keeps the existing delete-blocking path).
- **`KhGraphUpdatePlan.node_ops[].op` → `z.enum(['create','update','merge','link'])`**.
- **`node.scope` → `z.enum(['project','shared_candidate','shared'])`** (#28/#49) — a misspelled/alternate
  scope can no longer silently bypass the shared-promotion gate.
- **`RunState.engine` → `AgentKind`** (#19) — no more unvalidated string cast; an unknown engine fails loudly.
- **PolicyGuard shared floor (#28)** — apply the ≥2-evidence requirement to BOTH `shared_candidate` and
  `shared` (any non-project scope), so a self-declared `shared` can't skip the floor.

> **Scope note:** evidence/claims arrays keep `.default([])` (a no-evidence proposal is already a hard
> PolicyGuard block at NODE_PROPOSALS_CREATED — runtime gate). Real source/quote *verification* (#7/#34)
> is step 5, not here. This step is purely structural: reject empty/typo/hallucinated-shape output.

## Acceptance

- [ ] Schema rejects: empty proposal_id/node.id/node.title/path/evidence ids; unknown `op`; non-enum `scope`;
      unknown `engine`. Unit tests assert each rejection (and that valid canned shapes still parse).
- [ ] `delete_file` still parses and is blocked by PolicyGuard; PolicyGuard floor covers `shared` too.
- [ ] `pnpm typecheck` 0; packages + desktop suites green (fixtures using non-empty/valid values unaffected).
