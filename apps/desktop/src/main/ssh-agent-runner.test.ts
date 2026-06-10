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
    expect(seen?.cmd).toContain('/home/me/proj')   // path still present (single-quote-escaped)
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
