---
title: Project Wiki Direct Visualization — Design
slug: docs-superpowers-specs-2026-06-22-project-wiki-direct-visualization-design
sources: [docs/superpowers/specs/2026-06-22-project-wiki-direct-visualization-design.md]
status: accepted
date: 2026-06-22
topic: [graph-and-visualization]
---

## Context

Status: Approved (brainstorming) — pending implementation plan Branch: builds on feat/cytoscape-graph-viz (depends on the Cytoscape graph component + GraphData types) Visualize a project's existing, already-generated wiki ( /wiki/ , AutoSci/ΩmegaWiki layout with graph/edges.jsonl + / .md node files) directly in the Cytoscape graph view — without running the harness. The current graph reads only from a harness run's vault-staging ; this adds a second source (the promoted project wiki) and a toggle to switch between them. registry's repoPaths ), not a folder picker or manual path. (latest run). Not auto-replacement. AutoSci/ΩmegaWiki layout und

## Decision

- **Goal** — Visualize a project's existing, already-generated wiki ( /wiki/ , AutoSci/ΩmegaWiki layout with graph/edges.jsonl + / .md node files) directly in the Cytoscape graph view — without running the harness. The current graph reads only from a harness run's vault-staging ; this adds a second source (the promoted project wiki
- **Decisions (from brainstorming)** — registry's repoPaths ), not a folder picker or manual path. (latest run). Not auto-replacement. follow-up.
- **Non-Goals**
- **Wiki format (read target)** — AutoSci/ΩmegaWiki layout under /wiki/ qualified node refs in / form (slash separator — note: different from the vendored paper pack's : colon form). (papers, concepts, topics, people, ideas, experiments, methods, foundations, Summary, outputs, …).
- **Architecture**
- **Components**
- **IPC contract** — GraphEdgeDto already exists ( { from, to, type } & Record ), reused here.
- **readProjectWiki(repoPaths) (main)** — first whose graph/edges.jsonl exists. from / to / type (skip malformed). index.md / log.md ): slug = frontmatter slug: else filename stem; title = frontmatter title else slug; ref = / ; relPath = wiki/ / .

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-22-project-wiki-direct-visualization-design.md`
