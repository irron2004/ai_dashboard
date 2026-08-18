import { describe, expect, test, vi } from 'vitest'
import type { AgentPaneIdentity } from '@apc/shared'
import { CH } from '../shared/ipc-contract.js'
import {
  PTY_INPUT_MAX_BYTES,
  PtyManager,
  validatePtyInput,
  validatePtyResize,
  type IPtyLike,
} from './pty-manager.js'

class FakePty implements IPtyLike {
  private dataCallback: (data: string) => void = () => {}
  private exitCallback: (event: { exitCode: number }) => void = () => {}
  readonly writes: string[] = []
  readonly resizes: Array<[number, number]> = []
  kills = 0

  onData(callback: (data: string) => void): void { this.dataCallback = callback }
  onExit(callback: (event: { exitCode: number }) => void): void { this.exitCallback = callback }
  write(data: string): void { this.writes.push(data) }
  kill(): void { this.kills += 1 }
  resize(cols: number, rows: number): void { this.resizes.push([cols, rows]) }
  data(value: string): void { this.dataCallback(value) }
  exit(exitCode: number): void { this.exitCallback({ exitCode }) }
}

const pane: AgentPaneIdentity = {
  paneId: 'pane-1', projectId: 'p1', worktreePath: '/repo', slotId: 'codex-1', agent: 'codex',
}

describe('PtyManager launch lifecycle', () => {
  test('late data and exit from an old launch cannot emit, delete, write, resize, or kill the current launch', async () => {
    const children: FakePty[] = []
    const send = vi.fn()
    const lifecycle = vi.fn()
    const manager = new PtyManager(send, {
      loadPty: async () => ({ spawn: () => { const child = new FakePty(); children.push(child); return child } }),
      schedule: () => undefined,
      onLifecycle: lifecycle,
    })

    await manager.start('pane-1', '', [], '/repo', { pane, launchId: 'L1' })
    children[0].data('first')
    expect(send).toHaveBeenCalledWith(CH.ptyDataV2, { id: 'pane-1', launchId: 'L1', data: 'first' })

    send.mockClear()
    await manager.start('pane-1', '', [], '/repo', { pane, launchId: 'L2' })
    expect(children[0].kills).toBe(1)
    children[0].data('late-old-data')
    children[0].exit(99)
    expect(send).not.toHaveBeenCalled()
    expect(manager.currentLaunchId('pane-1')).toBe('L2')

    expect(manager.write('pane-1', 'old', 'L1')).toBe(false)
    expect(manager.resize('pane-1', 80, 24, 'L1')).toBe(false)
    expect(manager.kill('pane-1', 'L1')).toBe(false)
    expect(manager.write('pane-1', 'current', 'L2')).toBe(true)
    expect(manager.resize('pane-1', 100, 40, 'L2')).toBe(true)
    expect(children[1].writes).toEqual(['current'])
    expect(children[1].resizes).toEqual([[100, 40]])

    children[1].data('new-data')
    children[1].exit(0)
    expect(send).toHaveBeenCalledWith(CH.ptyDataV2, { id: 'pane-1', launchId: 'L2', data: 'new-data' })
    expect(send).toHaveBeenCalledWith(CH.ptyExitV2, {
      id: 'pane-1', launchId: 'L2', code: 0, reason: 'process-exited',
    })
    expect(manager.currentLaunchId('pane-1')).toBeUndefined()
    expect(lifecycle).toHaveBeenCalledWith({ type: 'exit', paneId: 'pane-1', launchId: 'L2', reason: 'process-exited', exitCode: 0 })
  })

  test('intentional kill reports its reason once and tags the v2 exit', async () => {
    const child = new FakePty()
    const send = vi.fn()
    const lifecycle = vi.fn()
    const manager = new PtyManager(send, {
      loadPty: async () => ({ spawn: () => child }),
      schedule: () => undefined,
      onLifecycle: lifecycle,
    })
    await manager.start('pane-1', '', [], '/repo', { pane, launchId: 'L1' })
    expect(manager.kill('pane-1', 'L1', 'unmount')).toBe(true)
    child.exit(0)

    expect(lifecycle).toHaveBeenCalledWith({ type: 'stop', paneId: 'pane-1', launchId: 'L1', reason: 'unmount' })
    expect(lifecycle.mock.calls.filter(([event]) => event.type === 'stop')).toHaveLength(1)
    expect(send).toHaveBeenCalledWith(CH.ptyExitV2, { id: 'pane-1', launchId: 'L1', code: 0, reason: 'unmount' })
  })

  test('spawn failure emits an error fact and versioned terminal events', async () => {
    const send = vi.fn()
    const lifecycle = vi.fn()
    const manager = new PtyManager(send, {
      loadPty: async () => ({ spawn: () => { throw new Error('spawn denied') } }),
      onLifecycle: lifecycle,
    })
    await manager.start('pane-1', '', [], '/repo', { pane, launchId: 'L1' })
    expect(lifecycle).toHaveBeenLastCalledWith({
      type: 'error', paneId: 'pane-1', launchId: 'L1', reason: 'spawn denied', exitCode: 1,
    })
    expect(send).toHaveBeenCalledWith(CH.ptyExitV2, { id: 'pane-1', launchId: 'L1', code: 1, reason: 'spawn-failed' })
  })

  test('kills every live pane for a deleted project and invalidates a start still loading', async () => {
    let resolveLoad: ((module: { spawn: () => FakePty }) => void) | undefined
    const delayed = new Promise<{ spawn: () => FakePty }>((resolve) => { resolveLoad = resolve })
    const manager = new PtyManager(vi.fn(), {
      loadPty: () => delayed,
      onLifecycle: vi.fn(),
    })
    const starting = manager.start('pane-1', '', [], '/repo', { pane, launchId: 'L1' })

    expect(manager.kill('pane-1', 'L1', 'unmount')).toBe(true)
    const child = new FakePty()
    resolveLoad?.({ spawn: () => child })
    await starting
    expect(manager.currentLaunchId('pane-1')).toBeUndefined()
    expect(child.kills).toBe(0)

    const p1 = new FakePty()
    const p2 = new FakePty()
    const children = [p1, p2]
    const live = new PtyManager(vi.fn(), {
      loadPty: async () => ({ spawn: () => children.shift()! }),
      onLifecycle: vi.fn(),
    })
    await live.start('p1-pane', '', [], '/repo', { pane: { ...pane, paneId: 'p1-pane' }, launchId: 'P1' })
    await live.start('p2-pane', '', [], '/repo', {
      pane: { ...pane, paneId: 'p2-pane', projectId: 'p2' }, launchId: 'P2',
    })

    expect(live.killProject('p1')).toBe(1)
    expect(p1.kills).toBe(1)
    expect(p2.kills).toBe(0)
    expect(live.currentLaunchId('p2-pane')).toBe('P2')
  })
})

describe('PTY payload guards', () => {
  test('bounds input by UTF-8 bytes without changing valid data', () => {
    expect(validatePtyInput('한글\nC:\\repo')).toEqual({ ok: true })
    expect(validatePtyInput(42)).toEqual({ ok: false, reason: 'invalid-input' })
    expect(validatePtyInput('a'.repeat(PTY_INPUT_MAX_BYTES + 1))).toEqual({ ok: false, reason: 'input-too-large' })
  })

  test('accepts only integer terminal dimensions inside safe bounds', () => {
    expect(validatePtyResize(80, 24)).toEqual({ ok: true })
    expect(validatePtyResize(80.5, 24)).toEqual({ ok: false, reason: 'invalid-resize' })
    expect(validatePtyResize(1, 24)).toEqual({ ok: false, reason: 'cols-out-of-range' })
    expect(validatePtyResize(80, 301)).toEqual({ ok: false, reason: 'rows-out-of-range' })
  })
})
