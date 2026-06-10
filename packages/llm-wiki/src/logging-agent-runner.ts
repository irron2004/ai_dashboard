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
      if (written.stderr === 0 && res.stderr) { const s = res.stderr; safe(() => writeFileSync(join(dir, 'stderr.log'), s)) }
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
