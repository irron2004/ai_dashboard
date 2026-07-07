import { execFile } from 'node:child_process'
import { isAbsolute, normalize } from 'node:path'
import type { GitFileChange, GitFileChangeStatus, GitSyncResult, GitSyncStatus } from '@apc/shared'

type GitRun = { code: number; stdout: string; stderr: string }
type GitError = Error & { code?: number; stdout?: string | Buffer; stderr?: string | Buffer }

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_EDITOR: ':',
  EDITOR: ':',
  VISUAL: '',
  GIT_SEQUENCE_EDITOR: ':',
  GIT_MERGE_AUTOEDIT: 'no',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
}

function compactOutput(result: Pick<GitRun, 'stdout' | 'stderr'>): string {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')
}

function commandFailed(args: string[], result: Pick<GitRun, 'stdout' | 'stderr' | 'code'>): string {
  const out = compactOutput(result)
  return `git ${args.join(' ')} failed${result.code === 0 ? '' : ` (${result.code})`}${out ? `: ${out}` : ''}`
}

function safePath(path: string): boolean {
  if (!path || path.includes('\0') || isAbsolute(path)) return false
  const normalized = normalize(path).replace(/\\/g, '/')
  return normalized !== '..' && !normalized.startsWith('../')
}

function statusFromXY(xy: string, fallback: GitFileChangeStatus): GitFileChangeStatus {
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'conflict'
  if (xy.includes('R')) return 'renamed'
  if (xy.includes('C')) return 'copied'
  if (xy.includes('D')) return 'deleted'
  if (xy.includes('A')) return 'added'
  return fallback
}

function pathField(record: string, fieldsBeforePath: number): string {
  return record.split(' ').slice(fieldsBeforePath).join(' ')
}

export function parseGitStatusPorcelainV2(stdout: string, repoPath = ''): GitSyncStatus {
  let branch: string | undefined
  let upstream: string | undefined
  let detached = false
  let ahead = 0
  let behind = 0
  const files: GitFileChange[] = []
  const records = stdout.split('\0').filter(Boolean)

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (record.startsWith('# branch.head ')) {
      const head = record.slice('# branch.head '.length)
      detached = head === '(detached)'
      branch = detached ? undefined : head
      continue
    }
    if (record.startsWith('# branch.upstream ')) {
      upstream = record.slice('# branch.upstream '.length)
      continue
    }
    if (record.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(record)
      if (match) {
        ahead = Number(match[1])
        behind = Number(match[2])
      }
      continue
    }
    if (record.startsWith('1 ')) {
      const xy = record.slice(2, 4)
      const path = pathField(record, 8)
      const status = statusFromXY(xy, 'modified')
      files.push({ path, status, staged: xy[0] !== '.', unstaged: xy[1] !== '.', conflict: status === 'conflict' })
      continue
    }
    if (record.startsWith('2 ')) {
      const xy = record.slice(2, 4)
      const path = pathField(record, 9)
      files.push({ path, status: statusFromXY(xy, 'renamed'), staged: xy[0] !== '.', unstaged: xy[1] !== '.', conflict: false })
      i++
      continue
    }
    if (record.startsWith('? ')) {
      files.push({ path: record.slice(2), status: 'untracked', staged: false, unstaged: true, conflict: false })
      continue
    }
    if (record.startsWith('u ')) {
      files.push({ path: pathField(record, 10), status: 'conflict', staged: true, unstaged: true, conflict: true })
    }
  }

  const warnings: string[] = []
  if (detached) warnings.push('detached HEAD 상태라 자동 push를 막았습니다')
  if (!upstream) warnings.push('upstream branch가 없어 push/pull 자동화를 막았습니다')
  if (files.some((file) => file.conflict)) warnings.push('충돌 파일이 있어 먼저 수동 해결이 필요합니다')

  return { ok: true, repoPath, branch, detached, upstream, ahead, behind, hasChanges: files.length > 0, files, warnings }
}

export class GitSyncService {
  constructor(private readonly timeoutMs = 30_000) {}

  private git(cwd: string, args: string[], timeoutMs = this.timeoutMs): Promise<GitRun> {
    return new Promise((resolve) => {
      execFile('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (!error) { resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) }); return }
        const err = error as GitError
        resolve({
          code: typeof err.code === 'number' ? err.code : 1,
          stdout: err.stdout?.toString() ?? String(stdout ?? ''),
          stderr: err.stderr?.toString() ?? String(stderr ?? err.message),
        })
      })
    })
  }

  async status(repoPath: string, opts: { fetch?: boolean } = {}): Promise<GitSyncStatus> {
    if (!repoPath) return { ok: false, reason: '등록된 repo 경로가 없습니다', detached: false, ahead: 0, behind: 0, hasChanges: false, files: [], warnings: [] }
    const root = await this.git(repoPath, ['rev-parse', '--show-toplevel'])
    if (root.code !== 0) return { ok: false, reason: commandFailed(['rev-parse', '--show-toplevel'], root), repoPath, detached: false, ahead: 0, behind: 0, hasChanges: false, files: [], warnings: [] }
    const cwd = root.stdout.trim()
    if (opts.fetch) await this.git(cwd, ['fetch', '--prune', '--no-tags'], 60_000)
    const status = await this.git(cwd, ['status', '--porcelain=v2', '--branch', '-z'])
    if (status.code !== 0) return { ok: false, reason: commandFailed(['status', '--porcelain=v2', '--branch', '-z'], status), repoPath: cwd, detached: false, ahead: 0, behind: 0, hasChanges: false, files: [], warnings: [] }
    return { ...parseGitStatusPorcelainV2(status.stdout, repoPath), root: cwd }
  }

  async fetch(repoPath: string): Promise<GitSyncResult> {
    const status = await this.status(repoPath)
    if (!status.ok || !status.root) return { ok: false, reason: status.reason, status }
    const fetched = await this.git(status.root, ['fetch', '--prune', '--no-tags'], 60_000)
    const next = await this.status(status.root)
    return fetched.code === 0
      ? { ok: true, output: compactOutput(fetched), status: next }
      : { ok: false, reason: commandFailed(['fetch', '--prune', '--no-tags'], fetched), output: compactOutput(fetched), status: next }
  }

  async pull(repoPath: string): Promise<GitSyncResult> {
    const fetched = await this.fetch(repoPath)
    const status = fetched.status
    if (!fetched.ok || !status?.ok || !status.root) return fetched
    if (status.detached) return { ok: false, reason: 'detached HEAD 상태에서는 pull 할 수 없습니다', status }
    if (!status.upstream) return { ok: false, reason: 'upstream branch가 없어 pull 할 수 없습니다', status }
    if (status.files.length > 0) return { ok: false, reason: 'working tree에 변경분이 있어 pull/rebase를 중단했습니다', status }
    if (status.behind === 0) return { ok: true, reason: '이미 최신 상태입니다', status }
    const args = status.ahead > 0 ? ['pull', '--rebase'] : ['pull', '--ff-only']
    const pulled = await this.git(status.root, args, 120_000)
    const next = await this.status(status.root)
    return pulled.code === 0
      ? { ok: true, output: compactOutput(pulled), status: next }
      : { ok: false, reason: commandFailed(args, pulled), output: compactOutput(pulled), status: next }
  }

  async commitPush(repoPath: string, files: string[], message: string): Promise<GitSyncResult> {
    const selected = [...new Set(files)].filter(Boolean)
    if (selected.length === 0) return { ok: false, reason: '커밋할 파일을 선택하세요' }
    if (!message.trim()) return { ok: false, reason: '커밋 메시지를 입력하세요' }
    const unsafe = selected.find((file) => !safePath(file))
    if (unsafe) return { ok: false, reason: `허용되지 않는 경로입니다: ${unsafe}` }

    const before = await this.status(repoPath)
    if (!before.ok || !before.root) return { ok: false, reason: before.reason, status: before }
    if (before.detached) return { ok: false, reason: 'detached HEAD 상태에서는 자동 push를 막았습니다', status: before }
    if (!before.upstream) return { ok: false, reason: 'upstream branch가 없어 push할 수 없습니다. 먼저 git push -u origin <branch>를 설정하세요.', status: before }
    if (before.files.some((file) => file.conflict)) return { ok: false, reason: '충돌 파일이 있어 커밋을 중단했습니다', status: before }
    const selectedSet = new Set(selected)
    const stagedElsewhere = before.files.find((file) => file.staged && !selectedSet.has(file.path))
    if (stagedElsewhere) return { ok: false, reason: `선택하지 않은 staged 파일이 있습니다: ${stagedElsewhere.path}`, status: before }

    const added = await this.git(before.root, ['add', '-A', '--', ...selected])
    if (added.code !== 0) return { ok: false, reason: commandFailed(['add', '-A', '--', ...selected], added), status: await this.status(before.root) }
    const staged = await this.git(before.root, ['diff', '--cached', '--name-only', '--', ...selected])
    if (staged.code !== 0) return { ok: false, reason: commandFailed(['diff', '--cached', '--name-only', '--', ...selected], staged), status: await this.status(before.root) }
    if (!staged.stdout.trim()) return { ok: false, reason: '선택한 파일에 staged 변경분이 없습니다', status: await this.status(before.root) }

    const committed = await this.git(before.root, ['commit', '-m', message.trim()], 120_000)
    if (committed.code !== 0) return { ok: false, reason: commandFailed(['commit', '-m', '<message>'], committed), output: compactOutput(committed), status: await this.status(before.root) }

    const fetched = await this.git(before.root, ['fetch', '--prune', '--no-tags'], 60_000)
    if (fetched.code !== 0) return { ok: false, reason: commandFailed(['fetch', '--prune', '--no-tags'], fetched), output: compactOutput(committed) + '\n' + compactOutput(fetched), status: await this.status(before.root) }

    let current = await this.status(before.root)
    let output = compactOutput(committed)
    if (current.behind > 0) {
      if (current.files.length > 0) return { ok: false, reason: '원격 변경이 있지만 아직 남은 로컬 변경분이 있어 rebase를 중단했습니다. 남은 변경분을 정리한 뒤 Pull/Push 하세요.', output, status: current }
      const rebased = await this.git(before.root, ['pull', '--rebase'], 120_000)
      output = [output, compactOutput(rebased)].filter(Boolean).join('\n')
      if (rebased.code !== 0) return { ok: false, reason: commandFailed(['pull', '--rebase'], rebased), output, status: await this.status(before.root) }
    }

    const pushed = await this.git(before.root, ['push'], 120_000)
    output = [output, compactOutput(pushed)].filter(Boolean).join('\n')
    const next = await this.status(before.root)
    return pushed.code === 0
      ? { ok: true, output, status: next }
      : { ok: false, reason: commandFailed(['push'], pushed), output, status: next }
  }
}
