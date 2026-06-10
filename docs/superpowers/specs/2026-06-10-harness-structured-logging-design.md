# Harness 구조화 로깅 — 설계 (Phase 1: 관측 가능성)

- **Date**: 2026-06-10
- **Status**: 승인됨 (사용자 승인 완료)
- **배경**: "전 문서로 위키 생성"(codex · SSH 원격)이 FAILED로 끝나지만 진짜 원인을 볼 수 없음.
  근거 진단: `docs/handoffs/2026-06-09-harness-codex-discovery-failure.md` — stderr·exit code 유실(결함 A),
  에러 메시지 800자 tail 잘림(결함 B), 실패 시 전체 출력 미보존(결함 C).

## 1. 목표 / 비목표

**목표**
1. 엔진 호출마다 prompt·stdout·stderr·exit code·소요시간을 run 디렉터리에 **성공·실패 불문** 영속한다.
2. 실패 메시지에 exit code와 stderr(우선)의 양단(head+tail)을 노출하고, 전체 로그 경로를 안내한다.
3. 실행 중 엔진 출력을 실시간으로 UI에 흘려 "지금 무슨 단계에서 뭘 하는지"를 보여준다.

**비목표 (후속 스펙으로 분리)**
- 생성 위키의 품질 개선 (프롬프트·스캔 범위·단계 설계). 로그로 실제 실패 원인을 확인한 뒤 진행.
- 엔진 preflight(인증/PATH 사전 점검), discovery 입력 범위 제한(바이너리 제외).
- 파이프라인 복원력(재시도/부분 재개) 강화.

## 2. 아키텍처

엔진 호출 경로에 로깅 데코레이터 한 겹을 추가한다:

```
LlmAgent → LoggingAgentRunner(신규) → RoutingAgentRunner → CliAgentRunner | SshAgentRunner
                │
                └→ runs/RUN-…/logs/<NN>-<label>/
                     prompt.txt   # 보낸 프롬프트 전문
                     stdout.log   # 실시간 append
                     stderr.log   # 실시간 append
                     meta.json    # { ok, exitCode, command, durationMs, engine, label, sshHost?, startedAt, endedAt }
```

`<NN>` 은 run 내 호출 순번(01, 02, …), `<label>` 은 `<STATE>-<agent>` (예: `PROJECT_SCANNED-project-discovery`).

### 2.1 계약 변경 (`packages/llm-wiki/src/agent-runner.ts`)

- `RunResult` 에 옵셔널 필드 추가: `exitCode?: number | null`, `stderr?: string`, `command?: string`, `durationMs?: number`.
- `RunInput` 에 옵셔널 필드 추가:
  - `label?: string` — 로그 디렉터리 이름·진행 이벤트에 쓰는 호출 식별자. 드라이버가 단계명으로 채움.
  - `onChunk?: (stream: 'stdout' | 'stderr', text: string) => void` — 하위 러너가 출력 도착 즉시 호출.
- 모두 옵셔널이므로 기존 구현/호출부와 하위호환.

### 2.2 `CliAgentRunner` (`packages/llm-wiki/src/cli-agent-runner.ts`)

- 결함 A 제거: `close` 시 `{ ok, output: stdout, stderr, exitCode: code, raw }` 반환.
  `raw` 는 진단용 결합 문자열로 유지하되 `stderr` 우선 + stdout 병기 (단락 평가로 한쪽을 버리지 않음).
- `data` 이벤트에서 `input.onChunk?.(stream, text)` 호출.
- timeout/`error` 경로에도 `exitCode: null` 과 그때까지의 `stderr` 를 채워 반환.

### 2.3 `SshAgentRunner` / `ssh-exec.ts` (`apps/desktop/src/main/`)

- `sshExec` 옵션에 `onChunk` 추가, stdout/stderr 도착 즉시 전달.
- `SshAgentRunner.run` 이 `exitCode`·`stderr`·`command`(마스킹된 ssh 명령 요약)·`durationMs` 를 결과에 채움.
- meta.json 용으로 ssh 호스트 정보를 결과에 포함 (`command` 에 user@host 표기).

### 2.4 `LoggingAgentRunner` (신규, `packages/llm-wiki/src/logging-agent-runner.ts`)

- 생성자: `(inner: AgentRunner, logRoot: string)` — run당 1개 생성, `logRoot = <runDir>/logs`.
- `run(input)`:
  1. 호출 순번 증가 → `logs/<NN>-<label>/` 생성, `prompt.txt` 기록.
  2. `input.onChunk` 를 래핑: 원래 콜백 호출 + 해당 스트림 로그 파일에 **즉시 append** (타임아웃·크래시 시에도 그 시점까지 디스크에 남도록).
  3. inner 결과 수신 후 `meta.json` 기록, 결과 그대로 반환.
- 파일당 상한 10MB: 초과분은 버리고 `…[truncated at 10MB]` 한 줄을 기록.
- 모든 fs 작업은 try/catch — **로그 쓰기 실패가 run을 실패시키지 않는다.**

### 2.5 배선 (`packages/app-services/src/harness-service.ts`, `make-drivers.ts`)

- harness-service 가 run 디렉터리를 알고 있으므로, 거기서 `new LoggingAgentRunner(runner, join(runDir, 'logs'))` 로 감싸 `makeDrivers` 에 전달.
- `make-drivers.ts` 의 각 LLM 드라이버가 `label: '<STATE>-<agent.name>'` 을 RunInput 에 채움 (LlmAgent.run 의 args 로 전달 → runner.run 까지 관통).

## 3. 에러 메시지 (`packages/knowledge-harness/src/agents/llm-agent.ts`)

기존 "끝 800자" 정책을 교체:

```
<agent> failed (<engine>, exit <code|signal|timeout>): <본문>
→ full logs: logs/<NN>-<label>/
```

- 본문은 `stderr` 가 비어있지 않으면 stderr, 아니면 stdout(raw).
- 800자 초과 시 **head 400자 + " … " + tail 400자** (양단 노출 — "에러가 앞에 있든 뒤에 있든" 잡힌다).
- 기존 tail-only 테스트(`llm-agent.test.ts`)는 새 포맷으로 교체.

## 4. 실시간 진행 표시

- **main**: LoggingAgentRunner 를 감싸기 전에 harness-service 가 `onChunk` 를 주입 —
  기존 harness progress IPC 채널에 `{ runId, label, stream, chunk }` 이벤트로 전송 (채널/contract 는
  기존 `harnessProgress` 계열 확장, 새 채널 추가는 ipc-contract.ts 에 1개 이내).
- **renderer**: store 에 `harnessLiveTail: string[]`(최근 ~10라인, run 시작 시 초기화) 추가.
  `HarnessDashboard` Coverage 탭의 "⏳ 위키 생성 중…" 플레이스홀더 아래에 현재 단계(label)와
  live tail 을 고정폭 블록으로 표시. 새 탭·대규모 UI 변경 없음.
- chunk 폭주 대비: main 쪽에서 50ms 단위로 배칭해 IPC 빈도를 제한.

## 5. 에러 처리 요약

| 상황 | 동작 |
|---|---|
| 엔진 비정상 종료 | stdout/stderr/meta 모두 보존, 메시지에 exit code + 양단 + 로그 경로 |
| timeout | 그때까지의 스트림이 이미 디스크에 append 됨, meta `exitCode: null`, reason `timeout` |
| spawn 실패(ENOENT 등) | meta 에 error 문자열, 메시지에 그대로 노출 |
| 로그 쓰기 실패 | run 에 영향 없음 (best-effort), console.warn 만 |

## 6. 테스트 계획 (TDD)

- `cli-agent-runner.test.ts`: stderr·exitCode 보존, onChunk 수신, timeout 시 부분 stderr 보존.
- `ssh-agent-runner.test.ts`: 모의 sshExec 로 stderr/exitCode/onChunk 관통 검증.
- `logging-agent-runner.test.ts`(신규): 성공/실패/타임아웃 각각 4파일 생성·내용 검증, 10MB 상한,
  fs 실패 시 결과 불변(주입한 깨진 logRoot).
- `llm-agent.test.ts`: 새 메시지 포맷(exit code, stderr 우선, head+tail, 로그 경로) 검증.
- e2e (`harness-pipeline.e2e.test.ts` 계열): 실패하는 fake runner 로 1 run → `logs/01-…/` 완전성 확인.

## 7. 핵심 파일

```
packages/llm-wiki/src/agent-runner.ts            # RunInput/RunResult 확장
packages/llm-wiki/src/cli-agent-runner.ts        # 결함 A 수정 + onChunk
packages/llm-wiki/src/logging-agent-runner.ts    # 신규 데코레이터
packages/knowledge-harness/src/agents/llm-agent.ts        # 결함 B 수정 (메시지 포맷)
packages/knowledge-harness/src/runtime/make-drivers.ts    # label 배선
packages/app-services/src/harness-service.ts     # LoggingAgentRunner 배선 + onChunk → progress
apps/desktop/src/main/ssh-agent-runner.ts        # stderr/exitCode/onChunk
apps/desktop/src/main/ssh-exec.ts                # onChunk 옵션
apps/desktop/src/shared/ipc-contract.ts          # live tail 이벤트
apps/desktop/src/renderer/components/HarnessDashboard.tsx # live tail 표시
```
