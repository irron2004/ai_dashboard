---
title: Knowledge Harness 엔진을 SSH(remote)에서 실행 — SshAgentRunner 설계
date: 2026-06-08
status: design-approved
author: PM (Claude)
trigger: ssh:// 프로젝트에서 "전 문서로 위키 생성" 시 harness가 엔진을 로컬(Windows 앱)에서 spawn → 환경/인증/MCP 불일치로 실패. 터미널 패널과 Generate(✨)는 SSH로 remote에서 실행해 잘 됨.
branch: docs/knowledge-harness-pipeline-spec
---

# Knowledge Harness 엔진을 SSH로 실행 (SshAgentRunner)

## 1. 배경 / 진단

사용자 환경: Electron 앱은 **Windows**에서 돌고, 작업 대상은 **remote Linux**(ssh:// 프로젝트). 코드 대조 결과:

- **터미널 패널**(`pty-manager.ts`)은 ssh:// 프로젝트면 `ssh`로 remote에 붙어 거기서 엔진 실행 → 잘 됨.
- **Generate(✨)**(`remote-generate.ts`)은 ssh:// 프로젝트면 **비대화식 ssh로 remote에서 엔진 실행**(prompt를 stdin) → 잘 됨. 핵심 트릭 포함:
  - `bash -lic 'source ~/.bashrc…; cd <project> && <engine>'` — 사용자 로그인 셸 PATH/인증을 그대로 로드 (주석: *"that's why codex/opencode resolved interactively but were 'not found' from the app"*).
  - codex는 `--skip-git-repo-check` 부여.
- **Knowledge Harness**(`harnessRun` → `HarnessService` → `CliAgentRunner`)만 **로컬에서 spawn**. ssh:// 프로젝트의 cwd(`ssh://…`)는 로컬에 존재하지 않아, 직전 cwd-guard로 크래시는 면했지만 **엉뚱한 Windows 호스트에서** 엔진이 돌아 인증/MCP가 안 맞음(`codex … AuthRequired/Transport channel closed` 등).

**결론:** "SSH로 remote에서 엔진 실행"은 이미 Generate 경로에 구현돼 있다. **Harness만 그 패턴을 안 쓴다.** 빠진 한 조각(SSH-aware AgentRunner)을 채운다.

## 2. 설계

### 2.1 공유 SSH 헬퍼 추출
현재 `remote-generate.ts` 내부의 `parseSsh` / `SshTarget` / `sshExec` / `SshExec` / `loginShell` / `ENGINE_CMD` 를 **`apps/desktop/src/main/ssh-exec.ts`** 로 추출·export. `remote-generate.ts`는 이를 import (동작 불변, 기존 테스트 green 유지). (`pty-manager.ts`의 별도 parseSsh 사본은 이번 범위에서 건드리지 않음.)

### 2.2 `SshAgentRunner` (신규) — `apps/desktop/src/main/ssh-agent-runner.ts`
`@apc/llm-wiki`의 `AgentRunner` 인터페이스(`run(input: RunInput): Promise<RunResult>`)를 구현. `RunInput = { agent, prompt, timeoutMs, cwd? }`.

```ts
class SshAgentRunner implements AgentRunner {
  constructor(private exec: SshExec = sshExec) {}
  async run(input: RunInput): Promise<RunResult> {
    const ssh = parseSsh(input.cwd ?? '')
    if (!ssh) return { ok: false, output: '', raw: 'SshAgentRunner: cwd is not an ssh:// target' }
    const cdPath = ssh.path.replace(/'/g, `'\\''`)
    const engineCmd = `cd '${cdPath}' && ${ENGINE_CMD[input.agent]}`
    const r = await this.exec(ssh, loginShell(engineCmd), { stdin: input.prompt, timeoutMs: input.timeoutMs })
    return { ok: r.ok, output: r.stdout, raw: r.stderr || r.stdout }
  }
}
```
= Generate가 쓰는 그 방식(로그인 셸 + cd + engine, prompt stdin)을 그대로 harness 에이전트 호출에 적용. 출력(stdout)은 harness의 `unwrapAgentJson(output, engine)` → `parseStructured`가 처리(Generate와 동일).

### 2.3 `RoutingAgentRunner` (신규, 같은 파일)
cwd가 ssh://면 SSH, 아니면 로컬.
```ts
class RoutingAgentRunner implements AgentRunner {
  constructor(private cli: AgentRunner = new CliAgentRunner(), private ssh: AgentRunner = new SshAgentRunner()) {}
  run(input: RunInput): Promise<RunResult> {
    return input.cwd?.startsWith('ssh://') ? this.ssh.run(input) : this.cli.run(input)
  }
}
```

### 2.4 컨테이너 주입
`apps/desktop/src/main/container.ts`: harness 러너 기본값을 `new CliAgentRunner()` → `new RoutingAgentRunner()`. (테스트는 `opts.agentRunner`로 `FakeAgentRunner` 주입 — 그대로 유지.) cwd는 이미 `harnessRun`이 `repoPaths[0]`로 넘기므로, ssh 프로젝트면 그 값이 `ssh://…` URL → 라우터가 SSH로 보냄.

## 3. 테스트

- **추출(2.1)**: `remote-generate.test.ts` 그대로 green(동작 불변 증명).
- **SshAgentRunner**: 주입한 fake `exec`로 — (a) ssh cwd → exec가 `loginShell(cd '<path>' && ENGINE_CMD[engine])` + `stdin=prompt`로 호출됨, stdout→output·ok 매핑; (b) codex → cmd에 `codex exec --skip-git-repo-check` 포함; (c) 비-ssh cwd → ok:false.
- **RoutingAgentRunner**: cwd `ssh://…` → ssh 러너 위임 / 로컬·undefined → cli 러너 위임 (fake 러너 스파이).
- 컨테이너 주입은 typecheck + 데스크톱 스위트 green로 게이트.

## 4. 범위 밖 (YAGNI)

- 영속 백그라운드 PTY 세션 — **불필요**(호출마다 비대화식 ssh exec가 더 견고; Generate가 이미 이 방식).
- 로컬 `CliAgentRunner`의 codex `--skip-git-repo-check`(로컬 경로 별개 이슈) — 이번 범위 밖.
- `pty-manager`의 parseSsh 사본 통합 — 선택적 후속.
- 비밀번호 인증 SSH(현재 BatchMode=key-auth만) — remote-generate와 동일 제약 유지.
- codex MCP(Linear 등) 인증 — remote 사용자 환경에 위임(로그인 셸로 동일 env 로드). 앱이 관여 안 함.

## 5. 수용 기준 (Done)

1. ssh:// 프로젝트에서 harness 실행 시, 엔진이 **로컬이 아니라 remote에서** (로그인 셸 + 프로젝트 경로 cd + stdin prompt로) 실행된다.
2. 로컬 프로젝트는 기존대로 `CliAgentRunner`로 실행된다(회귀 없음).
3. codex는 remote에서 `codex exec --skip-git-repo-check`로 실행된다.
4. `remote-generate`/기존 동작 불변, 신규/기존 테스트 + `pnpm typecheck` 통과.
5. 새 IPC 채널·DB migration 없음(러너 주입만 변경).
