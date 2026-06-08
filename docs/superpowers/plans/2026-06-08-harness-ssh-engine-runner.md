# Harness SSH Engine Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Knowledge Harness run the engine CLI on the remote host (over SSH, in the project folder, with the user's login-shell PATH/auth) for `ssh://` projects — the same mechanism the Generate flow already uses — instead of spawning it locally on the app host.

**Architecture:** Extract the existing SSH exec helpers from `remote-generate.ts` into a shared `ssh-exec.ts`; add an `SshAgentRunner` (implements the harness's `AgentRunner` interface; runs the engine on the remote via `ssh`) and a `RoutingAgentRunner` (ssh:// cwd → SSH, else local `CliAgentRunner`); inject the router into `HarnessService` in the container. The cwd that already reaches the runner is the project's `repoPaths[0]`, which is the `ssh://…` URL for remote projects.

**Tech Stack:** TypeScript, Node child_process (ssh), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-08-harness-ssh-engine-runner-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/desktop/src/main/ssh-exec.ts` | Create | Shared `parseSsh`/`sshExec`/`loginShell`/`ENGINE_CMD` + types (moved from remote-generate) |
| `apps/desktop/src/main/remote-generate.ts` | Modify | Import the helpers from `ssh-exec.ts`; re-export `SshExec` |
| `apps/desktop/src/main/ssh-agent-runner.ts` | Create | `SshAgentRunner` + `RoutingAgentRunner` |
| `apps/desktop/src/main/ssh-agent-runner.test.ts` | Create | Tests for both runners |
| `apps/desktop/src/main/container.ts` | Modify | Inject `RoutingAgentRunner` into `HarnessService` |

**Verification commands:**
- desktop tests: `cd apps/desktop && npx vitest run`
- (single file) `cd apps/desktop && npx vitest run src/main/ssh-agent-runner.test.ts` / `src/main/remote-generate.test.ts`
- typecheck: `pnpm typecheck`

> NodeNext: relative imports use `.js`.

---

## Task 1: Extract shared SSH helpers into `ssh-exec.ts`

**Files:**
- Create: `apps/desktop/src/main/ssh-exec.ts`
- Modify: `apps/desktop/src/main/remote-generate.ts`

This is a pure refactor — behavior must stay identical, proven by `remote-generate.test.ts` staying green.

- [ ] **Step 1: Create `ssh-exec.ts`** with the helpers (these are MOVED verbatim from `remote-generate.ts` — keep the exact strings/escaping):

```ts
import { spawn } from 'node:child_process'
import type { AgentType } from '@apc/shared'

export type SshTarget = { user: string; host: string; port: number; path: string }

/** Parse an ssh://user@host:port/remote/path project path, or null if not ssh. */
export function parseSsh(raw: string): SshTarget | null {
  if (!raw || !raw.startsWith('ssh://')) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'ssh:') return null
    return { user: decodeURIComponent(u.username) || 'root', host: u.hostname, port: u.port ? Number(u.port) : 22, path: decodeURIComponent(u.pathname) || '.' }
  } catch { return null }
}

export type SshExecResult = { ok: boolean; stdout: string; stderr: string }
export type SshExec = (ssh: SshTarget, remoteCmd: string, opts?: { stdin?: string; timeoutMs?: number }) => Promise<SshExecResult>

// Non-interactive ssh (BatchMode = key-auth only) running a remote command, optional stdin.
export function sshExec(ssh: SshTarget, remoteCmd: string, opts: { stdin?: string; timeoutMs?: number } = {}): Promise<SshExecResult> {
  return new Promise((resolve) => {
    const args = ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-p', String(ssh.port), `${ssh.user}@${ssh.host}`, remoteCmd]
    const child = spawn(process.platform === 'win32' ? 'ssh.exe' : 'ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ ok: false, stdout, stderr: stderr || 'timeout' }) }, opts.timeoutMs ?? 120000)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, stdout: '', stderr: String(e) }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, stdout, stderr }) })
    if (opts.stdin != null) { try { child.stdin?.write(opts.stdin); child.stdin?.end() } catch { /* gone */ } }
  })
}

// Run a command through the remote user's INTERACTIVE LOGIN shell so their full PATH
// (npm global prefix, nvm, ~/.local/bin, etc.) is loaded — exactly what the user gets when
// they type the command themselves. The `-i` is essential: distro .bashrc files guard their
// PATH exports behind `case $- in *i*) ;; *) return;; esac`, so a non-interactive `-lc` shell
// returns early and never reaches the PATH exports (that's why codex/opencode resolved
// interactively but were "not found" from the app). We also source the rc files explicitly.
export function loginShell(cmd: string): string {
  return `bash -lic 'source ~/.bashrc 2>/dev/null; source ~/.bash_profile 2>/dev/null; source ~/.profile 2>/dev/null; source ~/.zshrc 2>/dev/null; source ~/.zprofile 2>/dev/null; ${cmd.replace(/'/g, `'\\''`)}'`
}

// Headless engine command run on the remote (prompt arrives via stdin).
// codex refuses to run outside a trusted git repo unless --skip-git-repo-check is passed.
export const ENGINE_CMD: Record<AgentType, string> = {
  claude: 'claude -p --output-format json',
  codex: 'codex exec --skip-git-repo-check',
  opencode: 'opencode run',
}
```

- [ ] **Step 2: Update `remote-generate.ts` to import from `ssh-exec.ts`.**

(a) DELETE the now-moved declarations from `remote-generate.ts`: the `type SshTarget`, `function parseSsh`, `type SshExecResult`, `type SshExec`, `function sshExec`, `function loginShell`, and `const ENGINE_CMD`.

(b) Add near the top imports:
```ts
import { parseSsh, sshExec, loginShell, ENGINE_CMD } from './ssh-exec.js'
```

(c) `remote-generate.test.ts` imports `type SshExec` from `./remote-generate.js`, so keep that name exported — add a re-export line:
```ts
export type { SshExec } from './ssh-exec.js'
```

(Leave the rest of `remote-generate.ts` — `generateRemote` and its body — UNCHANGED. It already calls `parseSsh`, `sshExec` (via `deps.exec ?? sshExec`), `loginShell`, `ENGINE_CMD`.)

- [ ] **Step 3: Run the existing test + typecheck, confirm PASS (no behavior change).**

Run: `cd apps/desktop && npx vitest run src/main/remote-generate.test.ts && cd ../.. && pnpm typecheck`
Expected: PASS — `remote-generate.test.ts` (its 3 tests) stays green; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/ssh-exec.ts apps/desktop/src/main/remote-generate.ts
git commit -m "refactor(desktop): extract shared ssh-exec helpers from remote-generate"
```

---

## Task 2: `SshAgentRunner` + `RoutingAgentRunner`

**Files:**
- Create: `apps/desktop/src/main/ssh-agent-runner.ts`
- Create: `apps/desktop/src/main/ssh-agent-runner.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `apps/desktop/src/main/ssh-agent-runner.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import type { AgentRunner, RunInput, RunResult } from '@apc/llm-wiki'
import { SshAgentRunner, RoutingAgentRunner } from './ssh-agent-runner.js'
import type { SshExec } from './ssh-exec.js'

describe('SshAgentRunner', () => {
  test('runs the engine on the remote via login shell + cd, prompt on stdin', async () => {
    let seen: { cmd: string; stdin?: string } | undefined
    const exec: SshExec = async (_ssh, cmd, opts) => { seen = { cmd, stdin: opts?.stdin }; return { ok: true, stdout: '{"ok":true}', stderr: '' } }
    const res = await new SshAgentRunner(exec).run({ agent: 'codex', prompt: 'PROMPT', timeoutMs: 1000, cwd: 'ssh://me@host:22/home/me/proj' })
    expect(res.ok).toBe(true)
    expect(res.output).toBe('{"ok":true}')
    expect(seen?.stdin).toBe('PROMPT')
    expect(seen?.cmd).toContain("cd '/home/me/proj'")
    expect(seen?.cmd).toContain('codex exec --skip-git-repo-check')
    expect(seen?.cmd).toContain('bash -lic')
  })

  test('ok:false when cwd is not an ssh target', async () => {
    const exec: SshExec = async () => ({ ok: true, stdout: '', stderr: '' })
    const res = await new SshAgentRunner(exec).run({ agent: 'claude', prompt: '', timeoutMs: 1000, cwd: '/local/path' })
    expect(res.ok).toBe(false)
  })

  test('maps remote stderr to raw on failure', async () => {
    const exec: SshExec = async () => ({ ok: false, stdout: '', stderr: 'boom' })
    const res = await new SshAgentRunner(exec).run({ agent: 'claude', prompt: '', timeoutMs: 1000, cwd: 'ssh://me@host:22/p' })
    expect(res.ok).toBe(false)
    expect(res.raw).toBe('boom')
  })
})

describe('RoutingAgentRunner', () => {
  const spy = (): AgentRunner & { calls: RunInput[] } => {
    const calls: RunInput[] = []
    return { calls, run: async (i: RunInput): Promise<RunResult> => { calls.push(i); return { ok: true, output: '', raw: '' } } }
  }
  test('routes ssh:// cwd to the ssh runner', async () => {
    const cli = spy(); const ssh = spy()
    await new RoutingAgentRunner(cli, ssh).run({ agent: 'codex', prompt: '', timeoutMs: 1, cwd: 'ssh://me@host:22/p' })
    expect(ssh.calls.length).toBe(1); expect(cli.calls.length).toBe(0)
  })
  test('routes local/undefined cwd to the cli runner', async () => {
    const cli = spy(); const ssh = spy()
    await new RoutingAgentRunner(cli, ssh).run({ agent: 'codex', prompt: '', timeoutMs: 1, cwd: '/local' })
    expect(cli.calls.length).toBe(1); expect(ssh.calls.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run, confirm FAIL.** `cd apps/desktop && npx vitest run src/main/ssh-agent-runner.test.ts` — module not found.

- [ ] **Step 3: Write the runners.** Create `apps/desktop/src/main/ssh-agent-runner.ts`:

```ts
import type { AgentRunner, RunInput, RunResult } from '@apc/llm-wiki'
import { CliAgentRunner } from '@apc/llm-wiki'
import { parseSsh, sshExec, loginShell, ENGINE_CMD, type SshExec } from './ssh-exec.js'

/**
 * Runs the engine on the remote host (ssh:// cwd) using the same non-interactive ssh + login-shell
 * path the Generate flow uses, so the user's remote PATH and auth apply — `cd` into the project dir,
 * prompt on stdin. cwd is the project's repoPaths[0] (an ssh:// URL for remote projects).
 */
export class SshAgentRunner implements AgentRunner {
  constructor(private readonly exec: SshExec = sshExec) {}

  async run(input: RunInput): Promise<RunResult> {
    const ssh = parseSsh(input.cwd ?? '')
    if (!ssh) return { ok: false, output: '', raw: 'SshAgentRunner: cwd is not an ssh:// target' }
    const cdPath = ssh.path.replace(/'/g, `'\\''`)
    const engineCmd = `cd '${cdPath}' && ${ENGINE_CMD[input.agent]}`
    const r = await this.exec(ssh, loginShell(engineCmd), { stdin: input.prompt, timeoutMs: input.timeoutMs })
    return { ok: r.ok, output: r.stdout, raw: r.stderr || r.stdout }
  }
}

/** Routes each agent run to SSH when the cwd is an ssh:// project, else to the local CLI runner. */
export class RoutingAgentRunner implements AgentRunner {
  constructor(
    private readonly cli: AgentRunner = new CliAgentRunner(),
    private readonly ssh: AgentRunner = new SshAgentRunner(),
  ) {}

  run(input: RunInput): Promise<RunResult> {
    return input.cwd?.startsWith('ssh://') ? this.ssh.run(input) : this.cli.run(input)
  }
}
```

- [ ] **Step 4: Run the tests + typecheck, confirm PASS.** `cd apps/desktop && npx vitest run src/main/ssh-agent-runner.test.ts && cd ../.. && pnpm typecheck` — green (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/ssh-agent-runner.ts apps/desktop/src/main/ssh-agent-runner.test.ts
git commit -m "feat(desktop): SshAgentRunner runs harness engine on the remote (+ routing)"
```

---

## Task 3: Inject `RoutingAgentRunner` into the container + full verification

**Files:**
- Modify: `apps/desktop/src/main/container.ts`

- [ ] **Step 1: Wire the router into HarnessService.**

In `apps/desktop/src/main/container.ts`:

(a) The import line `import { WikiEngine, CliAgentRunner, type AgentRunner } from '@apc/llm-wiki'` — remove `CliAgentRunner` (it is no longer referenced directly in this file; it now lives inside `RoutingAgentRunner`):
```ts
import { WikiEngine, type AgentRunner } from '@apc/llm-wiki'
```
(`WikiEngine` is still used at `const wiki = new WikiEngine(...)`; `type AgentRunner` is still used for `opts.agentRunner?: AgentRunner`.)

(b) Add the router import:
```ts
import { RoutingAgentRunner } from './ssh-agent-runner.js'
```

(c) In the `HarnessService` construction, change the runner default:
```ts
    runner: opts.agentRunner ?? new CliAgentRunner(),
```
to:
```ts
    runner: opts.agentRunner ?? new RoutingAgentRunner(),
```

(Tests inject `opts.agentRunner` (a `FakeAgentRunner`), so they are unaffected. Production now routes by cwd.)

- [ ] **Step 2: Full desktop suite + typecheck, confirm PASS.**

Run: `cd apps/desktop && npx vitest run && cd ../.. && pnpm typecheck`
Expected: all desktop suites green (including the new `ssh-agent-runner.test.ts` and the unchanged `remote-generate.test.ts`), typecheck clean, and NO unused-import error for `CliAgentRunner` in `container.ts`.

- [ ] **Step 3: Confirm acceptance criteria (spec §5).**
1. ssh:// project → engine runs on the remote (login shell + cd + stdin). ✔ (Task 2 SshAgentRunner; Task 3 routing)
2. local project → `CliAgentRunner` (no regression). ✔ (routing default branch)
3. codex → `codex exec --skip-git-repo-check` on the remote. ✔ (ENGINE_CMD)
4. remote-generate + existing tests + typecheck pass. ✔ (Task 1 green + Step 2)
5. No new IPC channel / no migration. ✔

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/container.ts
git commit -m "feat(desktop): harness uses RoutingAgentRunner (SSH for remote projects)"
```

---

## Notes for the implementer

- Task 1 is a pure move — do NOT alter the helper bodies/strings (especially `loginShell`'s quoting and `ENGINE_CMD` values); `remote-generate.test.ts` proves behavior is unchanged.
- The harness already threads `cwd = repoPaths[0]` to the runner (prior work). For ssh:// projects that value IS the `ssh://…` URL, which is exactly what `RoutingAgentRunner` and `SshAgentRunner` parse — no extra threading needed.
- Do NOT add IPC channels or change the pipeline. The only production wiring change is the injected runner in `container.ts`.
- The harness `LlmAgent` already does `unwrapAgentJson(res.output, engine)` then `parseStructured`; `SshAgentRunner` returns `output = remote stdout`, matching how `remote-generate` consumes the same engine output.
