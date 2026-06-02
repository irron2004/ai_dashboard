import { spawn } from 'node:child_process'
import { parseClaudeJsonl } from '@apc/agents'
import { buildWikiPrompt, parseStructured, unwrapAgentJson } from '@apc/llm-wiki'
import { WikiGenerationSchema, type AgentType, type WikiGeneration } from '@apc/shared'
import type { ProjectRegistry } from '@apc/core'
import type { VaultAdapter } from '@apc/vault'
import type { VaultWriter } from '@apc/pm'
import type { GenerateProjectRes } from '../shared/ipc-contract.js'

type SshTarget = { user: string; host: string; port: number; path: string }

function parseSsh(raw: string): SshTarget | null {
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
function sshExec(ssh: SshTarget, remoteCmd: string, opts: { stdin?: string; timeoutMs?: number } = {}): Promise<SshExecResult> {
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

// Run a command through the remote user's LOGIN shell so their PATH (nvm, ~/.local/bin, etc.)
// is loaded — a bare `ssh host "codex …"` runs non-login and won't find the CLI.
// We explicitly source the common rc files because some setups only configure PATH in
// .bashrc (not .bash_profile), and a plain -l shell won't read .bashrc.
function loginShell(cmd: string): string {
  return `bash -lc 'source ~/.bashrc 2>/dev/null; source ~/.bash_profile 2>/dev/null; source ~/.profile 2>/dev/null; source ~/.zshrc 2>/dev/null; source ~/.zprofile 2>/dev/null; ${cmd.replace(/'/g, `'\\''`)}'`
}

// Headless engine command run on the remote (prompt arrives via stdin).
const ENGINE_CMD: Record<AgentType, string> = {
  claude: 'claude -p --output-format json',
  codex: 'codex exec',
  opencode: 'opencode run',
}

export type RemoteGenerateDeps = {
  registry: ProjectRegistry
  vault: VaultAdapter
  vaultWriter: VaultWriter
  now?: () => string
  exec?: SshExec // override for tests; defaults to the real ssh subprocess
}

/**
 * Generate for an SSH project: read the latest remote Claude transcript over SSH, run the
 * chosen engine CLI ON THE REMOTE (prompt via stdin), and write the summary + current proposal
 * into the local vault.
 */
export async function generateRemote(deps: RemoteGenerateDeps, input: { projectId: string; engine: AgentType }): Promise<GenerateProjectRes> {
  const exec = deps.exec ?? sshExec
  const project = deps.registry.get(input.projectId)
  if (!project) return { ok: false, reason: 'project not found' }
  const ssh = parseSsh(project.repoPaths[0] ?? '')
  if (!ssh) return { ok: false, reason: 'not an ssh project' }

  // 1. Read the most-recent remote Claude transcript for the remote repo path.
  const encoded = ssh.path.replace(/\/+$/, '').replace(/\//g, '-') // /home/x/y -> -home-x-y (Claude's scheme)
  const read = await exec(ssh, `ls -t "$HOME/.claude/projects/${encoded}"/*.jsonl 2>/dev/null | head -1 | xargs -r cat`, { timeoutMs: 30000 })
  if (!read.ok) return { ok: false, reason: `ssh read failed: ${read.stderr.trim().slice(0, 200) || 'connection error'}` }
  if (!read.stdout.trim()) return { ok: false, reason: `no remote Claude session found under ${ssh.path}` }
  const session = parseClaudeJsonl(read.stdout, { id: `${ssh.host}:${ssh.path}` })

  // 2. Local canonical current.md (vault is local).
  let currentCanonical = ''
  try { currentCanonical = deps.vault.readDoc(`projects/${input.projectId}/current.md`).body } catch { /* none yet */ }

  // 3. Run the engine CLI on the remote with the prompt on stdin.
  const prompt = buildWikiPrompt(session, { currentCanonical })
  const run = await exec(ssh, loginShell(ENGINE_CMD[input.engine]), { stdin: prompt, timeoutMs: 180000 })
  if (!run.ok) return { ok: false, reason: `remote ${input.engine} failed: ${run.stderr.trim().slice(0, 300) || 'non-zero exit'}` }

  let generation: WikiGeneration
  try { generation = parseStructured(unwrapAgentJson(run.stdout, input.engine), WikiGenerationSchema) as WikiGeneration }
  catch (e) { return { ok: false, reason: `could not parse ${input.engine} output: ${e}` } }

  // 4. Write into the local vault.
  const stamp = (deps.now ?? (() => new Date().toISOString()))().replace(/[:.]/g, '-')
  const summaryPath = deps.vaultWriter.writeRunSummary(input.projectId, {
    runId: `gen-${stamp}`, taskId: session.id, agent: 'claude',
    summary: generation.workSummary, filesTouched: generation.filesTouched, openProblems: generation.openProblems,
  })
  let proposalPath: string | undefined
  if (generation.currentProposalMarkdown.trim()) proposalPath = deps.vaultWriter.writeCurrentProposal(input.projectId, generation.currentProposalMarkdown)
  return { ok: true, sessionId: session.id, summaryPath, proposalPath, generation }
}
