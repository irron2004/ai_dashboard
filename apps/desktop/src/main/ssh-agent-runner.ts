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
    const startedAt = Date.now()
    const r = await this.exec(ssh, loginShell(engineCmd), { stdin: input.prompt, timeoutMs: input.timeoutMs, onChunk: input.onChunk })
    const raw = r.stderr && r.stdout ? `${r.stderr}\n--- stdout ---\n${r.stdout}` : (r.stderr || r.stdout)
    return {
      ok: r.ok, output: r.stdout, stderr: r.stderr, exitCode: r.exitCode ?? null, raw,
      command: `ssh ${ssh.user}@${ssh.host}:${ssh.port} ${ENGINE_CMD[input.agent]}`,
      durationMs: Date.now() - startedAt,
    }
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
