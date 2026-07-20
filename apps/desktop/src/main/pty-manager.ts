// node-pty is an optionalDependency (native; rebuilt for the Electron ABI on the target machine).
// It is loaded lazily so the rest of the app works even when it is unavailable.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { parseSsh } from './ssh-exec.js'
import { resumeCommand, findLatestSession, adapterFor } from '@apc/agents'
import type { AgentKind, AgentPaneIdentity } from '@apc/shared'
import { CH } from '../shared/ipc-contract.js'
import type { AgentRuntimeCoordinatorEvent } from './agent-runtime-coordinator.js'

export type IPtyLike = {
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(data: string): void
  kill(): void
  resize(cols: number, rows: number): void
}

export type PtyModuleLike = {
  spawn(file: string, args: string[], opts: Record<string, unknown>): IPtyLike
}

export type SendFn = (channel: string, ...args: unknown[]) => void

export const PTY_INPUT_MAX_BYTES = 1024 * 1024
export const PTY_MIN_COLS = 2
export const PTY_MAX_COLS = 500
export const PTY_MIN_ROWS = 1
export const PTY_MAX_ROWS = 300

export type PtyGuardResult = { ok: true } | { ok: false; reason: string }

export function validatePtyInput(data: unknown): PtyGuardResult {
  if (typeof data !== 'string') return { ok: false, reason: 'invalid-input' }
  if (Buffer.byteLength(data, 'utf8') > PTY_INPUT_MAX_BYTES) return { ok: false, reason: 'input-too-large' }
  return { ok: true }
}

export function validatePtyResize(cols: unknown, rows: unknown): PtyGuardResult {
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return { ok: false, reason: 'invalid-resize' }
  if ((cols as number) < PTY_MIN_COLS || (cols as number) > PTY_MAX_COLS) return { ok: false, reason: 'cols-out-of-range' }
  if ((rows as number) < PTY_MIN_ROWS || (rows as number) > PTY_MAX_ROWS) return { ok: false, reason: 'rows-out-of-range' }
  return { ok: true }
}

type ResumeDeps = {
  resolveResume?: (agent: AgentKind, cwd: string, sessionId?: string) => Promise<{ command: string; args: string[] }>
  loadPty?: () => Promise<PtyModuleLike | null>
  schedule?: (callback: () => void, delayMs: number) => unknown
  onLifecycle?: (event: AgentRuntimeCoordinatorEvent) => void
}

export type PtyStartOptions = {
  resume?: boolean
  agent?: AgentKind
  sessionId?: string
  pane?: AgentPaneIdentity
  launchId?: string
}

type ManagedPty = {
  launchId: string
  pty: IPtyLike
  pane?: AgentPaneIdentity
  remote: boolean
  killReason?: 'user' | 'restart' | 'unmount' | 'quit'
  stopEmitted: boolean
}

/**
 * Manages node-pty sessions keyed by pane id. Every callback closes over its launchId and must still
 * match latestLaunch before it may emit or delete, eliminating old-launch data/exit races.
 */
export class PtyManager {
  private readonly sessions = new Map<string, ManagedPty>()
  private readonly latestLaunch = new Map<string, string>()
  private mod: PtyModuleLike | null | undefined
  private legacySequence = 0
  private readonly resolveResume: NonNullable<ResumeDeps['resolveResume']>
  private readonly customLoadPty?: ResumeDeps['loadPty']
  private readonly schedule: NonNullable<ResumeDeps['schedule']>
  private readonly onLifecycle: NonNullable<ResumeDeps['onLifecycle']>

  constructor(private readonly send: SendFn, deps: ResumeDeps = {}) {
    this.resolveResume = deps.resolveResume ?? (async (agent, cwd, sessionId) => {
      if (sessionId) return resumeCommand(agent, { sessionId })
      const found = await findLatestSession(adapterFor(agent), cwd).catch(() => null)
      return resumeCommand(agent, { sessionId: found?.sessionId })
    })
    this.customLoadPty = deps.loadPty
    this.schedule = deps.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.onLifecycle = deps.onLifecycle ?? (() => {})
  }

  private async load(): Promise<PtyModuleLike | null> {
    if (this.customLoadPty) return this.customLoadPty()
    if (this.mod === null) return null
    if (this.mod) return this.mod
    try {
      this.mod = (await import('@homebridge/node-pty-prebuilt-multiarch')) as unknown as PtyModuleLike
      return this.mod
    } catch {
      this.mod = null
      return null
    }
  }

  async start(
    id: string,
    command: string,
    args: string[],
    cwd: string,
    opts: PtyStartOptions = {},
  ): Promise<string> {
    const launchId = opts.launchId ?? `legacy:${id}:${++this.legacySequence}`
    this.latestLaunch.set(id, launchId)
    if (opts.pane) this.onLifecycle({ type: 'start', pane: opts.pane, launchId })

    const pty = await this.load()
    if (this.latestLaunch.get(id) !== launchId) return launchId
    if (!pty) {
      this.emitData(id, launchId, '[node-pty unavailable — native module not loaded]\r\n')
      this.emitExit(id, launchId, 1, 'node-pty-unavailable')
      if (opts.pane) this.onLifecycle({ type: 'error', paneId: opts.pane.paneId, launchId, reason: 'node-pty-unavailable', exitCode: 1 })
      return launchId
    }

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

    const existing = this.sessions.get(id)
    if (existing) {
      existing.killReason = 'restart'
      if (!existing.stopEmitted && existing.pane) {
        existing.stopEmitted = true
        this.onLifecycle({ type: 'stop', paneId: existing.pane.paneId, launchId: existing.launchId, reason: 'restart' })
      }
      try { existing.pty.kill() } catch { /* already closed */ }
      if (this.sessions.get(id) === existing) this.sessions.delete(id)
    }

    try {
      const child = pty.spawn(file, spawnArgs, {
        name: 'xterm-256color', cols: 120, rows: 30, cwd: spawnCwd, env: process.env,
      })
      if (this.latestLaunch.get(id) !== launchId) {
        try { child.kill() } catch { /* superseded during spawn */ }
        return launchId
      }
      const managed: ManagedPty = {
        launchId,
        pty: child,
        pane: opts.pane,
        remote: Boolean(ssh),
        stopEmitted: false,
      }
      this.sessions.set(id, managed)
      if (opts.pane) this.onLifecycle({ type: 'spawn', paneId: opts.pane.paneId, launchId, sessionId: opts.sessionId })

      child.onData((data) => {
        if (!this.isCurrent(id, managed)) return
        this.emitData(id, launchId, data)
        if (managed.pane) this.onLifecycle({ type: 'output', paneId: managed.pane.paneId, launchId })
      })
      child.onExit(({ exitCode }) => {
        if (this.latestLaunch.get(id) !== launchId) return
        const reason = managed.killReason ?? (managed.remote ? 'transport-closed' : 'process-exited')
        this.emitExit(id, launchId, exitCode, reason)
        if (managed.pane && !managed.stopEmitted) {
          this.onLifecycle(managed.remote
            ? { type: 'disconnect', paneId: managed.pane.paneId, launchId, reason, exitCode }
            : { type: 'exit', paneId: managed.pane.paneId, launchId, reason, exitCode })
        }
        if (this.sessions.get(id) === managed) this.sessions.delete(id)
      })

      let line = [command, ...args].filter(Boolean).join(' ').trim()
      if (opts.resume && opts.agent) {
        try {
          const resumed = await this.resolveResume(opts.agent, cwd, opts.sessionId)
          line = [resumed.command, ...resumed.args].join(' ').trim()
        } catch {
          if (this.isCurrent(id, managed)) this.emitData(id, launchId, '[no prior session — fresh start]\r\n')
        }
      }
      if (line) {
        this.schedule(() => {
          if (!this.isCurrent(id, managed)) return
          try { child.write(line + '\r') } catch { /* shell closed */ }
        }, ssh ? 1500 : 500)
      }
    } catch (error) {
      if (this.latestLaunch.get(id) !== launchId) return launchId
      const reason = error instanceof Error ? error.message : String(error)
      this.emitData(id, launchId, `[PTY spawn failed: ${reason}]\r\n`)
      this.emitExit(id, launchId, 1, 'spawn-failed')
      if (opts.pane) this.onLifecycle({ type: 'error', paneId: opts.pane.paneId, launchId, reason, exitCode: 1 })
    }
    return launchId
  }

  write(id: string, data: string, launchId?: string): boolean {
    if (!validatePtyInput(data).ok) return false
    const managed = this.sessions.get(id)
    if (!managed || (launchId && managed.launchId !== launchId)) return false
    managed.pty.write(data)
    return true
  }

  resize(id: string, cols: number, rows: number, launchId?: string): boolean {
    if (!validatePtyResize(cols, rows).ok) return false
    const managed = this.sessions.get(id)
    if (!managed || (launchId && managed.launchId !== launchId)) return false
    managed.pty.resize(cols, rows)
    return true
  }

  kill(
    id: string,
    launchId?: string,
    reason: 'user' | 'restart' | 'unmount' | 'quit' = 'user',
  ): boolean {
    const managed = this.sessions.get(id)
    if (!managed || (launchId && managed.launchId !== launchId)) return false
    managed.killReason = reason
    if (!managed.stopEmitted && managed.pane) {
      managed.stopEmitted = true
      this.onLifecycle({ type: 'stop', paneId: managed.pane.paneId, launchId: managed.launchId, reason })
    }
    try { managed.pty.kill() } finally {
      if (this.sessions.get(id) === managed) this.sessions.delete(id)
    }
    return true
  }

  currentLaunchId(id: string): string | undefined {
    return this.sessions.get(id)?.launchId
  }

  private isCurrent(id: string, managed: ManagedPty): boolean {
    return this.latestLaunch.get(id) === managed.launchId && this.sessions.get(id) === managed
  }

  private emitData(id: string, launchId: string, data: string): void {
    this.send(CH.ptyData, id, data)
    this.send(CH.ptyDataV2, { id, launchId, data })
  }

  private emitExit(id: string, launchId: string, code: number, reason?: string): void {
    this.send(CH.ptyExit, id, code)
    this.send(CH.ptyExitV2, { id, launchId, code, reason })
  }
}
