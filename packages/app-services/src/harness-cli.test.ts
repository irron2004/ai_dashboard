import { describe, expect, test } from 'vitest'
import { parseArgs, runCli, type HarnessCliPort } from './harness-cli.js'

describe('parseArgs', () => {
  test('parses run with project + engine', () => {
    expect(parseArgs(['run', '--project', 'p1', '--engine', 'claude'])).toEqual({ cmd: 'run', projectId: 'p1', engine: 'claude' })
  })
  test('rejects run without project or with a bad engine', () => {
    expect(parseArgs(['run', '--engine', 'claude']).cmd).toBe('error')
    expect(parseArgs(['run', '--project', 'p1', '--engine', 'gpt']).cmd).toBe('error')
  })
  test('parses resume positional runId', () => {
    expect(parseArgs(['resume', 'RUN-1'])).toEqual({ cmd: 'resume', runId: 'RUN-1' })
    expect(parseArgs(['resume']).cmd).toBe('error')
  })
  test('parses show / promote positional runId + --allow-secrets / --allow-invalid', () => {
    expect(parseArgs(['show', 'RUN-1'])).toEqual({ cmd: 'show', runId: 'RUN-1' })
    expect(parseArgs(['promote', 'RUN-1'])).toEqual({ cmd: 'promote', runId: 'RUN-1', allowSecrets: false, allowInvalid: false })
    expect(parseArgs(['promote', 'RUN-1', '--allow-secrets'])).toEqual({ cmd: 'promote', runId: 'RUN-1', allowSecrets: true, allowInvalid: false })
    expect(parseArgs(['promote', 'RUN-1', '--allow-invalid'])).toEqual({ cmd: 'promote', runId: 'RUN-1', allowSecrets: false, allowInvalid: true })
  })
  test('no args / help → help; unknown → error', () => {
    expect(parseArgs([]).cmd).toBe('help')
    expect(parseArgs(['help']).cmd).toBe('help')
    expect(parseArgs(['frobnicate']).cmd).toBe('error')
  })
})

describe('runCli', () => {
  const port: HarnessCliPort = {
    async run() { return { ok: true, runId: 'RUN-9', finalState: 'HUMAN_REVIEW_REQUIRED' } },
    async resume() { return { ok: true, runId: 'RUN-9', finalState: 'HUMAN_REVIEW_REQUIRED' } },
    show() { return { ok: true, runState: { state: 'HUMAN_REVIEW_REQUIRED' } } },
    promote() { return { ok: true, promoted: ['concepts/n1.md'], proposals: [] } },
  }
  const capture = () => { const lines: string[] = []; return { out: (l: string) => lines.push(l), lines } }

  test('run prints the run id + final state, exit 0', async () => {
    const c = capture()
    expect(await runCli(['run', '--project', 'p1', '--engine', 'claude'], port, c.out)).toBe(0)
    expect(c.lines.join('\n')).toContain('RUN-9 → HUMAN_REVIEW_REQUIRED')
  })
  test('promote prints a summary, exit 0', async () => {
    const c = capture()
    expect(await runCli(['promote', 'RUN-9'], port, c.out)).toBe(0)
    expect(c.lines.join('\n')).toContain('promoted 1 file(s)')
  })
  test('bad invocation prints usage with exit 2', async () => {
    const c = capture()
    expect(await runCli(['run'], port, c.out)).toBe(2)
    expect(c.lines.join('\n')).toContain('knowledge-harness')
  })
  test('a failing run yields exit 1 and prints the reason', async () => {
    const c = capture()
    const failing: HarnessCliPort = { ...port, async run() { return { ok: false, reason: 'boom' } } }
    expect(await runCli(['run', '--project', 'p', '--engine', 'codex'], failing, c.out)).toBe(1)
    expect(c.lines.join('\n')).toContain('boom')  // pins the reason-print, not just the exit code
  })
})
