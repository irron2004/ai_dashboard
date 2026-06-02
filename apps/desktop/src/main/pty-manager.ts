// node-pty is an optionalDependency (native; rebuilt for the Electron ABI on the target
// machine). It is loaded lazily so the rest of the app works even when it is unavailable.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

type IPty = {
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(data: string): void
  kill(): void
}
type PtyModule = {
  spawn(file: string, args: string[], opts: Record<string, unknown>): IPty
}

export type SendFn = (channel: string, ...args: unknown[]) => void

/**
 * Manages node-pty sessions keyed by id, streaming output to the renderer.
 * channels: emits `pty:data` (id, data) and `pty:exit` (id, exitCode).
 */
export class PtyManager {
  private readonly sessions = new Map<string, IPty>()
  private mod: PtyModule | null | undefined // null = load attempted, unavailable

  constructor(private readonly send: SendFn) {}

  private async load(): Promise<PtyModule | null> {
    if (this.mod === null) return null // already failed
    if (this.mod) return this.mod
    try {
      this.mod = (await import('@homebridge/node-pty-prebuilt-multiarch')) as unknown as PtyModule
      return this.mod
    } catch {
      this.mod = null
      return null
    }
  }

  async start(id: string, command: string, args: string[], cwd: string): Promise<void> {
    const pty = await this.load()
    if (!pty) {
      this.send('pty:data', id, '[node-pty unavailable — native module not loaded]\r\n')
      this.send('pty:exit', id, 1)
      return
    }
    // Spawn the OS shell (always exists) in a valid cwd, then auto-type the agent command.
    // This handles Windows .cmd shims (PATH/PATHEXT resolution) and shows an error in-shell
    // instead of crashing when the agent isn't installed or cwd is invalid (e.g. an ssh:// path).
    const shell = process.platform === 'win32'
      ? (process.env.ComSpec || 'cmd.exe')
      : (process.env.SHELL || '/bin/bash')
    const safeCwd = cwd && existsSync(cwd) ? cwd : homedir()
    try {
      const p = pty.spawn(shell, [], {
        name: 'xterm-color', cols: 120, rows: 30, cwd: safeCwd, env: process.env,
      })
      this.sessions.set(id, p)
      p.onData((data) => this.send('pty:data', id, data))
      p.onExit(({ exitCode }) => {
        this.send('pty:exit', id, exitCode)
        this.sessions.delete(id)
      })
      const line = [command, ...args].filter(Boolean).join(' ').trim()
      if (line) setTimeout(() => { try { p.write(line + '\r') } catch { /* shell closed */ } }, 500)
    } catch (e) {
      this.send('pty:data', id, `[PTY spawn failed: ${e}]\r\n`)
      this.send('pty:exit', id, 1)
    }
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data)
  }

  kill(id: string): void {
    this.sessions.get(id)?.kill()
    this.sessions.delete(id)
  }
}
