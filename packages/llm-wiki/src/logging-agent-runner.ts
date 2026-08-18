import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentRunner, ChunkStream, RunInput, RunResult } from './agent-runner.js'
import {
  DEFAULT_OUTPUT_CAPTURE_BYTES,
  outputTruncationMarker,
  takeUtf8Prefix,
  truncateOutput,
} from './bounded-output.js'

const DEFAULT_FLUSH_BYTES = 64 * 1024
const DEFAULT_FLUSH_MS = 50

type PendingStream = {
  parts: string[]
  pendingBytes: number
  acceptedBytes: number
  truncated: boolean
}

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
  private readonly flushBytes: number
  private readonly flushMs: number

  constructor(
    private readonly inner: AgentRunner,
    private readonly logRoot: string,
    opts: { maxBytes?: number; flushBytes?: number; flushMs?: number } = {},
  ) {
    this.maxBytes = opts.maxBytes ?? DEFAULT_OUTPUT_CAPTURE_BYTES
    this.flushBytes = opts.flushBytes ?? DEFAULT_FLUSH_BYTES
    this.flushMs = opts.flushMs ?? DEFAULT_FLUSH_MS
  }

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
    const pending: Record<ChunkStream, PendingStream> = {
      stdout: { parts: [], pendingBytes: 0, acceptedBytes: 0, truncated: false },
      stderr: { parts: [], pendingBytes: 0, acceptedBytes: 0, truncated: false },
    }
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    const safe = (fn: () => void) => { try { fn() } catch (e) { console.warn('[LoggingAgentRunner] log write failed:', e) } }

    if (dir) safe(() => writeFileSync(join(dir, 'prompt.txt'), input.prompt))

    const flushStream = (stream: ChunkStream) => {
      const state = pending[stream]
      if (!dir || state.parts.length === 0) return
      const payload = state.parts.join('')
      state.parts = []
      state.pendingBytes = 0
      safe(() => appendFileSync(join(dir, `${stream}.log`), payload))
    }
    const flush = () => {
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = undefined
      flushStream('stdout')
      flushStream('stderr')
    }
    const scheduleFlush = () => {
      if (flushTimer || !dir) return
      flushTimer = setTimeout(flush, this.flushMs)
      flushTimer.unref?.()
    }
    const queue = (stream: ChunkStream, text: string) => {
      if (!dir || !text) return
      const state = pending[stream]
      if (state.truncated) return
      const accepted = takeUtf8Prefix(text, this.maxBytes - state.acceptedBytes)
      if (accepted) {
        state.parts.push(accepted)
        const bytes = Buffer.byteLength(accepted)
        state.acceptedBytes += bytes
        state.pendingBytes += bytes
      }
      if (accepted !== text) {
        state.truncated = true
        const marker = outputTruncationMarker(this.maxBytes)
        state.parts.push(marker)
        state.pendingBytes += Buffer.byteLength(marker)
      }
      if (state.pendingBytes >= this.flushBytes) flush()
      else scheduleFlush()
    }

    const onChunk: RunInput['onChunk'] = (stream, text) => {
      input.onChunk?.(stream, text)
      queue(stream, text)
    }

    let res: RunResult
    try {
      res = await this.inner.run({ ...input, onChunk })
    } finally {
      flush()
    }

    if (dir) {
      // 스트리밍이 없던 러너(Fake 등)도 최종 결과로 로그를 남긴다.
      const finalOutput = res.output
      if (pending.stdout.acceptedBytes === 0 && finalOutput) {
        safe(() => writeFileSync(join(dir, 'stdout.log'), truncateOutput(finalOutput, this.maxBytes)))
      }
      const finalStderr = res.stderr
      if (pending.stderr.acceptedBytes === 0 && finalStderr) {
        safe(() => writeFileSync(join(dir, 'stderr.log'), truncateOutput(finalStderr, this.maxBytes)))
      }
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
