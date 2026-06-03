---
title: KH Remediation Step 1 — Packaging boot fix (D1) + Typecheck step (D2)
date: 2026-06-03
status: spec
owner: irron2004
relates:
  - 2026-06-03-knowledge-harness-diagnosis.md
addresses: ["#4 (D1)", "#5 (D2)"]
---

# Step 1 — D1 (packaging boot) + D2 (typecheck)

First of the diagnosis's recommended-sequencing steps: the two cheapest, most concrete blockers.

## Problem (from diagnosis)

- **#4 / D1** — `feature-gate.ts:6` and `preamble.ts:6` resolve the default gates/rules paths via
  `fileURLToPath(new URL('../../../../', import.meta.url))`. That `../../../../` walk is correct when the
  module runs from `packages/knowledge-harness/src/...` (→ repo root) but **wrong once electron-vite bundles
  `@apc/knowledge-harness` into `apps/desktop/out/main/index.js`** — the same walk then lands at the repo's
  *parent* dir, so `harness/feature-gates.yml` / `harness-rules.md` are not found and the harness throws at
  boot. `container.ts:91` passes neither `gatesPath` nor `preamble`, so it inherits the broken defaults.
- **#5 / D2** — the repo has no typecheck step. `vitest` uses esbuild, which strips types without checking
  them, so type errors accumulate silently. There are real latent errors in committed source.

## Goal

1. The harness **boots with zero filesystem dependency** — defaults are compiled in, so a bundled Electron
   app can never fail to start over a missing `harness/` file. An explicit file path remains an *optional
   override* for runtime editing.
2. A root `typecheck` script exists and is **green on committed package source**, so type drift is caught.

## Design

### D1 — embedded defaults + fail-safe file override

- `feature-gate.ts`: add `export const DEFAULT_GATES_YAML` (verbatim content of `harness/feature-gates.yml`)
  and `FeatureGate.fromYaml(text)`. `fromFile(path)` stays for overrides.
- `preamble.ts`: add `export const DEFAULT_PREAMBLE` (verbatim `harness/harness-rules.md`). `loadPreamble(path)`
  reads a file when a path is given; **the no-arg / boot path returns `DEFAULT_PREAMBLE`** (no `import.meta.url`).
- `harness-service.ts`: gate construction becomes fail-safe —
  `gatesPath` present & readable → `FeatureGate.fromFile`; missing/unreadable or absent → `fromYaml(DEFAULT_GATES_YAML)`.
  `this.preamble = deps.preamble ?? DEFAULT_PREAMBLE`. So the **default boot path never touches the fs.**
- Drift guard: a test asserts `DEFAULT_GATES_YAML` / `DEFAULT_PREAMBLE` equal the canonical `harness/*` files
  (runs from source where the files exist), so the embedded copy cannot silently diverge.
- Packaged-boot smoke test: construct `HarnessService` with **no** `gatesPath`/`preamble`, assert it builds a
  runner and the HONORED gates resolve from the embedded YAML — simulating the bundled app.

> **Scope note (honest):** shipping an *editable* override file inside a packaged app (electron-builder
> `extraResource` + `process.resourcesPath`) is **not** done here — there is no electron-builder/forge config
> in the repo yet. Embedded defaults fully fix "won't boot"; runtime-editable shipped config is a follow-up
> gated on adding a packaging config. Documented, not silently skipped.

### D2 — typecheck step

- Add `tsconfig.typecheck.json` (root): `noEmit`, paths-mapping every `@apc/*` to its `src/index.ts`,
  `include` = `packages/*/src/**/*.ts(x)`, `exclude` = tests + node_modules.
- Add root `package.json` script `"typecheck": "tsc -p tsconfig.typecheck.json"`.
- Fix the surfaced **committed package-source** errors:
  - `parse-structured.ts` — `parseStructured<S extends ZodType>(raw, schema: S): S['_output']` (was
    `<T>(schema: ZodType<T>): T`, which inferred T as the *input* type, so defaulted fields came back optional
    and `wiki-engine.ts:16` failed TS2322). Output-typed return fixes the engine and the `llm-agent.ts` cast.
  - `schema.ts` — add `export type TaskStatus = z.infer<typeof TaskStatus>` and
    `export type ReviewStatus = z.infer<typeof ReviewStatus>` (value+type merge), fixing the TS2749s in
    `pm/review-service.ts` and `pm/task-store.ts` that imported `type TaskStatus`/`ReviewStatus`.

> **Scope note (honest):** the gating `typecheck` covers **package source**. It does NOT yet cover (a) test
> files or (b) `apps/desktop` renderer — both are entangled with two in-flight, uncommitted work streams: the
> `sourceMeta` ingest-schema refactor (modified working tree, not mine) and the untracked renderer components
> (`harness-utils.ts`, `AgentConfigPanel.tsx`, `DiffViewer.tsx`, … — the dead-UI / step-4 surface). Extending
> the typecheck to tests + desktop is tracked for after those streams land (and overlaps step 4). The
> remaining error buckets are listed in the diagnosis; they are not hidden by scoping the gate to source.

## Acceptance

- [ ] `pnpm typecheck` exits 0 on committed package source.
- [ ] New `feature-gate`/`preamble` constants + `fromYaml`; drift tests green; packaged-boot smoke test green.
- [ ] `HarnessService` default boot path performs no filesystem read for gates/preamble.
- [ ] Existing suites stay green (packages 233 + desktop 34 baseline).
- [ ] Commits are TDD-task-sized with conventional messages.
