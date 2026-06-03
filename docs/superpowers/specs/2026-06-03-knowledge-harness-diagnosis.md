---
title: Knowledge Harness — Holistic Problem Diagnosis (team-mode review)
date: 2026-06-03
status: diagnosis
owner: irron2004
relates:
  - 2026-06-02-knowledge-harness-design.md
  - 2026-06-02-knowledge-harness-pipeline-impl-design.md
  - handoffs/2026-06-03-knowledge-harness-phases-1-4.md
method: multi-agent team review (6 dimensions → adversarial verify → synthesis), workflow wf_46a7620f-d0c, 69 agents
---

# Knowledge Harness — Holistic Problem Diagnosis

> **Scope.** A problem-focused team-mode review of the ENTIRE knowledge-harness implementation
> (~79 commits, branch `docs/knowledge-harness-pipeline-spec`). Unlike the seven earlier narrow
> review rounds — which each verified that a specific *change* was locally correct — this pass looked
> at the whole system adversarially for weaknesses. **62 problems raised, 58 confirmed**
> (1 critical, 9 high, 28 medium, 20 low).

## Overall verdict: well-tested skeleton, NOT production-ready

The 267 passing tests prove a `FakeAgentRunner` echoing perfect canned JSON flows through the state
machine. They do **not** test the thing the product exists to do (turn real sources into evidence-backed
wiki content) or the gates meant to make that safe. **The system is safe today only because it writes to a
staging vault and requires human promotion — the human is the real safety gate, not the code.** Most
defects therefore fail *safe* (crash / over-block / no-op) rather than corrupting or leaking the real vault,
which is what keeps all-but-one below "critical."

### Three systemic weaknesses (cut across everything)

1. **The evidence chain is decorative.** No source-ingestion boundary exists — agents are fed only a
   `projectId` string or another agent's (already-fabricated) report; no agent reads a real file,
   transcript, or vault doc, and no code ever verifies a cited `source_path` / `quote_or_summary` is real.
   The `AgentIngestAdapter → NormalizedSession` boundary from impl-design was never wired. "Evidence-based,
   blocks hallucination" is enforced by **prompt text + a human reviewer, not by code**. *This is an
   undisclosed gap, beyond the documented §14 MVP narrowing.*
2. **"Deterministic safety invariants" are largely advisory or inert.** Graph/markdown/link validators
   compute `.ok` that **nothing reads**; PolicyGuard secret detection only *warns*; 17 of 22 feature gates
   (including every safety-named one) are never consulted; the documented "raw/ write → block → FAILED"
   works only by the writer silently skipping, not by the claimed blocking mechanism.
3. **The desktop UI lies to the operator.** `HarnessRunReq = { projectId, engine }`. The 22 gate toggles,
   prompt editors, and temperature/safety sliders are collected, persisted to localStorage, and discarded —
   only `engine` reaches the backend. Toggling "Policy guard off" or "Auto-delete on" changes nothing.

Compounding: **no typecheck in CI** (esbuild strips types; ~10 latent type errors already exist), and
**no test uses a real LLM**, so the entire real-LLM failure surface is unobserved.

## Blockers vs nice-to-haves (bottom line)

- **Hard blockers before real-LLM / production:** A1, A2 (grounding doesn't exist), B1–B3 (verification
  doesn't gate + false-fails on every run), C1/C2 (UI lies), D1 (packaged Electron app won't boot),
  D2 (no typecheck), E1 (tests don't exercise the real job). Until these are fixed, the
  "evidence-based, deterministic-safety" value proposition is **unverified and partly false**.
- **Nice-to-haves:** essentially everything MEDIUM/LOW — real debt and honesty gaps, bounded by the
  staging + human-promotion containment, so they degrade quality/robustness rather than corrupt/leak.

## Recommended sequencing

1. **D1 + D2 first** — a packaged app that won't boot is the most concrete failure; a typecheck step stops
   silent drift. Cheap and high-value.
2. **B1–B3** — make the deterministic validators actually gate (and fix the orphan/node_id rules so they
   don't false-fail every run), so "verification" means something.
3. **Schema hardening** — `.min(1)` / `z.enum` on identity/evidence/op fields + `scope` enum, so empty/
   hallucinated/typo output is rejected structurally (defense-in-depth, not single-point).
4. **C1/C2** — either plumb UI config to the backend or make the controls honest (read-only).
5. **A1 + A2** — the real work: a SourceReader boundary + deterministic evidence-verification driver. This
   is what turns the skeleton into a functioning evidence pipeline.
6. **E1** — harness-level fixtures feeding real-shaped / adversarial agent output through `makeDrivers`,
   plus an opt-in real-LLM smoke test.

## Full confirmed-problem list (58)

> Format: severity-grouped. `#` is a stable index for tracking. "File" is best-effort file:line from the review.

### CRITICAL

| # | Category | Problem | File | Fix |
|---|---|---|---|---|
| 1 | architecture | **No source-ingestion boundary: the "evidence-based" pipeline feeds agents zero real source data** | `packages/knowledge-harness/src/runtime/make-drivers.ts:60-79` | Introduce a deterministic SourceReader boundary (file/transcript loader) that materializes real source text into each agent's input before the LLM call, or explicitly mark these states as stubs in the spec acceptance criteria. As-is, the 'evidence' chain is decorative. |

### HIGH

| # | Category | Problem | File | Fix |
|---|---|---|---|---|
| 2 | architecture | **Entire UI harness config (gates, prompts, model, safety) is collected and silently discarded** | `apps/desktop/src/renderer/store.ts:236` | Either (a) plumb the UI config through HarnessRunReq → HarnessService (write a per-run gates/preamble override), or (b) remove the editable controls and render them read-only reflecting the shipped YAML, so the UI cannot promise control it does not have. |
| 3 | bug | **GraphIntegrity orphan rule is structurally incompatible with an incremental write pipeline (every new node is an orphan)** | `packages/knowledge-harness/src/verify/graph-integrity.ts:64-66` | Exclude newly-authored nodes from the orphan check (or only flag orphans among pre-existing vault docs), or treat orphans as a warning metric rather than an `ok`-affecting failure. |
| 4 | bug | **Default gates/preamble paths use import.meta.url relative '../../../../' — break in the bundled Electron app** | `packages/knowledge-harness/src/runtime/feature-gate.ts:6` | Resolve harness/ relative to a known runtime anchor (app.getAppPath() or process.resourcesPath) and pass gatesPath+preamble explicitly from container.ts; OR add @apc/knowledge-harness to EXTERNAL and ship harness/ as an extraResource. Add a packaged-app smoke test that constructs HarnessService from the bundle output dir. |
| 5 | maintainability | **Repo has no typecheck step and ~10 latent type errors esbuild silently strips** | `packages/llm-wiki/src/wiki-engine.ts:16` | Add per-package tsconfig + a root `typecheck` script (`tsc --noEmit` with project references) and run it in CI alongside vitest; fix the surfaced errors (they are latent bugs in fixtures/types). |
| 6 | safety | **Graph/markdown/link validation failures never block the pipeline or promotion — broken-graph output is silently promotable** | `packages/knowledge-harness/src/runtime/make-drivers.ts:118-139` | In the VALIDATED driver, treat graph/markdown/link `.ok === false` the same way the NODE_PROPOSALS_CREATED driver treats PolicyGuard (throw -> FAILED), or at minimum add these `.ok` flags to HarnessPromoteService.gate() so a human cannot promote a run with broken-graph/invalid-markdown output without an explicit override flag. |
| 7 | safety | **Evidence-based safety guarantee has no deterministic backstop — evidence existence is never verified** | `packages/knowledge-harness/src/policy/policy-guard.ts:28-39; packages/shared/src/kh-schema.ts:18` | Add a deterministic evidence-verification step that resolves each evidence.source_path within raw/ and confirms quote_or_summary (or a normalized substring) is present; block proposals whose evidence cannot be located. |
| 8 | spec-gap | **Desktop dashboard's gate/prompt/model-tuning controls are never sent to the run — they are dead UI** | `apps/desktop/src/shared/ipc-contract.ts:62` | Either (a) forward the renderer config (gates override, prompt overrides, model params) through HarnessRunReq into HarnessService/makeDrivers so the controls actually drive the run, or (b) mark the controls read-only/disabled with an explicit 'reflects harness/feature-gates.yml; edit the file to change' note and remove the prompt/temperature editors until wired. |
| 9 | spec-gap | **UI gate descriptions claim functional control over checks that are structurally always-on or inert** | `apps/desktop/src/renderer/harness-utils.ts:49` | Rewrite the inert-gate descriptions to state they are forward-declared/not yet wired (mirroring the feature-gates.yml header), or gray them out. Do not describe always-on safety checks as toggleable. |
| 10 | tests | **Harness e2e tests feed bare JSON, exercising neither the LLM parse/unwrap chain nor any secret/content flowing through validators** | `packages/knowledge-harness/src/runtime/harness-pipeline.e2e.test.ts:16-44` | Add harness-level tests that feed claude-envelope-wrapped, fenced, prose-prefixed, and malformed agent outputs through makeDrivers; add at least a smoke real-LLM/integration test behind a flag; add a tsc --noEmit typecheck to CI. |

### MEDIUM

| # | Category | Problem | File | Fix |
|---|---|---|---|---|
| 11 | bug | **KhWriteOp.path / node.id / node.title accept empty strings — empty path resolves to the staging root and crashes the write** | `packages/shared/src/kh-schema.ts:67-79` | Add `.min(1)` (and a 'must be a relative, non-empty, .md-ending path' refinement) to KhWriteOp.path, and `.min(1)` to node.id/title/proposal_id and KhWriteOp.op. Reject empty/whitespace paths in writeDoc before touching the fs. |
| 12 | bug | **GraphIntegrity wiki-link resolution ignores Obsidian heading/block link syntax → spurious broken_links** | `packages/knowledge-harness/src/verify/graph-integrity.ts:15-19,58-62` | Strip `#...` and `^...` suffixes before resolving the link target. |
| 13 | bug | **Artifact rel paths are OS-separated (join) but consumed with split('/') — name display breaks on Windows** | `packages/app-services/src/harness-service.ts:101` | Normalize stored rel paths to forward slashes at write time (replace(/\\/g,'/') in writeArtifact), or use path.basename() instead of split('/') in show(). |
| 14 | bug | **git diff uses a 64MB maxBuffer that throws on large vaults — staging always fails for big repos** | `packages/knowledge-harness/src/staging/staging-vault.ts:33` | Stream git diff to a file (or cap with --stat / size guard) and treat an over-size/empty diff as a degraded-but-non-fatal report; don't fail the run on diff size. |
| 15 | maintainability | **Feature-gate coupling is fragile string-matching across three disconnected sources of truth** | `packages/knowledge-harness/src/runtime/run-state-machine.ts:6-16` | Define the gate-name set once in @apc/shared as a const/enum; type PIPELINE step.gate and the UI keys against it; add a test asserting every PIPELINE gate exists in the shipped YAML so a rename fails loudly. |
| 16 | maintainability | **run-state-machine.yml and most of feature-gates.yml are decorative config never consumed by code** | `harness/run-state-machine.yml:1` | Either load the YAML as the actual source of truth (drive PIPELINE from it) or move it under docs/ and stop calling it config. Add a drift test if it is kept as the contract. |
| 17 | maintainability | **Magic-string artifact lookup duplicated across 5 call sites with no shared constant** | `packages/knowledge-harness/src/runtime/make-drivers.ts:35` | Define artifact names as exported const identifiers (e.g. ARTIFACT.appliedWriteReport) shared by writer and reader, and look up by exact basename equality rather than endsWith. |
| 18 | maintainability | **19 of 24 feature gates are inert; HONORED/STRUCTURAL split lives only in a hand-maintained comment** | `harness/feature-gates.yml:11` | Either wire the structural flags to real branches (so enable_secret_scan etc. toggle behavior) or remove the inert flags from the shipped file to stop implying a control that doesn't exist; add a test asserting the yml's flag set equals the set actually consumed. |
| 19 | safety | **RunnerContext.engine is an unvalidated string cast to AgentType at every driver call** | `packages/knowledge-harness/src/runtime/make-drivers.ts:30` | Type RunState.engine as AgentKind (z enum) in kh-schema, drop the cast, and let resume() fail loudly on an unknown engine. |
| 20 | safety | **Pervasive Zod .default() lets structurally-empty LLM output pass validation as 'valid'** | `packages/shared/src/kh-schema.ts:34-95` | Make truly-required fields (proposal evidence when claim_policy.requires_direct_source, node.title/type) non-defaulted/min(1) in the schema so the structural gate rejects empty LLM output before PolicyGuard, defense-in-depth rather than single-point. |
| 21 | safety | **PolicyGuard secret detection only warns, never blocks — secret-bearing proposals proceed** | `packages/knowledge-harness/src/policy/policy-guard.ts:36-39` | Either escalate evidence-text secret hits to `block`, or guarantee the VALIDATED secret scan covers every node summary/claim/evidence string (not just authored file bodies). Document explicitly which layer is authoritative. |
| 22 | safety | **Secrets are written to disk (staging vault AND run-dir diff.patch) BEFORE any scan runs** | `packages/knowledge-harness/src/runtime/make-drivers.ts:105-116` | Scan WritePlan op bodies for secrets BEFORE writing to staging/diff (fail the STAGING_WRITTEN step on a hit), or mask the diff.patch through the SecretScanner before persisting it. |
| 23 | safety | **SecretScanner false negatives for common credential shapes (client_secret, *_TOKEN vars, private-key bodies)** | `packages/knowledge-harness/src/policy/secret-scanner.ts:11-27` | Add a narrowly-anchored `client_secret`/`client[_-]?secret` rule and a private-key-body heuristic (long base64 run after a BEGIN header, or detect the END marker). Accept that this is a tradeoff and at least make the omission explicit in the spec rather than silently safe. |
| 24 | safety | **Markdown/YAML and link validators silently skip non-.md files the Writer can create** | `packages/knowledge-harness/src/verify/markdown-yaml-validator.ts:35-41` | Constrain create_file/append_section op paths to `.md` (skip or block otherwise), or extend the validators / an allowlist to cover the file types the Writer is permitted to author. |
| 25 | safety | **Deterministic validators (graph/markdown-yaml/link) never block the pipeline or promotion — verification is advisory-only** | `packages/knowledge-harness/src/runtime/make-drivers.ts:118-139` | Either fail the VALIDATED transition (or block promotion) when any validation report is not ok, or document explicitly that markdown/link/graph validation is advisory and downgrade the design's verification-gate claim. |
| 26 | safety | **§14 claim 'raw/ write is PolicyGuard-blocked (run FAILED)' is not realized — raw ops are silently skipped** | `packages/knowledge-harness/src/agents/obsidian-wiki-writer.ts:42` | Either run PolicyGuard.check(proposals, writePlan) as a BLOCKING gate at WRITE_PLAN_CREATED (before STAGING_WRITTEN) so raw/delete ops actually FAIL the run, or correct §14 to say 'raw ops are silently skipped by the writer and reported non-blockingly in the final policy pass'. |
| 27 | safety | **raw_modified safety metric is hardcoded false with an incorrect justifying comment** | `packages/knowledge-harness/src/eval/eval-report.ts:51` | Compute raw_modified from observed signal: count raw_write violations in finalPolicy and/or AppliedWriteReport.skipped entries under raw/. Fix the comment to reflect the real invariant (staging-only writes + writer skip), not PolicyGuard. |
| 28 | safety | **shared-promotion ≥2-evidence rule is bypassed by any scope value other than the exact string 'shared_candidate'** | `packages/shared/src/kh-schema.ts:43` | Make scope a z.enum(['project','shared_candidate','shared']) and have PolicyGuard apply the ≥2-evidence floor to BOTH 'shared_candidate' and 'shared' (any non-project scope), so a misspelled/alternate scope can't bypass the shared-promotion gate. |
| 29 | safety | **NodeProposal Zod schema defaults make empty/hallucinated output validate, undercutting the 'parseStructured blocks hallucination' claim** | `packages/shared/src/kh-schema.ts:49` | Drop `.default([])` on claims/evidence (require them, or use `.min(1)` where the contract demands evidence) so a proposal lacking them fails at parse, making the 'hallucination blocked by schema' claim true. Keep defaults only on genuinely-optional metadata. |
| 30 | spec-gap | **node_id_mismatch rule contradicts the spec and false-positives on every Obsidian doc whose filename differs from its node_id** | `packages/knowledge-harness/src/verify/graph-integrity.ts:53` | Compare frontmatter node_id against the graph-update-plan node_ids (cross-artifact consistency), not against the filename stem; or drop the rule. |
| 31 | spec-gap | **WriteOp.op / mode defaults let typo'd or mode-less LLM ops slip through silently** | `packages/shared/src/kh-schema.ts:67` | Make op a z.enum of the known operations so unknown ops fail validation loudly, and surface skipped ops as a policy warning so a silently-dropped write is visible in the report rather than indistinguishable from success. |
| 32 | tests | **E2E/integration tests feed hand-authored, perfectly-consistent LLM output — the LLM's actual job is never exercised** | `packages/knowledge-harness/src/runtime/harness-pipeline.e2e.test.ts:16-44` | Add adversarial fixtures that simulate plausible LLM misbehavior the gates are supposed to catch: write_plan op referencing a node never proposed; evidence.source_path pointing to a nonexistent file; lead emitting mode:'apply' on a non-canonical path that should have been proposal_only; malformed/extra JSON around the object. Assert the deterministic gates catch each. Separately, gate a real-LLM smoke test behind an env flag so prompt-steering is validated at least manually. |
| 33 | tests | **Safety-named feature flags are asserted by tests but never read by any code (false-coverage / decorative config)** | `packages/knowledge-harness/src/runtime/feature-gate.config.test.ts:27-32` | Either wire the asserted flags to real behavior (e.g. enable_secret_scan actually gating the VALIDATED scan; auto_write_to_real_vault actually gating promotion) or delete the inert flags and the test assertions. At minimum, rename/comment the test to make clear these are aspirational/inert config values, not enforced gates, so it stops projecting false safety coverage. |
| 34 | tests | **No deterministic backstop (and no test) for the core 'evidence is real' and 'no fabricated nodes' invariants the prompts demand** | `packages/knowledge-harness/src/policy/policy-guard.ts:26-49` | Add a deterministic check that each evidence.source_path exists under the project's raw/ tree (or is explicitly inference=true), and a reconciliation that every write_plan create op maps to a proposal_id present in NODE_PROPOSALS. Add tests feeding a fabricated-evidence proposal and an orphan write op and assert FAILED. If these checks are intentionally deferred, document them as a trust assumption in §14, because right now the prompts imply enforcement that does not exist. |
| 35 | tests | **Writer silently drops any unknown write-op verb with no test and no surfaced error** | `packages/knowledge-harness/src/agents/obsidian-wiki-writer.ts:43` | Add a test with op:'update_frontmatter' and a typo'd op asserting current behavior; then decide intent — either make unknown verbs a hard error (the plan asked for these ops; silently dropping them is data loss), or constrain op to a z.enum so the schema rejects typos before they reach the writer. |
| 36 | tests | **Zod .default() on identity/evidence fields lets structurally-degenerate LLM output parse as 'valid'** | `packages/shared/src/kh-schema.ts:18-93` | Tighten the schema where emptiness is meaningless: require content XOR content_template for create_file ops (z.refine), require evidence_ids non-empty for non-inference claims, and require quote_or_summary length>0. Add tests feeding the empty-body / empty-quote shapes and assert rejection. Reserve .default() for genuinely optional metadata, not load-bearing identity/evidence fields. |
| 37 | tests | **CLI agent runner and preamble tests validate plumbing/substrings, not the JSON-output contract or prompt steering** | `packages/llm-wiki/src/cli-agent-runner.test.ts:5-13` | Add unwrap/parse robustness tests feeding realistic dirty model outputs (```json fences, leading 'Here is the JSON:', trailing prose, double-encoded strings) and assert correct extraction or a clean ok:false. Behind an opt-in env flag, add at least one real-CLI smoke test that runs one agent and asserts the output parses, so the JSON-only contract is verified against an actual model before this is trusted with a real vault. |
| 38 | tests | **RunLock stale-lock recovery is untested, leaving a crashed run able to permanently block a project** | `packages/knowledge-harness/src/runtime/run-lock.test.ts:12-30` | Add a stale-lock test (pre-create p1.lock, attempt a new run, assert behavior) and implement a recovery path: store pid+timestamp in the lockfile and treat a lock older than a TTL or owned by a dead pid as reclaimable. Correct the spec note to say 'stale-lock recovery deferred' rather than 'cross-process lock deferred'. |

### LOW

| # | Category | Problem | File | Fix |
|---|---|---|---|---|
| 39 | bug | **GraphIntegrity self-links mask orphan detection** | `packages/knowledge-harness/src/verify/graph-integrity.ts:58-66` | Skip edges where idOf(from)===idOf(to) when building hasInbound (and when computing missing_backlinks). |
| 40 | maintainability | **WRITE_PLAN_CREATED state is a no-op pass-through — a vestigial state from a design that planned a second LLM call** | `packages/knowledge-harness/src/runtime/make-drivers.ts:100-103` | Either fold WRITE_PLAN_CREATED into LEAD_MERGED (drop the state + gate) or make it a real distinct step; the rename-only pass-through is pure ceremony. |
| 41 | maintainability | **eval-report coverage metrics are always degenerate; raw_modified is a hardcoded false safety metric** | `packages/knowledge-harness/src/eval/eval-report.ts:26-31,49-51; packages/knowledge-harness/src/runtime/make-drivers.ts:153-154` | Either compute coverage from distinct totals (discovered vs classified) or drop the group; replace the hardcoded raw_modified with an actual deterministic check (e.g. scan whether any applied/proposal target resolved under raw/, or diff the real raw/ tree). |
| 42 | maintainability | **run-state-machine.yml is decorative — never read; real state machine is hardcoded and can drift** | `harness/run-state-machine.yml:1` | Either generate the .ts PIPELINE from the yml (make it real config) or delete the yml and keep a generated/derived doc, so there is a single source of truth. |
| 43 | maintainability | **Three independent hand-rolled frontmatter/YAML parsers instead of one shared util** | `packages/knowledge-harness/src/verify/graph-integrity.ts:8` | Extract a single parseFrontmatter(text) -> {fields, body, errors} (ideally backed by a real YAML parser) and have graph-integrity + the validator consume it, so detection rules are identical. |
| 44 | maintainability | **Eval metrics next_task_candidates and shared_promotion_candidates are hardcoded to 0 (dead metrics)** | `packages/knowledge-harness/src/eval/eval-report.ts:60` | Thread the SharedPromotionPlan (and any next-task signal) into EvalInputs and compute these counts, or drop the fields from the schema until implemented so the report doesn't assert a measured 0. |
| 45 | maintainability | **vault-staging path convention is a literal duplicated across two services, sync enforced only by a comment** | `packages/app-services/src/harness-promote-service.ts:42` | Export one stagingDirFor(runsRoot, runId) helper from knowledge-harness and use it in both services (HarnessService already accepts an injectable stagingDirFor on the promote deps — make it the single source). |
| 46 | safety | **WikiGraphLead emits the WritePlan via LLM prompt instructions, not deterministic construction — safety invariants depend on model compliance** | `packages/knowledge-harness/src/agents/wiki-graph-lead.ts:15-21` | Treat any delete/unknown op in an approved WritePlan as a hard error (throw → FAILED) at the writer or a deterministic pre-write check, rather than silently skipping; do not rely on prompt 'MUST' for the no-delete invariant. |
| 47 | safety | **'shared' (already-promoted) scope is not gated — only 'shared_candidate' requires evidence; shared promotion plan is never enforced** | `packages/knowledge-harness/src/policy/policy-guard.ts:31-34` | Constrain scope to a z.enum, and apply the evidence/human-review gate to both 'shared' and 'shared_candidate'. Better: never let an LLM self-declare 'shared'; force everything through 'shared_candidate' + the human-reviewed promotion plan. |
| 48 | safety | **Writer can overwrite a proposal_only non-.md path directly (proposalPath only rewrites .md)** | `packages/knowledge-harness/src/agents/obsidian-wiki-writer.ts:9,45-48` | Append `.proposal.md` (or `.proposal`) when the path has no `.md` extension instead of replacing, and/or constrain write-op paths to a `.md` allowlist in the schema. |
| 49 | safety | **PolicyGuard delete-detection and shared-scope enforcement depend on free-form LLM strings** | `packages/knowledge-harness/src/policy/policy-guard.ts:32,45; packages/shared/src/kh-schema.ts:43,68` | Make op and scope Zod enums; treat any non-create/append op as block-or-skip with an explicit allowlist; apply the >=2 evidence floor to both shared_candidate and shared. |
| 50 | safety | **Secret-scan promotion gate is fail-OPEN when the secret-scan-report artifact is absent** | `packages/knowledge-harness/src/../app-services/src/harness-promote-service.ts:49-59` | If the run is at HUMAN_REVIEW_REQUIRED but no secret-scan-report is present, refuse promotion (treat missing report as not-clean) unless allowSecrets. |
| 51 | safety | **RunLock.release() deletes the lockfile without verifying ownership** | `packages/knowledge-harness/src/runtime/run-lock.ts:19-21` | Read the lockfile and only remove it if its contents match the owning runId passed to release(). |
| 52 | safety | **RunArtifactStore read/write use caller-supplied relative paths without resolveInside containment** | `packages/knowledge-harness/src/runtime/run-artifact-store.ts:42-52` | Route artifact/file paths through resolveInside(this.runDir, rel). |
| 53 | safety | **PolicyGuard canonical_overwrite is only a warn, so the canonical-overwrite safety relies entirely on the Writer** | `packages/knowledge-harness/src/policy/policy-guard.ts:46-48` | Make canonical-with-mode!=='proposal_only' a block (defense in depth), keeping the Writer reroute as the second layer. |
| 54 | spec-gap | **CLI port omits canonical-promotion surface, so the CLI and IPC paths have diverged capabilities** | `packages/app-services/src/harness-cli.ts:49-54` | Add a `promote-canonical <runId> <proposalRelPath> --hash <h>` CLI command (and `canonical-proposals <runId>`) so acceptance #7 is operable headless, or document the CLI as intentionally a subset. |
| 55 | spec-gap | **State machine's declared per-state artifact list is never enforced — impl-design §6.1 over-claims** | `packages/knowledge-harness/src/runtime/run-artifact-store.ts:60` | Either implement the promised validation (declare expected artifacts in run-state-machine.ts and have the store/runner assert presence per state), or soften impl-design §6.1 to match: artifact lists are documentation, not enforced. |
| 56 | spec-gap | **§14 'renderer UI는 후속' note for canonical promotion is stale — UI is implemented** | `docs/superpowers/specs/2026-06-02-knowledge-harness-pipeline-impl-design.md:348` | Update §14 to record that the renderer canonical-promote UI is implemented (HarnessDashboard 'Canonical proposals'). |
| 57 | spec-gap | **Optional LLM semantic secret/policy layer (design §7.2, §14) does not exist in code** | `packages/knowledge-harness/src/policy/secret-scanner.ts:30` | State in §7.1/§7.2/§14 that the optional LLM assist layer is unimplemented (not merely off), to avoid implying a dormant code path exists. |
| 58 | tests | **Validation reports (graph/markdown/link) are computed but never block — and tests confirm rather than challenge this** | `packages/knowledge-harness/src/runtime/policy-pipeline.e2e.test.ts:52-64` | Add an explicit test naming the contract: 'graph/markdown/link validation failures are advisory and do NOT block promotion (only secrets do)'. If that's wrong and they should block, wire them into the promote gate and test it. Either way make the intended blocking-vs-advisory boundary an asserted invariant, not an accident. |

## Notes on method & confidence

- Each problem was raised by a dimension reviewer, then independently **adversarially verified** against the
  code (58 of 62 survived; 4 were rejected as not-real). Severities are the verifiers' refined values.
- Several findings I (the implementer) can corroborate directly: B2 (orphan-always-false) is why an earlier
  e2e assertion had to be weakened; A1 is visible in `make-drivers.ts` (agents receive no file content);
  D2's latent errors include the pre-existing `wiki-engine.ts:16` TS2322.
- This diagnosis **revises** the earlier "converged / all 8 acceptance criteria met" framing: that was true
  against the literal checkbox wording, but those criteria assert structural plumbing and do not exercise
  the real job. The seven "clean" rounds gave false confidence by only re-checking the narrow changed
  surface each time. This holistic pass is what should have run earlier.
