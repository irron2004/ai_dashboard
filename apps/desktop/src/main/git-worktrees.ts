import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitWorktreeDto, GitWorktreesRes } from '../shared/ipc-contract.js'

const execFileAsync = promisify(execFile)

type WorktreeFields = {
  path?: string
  head?: string
  branch?: string
  detached?: boolean
  locked?: string
  prunable?: string
}

/** Parse `git worktree list --porcelain`, whose entries are separated by blank lines. */
export function parseGitWorktreesPorcelain(raw: string): GitWorktreeDto[] {
  const entries: WorktreeFields[] = []
  let current: WorktreeFields = {}

  const finish = () => {
    if (current.path) entries.push(current)
    current = {}
  }

  for (const line of raw.replace(/\r\n/g, '\n').replace(/\0/g, '\n').split('\n')) {
    if (!line) { finish(); continue }
    if (line.startsWith('worktree ')) current.path = line.slice('worktree '.length)
    else if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length)
    else if (line.startsWith('branch ')) current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    else if (line === 'detached') current.detached = true
    else if (line === 'locked') current.locked = 'locked'
    else if (line.startsWith('locked ')) current.locked = line.slice('locked '.length)
    else if (line === 'prunable') current.prunable = 'prunable'
    else if (line.startsWith('prunable ')) current.prunable = line.slice('prunable '.length)
  }
  finish()

  return entries.map((entry, index) => ({
    path: entry.path!,
    branch: entry.branch ?? null,
    head: entry.head ?? '',
    detached: entry.detached ?? !entry.branch,
    isMain: index === 0,
    ...(entry.locked ? { locked: entry.locked } : {}),
    ...(entry.prunable ? { prunable: entry.prunable } : {}),
  }))
}

function fallbackWorktree(repoPath: string): GitWorktreeDto {
  const parts = repoPath.replace(/[\\/]+$/, '').split(/[\\/]/)
  return {
    path: repoPath,
    branch: parts.at(-1) || null,
    head: '',
    detached: false,
    isMain: true,
  }
}

/** Read the worktrees registered with the selected project's Git repository. */
export async function listGitWorktrees(repoPath: string): Promise<GitWorktreesRes> {
  if (!repoPath) return { ok: true, worktrees: [] }

  // Remote project terminals already receive an ssh:// cwd through their existing runner path. The
  // local Git executable cannot inspect that repository, so keep the registered root as one tab.
  if (repoPath.startsWith('ssh://')) {
    return { ok: true, worktrees: [fallbackWorktree(repoPath)], reason: 'SSH 프로젝트는 등록된 경로만 표시합니다.' }
  }

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', repoPath, 'worktree', 'list', '--porcelain', '-z'],
      { encoding: 'utf8', timeout: 8_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
    )
    const worktrees = parseGitWorktreesPorcelain(String(stdout))
    return { ok: true, worktrees: worktrees.length > 0 ? worktrees : [fallbackWorktree(repoPath)] }
  } catch (error) {
    // A project may intentionally point at a non-Git folder (Obsidian/hybrid). It is still a valid
    // terminal cwd, so degrade to a single workspace tab instead of hiding the agent dock.
    return {
      ok: false,
      worktrees: [fallbackWorktree(repoPath)],
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
