---
title: "Paper Domain — Plan 1: Domain Plumbing + DomainPack Scaffold"
slug: docs-superpowers-plans-2026-06-20-paper-domain-plan1-domain-plumbing
sources: [docs/superpowers/plans/2026-06-20-paper-domain-plan1-domain-plumbing.md]
status: open
created: 2026-06-20
topic: [paper-domain]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Persist a per-project domain ('project-docs' 'paper') end-to-end (schema → DB → registry → IPC → renderer UI) and route it into the harness via a DomainPack selector, with zero behavior change for existing project-docs projects. Architecture: A new domain field on Project flows from the ProjectSidebar form through IPC/registry into SQLite (idempotent column migration). The knowledge-harness gains a DomainPack interface and

## Progress log

- Source checklist: 0 completed, 39 remaining.
- **Global Constraints**
- **File Structure**
- **Task 1: domain field on the Project schema** — Run: pnpm exec vitest run packages/shared/src/schema.domain.test.ts Expected: FAIL — p.domain is undefined (field not yet on schema). In packages/shared/src/schema.ts , after line 9 ( ProjectStatus ) In ProjectSchema (after the projectType line), add Run: pnpm exec vitest run packages/shared/src/schema.domain.test.ts E
- **Task 2: Persist domain in SQLite (idempotent migration + registry)** — Run: pnpm exec vitest run packages/core/src/project-registry.domain.test.ts Expected: FAIL — domain not selected/inserted (get returns default only because schema defaults; the paper round-trip fails because register does not write the column). In packages/core/src/db.ts , inside migrate , AFTER the db.exec(\ CREATE TA
- **Task 3: IPC contract + handlers carry domain** — Run: pnpm --filter @apc/desktop exec vitest run src/main/ipc.domain.test.ts Expected: FAIL — handler ignores domain , so the paper case returns project-docs . In apps/desktop/src/shared/ipc-contract.ts In apps/desktop/src/main/ipc.ts Run: pnpm --filter @apc/desktop exec vitest run src/main/ipc.domain.test.ts Expected:
- **Task 4: Renderer — domain selector in the project dialog** — Run: pnpm --filter @apc/desktop exec vitest run src/renderer/components/ProjectSidebar.domain.test.tsx Expected: FAIL — no Domain control; onAdd called with 3 args, not 4. In ProjectSidebar.tsx Run: pnpm --filter @apc/desktop exec vitest run src/renderer/components/ProjectSidebar.domain.test.tsx Expected: PASS. Run: no
- **Task 5: DomainPack interface + domainPackFor selector + project-docs pack** — Run: pnpm exec vitest run packages/knowledge-harness/src/domains/index.test.ts Expected: FAIL — module ./index.js does not exist. Run: pnpm exec vitest run packages/knowledge-harness/src/domains/index.test.ts Expected: PASS (2 tests). Add to packages/knowledge-harness/src/index.ts (the package's public barrel — match t
- **Task 6: Carry domain into the harness run (no behavior change)** — Run: pnpm exec vitest run packages/app-services/src/harness-service.domain.test.ts Expected: FAIL — resolveDomainPack is not exported. In packages/app-services/src/harness-service.ts In apps/desktop/src/main/container.ts harnessRun (line ~273), add domain: project?.domain to the harness.run({...}) input object. Run: pn

## Related

- Source: `docs/superpowers/plans/2026-06-20-paper-domain-plan1-domain-plumbing.md`
