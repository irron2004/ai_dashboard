// node-pty is an optionalDependency (native; rebuilt for the Electron ABI on the target
// machine). It is loaded lazily so the rest of the app works even when it is unavailable.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

type IPty = {
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(data: string): void
  kill(): void
  resize(cols: number, rows: number): void
}
type PtyModule = {
  spawn(file: string, args: string[], opts: Record<string, unknown>): IPty
}

export type SendFn = (channel: string, ...args: unknown[]) => void

type SshTarget = { user: string; host: string; port: number; path: string }

/** Parse an ssh://user@host:port/remote/path project path, or null if not ssh. */
function parseSsh(raw: string): SshTarget | null {
  if (!raw || !raw.startsWith('ssh://')) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'ssh:') return null
    return {
      user: decodeURIComponent(u.username) || 'root',
      host: u.hostname,
      port: u.port ? Number(u.port) : 22,
      path: decodeURIComponent(u.pathname) || '.',
    }
  } catch {
    return null
  }
}

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
    // SSH project (cwd is an ssh:// URL) → connect to the remote and open an interactive
    // shell in the remote folder. node-pty gives ssh a real PTY, so password prompts work
    // in the terminal. Otherwise spawn the local OS shell in a valid cwd.
    const ssh = parseSsh(cwd)
    let file: string
    let spawnArgs: string[]
    let spawnCwd: string
    if (ssh) {
      file = process.platform === 'win32' ? 'ssh.exe' : 'ssh'
      const remotePath = ssh.path.replace(/'/g, "'\\''")
      const remoteCmd = `cd '${remotePath}' 2>/dev/null; exec "\${SHELL:-bash}" -l`
      spawnArgs = ['-t', '-o', 'StrictHostKeyChecking=accept-new', '-p', String(ssh.port), `${ssh.user}@${ssh.host}`, remoteCmd]
      spawnCwd = homedir()
    } else {
      file = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/bash')
      spawnArgs = []
      spawnCwd = cwd && existsSync(cwd) ? cwd : homedir()
    }

    // Clean up any lingering session with the same id before spawning a new one
    const existing = this.sessions.get(id)
    if (existing) { try { existing.kill() } catch { /* ignore */ } this.sessions.delete(id) }

    try {
      const p = pty.spawn(file, spawnArgs, {
        name: 'xterm-color', cols: 120, rows: 30, cwd: spawnCwd, env: process.env,
      })
      this.sessions.set(id, p)
      p.onData((data) => this.send('pty:data', id, data))
      p.onExit(({ exitCode }) => {
        this.send('pty:exit', id, exitCode)
        this.sessions.delete(id)
      })
      // Auto-run the agent command in each pane (Enter included). Local fires quickly;
      // SSH waits longer so the command lands at the remote shell prompt (key-auth) rather
      // than mid-connect. (Password-auth hosts: clear the line and retype after authenticating.)
      const line = [command, ...args].filter(Boolean).join(' ').trim()
      if (line) {
        setTimeout(() => { try { p.write(line + '\r') } catch { /* shell closed */ } }, ssh ? 1500 : 500)
      }
    } catch (e) {
      this.send('pty:data', id, `[PTY spawn failed: ${e}]\r\n`)
      this.send('pty:exit', id, 1)
    }
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.resize(cols, rows)
  }

  kill(id: string): void {
    this.sessions.get(id)?.kill()
    this.sessions.delete(id)
  }
}
