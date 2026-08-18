import { execFile } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type ChangeStatus = 'new' | 'modified' | 'deleted'
export type ChangedFile = {
  path: string
  status: ChangeStatus
  isMarkdown: boolean
  mtimeMs: number
  unreflected?: boolean
  additions?: number
  deletions?: number
  binary?: boolean
}
export type ChangesResult = { ok: boolean; files?: ChangedFile[]; reason?: string }
export type DiffResult = { ok: boolean; patch?: string; reason?: string }
export type ProjectChangesOptions = { signal?: AbortSignal }

const GIT_TIMEOUT_MS = 15_000
const GIT_MAX_BUFFER = 32 * 1024 * 1024

type GitCommandError = Error & { code?: number | string; stdout?: string | Buffer; stderr?: string | Buffer }
type GitCommandResult = { code: number | null; stdout: string; stderr: string; error?: GitCommandError }

function runGit(repo: string, args: readonly string[], signal?: AbortSignal): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    try {
      execFile('git', [...args], {
        cwd: repo,
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        signal,
      }, (error, stdout, stderr) => {
        const commandError = error as GitCommandError | null
        resolve({
          code: commandError == null
            ? 0
            : typeof commandError.code === 'number'
              ? commandError.code
              : null,
          stdout: String(stdout ?? commandError?.stdout ?? ''),
          stderr: String(stderr ?? commandError?.stderr ?? ''),
          ...(commandError ? { error: commandError } : {}),
        })
      })
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: '', error: error as GitCommandError })
    }
  })
}

function gitFailure(repo: string, result: GitCommandResult): string {
  const detail = result.stderr.trim() || result.error?.message || `exit code ${result.code ?? 'unknown'}`
  return `git 실패 (${repo}): ${detail}`
}

function unquote(p: string): string {
  return p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p
}

/** `git status --porcelain=v1` 출력 파싱. 리네임은 새 경로를 new로 취급. */
export function parsePorcelain(stdout: string): { path: string; status: ChangeStatus }[] {
  const rows: { path: string; status: ChangeStatus }[] = []
  for (const line of stdout.split('\n')) {
    if (line.length < 4) continue
    const xy = line.slice(0, 2)
    let rest = line.slice(3)
    let status: ChangeStatus
    if (xy === '??' || xy.includes('A')) status = 'new'
    else if (xy.includes('D')) status = 'deleted'
    else status = 'modified'
    if (xy.includes('R') || xy.includes('C')) {
      const arrow = rest.indexOf(' -> ')
      if (arrow >= 0) rest = rest.slice(arrow + 4)
      status = 'new' // 리네임/복사의 새 경로를 새 파일로 취급
    }
    rows.push({ path: unquote(rest), status })
  }
  return rows
}

export type NumstatEntry = { additions: number | null; deletions: number | null }

/** `git diff --numstat` output. Binary counts are `null`; renames are indexed by their new path. */
export function parseNumstat(stdout: string): Map<string, NumstatEntry> {
  const map = new Map<string, NumstatEntry>()
  for (const line of stdout.split('\n')) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (!match) continue
    let path = unquote(match[3])
    if (path.includes(' => ')) {
      path = path.includes('{')
        ? path.replace(/\{[^}]* => ([^}]*)\}/, '$1').replace(/\/\//g, '/')
        : path.slice(path.indexOf(' => ') + 4)
    }
    map.set(path, {
      additions: match[1] === '-' ? null : Number(match[1]),
      deletions: match[2] === '-' ? null : Number(match[2]),
    })
  }
  return map
}

const MAX_COUNT_BYTES = 2 * 1024 * 1024

/** Count lines in an untracked text file. Binary, oversized and unreadable files return `null`. */
export function countUntrackedAdditions(absPath: string): number | null {
  try {
    const size = statSync(absPath).size
    if (size === 0) return 0
    if (size > MAX_COUNT_BYTES) return null
    const buffer = readFileSync(absPath)
    if (buffer.includes(0)) return null
    let lines = 0
    for (const byte of buffer) if (byte === 10) lines++
    if (buffer[buffer.length - 1] !== 10) lines++
    return lines
  } catch {
    return null
  }
}

/** sqlite `datetime('now')`는 "YYYY-MM-DD HH:MM:SS"(UTC, 타임존 표기 없음) — 그대로 Date.parse하면
 *  로컬 시간으로 읽혀 어긋난다. 'T'+'Z'를 붙여 UTC로 고정 파싱한다. */
function parseSqliteUtc(at: string): number {
  return Date.parse(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`)
}

export function markUnreflected<T extends { isMarkdown: boolean; mtimeMs: number }>(
  files: T[],
  latestIngestAt: string | null,
): (T & { unreflected: boolean })[] {
  const cutoff = latestIngestAt ? parseSqliteUtc(latestIngestAt) : null
  return files.map((f) => ({ ...f, unreflected: f.isMarkdown && (cutoff === null || f.mtimeMs > cutoff) }))
}

export async function listProjectChanges(
  repoPaths: readonly string[],
  latestIngestAt: string | null,
  options: ProjectChangesOptions = {},
): Promise<ChangesResult> {
  if (repoPaths.length === 0) return { ok: false, reason: '등록된 repo 경로가 없습니다' }
  const all: ChangedFile[] = []
  for (const repo of repoPaths) {
    const status = await runGit(repo, ['status', '--porcelain=v1'], options.signal)
    if (options.signal?.aborted) return { ok: false, reason: 'git 요청이 취소됐습니다' }
    if (status.code !== 0) return { ok: false, reason: gitFailure(repo, status) }
    let numstat = new Map<string, NumstatEntry>()
    const statsResult = await runGit(repo, ['diff', 'HEAD', '--numstat', '--find-renames'], options.signal)
    if (options.signal?.aborted) return { ok: false, reason: 'git 요청이 취소됐습니다' }
    if (statsResult.code === 0) numstat = parseNumstat(statsResult.stdout)
    // HEAD가 없는 빈 repo여도 untracked 목록은 계속 제공한다.
    for (const row of parsePorcelain(status.stdout)) {
      let mtimeMs = 0
      try { mtimeMs = statSync(join(repo, row.path)).mtimeMs } catch { /* 삭제된 파일 등 */ }
      const stats = numstat.get(row.path)
      let additions: number | undefined
      let deletions: number | undefined
      let binary: boolean | undefined
      if (stats) {
        if (stats.additions === null || stats.deletions === null) binary = true
        else { additions = stats.additions; deletions = stats.deletions }
      } else if (row.status === 'new') {
        const counted = countUntrackedAdditions(join(repo, row.path))
        if (counted === null) binary = true
        else { additions = counted; deletions = 0 }
      }
      all.push({ ...row, isMarkdown: /\.mdx?$/i.test(row.path), mtimeMs, additions, deletions, binary })
    }
  }
  return { ok: true, files: markUnreflected(all, latestIngestAt) }
}

export async function diffProjectFile(
  repoPaths: readonly string[],
  relPath: string,
  options: ProjectChangesOptions = {},
): Promise<DiffResult> {
  for (const repo of repoPaths) {
    // Try tracked content first: deleted files no longer exist on disk but still have a HEAD diff.
    const tracked = await runGit(repo, ['diff', 'HEAD', '--', relPath], options.signal)
    if (options.signal?.aborted) return { ok: false, reason: 'git 요청이 취소됐습니다' }
    if (tracked.code === 0 && tracked.stdout.trim()) return { ok: true, patch: tracked.stdout }
    // HEAD 없음(빈 repo) 등 — untracked 경로로 폴백
    // Untracked fallback only applies when the file exists in this repository.
    try { statSync(join(repo, relPath)) } catch { continue }
    // Git for Windows maps the literal '/dev/null' to the NUL device internally, so this is portable.
    const untracked = await runGit(repo, ['diff', '--no-index', '--', '/dev/null', relPath], options.signal)
    if (options.signal?.aborted) return { ok: false, reason: 'git 요청이 취소됐습니다' }
    if (untracked.code === 0) return { ok: true, patch: '' } // exit 0 = 차이 없음(빈 파일)
    if (untracked.code === 1 && untracked.stdout) return { ok: true, patch: untracked.stdout }
    return { ok: false, reason: gitFailure(repo, untracked) }
  }
  return { ok: false, reason: `파일을 찾을 수 없음: ${relPath}` }
}
