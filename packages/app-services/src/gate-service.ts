import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, dirname, resolve } from 'node:path'
import { runGit } from './git-sync-service.js'

export type GateStatus = {
  ok: boolean
  reason?: string
  enabled: boolean
  hookInstalled: boolean
  headSha: string | null
  headCovered: boolean
  reviewedCount: number
}

const HOOK_MARKER = '# apc-learning-gate v2'
const ENABLED_FILE = 'apc-gate-enabled'
const REVIEWED_FILE = 'apc-gate-reviewed'
const SKIP_FILE = 'apc-gate-skips'
const ORIGINAL_SUFFIX = '.apc-original'
const MAX_REVIEWED_SHAS = 100

const HOOK_SCRIPT = [
  '#!/bin/sh',
  HOOK_MARKER,
  '# Managed by Agent Project Console. The original hook, when present, is chained first.',
  'COMMON_DIR="$(git rev-parse --git-common-dir)" || exit 1',
  'case "$COMMON_DIR" in /*) ;; *) COMMON_DIR="$(pwd)/$COMMON_DIR" ;; esac',
  'INPUT_FILE="$COMMON_DIR/apc-pre-push-input.$$"',
  'trap \'rm -f "$INPUT_FILE"\' EXIT HUP INT TERM',
  'cat > "$INPUT_FILE" || exit 1',
  'HOOK_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
  'ORIGINAL="$HOOK_DIR/pre-push.apc-original"',
  'if [ -x "$ORIGINAL" ]; then',
  '  "$ORIGINAL" "$@" < "$INPUT_FILE" || exit $?',
  'fi',
  'ENABLED="$COMMON_DIR/apc-gate-enabled"',
  '[ -f "$ENABLED" ] || exit 0',
  'if [ -n "$APC_GATE_SKIP" ]; then',
  '  reason="$(printf \'%s\' "$APC_GATE_SKIP" | tr \'\\r\\n\\t\' \'   \')"',
  '  [ -n "$reason" ] || { echo "apc-gate: 우회 사유가 필요합니다." >&2; exit 1; }',
  '  printf \'%s\\t%s\\n\' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$reason" >> "$COMMON_DIR/apc-gate-skips"',
  '  echo "apc-gate: 우회가 기록되었습니다 — $reason" >&2',
  '  exit 0',
  'fi',
  'GATE_FILE="$COMMON_DIR/apc-gate-reviewed"',
  'ZERO=0000000000000000000000000000000000000000',
  'status=0',
  'while read -r _local_ref local_sha _remote_ref _remote_sha; do',
  '  [ "$local_sha" = "$ZERO" ] && continue',
  '  commit_sha="$(git rev-parse "$local_sha^{commit}" 2>/dev/null)" || {',
  '    echo "⛔ apc-gate: commit으로 해석할 수 없는 ref입니다 ($local_sha)." >&2',
  '    status=1',
  '    continue',
  '  }',
  '  covered=0',
  '  if [ -f "$GATE_FILE" ]; then',
  '    while read -r reviewed; do',
  '      [ -n "$reviewed" ] || continue',
  '      if git merge-base --is-ancestor "$commit_sha" "$reviewed" 2>/dev/null; then covered=1; break; fi',
  '    done < "$GATE_FILE"',
  '  fi',
  '  if [ "$covered" -ne 1 ]; then',
  '    echo "⛔ apc-gate: 리뷰되지 않은 변경입니다 ($commit_sha)." >&2',
  '    echo "   회고 탭에서 이 worktree의 Receipt를 발급하세요." >&2',
  '    echo "   긴급 우회: APC_GATE_SKIP=\\"사유\\" git push (기록됩니다)" >&2',
  '    status=1',
  '  fi',
  'done < "$INPUT_FILE"',
  'exit $status',
].join('\n') + '\n'

function safeReadLines(path: string): string[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function atomicWrite(path: string, content: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = path + '.tmp-' + process.pid + '-' + Date.now()
  writeFileSync(temporary, content, { encoding: 'utf8', ...(mode === undefined ? {} : { mode }) })
  renameSync(temporary, path)
  if (mode !== undefined) chmodSync(path, mode)
}

export class GateService {
  private async commonDir(repoPath: string): Promise<string | null> {
    const result = await runGit(repoPath, ['rev-parse', '--git-common-dir'])
    if (result.code !== 0) return null
    const path = result.stdout.trim()
    return isAbsolute(path) ? path : resolve(repoPath, path)
  }

  private async hookPath(repoPath: string): Promise<string | null> {
    const result = await runGit(repoPath, ['rev-parse', '--git-path', 'hooks/pre-push'])
    if (result.code !== 0) return null
    const path = result.stdout.trim()
    return isAbsolute(path) ? path : resolve(repoPath, path)
  }

  private async enable(repoPath: string): Promise<string | null> {
    const common = await this.commonDir(repoPath)
    if (!common) return null
    atomicWrite(resolve(common, ENABLED_FILE), new Date().toISOString() + '\n')
    return common
  }

  async installHook(repoPath: string): Promise<{ ok: boolean; reason?: string }> {
    const [common, hookPath] = await Promise.all([this.commonDir(repoPath), this.hookPath(repoPath)])
    if (!common || !hookPath) return { ok: false, reason: 'git repo 또는 hook 경로를 확인할 수 없습니다' }
    mkdirSync(dirname(hookPath), { recursive: true })
    let movedOriginal = false
    if (existsSync(hookPath)) {
      const existing = readFileSync(hookPath, 'utf8')
      if (!existing.includes(HOOK_MARKER)) {
        const backup = hookPath + ORIGINAL_SUFFIX
        if (existsSync(backup)) return { ok: false, reason: '기존 hook 백업이 이미 있어 안전하게 설치할 수 없습니다: ' + backup }
        renameSync(hookPath, backup)
        movedOriginal = true
      }
    }
    try {
      atomicWrite(hookPath, HOOK_SCRIPT, 0o755)
      atomicWrite(resolve(common, ENABLED_FILE), new Date().toISOString() + '\n')
      if (!existsSync(resolve(common, REVIEWED_FILE))) atomicWrite(resolve(common, REVIEWED_FILE), '')
      return { ok: true }
    } catch (error) {
      if (movedOriginal) {
        rmSync(hookPath, { force: true })
        renameSync(hookPath + ORIGINAL_SUFFIX, hookPath)
      }
      return { ok: false, reason: 'hook 설치 실패: ' + String(error) }
    }
  }

  async recordReviewedSha(repoPath: string, sha: string): Promise<{ ok: boolean; reason?: string }> {
    if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, reason: '유효한 SHA가 아닙니다: ' + sha }
    const exists = await runGit(repoPath, ['cat-file', '-e', sha + '^{commit}'])
    if (exists.code !== 0) return { ok: false, reason: 'repo에 존재하는 commit SHA가 아닙니다: ' + sha }
    const common = await this.enable(repoPath)
    if (!common) return { ok: false, reason: 'git repo가 아닙니다' }
    const path = resolve(common, REVIEWED_FILE)
    const previous = safeReadLines(path).filter((line) => /^[0-9a-f]{40}$/.test(line) && line !== sha)
    atomicWrite(path, [...previous, sha].slice(-MAX_REVIEWED_SHAS).join('\n') + '\n')
    return { ok: true }
  }

  async removeReviewedSha(repoPath: string, sha: string): Promise<void> {
    const common = await this.commonDir(repoPath)
    if (!common) return
    const path = resolve(common, REVIEWED_FILE)
    const next = safeReadLines(path).filter((line) => line !== sha)
    atomicWrite(path, next.length > 0 ? next.join('\n') + '\n' : '')
  }

  async status(repoPath: string): Promise<GateStatus> {
    const [common, hookPath] = await Promise.all([this.commonDir(repoPath), this.hookPath(repoPath)])
    if (!common) {
      return { ok: false, reason: 'git repo가 아닙니다', enabled: false, hookInstalled: false, headSha: null, headCovered: true, reviewedCount: 0 }
    }
    const enabled = existsSync(resolve(common, ENABLED_FILE))
    const reviewed = safeReadLines(resolve(common, REVIEWED_FILE)).filter((line) => /^[0-9a-f]{40}$/.test(line))
    const hookInstalled = !!hookPath && existsSync(hookPath) && readFileSync(hookPath, 'utf8').includes(HOOK_MARKER)
    const headResult = await runGit(repoPath, ['rev-parse', 'HEAD'])
    const headSha = headResult.code === 0 ? headResult.stdout.trim() : null
    let headCovered = !enabled
    if (enabled && headSha) {
      for (const reviewedSha of reviewed) {
        const result = await runGit(repoPath, ['merge-base', '--is-ancestor', headSha, reviewedSha])
        if (result.code === 0) { headCovered = true; break }
      }
    }
    return { ok: true, enabled, hookInstalled, headSha, headCovered, reviewedCount: reviewed.length }
  }

  async readAndClearSkips(repoPath: string): Promise<Array<{ ts: string; reason: string }>> {
    const common = await this.commonDir(repoPath)
    if (!common) return []
    const source = resolve(common, SKIP_FILE)
    if (!existsSync(source)) return []
    const draining = source + '.drain-' + process.pid + '-' + Date.now()
    try {
      renameSync(source, draining)
    } catch {
      return []
    }
    try {
      return safeReadLines(draining).map((line) => {
        const [ts, ...reason] = line.split('\t')
        return { ts, reason: reason.join('\t') }
      }).filter((entry) => !!entry.ts && !!entry.reason)
    } finally {
      rmSync(draining, { force: true })
    }
  }
}
