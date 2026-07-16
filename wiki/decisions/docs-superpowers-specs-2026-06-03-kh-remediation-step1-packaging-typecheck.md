---
title: Step 1 — D1 (packaging boot) + D2 (typecheck)
slug: docs-superpowers-specs-2026-06-03-kh-remediation-step1-packaging-typecheck
sources: [docs/superpowers/specs/2026-06-03-kh-remediation-step1-packaging-typecheck.md]
status: accepted
date: 2026-06-03
topic: [project-architecture]
---

## Context

title: KH Remediation Step 1 — Packaging boot fix (D1) + Typecheck step (D2) addresses: [" 4 (D1)", " 5 (D2)"] First of the diagnosis's recommended-sequencing steps: the two cheapest, most concrete blockers. fileURLToPath(new URL('../../../../', import.meta.url)) . That ../../../../ walk is correct when the module runs from packages/knowledge-harness/src/... (→ repo root) but wrong once electron-vite bundles @apc/knowledge-harness into apps/desktop/out/main/index.js — the same walk then lands at the repo's parent dir, so harness/feature-gates.yml / harness-rules.md are not found and the harness throws at boot. container.ts:91 passes neither g

## Decision

- **Problem (from diagnosis)** — fileURLToPath(new URL('../../../../', import.meta.url)) . That ../../../../ walk is correct when the module runs from packages/knowledge-harness/src/... (→ repo root) but wrong once electron-vite bundles @apc/knowledge-harness into apps/desktop/out/main/index.js — the same walk then lands at the repo's boot. container.
- **Goal** — 1. The harness boots with zero filesystem dependency — defaults are compiled in, so a bundled Electron app can never fail to start over a missing harness/ file. An explicit file path remains an optional override for runtime editing. 2. A root typecheck script exists and is green on committed package source , so type dr
- **Design**
- **D1 — embedded defaults + fail-safe file override** — and FeatureGate.fromYaml(text) . fromFile(path) stays for overrides. reads a file when a path is given; the no-arg / boot path returns DEFAULT PREAMBLE (no import.meta.url ). gatesPath present & readable → FeatureGate.fromFile ; missing/unreadable or absent → fromYaml(DEFAULT GATES YAML) . this.preamble = deps.preamble
- **D2 — typecheck step** — include = packages/ /src/ / .ts(x) , exclude = tests + node modules. (schema: ZodType ): T , which inferred T as the input type, so defaulted fields came back optional and wiki-engine.ts:16 failed TS2322). Output-typed return fixes the engine and the llm-agent.ts cast. export type ReviewStatus = z.infer (value+type mer
- **Acceptance**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-03-kh-remediation-step1-packaging-typecheck.md`
