import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { AgentType } from '@apc/shared'
import type { AgentRunner, RunInput, RunResult } from './agent-runner.js'
import { buildEngineArgs } from './engine-options.js'

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
      const safeCwd = input.cwd && existsSync(input.cwd) ? input.cwd : undefined
      const args = [...tpl.args, ...buildEngineArgs(input.agent, input.engineOptions)]
      const command = `${tpl.command} ${args.join(' ')}`
      const startedAt = Date.now()
      const child = spawn(tpl.command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32', cwd: safeCwd })
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
}
