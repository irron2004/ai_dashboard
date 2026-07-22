---
title: Harness SSH Engine Runner Implementation Plan
slug: docs-superpowers-plans-2026-06-08-harness-ssh-engine-runner
sources: [docs/superpowers/plans/2026-06-08-harness-ssh-engine-runner.md]
status: open
created: 2026-06-08
topic: [remote-and-packaging]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: Make the Knowledge Harness run the engine CLI on the remote host (over SSH, in the project folder, with the user's login-shell PATH/auth) for ssh:// projects — the same mechanism the Generate flow already uses — instead of spawning it locally on the app host. Architecture: Extract the existing SSH exec helpers from remote-generate.ts into a shared ssh-exec.ts ; add an SshAgentRunner (implements the harness's AgentRunner int

## Progress log

- Source checklist: 0 completed, 13 remaining.
- **File Structure**
- **Task 1: Extract shared SSH helpers into ssh-exec.ts** — This is a pure refactor — behavior must stay identical, proven by remote-generate.test.ts staying green. (a) DELETE the now-moved declarations from remote-generate.ts : the type SshTarget , function parseSsh , type SshExecResult , type SshExec , function sshExec , function loginShell , and const ENGINE CMD . (b) Add ne
- **Task 2: SshAgentRunner + RoutingAgentRunner**
- **Task 3: Inject RoutingAgentRunner into the container + full verification** — In apps/desktop/src/main/container.ts (a) The import line import { WikiEngine, CliAgentRunner, type AgentRunner } from '@apc/llm-wiki' — remove CliAgentRunner (it is no longer referenced directly in this file; it now lives inside RoutingAgentRunner ) ( WikiEngine is still used at const wiki = new WikiEngine(...) ; type
- **Notes for the implementer**

## Related

- Source: `docs/superpowers/plans/2026-06-08-harness-ssh-engine-runner.md`
