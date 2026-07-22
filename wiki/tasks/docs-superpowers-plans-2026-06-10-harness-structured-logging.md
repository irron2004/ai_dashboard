---
title: Harness 구조화 로깅 Implementation Plan
slug: docs-superpowers-plans-2026-06-10-harness-structured-logging
sources: [docs/superpowers/plans/2026-06-10-harness-structured-logging.md]
status: open
created: 2026-06-10
topic: [wiki-and-knowledge-harness]
---

## Summary

For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking. Goal: 모든 harness 엔진 호출의 prompt/stdout/stderr/exit code를 run 디렉터리에 성공·실패 불문 영속하고, 실패 메시지를 진단 가능하게 만들고, 실행 중 출력을 UI에 실시간 표시한다. Architecture: 엔진 호출 경로 LlmAgent → RoutingAgentRunner → Cli/Ssh 사이에 LoggingAgentRunner 데코레이터를 끼워 runs/RUN-…/logs/ - / 에 기록한다. 계약( RunInput / RunResult )에 옵셔널 필드만 추가해 하위호환을 유지한다. UI는 기존 harness:progress IPC와 나란한 새 채널 harness:engineLog 로 live tail을 받는다. Tech Stack: TypeScript, Node child process , Electron IPC

## Progress log

- Source checklist: 0 completed, 50 remaining.
- **Task 1: 계약 확장 — RunInput / RunResult** — packages/llm-wiki/src/agent-runner.ts 전체를 다음으로 교체 Run: pnpm --filter @apc/llm-wiki exec tsc --noEmit && pnpm vitest run packages/llm-wiki Expected: 타입 에러 없음, 기존 테스트 전부 PASS (필드가 전부 옵셔널이므로).
- **Task 2: CliAgentRunner — stderr/exitCode 보존 + onChunk** — cli-agent-runner.test.ts 의 첫 번째 describe('CliAgentRunner', …) 블록 안에 추가 Run: pnpm vitest run packages/llm-wiki/src/cli-agent-runner.test.ts Expected: 신규 3개 FAIL ( exitCode 가 undefined 등), 기존 7개 PASS. cli-agent-runner.ts 의 run 메서드를 다음으로 교체 Run: pnpm vitest run packages/llm-wiki/src/cli-agent-runner.test.ts Expected: 전부 P
- **Task 3: ssh-exec + SshAgentRunner — exitCode/onChunk 관통** — ssh-agent-runner.test.ts 의 describe('SshAgentRunner', …) 블록 안에 추가 Run: pnpm --filter @apc/desktop exec vitest run src/main/ssh-agent-runner.test.ts Expected: 신규 1개 FAIL (SshExecResult에 exitCode 없음 — 타입 에러로 먼저 드러날 수 있음), 기존 5개 PASS. SshExecResult / SshExec 타입과 sshExec 본문을 다음으로 교체 (parseSsh, loginShell, ENGINE CMD는 그대로)
- **Task 4: LoggingAgentRunner 데코레이터 (신규)** — packages/llm-wiki/src/logging-agent-runner.test.ts Run: pnpm vitest run packages/llm-wiki/src/logging-agent-runner.test.ts Expected: FAIL — 모듈 없음. packages/llm-wiki/src/logging-agent-runner.ts packages/llm-wiki/src/index.ts 에 추가 Run: pnpm vitest run packages/llm-wiki/src/logging-agent-runner.test.ts && pnpm --filter @a
- **Task 5: LlmAgent 에러 메시지 + label 관통** — llm-agent.test.ts 의 describe('LlmAgent failure + cwd', …) 블록에서 기존 'surfaces the TAIL…' 테스트를 아래 4개로 교체 Run: pnpm vitest run packages/knowledge-harness/src/agents/llm-agent.test.ts Expected: 신규 4개 FAIL, 나머지 PASS. LlmRunArgs 에 label?: string 추가 run 메서드를 다음으로 교체 5개 LLM 호출에 label 을 추가한다 (각 드라이버의 상태명-에이전트명) Run: pnpm vitest
- **Task 6: HarnessService 배선 — 로깅 + onEngineLog** — harness-service.test.ts 끝에 추가 (기존 import에 existsSync , readFileSync 가 없으면 node:fs 에서 추가) (이 테스트 파일에서 FakeAgentRunner , AgentRunner 는 @apc/llm-wiki 에서 import. mkdtempSync / mkdirSync / readdirSync / readFileSync / existsSync 는 node:fs , tmpdir 은 node:os , join 은 node:path — 파일 상단 기존 import와 중복되지 않게 병합.) Run: pnpm vitest
- **Task 7: IPC 배선 — harness:engineLog 채널** — ipc-contract.ts 의 CH 객체에서 harnessProgress: 'harness:progress', 다음 줄에 추가 타입 정의부(TestSshReq 근처)에 추가 import에 HarnessEngineLogEvent 추가. opts 타입( emitHarnessProgress 아래)에 추가 container.ts 모듈 레벨(createContainer 바깥)에 배처 추가 harnessRun 을 다음으로 교체 emitHarnessProgress: … 줄 옆에 추가 onHarnessProgress 아래에 추가 window.apc 타입 선언의 onHarnessP
- **Task 8: 렌더러 — live tail 표시** — apps/desktop/src/renderer/harness-utils.test.ts 가 이미 있으면 거기에, 없으면 신규 파일로 Run: pnpm --filter @apc/desktop exec vitest run src/renderer/harness-utils.test.ts Expected: FAIL — appendTailLines 없음. 상태 타입( harnessProgress: string null 옆)에 추가 초기값( harnessProgress: null, 옆)에 추가 startHarnessRun 의 시작 set(...) (264행 부근)에 리셋 추가 액션

## Related

- Source: `docs/superpowers/plans/2026-06-10-harness-structured-logging.md`
