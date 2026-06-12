import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'

export type ChangeStatus = 'new' | 'modified' | 'deleted'
export type ChangedFile = { path: string; status: ChangeStatus; isMarkdown: boolean; mtimeMs: number; unreflected?: boolean }
export type ChangesResult = { ok: boolean; files?: ChangedFile[]; reason?: string }
export type DiffResult = { ok: boolean; patch?: string; reason?: string }

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

export function listProjectChanges(repoPaths: readonly string[], latestIngestAt: string | null): ChangesResult {
  if (repoPaths.length === 0) return { ok: false, reason: '등록된 repo 경로가 없습니다' }
  const all: ChangedFile[] = []
  for (const repo of repoPaths) {
    let stdout: string
    try {
      stdout = execFileSync('git', ['status', '--porcelain=v1'], { cwd: repo, encoding: 'utf8', timeout: 15_000 })
    } catch (e) {
      return { ok: false, reason: `git 실패 (${repo}): ${(e as { stderr?: string }).stderr?.toString().trim() || String(e)}` }
    }
    for (const row of parsePorcelain(stdout)) {
      let mtimeMs = 0
      try { mtimeMs = statSync(join(repo, row.path)).mtimeMs } catch { /* 삭제된 파일 등 */ }
      all.push({ ...row, isMarkdown: /\.mdx?$/i.test(row.path), mtimeMs })
    }
  }
  return { ok: true, files: markUnreflected(all, latestIngestAt) }
}

export function diffProjectFile(repoPaths: readonly string[], relPath: string): DiffResult {
  for (const repo of repoPaths) {
    try { statSync(join(repo, relPath)) } catch { continue }
    // tracked 변경: HEAD 대비. untracked: --no-index로 /dev/null과 비교(차이가 있으면 exit 1 — 정상).
    try {
      const tracked = execFileSync('git', ['diff', 'HEAD', '--', relPath], { cwd: repo, encoding: 'utf8', timeout: 15_000 })
      if (tracked.trim()) return { ok: true, patch: tracked }
    } catch { /* HEAD 없음(빈 repo) 등 — untracked 경로로 폴백 */ }
    try {
      execFileSync('git', ['diff', '--no-index', '--', '/dev/null', relPath], { cwd: repo, encoding: 'utf8', timeout: 15_000 })
      return { ok: true, patch: '' }  // exit 0 = 차이 없음(빈 파일)
    } catch (e) {
      const out = (e as { stdout?: string | Buffer }).stdout?.toString()
      if (out) return { ok: true, patch: out }  // exit 1 + stdout = 정상 diff
      return { ok: false, reason: String(e) }
    }
  }
  return { ok: false, reason: `파일을 찾을 수 없음: ${relPath}` }
}
