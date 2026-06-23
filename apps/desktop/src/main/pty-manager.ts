// node-pty is an optionalDependency (native; rebuilt for the Electron ABI on the target
// machine). It is loaded lazily so the rest of the app works even when it is unavailable.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { parseSsh } from './ssh-exec.js'
import { resumeCommand, findLatestSession, adapterFor } from '@apc/agents'
import type { AgentKind } from '@apc/shared'

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

type ResumeDeps = {
  resolveResume?: (agent: AgentKind, cwd: string, sessionId?: string) => Promise<{ command: string; args: string[] }>
}

/**
 * Manages node-pty sessions keyed by id, streaming output to the renderer.
 * channels: emits `pty:data` (id, data) and `pty:exit` (id, exitCode).
 */
export class PtyManager {
  private readonly sessions = new Map<string, IPty>()
  private mod: PtyModule | null | undefined // null = load attempted, unavailable
  private readonly resolveResume: NonNullable<ResumeDeps['resolveResume']>

  constructor(private readonly send: SendFn, deps: ResumeDeps = {}) {
    this.resolveResume = deps.resolveResume ?? (async (agent, cwd, sessionId) => {
      if (sessionId) return resumeCommand(agent, { sessionId })
      const found = await findLatestSession(adapterFor(agent), cwd).catch(() => null)
      return resumeCommand(agent, { sessionId: found?.sessionId })
    })
  }

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

  async start(
    id: string, command: string, args: string[], cwd: string,
    opts: { resume?: boolean; agent?: AgentKind; sessionId?: string } = {},
  ): Promise<void> {
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
      spawnArgs = ['-t', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10', '-p', String(ssh.port), `${ssh.user}@${ssh.host}`, remoteCmd]
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
      let line = [command, ...args].filter(Boolean).join(' ').trim()
      if (opts.resume && opts.agent) {
        try {
          const r = await this.resolveResume(opts.agent, cwd, opts.sessionId)
          line = [r.command, ...r.args].join(' ').trim()
        } catch {
          this.send('pty:data', id, '[no prior session — fresh start]\r\n')
        }
      }
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
