---
title: Step 5 — make the evidence chain real (the core fix)
slug: docs-superpowers-specs-2026-06-03-kh-remediation-step5-source-evidence
sources: [docs/superpowers/specs/2026-06-03-kh-remediation-step5-source-evidence.md]
status: accepted
date: 2026-06-03
topic: [project-architecture]
---

## Context

title: KH Remediation Step 5 — SourceReader boundary (A1) + deterministic evidence verification (A2) addresses: [" 1", " 7", " 34"] The "evidence-based" pipeline feeds agents zero real source data — only a projectId string or a prior (already-LLM-generated) report ( 1). And nothing ever verifies a cited source path / quote is real ( 7/ 34). So "evidence-based, blocks hallucination" was enforced by prompt text + a human, not by code. A deterministic reader that materializes real source text into agent input before the LLM call. SourceReader(vaultRoot).read() lists every file under /raw/ (recursive, any extension) and returns [{ source id, sour

## Decision

- **Problem (from diagnosis)** — The "evidence-based" pipeline feeds agents zero real source data — only a projectId string or a prior (already-LLM-generated) report ( 1). And nothing ever verifies a cited source path / quote is real ( 7/ 34). So "evidence-based, blocks hallucination" was enforced by prompt text + a human, not by code.
- **Design**
- **A1 — SourceReader boundary ( runtime/source-reader.ts )** — A deterministic reader that materializes real source text into agent input before the LLM call. SourceReader(vaultRoot).read() lists every file under /raw/ (recursive, any extension) and returns [{ source id, source path: 'raw/...', text }] (per-file size-capped to keep prompts bounded). Wired into the SOURCES EXTRACTE
- **A2 — deterministic evidence verification ( verify/evidence-verifier.ts )** — EvidenceVerifier.verify(proposals, vaultRoot) → KhEvidenceVerificationReport . For every proposal's every evidence entry path); else reason: 'source not found' . reason: 'quote not found' . Unverifiable evidence makes the report !ok with per-evidence findings. declared evidence cannot be located throws → run FAILED (fa
- **Acceptance** — quote; respects path containment.

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-03-kh-remediation-step5-source-evidence.md`
