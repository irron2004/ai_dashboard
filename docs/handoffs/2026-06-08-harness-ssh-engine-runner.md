# Handoff — Knowledge Harness 엔진을 SSH(remote)에서 실행 (구현 완료)

- **Date**: 2026-06-08
- **Branch**: `docs/knowledge-harness-pipeline-spec`
- **PR**: 신규 → main 예정

## 0. 한 줄 요약

사용자(remote Linux로 붙고, 앱은 Windows, ssh:// 프로젝트)가 "전 문서로 위키 생성"을 누르면 harness가 **로컬(Windows)에서** 엔진을 spawn해 환경/인증/MCP 불일치로 실패했다. 사용자 제안대로 **harness가 터미널/Generate와 동일하게 SSH로 remote에서 엔진을 실행**하도록 구현했다(이미 Generate에만 있던 패턴을 harness에 채움). spec→plan→subagent 3 Task team-mode 완료.

## 1. 진단 흐름 (이번 세션 누적)

1. `agent runner returned not-ok` (깡통 메시지) → **(d)** 실제 CLI 에러 노출.
2. `spawn cmd.exe ENOENT` → **존재하지 않는 cwd**가 spawn을 죽임 → cwd 존재 가드(`2b3850d`, 이미 main).
3. `codex: Reading prompt... AuthRequired/Transport channel closed` → codex가 **실제로 실행**되긴 함(진전). 단 **Windows 호스트**라 codex 환경/MCP 불일치.
4. → 근본 해결: **ssh:// 프로젝트는 remote에서 엔진 실행.** (터미널/Generate가 이미 그렇게 함.)

## 2. 한 일 (3 Task)

- **S1** `apps/desktop/src/main/ssh-exec.ts`로 SSH 헬퍼(`parseSsh/sshExec/loginShell/ENGINE_CMD`) 추출(remote-generate와 공유, byte-identical).
- **S2** `apps/desktop/src/main/ssh-agent-runner.ts`:
  - `SshAgentRunner` — `AgentRunner` 구현. cwd가 `ssh://`면 `loginShell('source rc; cd <project> && ENGINE_CMD[agent]')`를 remote에서 비대화식 ssh 실행(prompt stdin), stdout→output·stderr→raw. **remote-generate와 문자 단위 동일한 셸 경로.**
  - `RoutingAgentRunner` — cwd `ssh://`면 SSH, 아니면 로컬 `CliAgentRunner`.
- **S3** `container.ts`가 harness 러너 기본값을 `RoutingAgentRunner`로 주입(테스트는 `opts.agentRunner`로 `FakeAgentRunner` 주입 — 무영향). cwd는 이미 harness가 `repoPaths[0]`로 넘기므로 ssh 프로젝트면 그 값이 `ssh://` URL.

> **품질 메모:** S2에서 구현 subagent가 잘못된 테스트 단언을 통과시키려 검증된 `loginShell`(싱글쿼트) 대신 더블쿼트 변형을 만들었음 → **반려·정정**(`356a9e7`)해 검증된 패턴으로 통일. (team-mode QA가 잡음.)

## 3. 커밋 (base `1e83518`=PR#2 머지 위)

```
259ffcf docs(desktop): correct harness runner comment
c46c9cb feat(desktop): harness uses RoutingAgentRunner (SSH for remote projects)
356a9e7 refactor(desktop): SshAgentRunner uses shared loginShell (match proven remote-generate)
0484140 feat(desktop): SshAgentRunner runs harness engine on the remote (+ routing)
d7c1ea8 refactor(desktop): extract shared ssh-exec helpers from remote-generate
3665a9d docs: implementation plan (3 tasks, TDD)
ccb5c16 docs: design (run engine on remote)
```

## 4. 검증 (전부 green)

```bash
pnpm typecheck                              # clean
npx vitest run packages/llm-wiki            # 22/23 (1 pre-existing skip)
npx vitest run packages/knowledge-harness   # 123/123
npx vitest run packages/app-services        # 55/55
cd apps/desktop && npx vitest run           # 65/65
```

## 5. 다음 / 주의

- 이제 ssh:// 프로젝트는 remote에서 엔진 실행 → 터미널에서 codex가 되던 그 환경. codex MCP(Linear 등) 인증은 **remote 사용자 환경에 위임**(로그인 셸로 동일 env 로드). remote codex가 그 MCP를 요구하면 사용자가 터미널에서 하던 대로 처리.
- 비밀번호 인증 SSH는 미지원(remote-generate와 동일하게 `BatchMode=yes` key-auth만).
- 후속 후보: (a) 실시간 단계 진행바, 엔진 preflight(설치/인증 사전검사), `pty-manager`의 parseSsh 사본 통합.

## 6. 핵심 파일

```
apps/desktop/src/main/ssh-exec.ts            # 공유 SSH 헬퍼 (parseSsh/sshExec/loginShell/ENGINE_CMD)
apps/desktop/src/main/ssh-agent-runner.ts    # SshAgentRunner + RoutingAgentRunner
apps/desktop/src/main/remote-generate.ts     # ssh-exec import (동작 불변)
apps/desktop/src/main/container.ts           # RoutingAgentRunner 주입
```
