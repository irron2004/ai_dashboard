import { describe, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRunner } from './agent-runner.js'
import { LoggingAgentRunner } from './logging-agent-runner.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'logrun-'))

describe('LoggingAgentRunner', () => {
  test('success: writes prompt/stdout/meta and returns logDir', async () => {
    const root = tmp()
    const inner: AgentRunner = {
      run: async (i) => {
        i.onChunk?.('stdout', 'streamed-out')
        return { ok: true, output: 'streamed-out', raw: 'streamed-out', exitCode: 0, stderr: '', command: 'codex exec', durationMs: 5 }
      },
    }
    const res = await new LoggingAgentRunner(inner, root).run({ agent: 'codex', prompt: 'PROMPT', timeoutMs: 100, label: 'PROJECT_SCANNED-project-discovery' })
    expect(res.ok).toBe(true)
    const dir = join(root, '01-PROJECT_SCANNED-project-discovery')
    expect(res.logDir).toBe(dir)
    expect(readFileSync(join(dir, 'prompt.txt'), 'utf8')).toBe('PROMPT')
    expect(readFileSync(join(dir, 'stdout.log'), 'utf8')).toBe('streamed-out')
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
    expect(meta).toMatchObject({ ok: true, exitCode: 0, command: 'codex exec', engine: 'codex', label: 'PROJECT_SCANNED-project-discovery' })
    expect(meta.startedAt).toBeTruthy()
    expect(meta.endedAt).toBeTruthy()
  })

  test('failure without streaming: stdout/stderr logs come from the final result', async () => {
    const root = tmp()
    const inner: AgentRunner = { run: async () => ({ ok: false, output: 'file listing', raw: 'x', exitCode: 1, stderr: 'auth error' }) }
    await new LoggingAgentRunner(inner, root).run({ agent: 'codex', prompt: 'p', timeoutMs: 100, label: 'L' })
    const dir = join(root, '01-L')
    expect(readFileSync(join(dir, 'stdout.log'), 'utf8')).toBe('file listing')
    expect(readFileSync(join(dir, 'stderr.log'), 'utf8')).toBe('auth error')
    expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')).exitCode).toBe(1)
  })

  test('sequence numbers continue across instances (resume case)', async () => {
    const root = tmp()
    const inner: AgentRunner = { run: async () => ({ ok: true, output: 'o', raw: 'o' }) }
    await new LoggingAgentRunner(inner, root).run({ agent: 'codex', prompt: 'p', timeoutMs: 100, label: 'A' })
    await new LoggingAgentRunner(inner, root).run({ agent: 'codex', prompt: 'p', timeoutMs: 100, label: 'B' })
    expect(readdirSync(root).sort()).toEqual(['01-A', '02-B'])
  })

  test('caps each stream log at maxBytes with a truncation marker', async () => {
    const root = tmp()
    const inner: AgentRunner = {
      run: async (i) => { i.onChunk?.('stdout', 'AAAA'); i.onChunk?.('stdout', 'BBBB'); i.onChunk?.('stdout', 'CCCC'); return { ok: true, output: '', raw: '' } },
    }
    await new LoggingAgentRunner(inner, root, { maxBytes: 6 }).run({ agent: 'codex', prompt: 'p', timeoutMs: 100, label: 'L' })
    const log = readFileSync(join(root, '01-L', 'stdout.log'), 'utf8')
    expect(log).toContain('AAAA')
    expect(log).toContain('[truncated')
    expect(log).not.toContain('CCCC')
  })

  test('log write failure never breaks the run (best-effort)', async () => {
    const root = tmp()
    const blocker = join(root, 'not-a-dir')
    writeFileSync(blocker, 'I am a file, mkdir under me fails')
    const inner: AgentRunner = { run: async () => ({ ok: true, output: 'fine', raw: 'fine' }) }
    // logRoot가 "파일"이라 mkdir이 실패하는 환경 — 결과는 그대로 나와야 한다
    const res = await new LoggingAgentRunner(inner, blocker).run({ agent: 'codex', prompt: 'p', timeoutMs: 100, label: 'L' })
    expect(res.ok).toBe(true)
    expect(res.output).toBe('fine')
    expect(res.logDir).toBeUndefined()
    expect(existsSync(join(blocker, '01-L'))).toBe(false)
  })

  test('still calls the caller-provided onChunk', async () => {
    const root = tmp()
    const inner: AgentRunner = { run: async (i) => { i.onChunk?.('stderr', 'e1'); return { ok: true, output: '', raw: '' } } }
    const seen: Array<[string, string]> = []
    await new LoggingAgentRunner(inner, root).run({ agent: 'codex', prompt: 'p', timeoutMs: 100, label: 'L', onChunk: (s, t) => seen.push([s, t]) })
    expect(seen).toEqual([['stderr', 'e1']])
  })

  test('flushes all queued chunks before returning even when the time window has not elapsed', async () => {
    const root = tmp()
    const inner: AgentRunner = {
      run: async (input) => {
        for (let index = 0; index < 100; index += 1) input.onChunk?.('stdout', `${index},`)
        return { ok: true, output: '', raw: '' }
      },
    }
    await new LoggingAgentRunner(inner, root, { flushBytes: 1024 * 1024, flushMs: 60_000 })
      .run({ agent: 'codex', prompt: 'p', timeoutMs: 100, label: 'L' })
    expect(readFileSync(join(root, '01-L', 'stdout.log'), 'utf8')).toBe(
      Array.from({ length: 100 }, (_, index) => `${index},`).join(''),
    )
  })
})
