import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { CliAgentRunner, type EngineTemplates } from './cli-agent-runner.js'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
import { spawn } from 'node:child_process'

const mockSpawn = vi.mocked(spawn)

function createMockChild() {
  const child = new EventEmitter() as any
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { write: vi.fn(), end: vi.fn() }
  child.kill = vi.fn()
  return child
}

describe('CliAgentRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('writes the prompt to stdin and returns stdout', async () => {
    const mockChild = createMockChild()
    mockSpawn.mockReturnValue(mockChild)
    const templates: EngineTemplates = { claude: { command: 'claude', args: ['-p'] } }
    const promise = new CliAgentRunner(templates).run({ agent: 'claude', prompt: 'hello world', timeoutMs: 10000 })
    mockChild.stdout.emit('data', JSON.stringify({ echo: 'hello world' }))
    mockChild.emit('close', 0)
    const res = await promise
    expect(res.ok).toBe(true)
    expect(JSON.parse(res.output).echo).toBe('hello world')
    expect(mockChild.stdin.write).toHaveBeenCalledWith('hello world')
    expect(mockChild.stdin.end).toHaveBeenCalled()
  })

  test('times out and returns ok:false when the process hangs', async () => {
    vi.useFakeTimers()
    const mockChild = createMockChild()
    mockSpawn.mockReturnValue(mockChild)
    const templates: EngineTemplates = { claude: { command: 'claude', args: ['-p'] } }
    const promise = new CliAgentRunner(templates).run({ agent: 'claude', prompt: 'x', timeoutMs: 300 })
    vi.advanceTimersByTime(300)
    const res = await promise
    expect(res.ok).toBe(false)
    expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL')
  })

  test('returns ok:false when spawn emits an error', async () => {
    const mockChild = createMockChild()
    mockSpawn.mockReturnValue(mockChild)
    const templates: EngineTemplates = { claude: { command: 'claude', args: ['-p'] } }
    const promise = new CliAgentRunner(templates).run({ agent: 'claude', prompt: 'x', timeoutMs: 10000 })
    mockChild.emit('error', new Error('spawn failed'))
    const res = await promise
    expect(res.ok).toBe(false)
    expect(res.raw).toContain('spawn failed')
  })

  test('returns ok:false when child exits with non-zero code', async () => {
    const mockChild = createMockChild()
    mockSpawn.mockReturnValue(mockChild)
    const templates: EngineTemplates = { claude: { command: 'claude', args: ['-p'] } }
    const promise = new CliAgentRunner(templates).run({ agent: 'claude', prompt: 'x', timeoutMs: 10000 })
    mockChild.stdout.emit('data', 'some output')
    mockChild.emit('close', 1)
    const res = await promise
    expect(res.ok).toBe(false)
    expect(res.output).toBe('some output')
  })

  test('throws for an engine with no configured template', async () => {
    await expect(new CliAgentRunner({}).run({ agent: 'opencode', prompt: 'x', timeoutMs: 100 })).rejects.toThrow(/no command template/i)
  })
})

describe('CliAgentRunner (real process)', () => {
  test('runs the engine command in the provided cwd', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cwd-test-')))
    vi.doUnmock('node:child_process')
    vi.resetModules()
    const { CliAgentRunner: RealRunner } = await import('./cli-agent-runner.js')
    const runner = new RealRunner({
      codex: { command: process.execPath, args: ['-e', 'process.stdout.write(process.cwd())'] },
    })
    const res = await runner.run({ agent: 'codex', prompt: '', timeoutMs: 10_000, cwd: dir })
    expect(res.ok).toBe(true)
    expect(realpathSync(res.output.trim())).toBe(dir)
  }, 15_000)
})
