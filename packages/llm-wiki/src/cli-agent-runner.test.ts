import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
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

  test('preserves stderr, exit code, command and duration on non-zero exit (defect A)', async () => {
    const mockChild = createMockChild()
    mockSpawn.mockReturnValue(mockChild)
    const templates: EngineTemplates = { codex: { command: 'codex', args: ['exec'] } }
    const promise = new CliAgentRunner(templates).run({ agent: 'codex', prompt: 'x', timeoutMs: 10000 })
    mockChild.stdout.emit('data', 'file-listing-noise')
    mockChild.stderr.emit('data', 'ERROR: not authenticated')
    mockChild.emit('close', 1)
    const res = await promise
    expect(res.ok).toBe(false)
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toBe('ERROR: not authenticated')
    expect(res.command).toBe('codex exec')
    expect(typeof res.durationMs).toBe('number')
    // raw는 stdout만으로 stderr를 가리면 안 된다 — 둘 다 담는다
    expect(res.raw).toContain('ERROR: not authenticated')
    expect(res.raw).toContain('file-listing-noise')
  })

  test('invokes onChunk per stream as data arrives', async () => {
    const mockChild = createMockChild()
    mockSpawn.mockReturnValue(mockChild)
    const templates: EngineTemplates = { claude: { command: 'claude', args: ['-p'] } }
    const chunks: Array<[string, string]> = []
    const promise = new CliAgentRunner(templates).run({
      agent: 'claude', prompt: 'x', timeoutMs: 10000,
      onChunk: (stream, text) => chunks.push([stream, text]),
    })
    mockChild.stdout.emit('data', 'out-1')
    mockChild.stderr.emit('data', 'err-1')
    mockChild.emit('close', 0)
    await promise
    expect(chunks).toEqual([['stdout', 'out-1'], ['stderr', 'err-1']])
  })

  test('bounds retained output while continuing to stream every chunk', async () => {
    const mockChild = createMockChild()
    mockSpawn.mockReturnValue(mockChild)
    const chunks: string[] = []
    const runner = new CliAgentRunner(
      { claude: { command: 'claude', args: ['-p'] } },
      { maxOutputBytes: 6 },
    )
    const promise = runner.run({
      agent: 'claude', prompt: 'x', timeoutMs: 10000,
      onChunk: (_stream, text) => chunks.push(text),
    })
    mockChild.stdout.emit('data', 'AAAA')
    mockChild.stdout.emit('data', 'BBBB')
    mockChild.stdout.emit('data', 'CCCC')
    mockChild.emit('close', 0)
    const result = await promise
    expect(result.output).toBe('AAAABB\n…[truncated at 6 bytes]\n')
    expect(chunks).toEqual(['AAAA', 'BBBB', 'CCCC'])
  })

  test('timeout result carries exitCode:null and partial stderr', async () => {
    vi.useFakeTimers()
    const mockChild = createMockChild()
    mockSpawn.mockReturnValue(mockChild)
    const templates: EngineTemplates = { claude: { command: 'claude', args: ['-p'] } }
    const promise = new CliAgentRunner(templates).run({ agent: 'claude', prompt: 'x', timeoutMs: 300 })
    mockChild.stderr.emit('data', 'partial diagnostics')
    vi.advanceTimersByTime(300)
    const res = await promise
    expect(res.ok).toBe(false)
    expect(res.exitCode).toBeNull()
    expect(res.stderr).toBe('partial diagnostics')
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

  test('a non-existent cwd does not crash the spawn (falls back to inherited cwd)', async () => {
    vi.doUnmock('node:child_process')
    vi.resetModules()
    const { CliAgentRunner: RealRunner } = await import('./cli-agent-runner.js')
    // Drive the script from a file, not `node -e "..."`: on Windows the runner spawns with shell:true
    // (for .cmd shims), and cmd.exe mangles the inner double-quotes of an -e script. A file path in
    // argv has no such quoting hazard, so this exercises the cwd-fallback logic cross-platform.
    const scriptFile = join(realpathSync(mkdtempSync(join(tmpdir(), 'cwd-test-'))), 'echo-ok.cjs')
    writeFileSync(scriptFile, 'process.stdout.write("ok")')
    const runner = new RealRunner({
      codex: { command: process.execPath, args: [scriptFile] },
    })
    const res = await runner.run({ agent: 'codex', prompt: '', timeoutMs: 10_000, cwd: '/no/such/dir/xyz-does-not-exist' })
    expect(res.ok).toBe(true)
    expect(res.output).toBe('ok')
  }, 15_000)
})
