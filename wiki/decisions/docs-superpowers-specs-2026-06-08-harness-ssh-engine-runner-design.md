---
title: Knowledge Harness 엔진을 SSH로 실행 (SshAgentRunner)
slug: docs-superpowers-specs-2026-06-08-harness-ssh-engine-runner-design
sources: [docs/superpowers/specs/2026-06-08-harness-ssh-engine-runner-design.md]
status: accepted
date: 2026-06-08
topic: [remote-and-packaging]
---

## Context

title: Knowledge Harness 엔진을 SSH(remote)에서 실행 — SshAgentRunner 설계 trigger: ssh:// 프로젝트에서 "전 문서로 위키 생성" 시 harness가 엔진을 로컬(Windows 앱)에서 spawn → 환경/인증/MCP 불일치로 실패. 터미널 패널과 Generate(✨)는 SSH로 remote에서 실행해 잘 됨. branch: docs/knowledge-harness-pipeline-spec 사용자 환경: Electron 앱은 Windows 에서 돌고, 작업 대상은 remote Linux (ssh:// 프로젝트). 코드 대조 결과 결론: "SSH로 remote에서 엔진 실행"은 이미 Generate 경로에 구현돼 있다. Harness만 그 패턴을 안 쓴다. 빠진 한 조각(SSH-aware AgentRunner)을 채운다. 현재 remote-generate.ts 내부의 parseSsh / SshTarget / sshExec / SshExec / loginShell / ENGINE CMD 를 apps/desktop/src/main/ssh-exec.ts 로 추출·export. remote-generate.ts 는 이를 import (동작 불변, 기존 테스트 green 유지). ( pty-manager

## Decision

- **1. 배경 / 진단** — 사용자 환경: Electron 앱은 Windows 에서 돌고, 작업 대상은 remote Linux (ssh:// 프로젝트). 코드 대조 결과
- **2. 설계**
- **2.1 공유 SSH 헬퍼 추출** — 현재 remote-generate.ts 내부의 parseSsh / SshTarget / sshExec / SshExec / loginShell / ENGINE CMD 를 apps/desktop/src/main/ssh-exec.ts 로 추출·export. remote-generate.ts 는 이를 import (동작 불변, 기존 테스트 green 유지). ( pty-manager.ts 의 별도 parseSsh 사본은 이번 범위에서 건드리지 않음.)
- **2.2 SshAgentRunner (신규) — apps/desktop/src/main/ssh-agent-runner.ts** — @apc/llm-wiki 의 AgentRunner 인터페이스( run(input: RunInput): Promise )를 구현. RunInput = { agent, prompt, timeoutMs, cwd? } . = Generate가 쓰는 그 방식(로그인 셸 + cd + engine, prompt stdin)을 그대로 harness 에이전트 호출에 적용. 출력(stdout)은 harness의 unwrapAgentJson(output, engine) → parseStructured 가 처리(Generate와 동일).
- **2.3 RoutingAgentRunner (신규, 같은 파일)** — cwd가 ssh://면 SSH, 아니면 로컬.
- **2.4 컨테이너 주입** — apps/desktop/src/main/container.ts : harness 러너 기본값을 new CliAgentRunner() → new RoutingAgentRunner() . (테스트는 opts.agentRunner 로 FakeAgentRunner 주입 — 그대로 유지.) cwd는 이미 harnessRun 이 repoPaths[0] 로 넘기므로, ssh 프로젝트면 그 값이 ssh://… URL → 라우터가 SSH로 보냄.
- **3. 테스트**
- **4. 범위 밖 (YAGNI)**

## Consequences

- Consequences and validation details remain traceable to the source document.

## Related

- Source: `docs/superpowers/specs/2026-06-08-harness-ssh-engine-runner-design.md`
