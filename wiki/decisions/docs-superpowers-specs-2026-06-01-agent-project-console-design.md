---
title: Agent Project Console — PRD v0.4
slug: docs-superpowers-specs-2026-06-01-agent-project-console-design
sources: [docs/superpowers/specs/2026-06-01-agent-project-console-design.md]
status: accepted
date: 2026-06-01
topic: [agent-runtime-and-sessions]
---

## Context

title: Agent Project Console — Design (PRD v0.4) supersedes: PRD v0.2 (Multi-Project LLM Wiki Workbench) AI agent 시대에 PM이 여러 프로젝트를 운영하는 작업대. AI agent(Claude / Codex / OpenCode)에게 task를 나눠주고, 작업 결과를 리뷰하고, 다음 task를 만들며, 프로젝트의 현재 상태와 의사결정을 LLM Wiki + Obsidian-compatible vault 로 유지하는 개인 PM workbench. 개발자용 또 다른 IDE가 아니다. 핵심은 코드 편집이 아니라 task lifecycle 다. AI agent 작업 관리 + 리뷰 + 다음 task 생성 도구 ✅ v0.2(LLM Wiki Workbench)의 기술 결정(런타임 스택, Common Core, terminal wrapper, transcript resolver, 멀티엔진 picker)은 모두 유효하다. v0.3은 그 위에 PM 도메인(Task / AgentRun / Review) 을 중심으로 재포지셔닝한 것이다. 제품의 중심 흐름은 코드가 아니라 task lifecycle다. → (P1) Roadmap / Schedule / Epic → Agent Assign

## Decision

- **0. 한 줄 정의**
- **1. 제품 정체성 & 포지셔닝** — 사용자는 "코드 편집자"가 아니라 PM 이다
- **2. 핵심 워크플로 — Task Lifecycle** — 제품의 중심 흐름은 코드가 아니라 task lifecycle다.
- **MVP 최소 핵심 루프 (확정)**
- **3. 런타임 스택 결정 (v0.2에서 확정, 유지)** — 이유 1. 장기 목표가 독립 앱 기반 multi-project PM workbench다. 2. Obsidian-compatible vault, agent log path scan, SQLite index, file watcher, PTY 터미널 등 로컬 OS 기능 이 핵심이다. 3. 설계 contract를 TypeScript / Zod schema로 한 언어에서 유지할 수 있다. 4. Dashboard / PM 서비스 / LLM Wiki pipeline이 동일한 domain model을 공유한다. 5. 장기 실행 작업은 Electron main에서 직접 수행하지 않고
- **핵심 원칙 (비협상)**
- **부속 스택**
- **4. 아키텍처**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-01-agent-project-console-design.md`
