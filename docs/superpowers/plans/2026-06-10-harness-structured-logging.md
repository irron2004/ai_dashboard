# Harness 구조화 로깅 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 harness 엔진 호출의 prompt/stdout/stderr/exit code를 run 디렉터리에 성공·실패 불문 영속하고, 실패 메시지를 진단 가능하게 만들고, 실행 중 출력을 UI에 실시간 표시한다.

**Architecture:** 엔진 호출 경로 `LlmAgent → RoutingAgentRunner → Cli/Ssh` 사이에 `LoggingAgentRunner` 데코레이터를 끼워 `runs/RUN-…/logs/<NN>-<label>/`에 기록한다. 계약(`RunInput`/`RunResult`)에 옵셔널 필드만 추가해 하위호환을 유지한다. UI는 기존 `harness:progress` IPC와 나란한 새 채널 `harness:engineLog`로 live tail을 받는다.

**Tech Stack:** TypeScript, Node `child_process`, Electron IPC, React + zustand, vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-harness-structured-logging-design.md`

**검증 명령 (모든 태스크 공통):**
- **PATH 선행 (비대화형 shell에 nvm 미적용):** 모든 명령 앞에 `export PATH="$HOME/.nvm/versions/node/v20.19.5/bin:$PATH"`
- 패키지 테스트: 루트에서 `pnpm vitest run <파일경로>` (desktop은 `pnpm --filter @apc/desktop exec vitest run <src 상대경로>`)
- 타입체크: **루트에서 `pnpm run typecheck`** (`tsc -p tsconfig.typecheck.json && tsc -p apps/desktop/tsconfig.json --noEmit`). 패키지별 `tsc --noEmit`은 개별 tsconfig가 없어 동작하지 않으니 쓰지 말 것.
- 환경 주의: 레포가 `/mnt/c`(Windows FS)에 있어 node_modules가 Windows용. linux rollup/esbuild 바이너리는 설치 완료. 네이티브 모듈(better-sqlite3·node-pty)은 Windows 빌드이므로 **`pnpm install`을 새로 돌리지 말 것**(Windows 빌드를 덮어씀).

---

### Task 1: 계약 확장 — `RunInput`/`RunResult`

**Files:**
- Modify: `packages/llm-wiki/src/agent-runner.ts`

- [ ] **Step 1: 타입 확장**

`packages/llm-wiki/src/agent-runner.ts` 전체를 다음으로 교체:

```ts
import type { AgentType } from '@apc/shared'

export type ChunkStream = 'stdout' | 'stderr'

export type RunInput = {
  agent: AgentType
  prompt: string
  timeoutMs: number
  cwd?: string
  /** 로그 디렉터리·진행 이벤트용 호출 식별자, 예: 'PROJECT_SCANNED-project-discovery'. */
  label?: string
  /** 하위 러너가 출력 도착 즉시 호출 (스트리밍 로그·live tail용). */
  onChunk?: (stream: ChunkStream, text: string) => void
}

export type RunResult = {
  ok: boolean
  output: string
  raw: string
  /** 프로세스 종료 코드; timeout/spawn 실패는 null. 미지원 러너(Fake 등)는 undefined. */
  exitCode?: number | null
  stderr?: string
  /** 진단용 명령 요약 (ssh의 경우 user@host 포함). */
  command?: string
  durationMs?: number
  /** LoggingAgentRunner가 채움 — 이 호출의 로그 디렉터리 절대경로. */
  logDir?: string
}

export interface AgentRunner {
  run(input: RunInput): Promise<RunResult>
}

export class FakeAgentRunner implements AgentRunner {
  readonly calls: RunInput[] = []
  constructor(private readonly outputs: string[]) {}
  async run(input: RunInput): Promise<RunResult> {
    this.calls.push(input)
    if (this.calls.length > this.outputs.length) return { ok: false, output: '', raw: '' }
    const output = this.outputs[this.calls.length - 1]
    return { ok: true, output, raw: output }
  }
}
```

- [ ] **Step 2: 타입체크 + 기존 테스트 회귀 확인**

Run: `pnpm --filter @apc/llm-wiki exec tsc --noEmit && pnpm vitest run packages/llm-wiki`
Expected: 타입 에러 없음, 기존 테스트 전부 PASS (필드가 전부 옵셔널이므로).

- [ ] **Step 3: Commit**

```bash
git add packages/llm-wiki/src/agent-runner.ts
git commit -m "feat(llm-wiki): extend RunInput/RunResult contract for structured logging"
```

---

### Task 2: `CliAgentRunner` — stderr/exitCode 보존 + onChunk

**Files:**
- Modify: `packages/llm-wiki/src/cli-agent-runner.ts`
- Test: `packages/llm-wiki/src/cli-agent-runner.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`cli-agent-runner.test.ts`의 첫 번째 `describe('CliAgentRunner', …)` 블록 안에 추가:

```ts
  test('preserves stderr, exit code, command and duration on non-zero exit (defect A)', async () => {
    const mockChild = createMockChild()
    mockSpawn.mockReturnValue(mockChild)
    const templates: EngineTemplates = { codex: { command: 'codex', args: ['exec'] } }
    const promise = new CliAgentRunner(templates).run({ agent: 'codex', prompt: 'x', timeoutMs: 10000 })
    mockChild.stdout.emit('data', 'file-listing-noise')
    mockChild.stderr.emit('data', 'ERROR: not authenticated')
    mockChild.emit('close', 1)
    const res = await promise
    expect(res.ok).toBe(false)
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toBe('ERROR: not authenticated')
    expect(res.command).toBe('codex exec')
    expect(typeof res.durationMs).toBe('number')
    // raw는 stdout만으로 stderr를 가리면 안 된다 — 둘 다 담는다
    expect(res.raw).toContain('ERROR: not authenticated')
    expect(res.raw).toContain('file-listing-noise')
  })

  test('invokes onChunk per stream as data arrives', async () => {
    const mockChild = createMockChild()
    mockSpawn.mockReturnValue(mockChild)
    const templates: EngineTemplates = { claude: { command: 'claude', args: ['-p'] } }
    const chunks: Array<[string, string]> = []
    const promise = new CliAgentRunner(templates).run({
      agent: 'claude', prompt: 'x', timeoutMs: 10000,
      onChunk: (stream, text) => chunks.push([stream, text]),
    })
    mockChild.stdout.emit('data', 'out-1')
    mockChild.stderr.emit('data', 'err-1')
    mockChild.emit('close', 0)
    await promise
    expect(chunks).toEqual([['stdout', 'out-1'], ['stderr', 'err-1']])
  })

  test('timeout result carries exitCode:null and partial stderr', async () => {
    vi.useFakeTimers()
    const mockChild = createMockChild()
    mockSpawn.mockReturnValue(mockChild)
    const templates: EngineTemplates = { claude: { command: 'claude', args: ['-p'] } }
    const promise = new CliAgentRunner(templates).run({ agent: 'claude', prompt: 'x', timeoutMs: 300 })
    mockChild.stderr.emit('data', 'partial diagnostics')
    vi.advanceTimersByTime(300)
    const res = await promise
    expect(res.ok).toBe(false)
    expect(res.exitCode).toBeNull()
    expect(res.stderr).toBe('partial diagnostics')
  })
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/llm-wiki/src/cli-agent-runner.test.ts`
Expected: 신규 3개 FAIL (`exitCode`가 undefined 등), 기존 7개 PASS.

- [ ] **Step 3: 구현**

`cli-agent-runner.ts`의 `run` 메서드를 다음으로 교체:

```ts
  run(input: RunInput): Promise<RunResult> {
    const tpl = this.templates[input.agent]
    if (!tpl) return Promise.reject(new Error(`No command template for engine: ${input.agent}`))

    return new Promise<RunResult>((resolve) => {
      // shell:true on Windows so .cmd/PATHEXT shims (claude.cmd, etc.) resolve.
      const safeCwd = input.cwd && existsSync(input.cwd) ? input.cwd : undefined
      const command = `${tpl.command} ${tpl.args.join(' ')}`
      const startedAt = Date.now()
      const child = spawn(tpl.command, tpl.args, { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32', cwd: safeCwd })
      let stdout = '', stderr = ''
      const base = () => ({ command, durationMs: Date.now() - startedAt })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve({ ok: false, output: stdout, stderr, exitCode: null, raw: stderr || `timeout after ${input.timeoutMs}ms`, ...base() })
      }, input.timeoutMs)
      child.stdout.on('data', (d) => { const t = String(d); stdout += t; input.onChunk?.('stdout', t) })
      child.stderr.on('data', (d) => { const t = String(d); stderr += t; input.onChunk?.('stderr', t) })
      child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, output: '', stderr: String(e), exitCode: null, raw: String(e), ...base() }) })
      child.on('close', (code) => {
        clearTimeout(timer)
        // raw: 진단용 결합 뷰. `stdout || stderr` 단락 평가로 stderr를 버리던 결함 A 제거 — 둘 다 보존.
        const raw = stderr && stdout ? `${stderr}\n--- stdout ---\n${stdout}` : (stderr || stdout)
        resolve({ ok: code === 0, output: stdout, stderr, exitCode: code, raw, ...base() })
      })
      try { child.stdin?.write(input.prompt); child.stdin?.end() } catch { /* child already gone */ }
    })
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run packages/llm-wiki/src/cli-agent-runner.test.ts`
Expected: 전부 PASS. (기존 'returns ok:false when spawn emits an error' 테스트는 `raw`에 에러 문자열이 남으므로 그대로 통과.)

- [ ] **Step 5: Commit**

```bash
git add packages/llm-wiki/src/cli-agent-runner.ts packages/llm-wiki/src/cli-agent-runner.test.ts
git commit -m "fix(llm-wiki): preserve stderr/exit code in CliAgentRunner + stream chunks (defect A)"
```

---

### Task 3: `ssh-exec` + `SshAgentRunner` — exitCode/onChunk 관통

**Files:**
- Modify: `apps/desktop/src/main/ssh-exec.ts`
- Modify: `apps/desktop/src/main/ssh-agent-runner.ts`
- Test: `apps/desktop/src/main/ssh-agent-runner.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`ssh-agent-runner.test.ts`의 `describe('SshAgentRunner', …)` 블록 안에 추가:

```ts
  test('preserves stderr/exitCode/command/duration and forwards onChunk to sshExec', async () => {
    const exec: SshExec = async (_ssh, _cmd, opts) => {
      opts?.onChunk?.('stdout', 'remote-out')
      return { ok: false, stdout: 'listing', stderr: 'auth failed', exitCode: 1 }
    }
    const chunks: Array<[string, string]> = []
    const res = await new SshAgentRunner(exec).run({
      agent: 'codex', prompt: 'P', timeoutMs: 1000, cwd: 'ssh://me@host:22/p',
      onChunk: (s, t) => chunks.push([s, t]),
    })
    expect(res.ok).toBe(false)
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toBe('auth failed')
    expect(res.command).toContain('me@host')
    expect(typeof res.durationMs).toBe('number')
    expect(res.raw).toContain('auth failed')
    expect(res.raw).toContain('listing')
    expect(chunks).toEqual([['stdout', 'remote-out']])
  })
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @apc/desktop exec vitest run src/main/ssh-agent-runner.test.ts`
Expected: 신규 1개 FAIL (SshExecResult에 exitCode 없음 — 타입 에러로 먼저 드러날 수 있음), 기존 5개 PASS.

- [ ] **Step 3: `ssh-exec.ts` 구현**

`SshExecResult`/`SshExec` 타입과 `sshExec` 본문을 다음으로 교체 (parseSsh, loginShell, ENGINE_CMD는 그대로):

```ts
export type SshExecResult = { ok: boolean; stdout: string; stderr: string; exitCode?: number | null }
export type SshExec = (
  ssh: SshTarget,
  remoteCmd: string,
  opts?: { stdin?: string; timeoutMs?: number; onChunk?: (stream: 'stdout' | 'stderr', text: string) => void },
) => Promise<SshExecResult>
```

```ts
export function sshExec(ssh: SshTarget, remoteCmd: string, opts: { stdin?: string; timeoutMs?: number; onChunk?: (stream: 'stdout' | 'stderr', text: string) => void } = {}): Promise<SshExecResult> {
  return new Promise((resolve) => {
    const args = [
      '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4',
      '-p', String(ssh.port), `${ssh.user}@${ssh.host}`, remoteCmd,
    ]
    const child = spawn(process.platform === 'win32' ? 'ssh.exe' : 'ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ ok: false, stdout, stderr: stderr || 'timeout', exitCode: null }) }, opts.timeoutMs ?? 120000)
    child.stdout.on('data', (d) => { const t = String(d); stdout += t; opts.onChunk?.('stdout', t) })
    child.stderr.on('data', (d) => { const t = String(d); stderr += t; opts.onChunk?.('stderr', t) })
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, stdout: '', stderr: String(e), exitCode: null }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, stdout, stderr, exitCode: code }) })
    if (opts.stdin != null) { try { child.stdin?.write(opts.stdin); child.stdin?.end() } catch { /* gone */ } }
  })
}
```

(기존 ConnectTimeout/ServerAlive 주석 블록은 그대로 유지.)

- [ ] **Step 4: `ssh-agent-runner.ts` 구현**

`SshAgentRunner.run`을 다음으로 교체:

```ts
  async run(input: RunInput): Promise<RunResult> {
    const ssh = parseSsh(input.cwd ?? '')
    if (!ssh) return { ok: false, output: '', raw: 'SshAgentRunner: cwd is not an ssh:// target' }
    const cdPath = ssh.path.replace(/'/g, `'\\''`)
    const engineCmd = `cd '${cdPath}' && ${ENGINE_CMD[input.agent]}`
    const startedAt = Date.now()
    const r = await this.exec(ssh, loginShell(engineCmd), { stdin: input.prompt, timeoutMs: input.timeoutMs, onChunk: input.onChunk })
    const raw = r.stderr && r.stdout ? `${r.stderr}\n--- stdout ---\n${r.stdout}` : (r.stderr || r.stdout)
    return {
      ok: r.ok, output: r.stdout, stderr: r.stderr, exitCode: r.exitCode ?? null, raw,
      command: `ssh ${ssh.user}@${ssh.host}:${ssh.port} ${ENGINE_CMD[input.agent]}`,
      durationMs: Date.now() - startedAt,
    }
  }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm --filter @apc/desktop exec vitest run src/main/ssh-agent-runner.test.ts && pnpm --filter @apc/desktop exec tsc --noEmit`
Expected: 전부 PASS, 타입 클린. (기존 'maps remote stderr to raw on failure'는 stdout이 빈 케이스라 `raw === 'boom'` 그대로 통과.)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/ssh-exec.ts apps/desktop/src/main/ssh-agent-runner.ts apps/desktop/src/main/ssh-agent-runner.test.ts
git commit -m "feat(desktop): ssh engine path preserves stderr/exit code + streams chunks"
```

---

### Task 4: `LoggingAgentRunner` 데코레이터 (신규)

**Files:**
- Create: `packages/llm-wiki/src/logging-agent-runner.ts`
- Create: `packages/llm-wiki/src/logging-agent-runner.test.ts`
- Modify: `packages/llm-wiki/src/index.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/llm-wiki/src/logging-agent-runner.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRunner } from './agent-runner.js'
import { LoggingAgentRunner } from './logging-agent-runner.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'logrun-'))

describe('LoggingAgentRunner', () => {
  test('success: writes prompt/stdout/meta and returns logDir', async () => {
    const root = tmp()
    const inner: AgentRunner = {
      run: async (i) => {
        i.onChunk?.('stdout', 'streamed-out')
        return { ok: true, output: 'streamed-out', raw: 'streamed-out', exitCode: 0, stderr: '', command: 'codex exec', durationMs: 5 }
      },
    }
    const res = await new LoggingAgentRunner(inner, root).run({ agent: 'codex', prompt: 'PROMPT', timeoutMs: 100, label: 'PROJECT_SCANNED-project-discovery' })
    expect(res.ok).toBe(true)
    const dir = join(root, '01-PROJECT_SCANNED-project-discovery')
    expect(res.logDir).toBe(dir)
    expect(readFileSync(join(dir, 'prompt.txt'), 'utf8')).toBe('PROMPT')
    expect(readFileSync(join(dir, 'stdout.log'), 'utf8')).toBe('streamed-out')
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
    expect(meta).toMatchObject({ ok: true, exitCode: 0, command: 'codex exec', engine: 'codex', label: 'PROJECT_SCANNED-project-discovery' })
    expect(meta.startedAt).toBeTruthy()
    expect(meta.endedAt).toBeTruthy()
  })

  test('failure without streaming: stdout/stderr logs come from the final result', async () => {
    const root = tmp()
    const inner: AgentRunner = { run: async () => ({ ok: false, output: 'file listing', raw: 'x', exitCode: 1, stderr: 'auth error' }) }
    await new LoggingAgentRunner(inner, root).run({ agent: 'codex', prompt: 'p', timeoutMs: 100, label: 'L' })
    const dir = join(root, '01-L')
    expect(readFileSync(join(dir, 'stdout.log'), 'utf8')).toBe('file listing')
    expect(readFileSync(join(dir, 'stderr.log'), 'utf8')).toBe('auth error')
    expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')).exitCode).toBe(1)
  })

  test('sequence numbers continue across instances (resume case)', async () => {
    const root = tmp()
    const inner: AgentRunner = { run: async () => ({ ok: true, output: 'o', raw: 'o' }) }
    await new LoggingAgentRunner(inner, root).run({ agent: 'codex', prompt: 'p', timeoutMs: 100, label: 'A' })
    await new LoggingAgentRunner(inner, root).run({ agent: 'codex', prompt: 'p', timeoutMs: 100, label: 'B' })
    expect(readdirSync(root).sort()).toEqual(['01-A', '02-B'])
  })

  test('caps each stream log at maxBytes with a truncation marker', async () => {
    const root = tmp()
    const inner: AgentRunner = {
      run: async (i) => { i.onChunk?.('stdout', 'AAAA'); i.onChunk?.('stdout', 'BBBB'); i.onChunk?.('stdout', 'CCCC'); return { ok: true, output: '', raw: '' } },
    }
    await new LoggingAgentRunner(inner, root, { maxBytes: 6 }).run({ agent: 'codex', prompt: 'p', timeoutMs: 100, label: 'L' })
    const log = readFileSync(join(root, '01-L', 'stdout.log'), 'utf8')
    expect(log).toContain('AAAA')
    expect(log).toContain('[truncated')
    expect(log).not.toContain('CCCC')
  })

  test('log write failure never breaks the run (best-effort)', async () => {
    const root = tmp()
    const blocker = join(root, 'not-a-dir')
    writeFileSync(blocker, 'I am a file, mkdir under me fails')
    const inner: AgentRunner = { run: async () => ({ ok: true, output: 'fine', raw: 'fine' }) }
    // logRoot가 "파일"이라 mkdir이 실패하는 환경 — 결과는 그대로 나와야 한다
    const res = await new LoggingAgentRunner(inner, blocker).run({ agent: 'codex', prompt: 'p', timeoutMs: 100, label: 'L' })
    expect(res.ok).toBe(true)
    expect(res.output).toBe('fine')
    expect(res.logDir).toBeUndefined()
    expect(existsSync(join(blocker, '01-L'))).toBe(false)
  })

  test('still calls the caller-provided onChunk', async () => {
    const root = tmp()
    const inner: AgentRunner = { run: async (i) => { i.onChunk?.('stderr', 'e1'); return { ok: true, output: '', raw: '' } } }
    const seen: Array<[string, string]> = []
    await new LoggingAgentRunner(inner, root).run({ agent: 'codex', prompt: 'p', timeoutMs: 100, label: 'L', onChunk: (s, t) => seen.push([s, t]) })
    expect(seen).toEqual([['stderr', 'e1']])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/llm-wiki/src/logging-agent-runner.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`packages/llm-wiki/src/logging-agent-runner.ts`:

```ts
import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentRunner, ChunkStream, RunInput, RunResult } from './agent-runner.js'

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

/**
 * Decorator that persists every engine call to <logRoot>/<NN>-<label>/
 * (prompt.txt, stdout.log, stderr.log, meta.json) — success or failure.
 * Streams are appended as chunks arrive, so a timeout/crash still leaves
 * everything up to that moment on disk. All fs work is best-effort:
 * a logging failure must never fail the run itself.
 */
export class LoggingAgentRunner implements AgentRunner {
  private seq: number | null = null
  private readonly maxBytes: number

  constructor(
    private readonly inner: AgentRunner,
    private readonly logRoot: string,
    opts: { maxBytes?: number } = {},
  ) { this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES }

  /** NN은 logRoot의 기존 항목 수에서 이어진다 — resume된 run도 번호가 충돌하지 않는다. */
  private nextDir(label: string): string | null {
    try {
      if (this.seq === null) {
        try { this.seq = readdirSync(this.logRoot).length } catch { this.seq = 0 }
      }
      this.seq += 1
      const dir = join(this.logRoot, `${String(this.seq).padStart(2, '0')}-${label}`)
      mkdirSync(dir, { recursive: true })
      return dir
    } catch (e) {
      console.warn('[LoggingAgentRunner] cannot create log dir:', e)
      return null
    }
  }

  async run(input: RunInput): Promise<RunResult> {
    const label = input.label ?? input.agent
    const dir = this.nextDir(label)
    const startedAt = new Date().toISOString()
    const t0 = Date.now()
    const written: Record<ChunkStream, number> = { stdout: 0, stderr: 0 }
    const safe = (fn: () => void) => { try { fn() } catch (e) { console.warn('[LoggingAgentRunner] log write failed:', e) } }

    if (dir) safe(() => writeFileSync(join(dir, 'prompt.txt'), input.prompt))

    const onChunk: RunInput['onChunk'] = (stream, text) => {
      input.onChunk?.(stream, text)
      if (!dir || written[stream] > this.maxBytes) return
      written[stream] += Buffer.byteLength(text)
      const payload = written[stream] > this.maxBytes ? `\n…[truncated at ${this.maxBytes} bytes]\n` : text
      safe(() => appendFileSync(join(dir, `${stream}.log`), payload))
    }

    const res = await this.inner.run({ ...input, onChunk })

    if (dir) {
      // 스트리밍이 없던 러너(Fake 등)도 최종 결과로 로그를 남긴다.
      if (written.stdout === 0 && res.output) safe(() => writeFileSync(join(dir, 'stdout.log'), res.output))
      if (written.stderr === 0 && res.stderr) safe(() => writeFileSync(join(dir, 'stderr.log'), res.stderr))
      safe(() => writeFileSync(join(dir, 'meta.json'), JSON.stringify({
        ok: res.ok, exitCode: res.exitCode ?? null, command: res.command ?? null,
        engine: input.agent, label, timeoutMs: input.timeoutMs,
        durationMs: res.durationMs ?? Date.now() - t0,
        startedAt, endedAt: new Date().toISOString(),
      }, null, 2)))
      return { ...res, logDir: dir }
    }
    return res
  }
}
```

`packages/llm-wiki/src/index.ts`에 추가:

```ts
export * from './logging-agent-runner.js'
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run packages/llm-wiki/src/logging-agent-runner.test.ts && pnpm --filter @apc/llm-wiki exec tsc --noEmit`
Expected: 6개 전부 PASS, 타입 클린.

- [ ] **Step 5: Commit**

```bash
git add packages/llm-wiki/src/logging-agent-runner.ts packages/llm-wiki/src/logging-agent-runner.test.ts packages/llm-wiki/src/index.ts
git commit -m "feat(llm-wiki): LoggingAgentRunner persists every engine call to runs/<id>/logs (defect C)"
```

---

### Task 5: `LlmAgent` 에러 메시지 + label 관통

**Files:**
- Modify: `packages/knowledge-harness/src/agents/llm-agent.ts`
- Modify: `packages/knowledge-harness/src/runtime/make-drivers.ts` (LLM 호출 5곳)
- Test: `packages/knowledge-harness/src/agents/llm-agent.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`llm-agent.test.ts`의 `describe('LlmAgent failure + cwd', …)` 블록에서 기존 'surfaces the TAIL…' 테스트를 아래 4개로 교체:

```ts
  test('shows BOTH head and tail of a long error (defect B: error may be at either end)', async () => {
    const longRaw = 'HEAD_REAL_ERROR ' + 'noise '.repeat(300) + 'TAIL_REAL_ERROR'
    const failing: AgentRunner = { run: async () => ({ ok: false, output: '', raw: longRaw }) }
    const err = await tinyAgent().run({ runner: failing, engine: 'codex', input: {} }).catch((e: Error) => e)
    expect(String(err)).toContain('HEAD_REAL_ERROR')
    expect(String(err)).toContain('TAIL_REAL_ERROR')
  })

  test('prefers stderr over raw when present', async () => {
    const failing: AgentRunner = { run: async () => ({ ok: false, output: '', raw: 'file-listing-noise', stderr: 'codex: not authenticated' }) }
    const err = await tinyAgent().run({ runner: failing, engine: 'codex', input: {} }).catch((e: Error) => e)
    expect(String(err)).toContain('not authenticated')
    expect(String(err)).not.toContain('file-listing-noise')
  })

  test('includes exit code and log dir pointer when provided', async () => {
    const failing: AgentRunner = { run: async () => ({ ok: false, output: '', raw: 'boom', exitCode: 2, logDir: '/runs/R/logs/01-X' }) }
    const err = await tinyAgent().run({ runner: failing, engine: 'codex', input: {} }).catch((e: Error) => e)
    expect(String(err)).toContain('exit 2')
    expect(String(err)).toContain('/runs/R/logs/01-X')
  })

  test('forwards label to the runner', async () => {
    const calls: RunInput[] = []
    const rec: AgentRunner = { run: async (i) => { calls.push(i); return { ok: false, output: '', raw: '' } } }
    await tinyAgent().run({ runner: rec, engine: 'codex', input: {}, label: 'STATE-agent' }).catch(() => {})
    expect(calls[0].label).toBe('STATE-agent')
  })
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/knowledge-harness/src/agents/llm-agent.test.ts`
Expected: 신규 4개 FAIL, 나머지 PASS.

- [ ] **Step 3: `llm-agent.ts` 구현**

`LlmRunArgs`에 `label?: string` 추가:

```ts
export type LlmRunArgs = { runner: AgentRunner; engine: AgentType; input: unknown; timeoutMs?: number; cwd?: string; label?: string }
```

`run` 메서드를 다음으로 교체:

```ts
  async run(args: LlmRunArgs): Promise<O> {
    const res = await args.runner.run({ agent: args.engine, prompt: this.buildPrompt(args.input), timeoutMs: args.timeoutMs ?? 180000, cwd: args.cwd, label: args.label })
    if (!res.ok) {
      // stderr가 있으면 그것이 진짜 에러일 확률이 높다 (codex는 stdout에 파일 열거를 쏟는다).
      // 에러가 출력의 앞/뒤 어디에 있을지 엔진마다 다르므로 양단(head+tail)을 함께 노출한다.
      const src = (res.stderr?.trim() ? res.stderr : res.raw) || 'agent runner returned not-ok'
      const detail = src.length > 800 ? `${src.slice(0, 400)} … ${src.slice(-400)}` : src
      const exit = res.exitCode === undefined ? '' : `, exit ${res.exitCode ?? 'none (timeout/killed)'}`
      const logs = res.logDir ? `\n→ full logs: ${res.logDir}` : ''
      throw new Error(`${this.cfg.name} failed (${args.engine}${exit}): ${detail}${logs}`)
    }
    // parseStructured's generic ties input===output; our schema's input is `unknown`, so cast to the
    // output-typed view. Sound: parseStructured validates against the schema at runtime.
    return parseStructured(unwrapAgentJson(res.output, args.engine), this.cfg.schema as ZodType<O>)
  }
```

- [ ] **Step 4: `make-drivers.ts` label 배선**

5개 LLM 호출에 `label`을 추가한다 (각 드라이버의 상태명-에이전트명):

```ts
    // PROJECT_SCANNED 드라이버 내부:
    const data = await discovery.run({ ...run, engine: engineOf(ctx), label: `PROJECT_SCANNED-${discovery.name}`, input: { projectId: ctx.projectId } })
```

```ts
    // SOURCES_EXTRACTED 드라이버 내부:
    const data = await reader.run({ ...run, engine: engineOf(ctx), label: `SOURCES_EXTRACTED-${reader.name}`, input: {
```

```ts
    // DOCUMENTS_CLASSIFIED 드라이버 내부:
    const data = await classifier.run({ ...run, engine: engineOf(ctx), label: `DOCUMENTS_CLASSIFIED-${classifier.name}`, input: { discovery: artifactByName(ctx, 'PROJECT_SCANNED', ARTIFACTS.projectDiscovery) } })
```

```ts
    // NODE_PROPOSALS_CREATED 드라이버 내부:
    const data = await extractor.run({ ...run, engine: engineOf(ctx), label: `NODE_PROPOSALS_CREATED-${extractor.name}`, input: {
```

```ts
    // LEAD_MERGED 드라이버 내부 (lead.run 호출, 현재 145행 부근):
    const out = await lead.run({ ...run, engine: engineOf(ctx), label: `LEAD_MERGED-${lead.name}`, input: { proposals: artifactByName(ctx, 'NODE_PROPOSALS_CREATED', ARTIFACTS.nodeProposals) } })
```

- [ ] **Step 5: 테스트 통과 + 패키지 회귀 확인**

Run: `pnpm vitest run packages/knowledge-harness && pnpm --filter @apc/knowledge-harness exec tsc --noEmit`
Expected: 전부 PASS (e2e 포함 — FakeAgentRunner는 label을 무시하므로 무해), 타입 클린.

- [ ] **Step 6: Commit**

```bash
git add packages/knowledge-harness/src/agents/llm-agent.ts packages/knowledge-harness/src/agents/llm-agent.test.ts packages/knowledge-harness/src/runtime/make-drivers.ts
git commit -m "fix(knowledge-harness): diagnosable failure message (stderr-first, head+tail, exit code, log dir) + per-call labels (defect B)"
```

---

### Task 6: `HarnessService` 배선 — 로깅 + onEngineLog

**Files:**
- Modify: `packages/app-services/src/harness-service.ts`
- Test: `packages/app-services/src/harness-service.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`harness-service.test.ts` 끝에 추가 (기존 import에 `existsSync`, `readFileSync`가 없으면 `node:fs`에서 추가):

```ts
describe('HarnessService engine logging', () => {
  test('a failed first step still leaves prompt/meta logs in runs/<id>/logs', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hs-log-'))
    const vaultRoot = join(tmp, 'vault'); mkdirSync(vaultRoot, { recursive: true })
    const runsRoot = join(tmp, 'runs')
    const svc = new HarnessService({ runner: new FakeAgentRunner([]), vaultRoot, runsRoot })
    const res = await svc.run({ projectId: 'p1', engine: 'codex' })
    expect(res.ok).toBe(false)
    const logRoot = join(runsRoot, res.runId, 'logs')
    const dirs = readdirSync(logRoot)
    expect(dirs).toEqual(['01-PROJECT_SCANNED-project-discovery'])
    expect(existsSync(join(logRoot, dirs[0], 'prompt.txt'))).toBe(true)
    const meta = JSON.parse(readFileSync(join(logRoot, dirs[0], 'meta.json'), 'utf8'))
    expect(meta.ok).toBe(false)
    // 실패 메시지가 로그 위치를 가리킨다
    expect(res.reason).toContain('full logs:')
  })

  test('onEngineLog receives streamed chunks with the call label', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hs-chunk-'))
    const vaultRoot = join(tmp, 'vault'); mkdirSync(vaultRoot, { recursive: true })
    const streaming: AgentRunner = {
      run: async (i) => { i.onChunk?.('stdout', 'scanning…'); return { ok: false, output: '', raw: 'dead' } },
    }
    const svc = new HarnessService({ runner: streaming, vaultRoot, runsRoot: join(tmp, 'runs') })
    const events: Array<{ label: string; stream: string; chunk: string }> = []
    await svc.run({ projectId: 'p1', engine: 'codex' }, undefined, (e) => events.push(e))
    expect(events).toEqual([{ label: 'PROJECT_SCANNED-project-discovery', stream: 'stdout', chunk: 'scanning…' }])
  })
})
```

(이 테스트 파일에서 `FakeAgentRunner`, `AgentRunner`는 `@apc/llm-wiki`에서 import. `mkdtempSync`/`mkdirSync`/`readdirSync`/`readFileSync`/`existsSync`는 `node:fs`, `tmpdir`은 `node:os`, `join`은 `node:path` — 파일 상단 기존 import와 중복되지 않게 병합.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/app-services/src/harness-service.test.ts`
Expected: 신규 2개 FAIL (logs 디렉터리 없음 / onEngineLog 파라미터 없음).

- [ ] **Step 3: 구현**

`harness-service.ts` 수정:

```ts
import type { AgentRunner } from '@apc/llm-wiki'
import { LoggingAgentRunner } from '@apc/llm-wiki'
```

타입 추가 (HarnessRunResult 근처):

```ts
/** 엔진 출력 스트리밍 이벤트 — UI live tail용. label = '<STATE>-<agent>'. */
export type EngineLogEvent = { label: string; stream: 'stdout' | 'stderr'; chunk: string }
```

`runnerFor`를 다음으로 교체:

```ts
  /** Build a runner bound to one run dir (drivers close over that run's staging dir + a per-project lock).
   * 모든 엔진 호출은 LoggingAgentRunner를 거쳐 runs/<id>/logs/에 영속되고(성공·실패 불문),
   * onEngineLog가 주어지면 출력 chunk가 도착 즉시 콜백으로도 흐른다. */
  private runnerFor(runId: string, projectId: string, projectCwd?: string, onEngineLog?: (e: EngineLogEvent) => void): HarnessRunner {
    const logging = new LoggingAgentRunner(this.deps.runner, join(this.deps.runsRoot, runId, 'logs'))
    const runner: AgentRunner = !onEngineLog ? logging : {
      run: (i) => logging.run({
        ...i,
        onChunk: (stream, text) => { i.onChunk?.(stream, text); onEngineLog({ label: i.label ?? i.agent, stream, chunk: text }) },
      }),
    }
    const drivers = makeDrivers({
      runner, vaultRoot: this.deps.vaultRoot,
      stagingRoot: this.stagingDir(runId), preamble: this.preamble, projectCwd,
    })
    const lock = new RunLock(join(this.deps.runsRoot, '.locks'), projectId)
    return new HarnessRunner({ gates: this.featureGate(), drivers, now: this.now, lock })
  }
```

`run` 시그니처에 onEngineLog 추가:

```ts
  async run(input: { projectId: string; engine: AgentType; materialize?: boolean; repoPaths?: string[] }, onProgress?: (rs: RunState) => void, onEngineLog?: (e: EngineLogEvent) => void): Promise<HarnessRunResult> {
    if (input.materialize && input.repoPaths?.length) {
      materializeProjectDocs(input.repoPaths, this.deps.vaultRoot)
    }
    const runId = `RUN-${this.now().replace(/[:.]/g, '-')}`
    const store = new RunArtifactStore(join(this.deps.runsRoot, runId))
    const runner = this.runnerFor(runId, input.projectId, input.repoPaths?.[0], onEngineLog)
    runner.createRun(store, { runId, projectId: input.projectId, engine: input.engine })
    return this.advanceSafely(runId, runner, store, onProgress)
  }
```

(`resume`은 시그니처 변경 없음 — `runnerFor`가 항상 LoggingAgentRunner로 감싸므로 resume된 run도 로그가 이어서 기록된다.)

- [ ] **Step 4: 테스트 통과 + 패키지 회귀 확인**

Run: `pnpm vitest run packages/app-services && pnpm --filter @apc/app-services exec tsc --noEmit`
Expected: 전부 PASS, 타입 클린.

- [ ] **Step 5: Commit**

```bash
git add packages/app-services/src/harness-service.ts packages/app-services/src/harness-service.test.ts
git commit -m "feat(app-services): wrap harness engine calls in LoggingAgentRunner + expose onEngineLog"
```

---

### Task 7: IPC 배선 — `harness:engineLog` 채널

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts`
- Modify: `apps/desktop/src/main/container.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/api.ts`
- Test: `apps/desktop/src/main/ipc.test.ts` (기존 회귀만)

- [ ] **Step 1: ipc-contract 채널 + 타입 추가**

`ipc-contract.ts`의 CH 객체에서 `harnessProgress: 'harness:progress',` 다음 줄에 추가:

```ts
  harnessEngineLog: 'harness:engineLog',
```

타입 정의부(TestSshReq 근처)에 추가:

```ts
export type HarnessEngineLogEvent = { label: string; stream: 'stdout' | 'stderr'; chunk: string }
```

- [ ] **Step 2: container.ts — emit 옵션 + 50ms 배칭**

import에 `HarnessEngineLogEvent` 추가. opts 타입(`emitHarnessProgress` 아래)에 추가:

```ts
  emitHarnessEngineLog?: (e: HarnessEngineLogEvent) => void
```

container.ts 모듈 레벨(createContainer 바깥)에 배처 추가:

```ts
/** 같은 label/stream의 chunk를 50ms 단위로 합쳐 IPC 빈도를 제한 — 수다스러운 엔진이 렌더러를 플러딩하지 못하게. */
function batchEngineLog(emit?: (e: HarnessEngineLogEvent) => void): ((e: HarnessEngineLogEvent) => void) | undefined {
  if (!emit) return undefined
  let pending = new Map<string, HarnessEngineLogEvent>()
  let timer: ReturnType<typeof setTimeout> | null = null
  return (e) => {
    const key = `${e.label} ${e.stream}`
    const prev = pending.get(key)
    if (prev) prev.chunk += e.chunk
    else pending.set(key, { ...e })
    if (!timer) {
      timer = setTimeout(() => {
        const batch = [...pending.values()]; pending = new Map(); timer = null
        for (const ev of batch) emit(ev)
      }, 50)
    }
  }
}
```

`harnessRun`을 다음으로 교체:

```ts
  const harnessRun = (req: HarnessRunReq): Promise<HarnessRunRes> => {
    const project = registry.get(req.projectId)
    return harness.run(
      { projectId: req.projectId, engine: req.engine, materialize: req.materialize, repoPaths: project?.repoPaths ?? [] },
      (rs) => opts.emitHarnessProgress?.({ runId: rs.runId, state: rs.state }),
      batchEngineLog(opts.emitHarnessEngineLog),
    )
  }
```

- [ ] **Step 3: index.ts — 윈도우로 전송**

`emitHarnessProgress: …` 줄 옆에 추가:

```ts
    emitHarnessEngineLog: (e) => win.webContents.send(CH.harnessEngineLog, e),
```

- [ ] **Step 4: preload — 구독 API**

`onHarnessProgress` 아래에 추가:

```ts
  onHarnessEngineLog: (cb: (e: { label: string; stream: 'stdout' | 'stderr'; chunk: string }) => void) => {
    const handler = (_e: unknown, ev: { label: string; stream: 'stdout' | 'stderr'; chunk: string }) => cb(ev)
    ipcRenderer.on(CH.harnessEngineLog, handler)
    return () => ipcRenderer.removeListener(CH.harnessEngineLog, handler)
  },
```

- [ ] **Step 5: api.ts — 렌더러 래퍼**

`window.apc` 타입 선언의 `onHarnessProgress` 옆에 추가:

```ts
      onHarnessEngineLog(cb: (e: { label: string; stream: 'stdout' | 'stderr'; chunk: string }) => void): () => void
```

구현부의 `onHarnessProgress` 메서드 옆에 추가:

```ts
  onHarnessEngineLog(cb: (e: { label: string; stream: 'stdout' | 'stderr'; chunk: string }) => void): () => void {
    return window.apc.onHarnessEngineLog(cb)
  },
```

- [ ] **Step 6: 회귀 확인**

Run: `pnpm --filter @apc/desktop exec tsc --noEmit && pnpm --filter @apc/desktop exec vitest run src/main/ipc.test.ts`
Expected: 타입 클린, 기존 IPC 테스트 PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/container.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/api.ts
git commit -m "feat(desktop): harness:engineLog IPC channel with 50ms batching"
```

---

### Task 8: 렌더러 — live tail 표시

**Files:**
- Modify: `apps/desktop/src/renderer/harness-utils.ts`
- Modify: `apps/desktop/src/renderer/store.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/components/HarnessDashboard.tsx`
- Modify: `apps/desktop/src/renderer/app.css`
- Test: `apps/desktop/src/renderer/harness-utils.test.ts` (없으면 신규)

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/desktop/src/renderer/harness-utils.test.ts`가 이미 있으면 거기에, 없으면 신규 파일로:

```ts
import { describe, expect, test } from 'vitest'
import { appendTailLines } from './harness-utils.js'

describe('appendTailLines', () => {
  test('keeps only the last `max` lines', () => {
    expect(appendTailLines([], 'a\nb\nc\nd', 3)).toEqual(['b', 'c', 'd'])
  })
  test('merges a partial chunk into the previous last line', () => {
    const first = appendTailLines([], 'hel')
    expect(appendTailLines(first, 'lo\nworld')).toEqual(['hello', 'world'])
  })
  test('handles CRLF', () => {
    expect(appendTailLines([], 'a\r\nb')).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @apc/desktop exec vitest run src/renderer/harness-utils.test.ts`
Expected: FAIL — `appendTailLines` 없음.

- [ ] **Step 3: `harness-utils.ts`에 헬퍼 추가**

```ts
/** live tail 누적: 마지막 `max`줄만 유지. 줄 중간에서 끊긴 chunk는 직전 마지막 줄에 이어 붙는다. */
export function appendTailLines(prev: string[], chunk: string, max = 10): string[] {
  const joined = (prev.length ? prev.join('\n') : '') + chunk
  return joined.split(/\r?\n/).slice(-max)
}
```

- [ ] **Step 4: store.ts — 상태 + 액션**

상태 타입(`harnessProgress: string | null` 옆)에 추가:

```ts
  harnessLiveLabel: string | null
  harnessLiveTail: string[]
```

초기값(`harnessProgress: null,` 옆)에 추가:

```ts
  harnessLiveLabel: null,
  harnessLiveTail: [],
```

`startHarnessRun`의 시작 `set(...)`(264행 부근)에 리셋 추가:

```ts
    set({ harnessLoading: true, harnessMessage: null, harnessCanonicalProposals: [], harnessProgress: null, harnessLiveLabel: null, harnessLiveTail: [] })
```

액션(`setHarnessProgress` 옆)에 추가 — 파일 상단에 `import { appendTailLines } from './harness-utils.js'`가 필요하면 기존 harness-utils import에 병합:

```ts
  appendHarnessEngineLog(e: { label: string; stream: 'stdout' | 'stderr'; chunk: string }) {
    set((s) => ({ harnessLiveLabel: e.label, harnessLiveTail: appendTailLines(s.harnessLiveTail, e.chunk) }))
  },
```

(상태 타입에 액션 시그니처도 추가: `appendHarnessEngineLog: (e: { label: string; stream: 'stdout' | 'stderr'; chunk: string }) => void`)

- [ ] **Step 5: App.tsx — 구독**

기존 `onHarnessProgress` useEffect(102행) 아래에 추가:

```ts
  useEffect(() => api.onHarnessEngineLog((e) => useStore.getState().appendHarnessEngineLog(e)), [])
```

- [ ] **Step 6: HarnessDashboard.tsx — Coverage 탭 live tail**

useStore 구조분해에 `harnessLiveLabel, harnessLiveTail` 추가. Coverage 탭의 로딩 플레이스홀더를 다음으로 교체:

```tsx
            {tab === 'coverage' && (
              harnessLoading
                ? <div className="harness-dashboard__placeholder">
                    <div>⏳ 위키 생성 중… {harnessProgress ? `(현재 단계: ${harnessProgress})` : '(시작 중…)'}</div>
                    {harnessLiveLabel && (
                      <pre className="harness-dashboard__live-tail">
                        {`[${harnessLiveLabel}]\n${harnessLiveTail.join('\n')}`}
                      </pre>
                    )}
                  </div>
                : coverageData
                  ? <CoverageMatrix data={coverageData} onOpenSource={(p) => window.alert(p)} />
                  : currentRun?.runState.state === 'FAILED'
                    ? <div className="harness-dashboard__placeholder harness-dashboard__placeholder--error">❌ 실패: {currentRun.runState.error ?? '원인 미상'}</div>
                    : <div className="harness-dashboard__placeholder">아직 커버리지 데이터가 없습니다 — "전 문서로 위키 생성"을 실행하세요.</div>
            )}
```

- [ ] **Step 7: app.css — live tail 스타일**

기존 `.harness-dashboard__placeholder` 정의 근처에 추가:

```css
.harness-dashboard__live-tail {
  margin-top: 12px;
  padding: 10px;
  max-height: 220px;
  overflow-y: auto;
  text-align: left;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 6px;
  opacity: 0.85;
}
```

- [ ] **Step 8: 테스트 + 타입 + 전체 회귀**

Run: `pnpm --filter @apc/desktop exec vitest run && pnpm --filter @apc/desktop exec tsc --noEmit`
Expected: 전부 PASS (기존 컴포넌트 테스트 포함), 타입 클린.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/renderer/harness-utils.ts apps/desktop/src/renderer/harness-utils.test.ts apps/desktop/src/renderer/store.ts apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/components/HarnessDashboard.tsx apps/desktop/src/renderer/app.css
git commit -m "feat(desktop): live engine output tail during wiki generation"
```

---

### Task 9: 전체 회귀 + 수동 검증

- [ ] **Step 1: 전 패키지 테스트**

Run: `pnpm -r test` (또는 루트 `pnpm vitest run` + `pnpm --filter @apc/desktop exec vitest run`)
Expected: 전부 PASS.

- [ ] **Step 2: 전 패키지 타입체크**

Run: `pnpm --filter @apc/llm-wiki exec tsc --noEmit && pnpm --filter @apc/knowledge-harness exec tsc --noEmit && pnpm --filter @apc/app-services exec tsc --noEmit && pnpm --filter @apc/desktop exec tsc --noEmit`
Expected: 클린.

- [ ] **Step 3: 수동 검증 (사용자 환경)**

1. 데스크톱 앱 실행 → SSH 프로젝트 선택 → "전 문서로 위키 생성" 클릭.
2. Coverage 탭에 현재 단계 + 엔진 출력 tail이 실시간으로 보이는지 확인.
3. 실패 시: 메시지에 `exit <code>` + stderr 내용 + `→ full logs: …` 경로가 보이는지 확인.
4. `<runsRoot>/RUN-…/logs/01-PROJECT_SCANNED-project-discovery/` 안에 prompt.txt / stdout.log / stderr.log / meta.json이 있는지 확인 — **이것으로 6/9부터 미궁이던 codex 실패의 진짜 원인이 처음으로 확인 가능해진다.**

- [ ] **Step 4: 실패 원인 기록**

수동 검증에서 드러난 codex 실패의 실제 원인(인증/플래그/컨텍스트 초과 등)을 `docs/handoffs/2026-06-09-harness-codex-discovery-failure.md` §4 가설과 대조해 후속 스펙(품질·preflight)의 입력으로 기록.
