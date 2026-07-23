import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import type { AgentType } from '@apc/shared'
import type { AgentRunner, RunInput, RunResult } from './agent-runner.js'
import { BoundedOutputBuffer, DEFAULT_OUTPUT_CAPTURE_BYTES } from './bounded-output.js'
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
  private readonly maxOutputBytes: number

  constructor(
    private readonly templates: EngineTemplates = DEFAULT_TEMPLATES,
    options: { maxOutputBytes?: number } = {},
  ) {
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_OUTPUT_CAPTURE_BYTES
  }

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
      const stdout = new BoundedOutputBuffer(this.maxOutputBytes)
      const stderr = new BoundedOutputBuffer(this.maxOutputBytes)
      const stdoutDecoder = new StringDecoder('utf8')
      const stderrDecoder = new StringDecoder('utf8')
      const base = () => ({ command, durationMs: Date.now() - startedAt })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        const output = stdout.toString(), diagnostics = stderr.toString()
        resolve({ ok: false, output, stderr: diagnostics, exitCode: null, raw: diagnostics || `timeout after ${input.timeoutMs}ms`, ...base() })
      }, input.timeoutMs)
      const decode = (decoder: StringDecoder, data: unknown) => decoder.write(Buffer.isBuffer(data) ? data : Buffer.from(String(data)))
      child.stdout.on('data', (data) => {
        const text = decode(stdoutDecoder, data)
        if (text) { stdout.append(text); input.onChunk?.('stdout', text) }
      })
      child.stderr.on('data', (data) => {
        const text = decode(stderrDecoder, data)
        if (text) { stderr.append(text); input.onChunk?.('stderr', text) }
      })
      child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, output: '', stderr: String(e), exitCode: null, raw: String(e), ...base() }) })
      child.on('close', (code) => {
        clearTimeout(timer)
        const stdoutTail = stdoutDecoder.end()
        if (stdoutTail) { stdout.append(stdoutTail); input.onChunk?.('stdout', stdoutTail) }
        const stderrTail = stderrDecoder.end()
        if (stderrTail) { stderr.append(stderrTail); input.onChunk?.('stderr', stderrTail) }
        const output = stdout.toString(), diagnostics = stderr.toString()
        // raw: 진단용 결합 뷰. `stdout || stderr` 단락 평가로 stderr를 버리던 결함 A 제거 — 둘 다 보존.
        const raw = diagnostics && output ? `${diagnostics}\n--- stdout ---\n${output}` : (diagnostics || output)
        resolve({ ok: code === 0, output, stderr: diagnostics, exitCode: code, raw, ...base() })
      })
      try { child.stdin?.write(input.prompt); child.stdin?.end() } catch { /* child already gone */ }
    })
  }
}
