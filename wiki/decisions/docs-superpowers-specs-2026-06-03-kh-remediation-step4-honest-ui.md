---
title: Step 4 — honest harness config UI
slug: docs-superpowers-specs-2026-06-03-kh-remediation-step4-honest-ui
sources: [docs/superpowers/specs/2026-06-03-kh-remediation-step4-honest-ui.md]
status: accepted
date: 2026-06-03
topic: [project-architecture]
---

## Context

title: KH Remediation Step 4 — Stop the desktop UI from lying about control it doesn't have (C1/C2) HarnessRunReq = { projectId, engine } . The Agent-Config panel collects 22 gate toggles, 6 prompt editors, temperature/max-tokens, and safety sliders, persists them to localStorage — and sends only engine . Toggling "Policy guard off" or "Auto-delete on" changes nothing ( 2, 8). The gate descriptions present always-on safety checks and inert forward-declared flags as freely toggleable ( 9). Plumbing the toggles to actually flip gates was explicitly rejected earlier (round-1 7: "per-flag gate wiring weakens the always-on safety net — skip") and

## Decision

- **Problem (from diagnosis)** — HarnessRunReq = { projectId, engine } . The Agent-Config panel collects 22 gate toggles, 6 prompt editors, temperature/max-tokens, and safety sliders, persists them to localStorage — and sends only engine . Toggling "Policy guard off" or "Auto-delete on" changes nothing ( 2, 8). The gate descriptions present always-on
- **Why "make honest", not "plumb to backend"** — Plumbing the toggles to actually flip gates was explicitly rejected earlier (round-1 7: "per-flag gate wiring weakens the always-on safety net — skip") and contradicts the shipped harness/feature-gates.yml header, which states the safety gates are always-on, structurally enforced, NOT toggleable in the MVP . Making a "
- **Design (confined to the two untracked harness-UI files)** — harness-utils.ts entry, classified from the shipped YAML header (honored=drives pipeline; structural=always-on safety; forward-declared=inert P1). Add SHIPPED GATE VALUES (the on/off the harness actually ships) as the read-only source of truth, and a GATE WIRING LABEL map. AgentConfigPanel.tsx no toggle. A banner state
- **Acceptance** — tokens/prompts/safety disabled + labeled; engine still live. wiring class and that SHIPPED GATE VALUES matches the embedded DEFAULT GATES YAML policy.

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-03-kh-remediation-step4-honest-ui.md`
