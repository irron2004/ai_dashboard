import type { AgentRunner, RunInput, RunResult } from '@apc/llm-wiki'
import { CliAgentRunner } from '@apc/llm-wiki'
import { parseSsh, sshExec, ENGINE_CMD, type SshExec } from './ssh-exec.js'

// Source files loaded by both login and interactive shells so the user's full PATH is available.
const SOURCE_CHAIN =
  'source ~/.bashrc 2>/dev/null; source ~/.bash_profile 2>/dev/null; source ~/.profile 2>/dev/null; source ~/.zshrc 2>/dev/null; source ~/.zprofile 2>/dev/null'

/**
 * Build a bash -lic command using double-quote wrapping so that single-quote-delimited path
 * segments (`cd '/path'`) appear literally in the command string — loginShell's single-quote
 * wrapping would mangle embedded single quotes in the path. Dollar signs, backticks, and
 * backslashes that could be interpreted inside double quotes are escaped.
 */
function agentLoginShell(cdPath: string, engineCmd: string): string {
  // Escape chars that are special inside double-quoted bash strings.
  const safePath = cdPath.replace(/["\\$`]/g, (c) => `\\${c}`)
  return `bash -lic "${SOURCE_CHAIN}; cd '${safePath}' && ${engineCmd}"`
}

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
    const cmd = agentLoginShell(ssh.path, ENGINE_CMD[input.agent])
    const r = await this.exec(ssh, cmd, { stdin: input.prompt, timeoutMs: input.timeoutMs })
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
