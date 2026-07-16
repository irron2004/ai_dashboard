---
title: AI Dashboard Project Overview
slug: ai-dashboard-overview
sources:
- README.md
- CLAUDE.md
- docs/handoffs/2026-07-02-product-diagnosis-and-roadmap.md
- docs/handoffs/2026-07-14-ui-usability-diagnosis.md
purpose: 개인 LLM 위키와 여러 소프트웨어 프로젝트의 작업 흐름을 통합 관리하는 Electron 기반 PM 대시보드
date_updated: '2026-07-16'
---

<!-- autosci:overview:start -->
## Purpose

AI Dashboard is an Electron-based project-management workbench for building and operating a personal LLM wiki while coordinating work across multiple software projects. Its documented boundary covers session ingestion, task and knowledge retrieval, wiki generation and review, agent execution, remote projects, and project-status surfaces.

## Structure

- **Contract surface:** 50 task pages, 45 decision pages, 39 documentation pages, 10 topic pages, and this singleton overview.
- **Knowledge organization:** Every source-backed page is assigned to one of the topic pages below; task-to-topic reverse references are contract-validated.
- **Graph:** 39 evidence-bearing typed relationships connect matching plan, design, and handoff artifacts. The projected graph contains 184 topic and reverse-reference connections.
- **Topic map:** [[project-architecture]], [[desktop-experience]], [[project-management]], [[wiki-and-knowledge-harness]], [[knowledge-and-search]], [[agent-runtime-and-sessions]], [[graph-and-visualization]], [[remote-and-packaging]], [[paper-domain]], and [[autosci-core-integration]].

## Key documents

- [[readme]] — product purpose, primary capabilities, architecture, and development commands.
- [[claude]] — repository operating constraints, IPC wiring rules, and service boundaries.
- [[docs-handoffs-2026-07-02-product-diagnosis-and-roadmap]] — product diagnosis and prioritized roadmap.
- [[docs-handoffs-2026-07-14-ui-usability-diagnosis]] — latest documented UI and usability diagnosis.
- [[docs-handoffs-2026-07-01-ai-dashboard-workviz-and-harness-handoff]] — work-to-wiki graph and harness integration handoff.
- [[docs-handoffs-2026-06-19-autosci-core-substrate-and-interactive-node-confirmation]] — AutoSci substrate integration and node-confirmation handoff.

## Gaps

### Capture health

All 134 selected source documents are captured and marked done; pending, failed, skipped, and orphaned counts are zero.

### Typed graph coverage

- 77 of 145 wiki pages are not endpoints of a typed edge. All 134 source-backed pages still have a validated topic assignment, but additional evidence-backed semantic relationships can improve typed graph coverage.

### Lifecycle review

- Of 50 task pages, 49 remain open and one is done because its source checklist proved completion. Historical handoffs should be used for a later status review rather than inferring completion from age.

### Open work

Topic `Open items` sections and `wiki/graph/open_questions.md` expose the current plan-derived work surface; these entries require product-owner prioritization.
<!-- autosci:overview:end -->
