---
title: Generate / LLM Wiki UI — Design
slug: docs-superpowers-specs-2026-06-02-generate-llm-wiki-ui-design
sources: [docs/superpowers/specs/2026-06-02-generate-llm-wiki-ui-design.md]
status: accepted
date: 2026-06-02
topic: [wiki-and-knowledge-harness]
---

## Context

title: Generate / LLM Wiki UI — Design relates: 2026-06-01-agent-project-console-design.md (PRD v0.4 §9 LLM Wiki engine, §11 vault, §10 conflict) Wire the already-built LLM Wiki engine into the desktop app so a PM can, with one click, turn recent agent work into Obsidian-compatible project memory : pick an engine, generate a work summary + a current.md proposal, review it, and promote it into the canonical vault. Engines already exist ( @apc/llm-wiki WikiEngine / CliAgentRunner / buildWikiPrompt / parseStructured ; @apc/pm VaultWriter ; @apc/app-services RunService / CurrentPromotionService ; renderer ModelPicker ). This spec covers the deskt

## Decision

- **0. Goal** — Wire the already-built LLM Wiki engine into the desktop app so a PM can, with one click, turn recent agent work into Obsidian-compatible project memory : pick an engine, generate a work summary + a current.md proposal, review it, and promote it into the canonical vault.
- **1. Scope (MVP)** — In Out (P1+)
- **2. Key decisions**
- **2.1 What does Generate operate on?** — The desktop terminals are plain shells — there is no AgentRun record or captured transcript . So Generate does not depend on a Task/AgentRun. Instead A new GenerateService.generateForProject({ projectId, engine }) 1. Asks each ingest adapter ( @apc/agents ) to discoverSources , ordered most-recent-first. 2. Parses sour
- **2.2 Headless CLI invocation must be robust (engine fix)** — CliAgentRunner currently substitutes the prompt into argv ( {{PROMPT}} ) and spawn s the bare command. Two problems: (1) Windows agent CLIs are .cmd shims → bare spawn('claude') fails ( ENOENT ); (2) a large prompt in argv is fragile (quoting/length). Fix
- **2.3 Trigger & review (PRD §9 권한)**
- **3. Flow**
- **4. Interfaces**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-02-generate-llm-wiki-ui-design.md`
