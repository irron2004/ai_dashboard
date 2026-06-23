import { describe, test, expect, vi } from 'vitest'
import { PtyManager } from './pty-manager.js'

// node-pty를 가짜로 — spawn 인자를 캡처
vi.mock('@homebridge/node-pty-prebuilt-multiarch', () => {
  const spawn = vi.fn(() => ({ onData() {}, onExit() {}, write() {}, kill() {}, resize() {} }))
  return { spawn, __spawn: spawn }
})

describe('PtyManager resume', () => {
  test('resume=true uses resolveResume to build the launched line', async () => {
    const resolveResume = vi.fn(async () => ({ command: 'claude', args: ['--resume', 'sid'] }))
    const writes: string[] = []
    const pm = new PtyManager(() => {}, { resolveResume })
    // start의 자동 입력 라인을 가로채기 위해 write를 감시: 가짜 pty.write 캡처
    const mod = await import('@homebridge/node-pty-prebuilt-multiarch') as any
    mod.__spawn.mockImplementation(() => ({
      onData() {}, onExit() {}, kill() {}, resize() {},
      write: (d: string) => writes.push(d),
    }))
    await pm.start('p1:claude', 'claude', [], '/repo/a', { resume: true, agent: 'claude' })
    expect(resolveResume).toHaveBeenCalledWith('claude', '/repo/a')
    // 셸에 타이핑되는 라인이 resume 명령이어야 한다
    await new Promise((r) => setTimeout(r, 700))
    expect(writes.join('')).toContain('claude --resume sid')
  })
})
