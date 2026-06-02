import { spawn } from 'node:child_process'
import type { AgentType } from '@apc/shared'
import type { AgentRunner, RunInput, RunResult } from './agent-runner.js'

export type CommandTemplate = { command: string; args: string[] }
export type EngineTemplates = Partial<Record<AgentType, CommandTemplate>>

// Prompt is sent on stdin (not argv), so there are no quoting/length limits.
// Flags are version-dependent — these are the documented defaults and are overridable.
export const DEFAULT_TEMPLATES: EngineTemplates = {
  claude: { command: 'claude', args: ['-p', '--output-format', 'json'] },
  codex: { command: 'codex', args: ['exec'] },
  opencode: { command: 'opencode', args: ['run'] },
}

export class CliAgentRunner implements AgentRunner {
  constructor(private readonly templates: EngineTemplates = DEFAULT_TEMPLATES) {}

  run(input: RunInput): Promise<RunResult> {
    const tpl = this.templates[input.agent]
    if (!tpl) return Promise.reject(new Error(`No command template for engine: ${input.agent}`))

    return new Promise<RunResult>((resolve) => {
      // shell:true on Windows so .cmd/PATHEXT shims (claude.cmd, etc.) resolve.
      // env:process.env ensures PATH (e.g. nvm bins) is inherited in Electron.
      const child = spawn(tpl.command, tpl.args, { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32', env: process.env })
      let stdout = '', stderr = ''
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ ok: false, output: '', raw: stderr || 'timeout' }) }, input.timeoutMs)
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))
      child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, output: '', raw: String(e) }) })
      child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, output: stdout, raw: stdout || stderr }) })
      try { child.stdin?.write(input.prompt); child.stdin?.end() } catch { /* child already gone */ }
    })
  }
}
