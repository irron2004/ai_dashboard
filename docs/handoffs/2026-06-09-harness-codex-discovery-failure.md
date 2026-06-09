# 진단 — `project-discovery failed (codex)` (PROJECT_SCANNED 단계 실패)

- **Date**: 2026-06-09
- **Branch**: `docs/harness-codex-discovery-failure-2026-06-09`
- **성격**: 분석 전용 (코드 수정 없음). `2026-06-08-harness-run-ux-and-cwd` 의 cwd/에러노출 수정이 머지된 **이후**에 나타난 새 실패 양상.

## 0. 원본 로그

데스크톱 앱에서 위키 생성 실행 시:

```
RUN-2026-06-09T04-34-43-610Z → FAILED — project-discovery failed (codex): …_doc/bayesian/exp035_combo05_ensemble.py
50_paper_d_sensor_doc/bayesian/analysis-output-2026-05-24/analysis-report.md
50_paper_d_sensor_doc/bayesian/analysis-output-2026-05-24/figures/figure-02-exp046-hierarchy-stress.pdf
50_paper_d_sensor_doc/bayesian/analysis-output-2026-05-24/figures/figure-02-exp046-hierarchy-stress.png
50_paper_d_sensor_doc/bayesian/analysis-output-2026-05-24/figures/figure-01-exp043c-main-comparison.pdf
50_paper_d_sensor_doc/bayesian/analysis-output-2026-05-24/figures/figure-01-exp043c-main-comparison.png
50_paper_d_sensor_doc/bayesian/analysis-output-2026-05-24/figure-catalog.md
50_paper_d_sensor_doc/bayesian/analysis-output-2026-05-24/stats-appendix.md
50_paper_d_sensor_doc/bayesian/exp035b_ensemble_honest.md
50_paper_d_sensor_doc/bayesian/query_label_overlap.csv
```

## 1. 한 줄 요약

파이프라인 **첫 LLM 단계(`PROJECT_SCANNED` → project-discovery)** 에서 `codex exec` 가 **비정상 종료(exit ≠ 0)** 했다. 그런데 **사용자에게 보이는 메시지가 실패 원인이 아니라 codex가 "쳐다본 파일 목록"** 이다 — 진짜 codex 에러는 메시지에 들어있지 않다. 이는 에러 표면화 경로의 **두 개 결함이 겹쳐서** 생긴 것이고, 그래서 현재 로그만으로는 codex가 *왜* 죽었는지 단정할 수 없다.

## 2. 호출 경로 (확인된 사실)

```
HarnessService.run  (harness-service.ts:82  runId = RUN-…)
  └─ makeDrivers().PROJECT_SCANNED            (make-drivers.ts:98-101)
       └─ LlmAgent.run (project-discovery)    (llm-agent.ts:30-42)
            └─ CliAgentRunner.run             (cli-agent-runner.ts:20-36)
                 └─ spawn('codex', ['exec'], { cwd: repoPaths[0], shell })   ← cwd 수정으로 이제 프로젝트 폴더에서 실행됨
```

- `50_paper_d_sensor_doc/…` 경로들이 **프로젝트 폴더 기준 상대경로**로 찍혔다는 것 = 2026-06-08 의 **cwd 배선 수정이 정상 동작** 중이라는 증거. codex가 이제 앱 폴더가 아니라 대상 프로젝트 폴더에서 돌고 있다.
- 즉 이건 "cwd 안 먹던 옛 버그"가 아니라 **그 다음 단계의 새 실패**다.

## 3. 근본 원인 (확실 — 코드로 확인)

### 결함 A — `CliAgentRunner` 가 stderr 를 버리고 exit code 를 안 남긴다
`packages/llm-wiki/src/cli-agent-runner.ts:33`
```ts
child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, output: stdout, raw: stdout || stderr }) })
```
- `raw: stdout || stderr` — **stdout 이 비어있지 않으면 stderr 는 절대 표면화되지 않는다** (`||` 단락 평가).
- `codex exec` 는 진행상황/파일열거를 **stdout** 에 흘리고, 실제 실패 사유(인증/레이트리밋/모델 에러/sandbox 거부 등)는 **stderr** 에 찍는 경우가 많다. 그러면 `raw` = stdout(파일 목록)이 되고 **stderr 의 진짜 에러는 통째로 버려진다.**
- **종료 코드(`code`) 가 숫자로 어디에도 기록되지 않는다** — `ok: false` 라는 사실만 남고 "왜"는 사라진다.

### 결함 B — `LlmAgent` 가 raw 의 *끝 800자* 만 보여준다
`packages/knowledge-harness/src/agents/llm-agent.ts:34-37`
```ts
const raw = res.raw || 'agent runner returned not-ok'
const detail = raw.length > 800 ? `…${raw.slice(-800)}` : raw
throw new Error(`${this.cfg.name} failed (${args.engine}): ${detail}`)
```
- "엔진은 배너를 먼저, 에러를 마지막에 찍는다"는 가정으로 **TAIL(끝)** 을 보여주도록 설계됨 (`llm-agent.test.ts:47-54` 참조).
- 그러나 `codex exec` 는 종료 직전 마지막 출력이 **에러가 아니라 파일 열거** 였다. 그래서 800자 tail 이 전부 파일 경로로 채워지고, 그 위에 있었을 진짜 에러는 잘려나갔다.
- 로그 맨 앞 `…_doc/bayesian/exp035_combo05_ensemble.py` 의 선행 `…` 가 곧 "이 앞은 다 잘렸음" 의 증거다.

### 결함 C — 실패 시 codex 의 전체 출력이 어디에도 영속되지 않는다
- `RunArtifactStore` / run-state-machine 은 **throw 된 (이미 800자로 잘린) 메시지** 만 run state 에 기록한다 (`make-drivers` 의 driver 가 throw → 상위에서 FAILED 기록).
- codex 의 full stdout+stderr 를 run 디렉터리에 저장하는 코드가 없다. → **사후 진단 불가.**

> **A·B·C 가 합쳐진 결과**: 사용자는 "codex가 무엇을 보고 있었는가(파일 목록)"만 보고, "codex가 왜 죽었는가"는 메시지·아티팩트 어디에도 남지 않는다.

## 4. codex 가 죽은 실제 사유 (가설 — 현재 로그로는 단정 불가)

가능성 높은 순서. 결함 A/B/C 때문에 **확정하려면 추가 계측이 필요**하다.

1. **인증/레이트리밋/모델 에러** (stderr 로 나가 결함 A 로 버려짐). 가장 흔한 1차 단계 실패. → 2026-06-08 핸드오프 §5 의 "엔진 CLI 설치·인증·PATH" 미충족과 동일 계열.
2. **`codex exec` 의 sandbox/approval 모드**. 기본 `codex exec` 는 비대화형에서 승인 없이 파일 접근/쓰기를 못 해 열거만 하고 비정상 종료할 수 있다 (`--full-auto` / 적절한 `--sandbox` 플래그 부재). 현재 템플릿은 `args: ['exec']` 뿐 (`cli-agent-runner.ts:14`).
3. **컨텍스트/입력 과대**. `50_paper_d_sensor_doc/bayesian/` 에 `.pdf`·`.png`(바이너리)·대형 `.csv` 가 섞여 있다. codex 가 이들을 열거·적재하다 컨텍스트 초과 또는 바이너리 처리 실패로 종료.
4. **JSON-only 출력 미준수**. project-discovery 프롬프트는 "ONLY a single JSON object" 를 요구하는데(`llm-agent.ts:26`), `codex exec` 는 자유형 활동 로그를 내보내는 성향이라 비정상 종료/언랩 실패로 이어질 수 있다.

가설 1·2 가 stderr 로 나갔다면 결함 A 가 정확히 그걸 삼킨다 — 이게 "파일 목록만 남은" 현상과 가장 잘 맞는다.

## 5. 다음에 할 일 (수정 제안 — 우선순위)

이 문서는 분석만 담는다. 실제 수정은 후속 작업으로:

1. **(결함 A) `CliAgentRunner` 가 stdout·stderr·exit code 를 모두 보존.**
   `raw` 를 `stdout || stderr` 대신 `[`exit ${code}`, stderr, stdout].join('\n---\n')` 류로 합치고, `RunResult` 에 `exitCode`·`stderr` 필드 추가. 회귀: `cli-agent-runner.test.ts:68-78`(non-zero) 가 `res.output` 만 보므로 그대로 통과, stderr 보존 케이스 1개 추가.
2. **(결함 C) 실패한 엔진 호출의 full 출력을 run 디렉터리에 덤프** (`store.writeFile('engine-<state>.stdout.txt' / '.stderr.txt')`). 사후 진단 가능하게.
3. **(결함 B) 메시지에 head+tail 동시 노출** 또는 stderr 우선 노출. "배너는 앞, 에러는 끝" 가정이 codex 에는 깨짐(끝이 파일목록) — 양끝 일부씩 보여주는 게 안전.
4. **(가설 1·2 차단) 엔진 preflight** — codex 인증/PATH 사전 점검, `codex exec` 템플릿에 비대화형 플래그(`--full-auto` 또는 명시적 sandbox) 검토. (2026-06-08 §5 후속과 합류.)
5. **(가설 3 차단) discovery 입력 범위 제한** — 바이너리(.pdf/.png)·대형 데이터(.csv) 를 스캔 대상에서 제외하거나 경로만 전달.

## 6. 핵심 파일 / 라인

```
packages/llm-wiki/src/cli-agent-runner.ts:33          # 결함 A: raw = stdout || stderr, exit code 유실
packages/knowledge-harness/src/agents/llm-agent.ts:34-37 # 결함 B: tail 800자만 노출
packages/knowledge-harness/src/runtime/make-drivers.ts:98-101 # PROJECT_SCANNED 드라이버
packages/app-services/src/harness-service.ts:82        # runId 포맷 (RUN-…)
packages/llm-wiki/src/cli-agent-runner.ts:14           # codex 템플릿 args: ['exec']
docs/handoffs/2026-06-08-harness-run-ux-and-cwd.md      # 직전 cwd/에러노출 수정 (이 실패의 전사前史)
```

---

## 7. 2차 incident — `ssh: connect to host 10.10.100.45 port 22: Connection timed out` (수정 완료)

### 7.1 로그
```
RUN-2026-06-09T07-51-27-124Z → FAILED — project-discovery failed (codex):
ssh: connect to host 10.10.100.45 port 22: Connection timed out
```

### 7.2 진단
- 이 프로젝트의 `repoPaths[0]` 가 `ssh://…@10.10.100.45:22/…` 형태라, `RoutingAgentRunner` 가 codex 를 **원격 호스트에서 SSH 로 실행**한다 (`ssh-agent-runner.ts:30-32`). 이번엔 그 원격 호스트에 **TCP 연결 자체가 timeout**.
- 이번엔 stdout 이 비어 stderr 가 그대로 표면화돼(결함 A 가 가린 게 없음) **메시지가 명확**했다 — §3 분석과 일관.
- **실측**: 이 머신에서 `Test-NetConnection 10.10.100.45 -Port 22` → `TcpTestSucceeded: True` (Ping 은 ICMP 차단으로 False, 정상). **지금은 22 포트가 열려 있고 닿는다.** 즉 07:51 당시는 **일시적 연결 순단**(VPN/네트워크 블립 또는 원격 호스트 재부팅)이었고 현재는 복구됨.

### 7.3 근본 코드 약점 (수정함)
일시적 순단 하나가 **전체 파이프라인 run 을 FAILED 로 죽였다.** SSH 호출 경로가 비대칭이었음:
- `index.ts:46` testSsh **프리플라이트** 는 이미 `ConnectTimeout=5` → 빠르게 실패.
- 그러나 **실제 엔진 실행 경로** `sshExec` (`ssh-exec.ts:22`) 는 `ConnectTimeout` 도 keepalive 도 **없었다** → 닿지 않는 호스트에서 OS TCP 타임아웃/앱 120s 타이머까지 길게 매달리고, run 중간 드롭도 감지 못 함.

### 7.4 수정
- `ssh-exec.ts` `sshExec`: `-o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=4` 추가.
  - 닿지 않는 호스트 → ~10s 안에 명확히 실패 (프리플라이트와 동일 거동).
  - 긴 엔진 run 중 네트워크 드롭 → ~60s 안에 감지 (이전엔 timeoutMs 까지 무한 대기).
  - `ConnectTimeout` 은 **핸드셰이크만** 제한 → 정상 호스트의 장시간 codex 실행에는 영향 없음.
- `pty-manager.ts:78` 원격 터미널 spawn 에도 `-o ConnectTimeout=10` 추가 (동일 행 hang 방지, 일관성).
- 검증: `pnpm --filter @apc/desktop exec tsc --noEmit` clean, `ssh-agent-runner.test.ts` 5/5 green (ssh args 를 단언하는 테스트는 없어 회귀 없음).

### 7.5 사용자 조치 (코드 밖)
근본 트리거는 환경 문제다 — 코드가 못 고치는 부분:
1. **지금은 호스트가 닿으므로 그냥 재실행하면 성공할 가능성이 높다.**
2. 다시 timeout 나면: 원격 호스트 `10.10.100.45` 전원/네트워크, 같은 LAN/VPN 접속 여부, 22 포트 방화벽, sshd 기동을 확인. (`10.10.100.45` 는 사설 IP — VPN/내부망 연결이 끊기면 못 닿음.)
3. 위키 생성 전 UI 의 **"Test connection"** (testSsh) 으로 사전 점검 가능 — 이제 본 실행 경로도 프리플라이트와 같은 속도로 실패한다.
