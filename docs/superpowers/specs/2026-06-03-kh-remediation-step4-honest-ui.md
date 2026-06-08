---
title: KH Remediation Step 4 — Stop the desktop UI from lying about control it doesn't have (C1/C2)
date: 2026-06-03
status: spec
owner: irron2004
relates:
  - 2026-06-03-knowledge-harness-diagnosis.md
addresses: ["#2", "#8", "#9"]
---

# Step 4 — honest harness config UI

## Problem (from diagnosis)

`HarnessRunReq = { projectId, engine }`. The Agent-Config panel collects 22 gate toggles, 6 prompt
editors, temperature/max-tokens, and safety sliders, persists them to localStorage — and sends only
`engine`. Toggling "Policy guard off" or "Auto-delete on" changes nothing (#2, #8). The gate descriptions
present always-on safety checks and inert forward-declared flags as freely toggleable (#9).

## Why "make honest", not "plumb to backend"

Plumbing the toggles to actually flip gates was **explicitly rejected** earlier (round-1 #7: "per-flag gate
wiring weakens the always-on safety net — skip") and contradicts the shipped `harness/feature-gates.yml`
header, which states the safety gates are **always-on, structurally enforced, NOT toggleable in the MVP**.
Making a "Policy guard" toggle actually disable PolicyGuard would be a safety regression. Temperature /
max-tokens / secret-scan-sensitivity also map to **no** backend knob (the CLI runner has none). So the
correct fix is diagnosis option (b): make the controls **honest** — reflect the shipped policy read-only,
and clearly mark what does vs does not affect a run.

## Design (confined to the two untracked harness-UI files)

`harness-utils.ts`:
- Add a `wiring: 'honored' | 'structural' | 'forward-declared'` field to every `HARNESS_FEATURE_GATES`
  entry, classified from the shipped YAML header (honored=drives pipeline; structural=always-on safety;
  forward-declared=inert P1). Add `SHIPPED_GATE_VALUES` (the on/off the harness actually ships) as the
  read-only source of truth, and a `GATE_WIRING_LABEL` map.

`AgentConfigPanel.tsx`:
- **Engine** stays interactive — it is the one setting that reaches the run.
- **Feature Gates** render **read-only**: shipped value + a wiring badge (HONORED / ALWAYS-ON / NOT WIRED),
  no toggle. A banner states they reflect `harness/feature-gates.yml` and are not editable in the MVP.
- **Temperature / Max tokens**, **Agent Prompts**, **Safety Settings** are shown **disabled** with a
  "not wired in the MVP" note (the shipped `harness-rules.md` preamble + fixed always-on safety are used).
- Props/signatures unchanged (HarnessDashboard + store untouched) — the now-inert callbacks simply aren't
  invoked, so no other file (incl. the in-flight store.ts/App.tsx restyle stream) is modified.

## Acceptance

- [ ] No control in the panel claims an effect it doesn't have: gates read-only w/ wiring badges; temp/
      tokens/prompts/safety disabled + labeled; engine still live.
- [ ] `harness-utils` exposes gate wiring class + shipped values; a unit test asserts every gate has a
      wiring class and that SHIPPED_GATE_VALUES matches the embedded DEFAULT_GATES_YAML policy.
- [ ] desktop suite stays green; no change to store.ts / HarnessDashboard / other streams.

> **Scope note:** this is the honest-UI half of C1/C2. A future per-run *override* path (if ever desired)
> would still be gated by the round-1 safety decision and is out of scope.
