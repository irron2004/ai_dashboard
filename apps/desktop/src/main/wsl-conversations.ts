import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { AgentIngestAdapter } from '@apc/agents'
import type { AgentType } from '@apc/shared'
import type { SshExecResult } from './ssh-exec.js'
import {
  fetchConversationsWithRunner,
  type BashScriptRunner,
} from './remote-conversations.js'

export type WslProjectTarget = { distro?: string; path: string }

/** Translate paths registered by Windows/Electron into the cwd recorded inside a WSL transcript. */
export function toWslProjectTarget(rawPath: string): WslProjectTarget | null {
  const trimmed = rawPath.trim()
  if (!trimmed || trimmed.startsWith('ssh://')) return null
  const normalized = trimmed.replace(/\\/g, '/')

  const unc = normalized.match(/^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(\/.*)?$/i)
  if (unc) return { distro: unc[1], path: unc[2] || '/' }

  const drive = normalized.match(/^([a-z]):(?:\/(.*))?$/i)
  if (drive) return { path: `/mnt/${drive[1].toLowerCase()}${drive[2] ? `/${drive[2]}` : ''}` }

  if (/^\/mnt\/[a-z](?:\/|$)/i.test(normalized)) return { path: normalized }
  return null
}

/** `wsl.exe --list --quiet` may arrive as UTF-16-ish text with NUL bytes when stdout is redirected. */
export function parseWslDistros(raw: string): string[] {
  const seen = new Set<string>()
  for (const rawLine of raw.replace(/\u0000/g, '').replace(/^\ufeff/, '').split(/\r?\n/)) {
    const name = rawLine.trim().replace(/^\*\s*/, '')
    if (!name || /^docker-desktop(?:-data)?$/i.test(name)) continue
    seen.add(name)
  }
  return [...seen]
}

function wslExecutable(): string {
  return process.platform === 'win32' && process.env.SystemRoot
    ? join(process.env.SystemRoot, 'System32', 'wsl.exe')
    : 'wsl.exe'
}

function runWslProcess(args: readonly string[], stdin: string | undefined, timeoutMs: number): Promise<SshExecResult> {
  return new Promise((resolve) => {
    const child = spawn(wslExecutable(), [...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: SshExecResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ ok: false, stdout, stderr: stderr || 'timeout', exitCode: null })
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => finish({ ok: false, stdout, stderr: stderr || String(error), exitCode: null }))
    child.on('close', (exitCode) => finish({ ok: exitCode === 0, stdout, stderr, exitCode }))
    try {
      if (stdin !== undefined) child.stdin.write(stdin)
      child.stdin.end()
    } catch (error) {
      finish({ ok: false, stdout, stderr: stderr || String(error), exitCode: null })
    }
  })
}

export async function listWslDistros(): Promise<string[]> {
  const result = await runWslProcess(['--list', '--quiet'], undefined, 15_000)
  if (!result.ok) throw new Error(result.stderr.trim() || 'WSL distribution discovery failed')
  return parseWslDistros(result.stdout)
}

export function runBashInWsl(distro: string): BashScriptRunner {
  return (script, timeoutMs) => runWslProcess(
    ['--distribution', distro, '--exec', 'bash', '-s'],
    script,
    timeoutMs,
  )
}

export type WslConversationDeps = {
  listDistros?: () => Promise<string[]>
  runBashFor?: (distro: string) => BashScriptRunner
  fetchWithRunner?: typeof fetchConversationsWithRunner
}

/** Fetch the selected agent's matching sessions from every user WSL distro into compact local copies. */
export async function fetchWslConversations(
  projectPath: string,
  destDir: string,
  agents?: readonly AgentType[],
  deps: WslConversationDeps = {},
): Promise<AgentIngestAdapter[]> {
  const target = toWslProjectTarget(projectPath)
  if (!target) return []

  const distros = target.distro
    ? [target.distro]
    : await (deps.listDistros ?? listWslDistros)()
  const runBashFor = deps.runBashFor ?? runBashInWsl
  const fetchWithRunner = deps.fetchWithRunner ?? fetchConversationsWithRunner
  const adapters: AgentIngestAdapter[] = []
  const failures: Error[] = []

  for (const distro of distros) {
    const safeDistro = distro.replace(/[^a-z0-9._-]+/gi, '_')
    try {
      adapters.push(...await fetchWithRunner(
        target.path,
        join(destDir, safeDistro),
        runBashFor(distro),
        agents,
      ))
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)))
    }
  }

  if (adapters.length === 0 && distros.length > 0 && failures.length === distros.length) {
    throw failures[0]
  }
  return adapters
}
