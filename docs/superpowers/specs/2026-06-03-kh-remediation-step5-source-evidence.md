---
title: KH Remediation Step 5 — SourceReader boundary (A1) + deterministic evidence verification (A2)
date: 2026-06-03
status: spec
owner: irron2004
relates:
  - 2026-06-03-knowledge-harness-diagnosis.md
addresses: ["#1", "#7", "#34"]
---

# Step 5 — make the evidence chain real (the core fix)

## Problem (from diagnosis)

The "evidence-based" pipeline feeds agents **zero real source data** — only a `projectId` string or a
prior (already-LLM-generated) report (#1). And nothing ever verifies a cited `source_path`/`quote` is real
(#7/#34). So "evidence-based, blocks hallucination" was enforced by prompt text + a human, not by code.

## Design

### A1 — SourceReader boundary (`runtime/source-reader.ts`)

A deterministic reader that materializes real source text into agent input before the LLM call.
`SourceReader(vaultRoot).read()` lists every file under `<vaultRoot>/raw/` (recursive, any extension) and
returns `[{ source_id, source_path: 'raw/...', text }]` (per-file size-capped to keep prompts bounded).
Wired into the SOURCES_EXTRACTED (reader) and NODE_PROPOSALS_CREATED (extractor) driver inputs as
`sources`, so the real LLM cites paths/quotes that actually exist. (FakeAgentRunner ignores input, so this
changes no canned-output test.)

### A2 — deterministic evidence verification (`verify/evidence-verifier.ts`)

`EvidenceVerifier.verify(proposals, vaultRoot) → KhEvidenceVerificationReport`. For every proposal's every
evidence entry:
- `source_path` must resolve (via `resolveInside`) to an **existing file** under `vaultRoot` (and be a raw
  path); else `reason: 'source_not_found'`.
- if `quote_or_summary` is non-empty, a **normalized substring** of it must appear in the file text; else
  `reason: 'quote_not_found'`.

Unverifiable evidence makes the report `!ok` with per-evidence findings.

**Gate:** wired as a BLOCKING check at NODE_PROPOSALS_CREATED, a sibling of PolicyGuard — a proposal whose
declared evidence cannot be located throws → run **FAILED** (fabricated evidence is a hard stop, exactly
like no-evidence). The report is also persisted as an artifact. Inference-only claims are unaffected: they
carry no evidence entry, so there is nothing to verify.

## Acceptance

- [ ] SourceReader lists raw files (any extension), caps file size, ignores a missing raw/ dir.
- [ ] EvidenceVerifier: passes real evidence (file exists + quote present); flags missing file and absent
      quote; respects path containment.
- [ ] A proposal citing a nonexistent `source_path` (or a quote not in the file) fails the run (e2e).
- [ ] Existing full-run tests seed the raw sources their canned evidence cites and stay green.
- [ ] `pnpm typecheck` 0; packages + desktop suites green.

> **Scope note:** this verifies declared evidence against the immutable raw/ tree — the deterministic
> backstop the prompts implied but didn't enforce. Semantic/LLM judgement of quote *relevance* remains out
> of scope (and explicitly a non-goal of the MVP).
