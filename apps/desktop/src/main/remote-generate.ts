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

// Run a command through the remote user's INTERACTIVE LOGIN shell so their full PATH
// (npm global prefix, nvm, ~/.local/bin, etc.) is loaded — exactly what the user gets when
// they type the command themselves. The `-i` is essential: distro .bashrc files guard their
// PATH exports behind `case $- in *i*) ;; *) return;; esac`, so a non-interactive `-lc` shell
// returns early and never reaches lines like `export PATH=$HOME/.npm-global/bin:$PATH`
// (that's why codex/opencode resolved interactively but were "not found" from the app).
// We still source the rc files explicitly for setups where the login files don't chain to
// .bashrc. The prompt arrives on the engine's stdin; -c runs the command string, so stdin
// passes straight through to the engine. -i emits a harmless "no job control" line on stderr.
function loginShell(cmd: string): string {
  return `bash -lic 'source ~/.bashrc 2>/dev/null; source ~/.bash_profile 2>/dev/null; source ~/.profile 2>/dev/null; source ~/.zshrc 2>/dev/null; source ~/.zprofile 2>/dev/null; ${cmd.replace(/'/g, `'\\''`)}'`
}

// Headless engine command run on the remote (prompt arrives via stdin).
// codex refuses to run outside a trusted git repo unless --skip-git-repo-check is passed;
// we cd into the project dir below, but the flag keeps it working for non-repo projects too.
const ENGINE_CMD: Record<AgentType, string> = {
  claude: 'claude -p --output-format json',
  codex: 'codex exec --skip-git-repo-check',
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

  // 3. Run the engine CLI on the remote, inside the project dir, with the prompt on stdin.
  // cd into the repo so the agent has project context (and codex's git-repo trust check passes).
  const prompt = buildWikiPrompt(session, { currentCanonical })
  const cdPath = ssh.path.replace(/'/g, `'\\''`)
  const engineCmd = `cd '${cdPath}' && ${ENGINE_CMD[input.engine]}`
  const run = await exec(ssh, loginShell(engineCmd), { stdin: prompt, timeoutMs: 180000 })
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
