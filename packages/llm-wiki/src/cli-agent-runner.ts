import { spawn } from 'node:child_process'
import type { AgentType } from '@apc/shared'
import type { AgentRunner, RunInput, RunResult } from './agent-runner.js'

export type CommandTemplate = { command: string; args: string[] }
export type EngineTemplates = Partial<Record<AgentType, CommandTemplate>>

/** Default headless templates. Flags are version-dependent — validate at runtime (Plan 6 detect step). */
export const DEFAULT_TEMPLATES: EngineTemplates = {
  claude: { command: 'claude', args: ['-p', '{{PROMPT}}', '--output-format', 'json'] },
  codex: { command: 'codex', args: ['exec', '{{PROMPT}}'] },
  opencode: { command: 'opencode', args: ['run', '{{PROMPT}}'] },
}

export class CliAgentRunner implements AgentRunner {
  constructor(private readonly templates: EngineTemplates = DEFAULT_TEMPLATES) {}

  run(input: RunInput): Promise<RunResult> {
    const tpl = this.templates[input.agent]
    if (!tpl) return Promise.reject(new Error(`No command template for engine: ${input.agent}`))
    const args = tpl.args.map((a) => a.replace('{{PROMPT}}', input.prompt))

    return new Promise<RunResult>((resolve) => {
      const child = spawn(tpl.command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = '', stderr = ''
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ ok: false, output: '', raw: stderr }) }, input.timeoutMs)
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))
      child.on('error', () => { clearTimeout(timer); resolve({ ok: false, output: '', raw: stderr }) })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ ok: code === 0, output: stdout, raw: stdout || stderr })
      })
    })
  }
}
