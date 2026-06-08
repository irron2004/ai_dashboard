import { spawn } from 'node:child_process'
import type { AgentType } from '@apc/shared'

export type SshTarget = { user: string; host: string; port: number; path: string }

/** Parse an ssh://user@host:port/remote/path project path, or null if not ssh. */
export function parseSsh(raw: string): SshTarget | null {
  if (!raw || !raw.startsWith('ssh://')) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'ssh:') return null
    return { user: decodeURIComponent(u.username) || 'root', host: u.hostname, port: u.port ? Number(u.port) : 22, path: decodeURIComponent(u.pathname) || '.' }
  } catch { return null }
}

export type SshExecResult = { ok: boolean; stdout: string; stderr: string }
export type SshExec = (ssh: SshTarget, remoteCmd: string, opts?: { stdin?: string; timeoutMs?: number }) => Promise<SshExecResult>

// Non-interactive ssh (BatchMode = key-auth only) running a remote command, optional stdin.
export function sshExec(ssh: SshTarget, remoteCmd: string, opts: { stdin?: string; timeoutMs?: number } = {}): Promise<SshExecResult> {
  return new Promise((resolve) => {
    const args = ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-p', String(ssh.port), `${ssh.user}@${ssh.host}`, remoteCmd]
    const child = spawn(process.platform === 'win32' ? 'ssh.exe' : 'ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ ok: false, stdout, stderr: stderr || 'timeout' }) }, opts.timeoutMs ?? 120000)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, stdout: '', stderr: String(e) }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, stdout, stderr }) })
    if (opts.stdin != null) { try { child.stdin?.write(opts.stdin); child.stdin?.end() } catch { /* gone */ } }
  })
}

// Run a command through the remote user's INTERACTIVE LOGIN shell so their full PATH
// (npm global prefix, nvm, ~/.local/bin, etc.) is loaded — exactly what the user gets when
// they type the command themselves. The `-i` is essential: distro .bashrc files guard their
// PATH exports behind `case $- in *i*) ;; *) return;; esac`, so a non-interactive `-lc` shell
// returns early and never reaches lines like `export PATH=$HOME/.npm-global/bin:$PATH`
// (that's why codex/opencode resolved interactively but were "not found" from the app).
// We still source the rc files explicitly for setups where the login files don't chain to
// .bashrc. The prompt arrives on the engine's stdin; -c runs the command string, so stdin
// passes straight through to the engine. -i emits a harmless "no job control" line on stderr.
export function loginShell(cmd: string): string {
  return `bash -lic 'source ~/.bashrc 2>/dev/null; source ~/.bash_profile 2>/dev/null; source ~/.profile 2>/dev/null; source ~/.zshrc 2>/dev/null; source ~/.zprofile 2>/dev/null; ${cmd.replace(/'/g, `'\\''`)}'`
}

// Headless engine command run on the remote (prompt arrives via stdin).
// codex refuses to run outside a trusted git repo unless --skip-git-repo-check is passed;
// we cd into the project dir below, but the flag keeps it working for non-repo projects too.
export const ENGINE_CMD: Record<AgentType, string> = {
  claude: 'claude -p --output-format json',
  codex: 'codex exec --skip-git-repo-check',
  opencode: 'opencode run',
}
