# Spec — S3: 콘솔이 멀티에이전트 dev 하네스를 구동

**날짜:** 2026-07-01
**상태:** 설계(spec). 승인 후 writing-plans로 구현 계획 분기.
**상위 맥락:** [`2026-06-30-multi-project-integration-map.md`](./2026-06-30-multi-project-integration-map.md) · [`2026-06-30-harness-core-submodule-consolidation-design.md`](./2026-06-30-harness-core-submodule-consolidation-design.md) — 하네스 통합 트랙의 세 번째 sub-project. S1(canonical submodule 정식화)·S2(나머지 마이그레이션)에 이어, **콘솔이 그 하네스를 실제로 구동**하는 마지막 축.
**스코프 제약(이 세션):** 변경은 **ai_dashboard + autosci-core 내부로만**. langgraph-agent `agents/CLI_CONTRACT.md`는 **읽기 전용 외부 seam**으로만 소비(코드 수정 금지). coin/calc/blog 통합(#4/#5/#6)·superproject 포인터 정리는 범위 밖.

---

## 1. 배경 — 실측

S1에서 `agents_up_cli.sh`의 입출력/종료코드를 [`CLI_CONTRACT.md`](../../../../calculate_math/agents/CLI_CONTRACT.md)로 고정했다. S3는 그 계약의 **소비자**다.

ai_dashboard 콘솔 실측 구조:
- **`pm/AgentRunStore`** (`agent_runs` 테이블) — dev run을 기록할 store가 *이미 존재*한다. 스키마: `id·taskId·agent·repoPath·branch·worktreePath·startedAt·endedAt·status('running'|'completed'|'failed')·transcriptPath·summaryPath`. 컨테이너에 `runs`로 배선돼 있으나 **`create()`를 호출하는 프로덕션 경로가 아직 없다** — S3가 채운다.
- **`app-services/HarnessService`** — 이름은 "harness"지만 실제로는 **위키/knowledge 생성 파이프라인**이다(소스 materialize → reader/extractor 에이전트 → 그래프 생성 → promote). 멀티에이전트 dev run과 **도메인이 다르다.**
- **`llm-wiki/CliAgentRunner`** — 서브프로세스 spawn + stdout/stderr `onChunk` 스트리밍 + timeout + exit code 패턴의 레퍼런스.
- **IPC/로그 스트리밍** — 위키 하네스 run은 `harnessRun` IPC + `emitHarnessEngineLog`(`batchEngineLog`로 배치) push로 renderer에 live tail을 흘린다. 재사용 가능한 패턴.
- **`ProjectRegistry`** — projectId → `repoPaths`(=하네스 `ROOT`)·domain·vaultPaths.
- **`AgentKind = ['claude','codex','opencode']`** — 단일 에이전트 종류 enum.

---

## 2. 목표 / 비목표

**목표:** 콘솔에서 프로젝트의 task를 선택해 멀티에이전트 하네스를 *띄우고*, 실시간 로그를 보고, 실행 이력을 `AgentRunStore`에 남긴다. `CLI_CONTRACT.md` seam만 의존한다.

**In(S3):**
1. **`DevHarnessService`**(신규, app-services) — projectId+taskId로 하네스 CLI를 shell-out, run 레코드 기록, 로그 스트리밍.
2. **`HarnessCli`**(신규, 주입식 spawner) — `CLI_CONTRACT.md` 입출력/종료코드 어댑터. spawn DI로 테스트.
3. **AgentRun 기록** — start 시 `create(status='running')`, 종료 시 `complete`/`fail`(+`transcriptPath`).
4. **로그 스트리밍** — stdout/stderr를 renderer live tail로(기존 위키 하네스 패턴 미러링, 채널 분리).
5. **cancel** — 진행 중 run을 SIGTERM으로 중지(status='failed', reason='cancelled').
6. **`AgentKind`에 `'harness'` 추가** — dev run의 `agent` 라벨.
7. **IPC + 최소 UI** — task에서 ▶ Run harness 액션 + live 로그 패널(기존 로그 tail 컴포넌트 재사용).
8. **인프라 하드닝** — 루트 vitest가 `apps/desktop`도 실행(SP1 회귀 함정 제거).

**Out(후속):**
- coin→`prediction`(#4)·calc 어댑터(#5)·blog→graph(#6) 통합.
- langgraph-agent 코드 변경, tmux 패널 내부 attach, run **resume**(CLI 내부 관심사).
- superproject submodule 포인터 정리(② — coin 보류로 막힘).
- 동시 다중 run 스케줄링/큐(MVP는 프로젝트당 1 run 가정, 단순 가드만).

---

## 3. 고려한 대안과 결정 (보고서용 후보 분석)

### 결정 1 — dev-orchestration의 위치 ⭐
| 후보 | 내용 | 트레이드오프 |
|---|---|---|
| A. 기존 `HarnessService`에 모드 추가 (spec 원문 문구) | 한 서비스에 위키생성 + dev오케 공존 | 510줄 클래스에 이질 도메인 결합 → god-object, 테스트·이해 난도↑ |
| **B. 신규 `DevHarnessService` (형제 서비스)** ⭐ | dev run 전담, 단일 책임 | 파일 1개 추가. 경계 명확, 독립 테스트, cancel/동시실행 확장 자연스러움 |
| C. `packages/harness`에 배치 | 그 패키지는 config 편집(agent-config-editor) 도메인 | 실행 ≠ 설정 — 또 다른 혼선 |

**결정 = B.** 원본 spec(S1 §9)의 "harness-service에 dev-orchestration 모드 추가"는 *기존 HarnessService가 위키 하네스인 줄 모르고* 쓰인 문구다. 장기적으로 위키 하네스와 dev 하네스는 분리돼야 하므로 **신규 서비스로 spec 문구를 의도적으로 이탈**한다.

### 결정 2 — CLI 호출 방식
| 후보 | 내용 | 트레이드오프 |
|---|---|---|
| A. `CliAgentRunner` 재사용 | LLM 엔진 템플릿(claude/codex) 전용, prompt를 stdin으로 | 하네스 CLI는 bash 스크립트+argv task_id+env ROOT — 형태 불일치 |
| **B. 신규 `HarnessCli` (얇은 spawner)** ⭐ | `CLI_CONTRACT` 전용 어댑터, spawn DI | 패턴만 재사용. 계약에 정확히 맞고 테스트 용이 |

**결정 = B.** 클래스가 아니라 **패턴**(spawn+onChunk+timeout+exit code)을 재사용.

### 결정 3 — 프로세스 모델
계약(`CLI_CONTRACT.md`)은 "실행 중 stdout/stderr 스트리밍 + 종료코드 0/비0"을 보장한다. → **블로킹 프로세스로 취급**(스트리밍하다 exit code로 종료). tmux 내부에 attach하지 않는다("본 계약 외 내부 구현에 의존하지 않는다"). CLI가 detach하면 *프로젝트측 계약 위반*으로 S3 밖에서 수정.

### 결정 4 — `agent` 필드
`AgentKind`에 단일 에이전트만 있어 오케스트레이터 run을 표현 못 함.
- **결정: `AgentKind`에 `'harness'` 추가**(shared 스키마 1줄). dev run `agent='harness'`로 위키/단일 run과 구분. 대안(요청 엔진 라벨 재사용)은 의미가 흐려져 비채택.

### 결정 5 — 인프라 하드닝 방식
루트 `vitest.config.ts`의 `include`가 `packages/**`·`scripts/**`만 포함 → `apps/desktop` 누락(SP1 회귀 원인).
| 후보 | 트레이드오프 |
|---|---|
| A. `include`에 `apps/**` 추가 | apps/desktop이 다른 env/모킹 필요 시 오염 위험 |
| **B. vitest `projects` 분리** ⭐ | packages(node) + apps/desktop(자체 config) 각자 env로 `pnpm test` 한 번에 실행 |

**결정 = B**(apps/desktop 기존 vitest 설정 존중). 단, 통합 시 apps/desktop 스위트가 루트에서 그대로 green인지 실측 후 확정(어려우면 A의 변형: 루트 `test` 스크립트가 양쪽을 체이닝).

---

## 4. 아키텍처

```
renderer  (Task 행/상세의 ▶ Run harness)
   │  invoke devHarnessRun({ projectId, taskId, workflow?, graphProfile? })
   ▼
IPC (apps/desktop main)
   │  emitDevHarnessLog(e)  ──push──▶ renderer live tail
   ▼
DevHarnessService (app-services)            deps: { cli, runs, registry, runsRoot, now }
   ├─ project = registry.get(projectId)     → ROOT = project.repoPaths[0]
   ├─ runId = run:${projectId}:${ts}
   ├─ runs.create({ id:runId, taskId, agent:'harness', repoPath:ROOT, startedAt, status:'running' })
   ├─ cli.spawn({ root:ROOT, taskId, workflow, graphProfile, onChunk })   ← CLI_CONTRACT seam
   │      env ROOT=root, argv=[taskId, --workflow wf?, --graph-profile p?]
   │      onChunk(stream, text) → onLog({label, stream, chunk})  +  append transcript.log
   └─ on exit(code): runs.complete | runs.fail (endedAt, transcriptPath, exitCode)

HarnessCli (app-services)                   deps: { spawn } (DI; default node:child_process spawn)
   └─ spawn(<ROOT>/agents_up.sh, [taskId, ...flags], { cwd:ROOT, env:{...process.env, ROOT} })
        stdout/stderr → onChunk;  timeout → kill;  cancel handle → kill(SIGTERM)
```

의존 방향: renderer → IPC → DevHarnessService → HarnessCli → (외부) 하네스 CLI. 역결합 없음. 위키 `HarnessService`와 독립(공유 자원: `ProjectRegistry`, `AgentRunStore`만).

### 컴포넌트 경계
- **`HarnessCli`** — *무엇*: 하네스 CLI를 계약대로 1회 실행하고 출력을 스트리밍/종료코드 반환. *의존*: 주입된 spawn. *테스트*: fake spawn으로 stdout/stderr/exit/timeout/cancel.
- **`DevHarnessService`** — *무엇*: projectId+taskId → run 레코드 생명주기 + 로그 fan-out. *의존*: `HarnessCli`, `AgentRunStore`, `ProjectRegistry`. *테스트*: fake cli + in-memory store.
- **IPC 계층** — *무엇*: renderer 요청을 서비스로, 로그를 renderer로. *의존*: container의 service + emit 콜백.

---

## 5. 데이터 / 계약

### AgentRun 레코드
- `id` = `run:${projectId}:${ts}` (ts = `now()` 콜론/점 치환).
- `taskId` = 구동 대상 task(SP1의 `req:`/`todo:` id 또는 임의 task id).
- `agent` = `'harness'`(결정 4).
- `repoPath` = `project.repoPaths[0]`(= CLI `ROOT`).
- `startedAt`/`endedAt` = ISO. `status` = running→completed(exit 0)|failed(비0/error/cancel).
- `transcriptPath` = `<runsRoot>/.agent-runs/<runId>/transcript.log`(결합 stdout/stderr).

### HarnessCli 입력/출력(=CLI_CONTRACT 매핑)
- 입력: `root`(→env ROOT, cwd), `taskId`(argv[0]), `workflow?`(`--workflow`), `graphProfile?`(`--graph-profile`), `onChunk(stream,text)`, `timeoutMs?`, `signal?`(cancel).
- 출력: `{ exitCode: number|null, stdout, stderr }`. 실패는 exit code/`error` 이벤트로.

### IPC 채널(위키 하네스와 분리)
- `devHarnessRun(req) → res{ ok, runId, exitCode?, reason? }`
- `devHarnessCancel(req{ runId }) → res{ ok }`
- push: `devHarness:log` = `{ runId, label, stream, chunk }`(배치).

---

## 6. 에러 처리
- 프로젝트/`repoPaths` 없음 → 즉시 `{ ok:false, reason }`, run 레코드 미생성.
- `agents_up.sh` 부재(ENOENT) → `error` 이벤트 → run `failed`, reason에 "하네스 진입점 없음".
- timeout → kill + `failed`(reason=timeout).
- cancel → SIGTERM + `failed`(reason='cancelled').
- 로그/transcript 쓰기 실패는 run을 실패시키지 않음(best-effort, 위키 하네스 `persistTranscript` 관례 일치).

---

## 7. 테스트 / 수용 기준
- **`HarnessCli`**: fake spawn으로 (a) stdout/stderr onChunk 스트리밍, (b) exit 0/비0 매핑, (c) timeout kill, (d) cancel(SIGTERM), (e) argv/env(ROOT) 구성 검증.
- **`DevHarnessService`**: fake cli + in-memory `AgentRunStore`로 (a) create(running)→complete(exit0), (b) →fail(비0), (c) 프로젝트 없음 가드, (d) 로그 emit fan-out, (e) transcriptPath 기록.
- **IPC(apps/desktop)**: 핸들러가 서비스 호출·결과 반환·로그 push(루트 vitest `projects` 포함으로 회귀 포착).
- **수용 기준:**
  1. 콘솔에서 task 선택 → 하네스 run 시작, `agent_runs`에 running 레코드.
  2. 로그가 renderer에 live tail.
  3. 종료 시 status=completed/failed + transcriptPath 기록.
  4. cancel로 진행 run 중지 → failed.
  5. `pnpm test`(루트) 한 번에 packages + apps/desktop 둘 다 실행·green.
  6. langgraph-agent 미수정, 계약 외 의존 없음.

---

## 8. 리스크 / 완화
| 리스크 | 완화 |
|---|---|
| 대상 CLI가 tmux로 detach → 스트리밍/exit code 계약 어긋남 | 문서화된 계약만 의존. detach는 프로젝트측 계약 위반 → S3 밖에서 수정. 실측은 dev 중 실제 프로젝트로 1회 확인 |
| apps/desktop 스위트를 루트 vitest에 포함 시 env 충돌 | `projects` 분리로 격리. 실패 시 루트 `test` 체이닝 폴백 |
| `AgentKind` 확장이 기존 소비자 회귀 | enum 추가만(기존 값 불변), 타입체크로 누락 분기 포착 |
| 프로젝트당 동시 run | MVP는 단순 가드(이미 running이면 거부) — 큐는 후속 |

---

## 9. 후속 정리(폴리시, 싸면 포함)
- SP1 `onSessionParsed` catch 무로그 → 경고 1줄.
- SP1 slug 충돌 시 near-dup todo 드롭.
- (SP2 Windows 백슬래시 정규화 — WSL2 무관, non-blocking 유지)
