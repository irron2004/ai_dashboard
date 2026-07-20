import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitFileChange, GitSyncStatus } from '@apc/shared'
import { api } from '../api.js'
import { useStore } from '../store.js'

type Props = {
  projectId: string | null
  repoPath?: string
  onSynced?: () => void
}

type Busy = 'status' | 'fetch' | 'pull' | 'commit' | 'push' | null

function shortStatus(file: GitFileChange): string {
  if (file.conflict) return '충돌'
  if (file.status === 'untracked') return '새 파일'
  if (file.status === 'added') return '추가'
  if (file.status === 'deleted') return '삭제'
  if (file.status === 'renamed') return '이름변경'
  if (file.status === 'copied') return '복사'
  return '수정'
}

function summarize(status: GitSyncStatus | null): string {
  if (!status) return '상태를 불러오는 중…'
  if (!status.ok) return status.reason ?? 'Git 상태를 불러올 수 없습니다'
  const remote = status.upstream ? `${status.upstream} · ↑${status.ahead} ↓${status.behind}` : 'upstream 없음'
  const branch = status.detached ? 'detached HEAD' : status.branch ?? '(branch 없음)'
  return `${branch} · ${remote}`
}

export function GitSyncPanel({ projectId, repoPath, onSynced }: Props) {
  const activeWorktree = useStore((state) => projectId ? state.activeWorktrees[projectId] ?? null : null)
  const [status, setStatus] = useState<GitSyncStatus | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const loadStatus = useCallback(async (fetch = false) => {
    if (!projectId) return
    setBusy(fetch ? 'fetch' : 'status')
    setNotice(null)
    try {
      const next = await api.gitStatus({ projectId, fetch, worktreePath: activeWorktree ?? undefined })
      setStatus(next)
      setSelected((current) => current.filter((path) => next.files.some((file) => file.path === path)))
    } catch (e) {
      setStatus({ ok: false, reason: String(e), detached: false, ahead: 0, behind: 0, hasChanges: false, files: [], warnings: [] })
    } finally {
      setBusy(null)
    }
  }, [activeWorktree, projectId])

  useEffect(() => { void loadStatus(false) }, [loadStatus])

  const selectableFiles = status?.files.filter((file) => !file.conflict) ?? []
  const allSelected = selectableFiles.length > 0 && selectableFiles.every((file) => selected.includes(file.path))
  const canCommit = !!status?.ok && selected.length > 0 && !!message.trim() && !busy
  const canPush = !!status?.ok && !status.detached && !!status.upstream && status.ahead > 0 && !busy
  const canPull = !!status?.ok && !status.detached && !!status.upstream && status.behind > 0 && status.files.length === 0 && !busy

  const toggleAll = () => {
    setSelected(allSelected ? [] : selectableFiles.map((file) => file.path))
  }

  const toggleFile = (path: string) => {
    setSelected((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path])
  }

  const runPull = async () => {
    if (!projectId) return
    setBusy('pull')
    setNotice(null)
    const result = await api.gitPull({ projectId, worktreePath: activeWorktree ?? undefined })
    setStatus(result.status ?? status)
    setNotice({ ok: result.ok, text: result.ok ? (result.reason ?? 'Pull 완료') : (result.reason ?? 'Pull 실패') })
    if (result.ok) onSynced?.()
    setBusy(null)
  }

  const runCommit = async () => {
    if (!projectId) return
    setBusy('commit')
    setNotice(null)
    const result = await api.gitCommit({ projectId, files: selected, message, worktreePath: activeWorktree ?? undefined })
    setStatus(result.status ?? status)
    setNotice({ ok: result.ok, text: result.ok ? `Commit 완료${result.committedSha ? ` (${result.committedSha.slice(0, 7)})` : ''}` : (result.reason ?? 'Commit 실패') })
    if (result.ok) {
      setSelected([])
      setMessage('')
      onSynced?.()
    }
    setBusy(null)
  }

  const runPush = async () => {
    if (!projectId) return
    setBusy('push')
    setNotice(null)
    const result = await api.gitPush({ projectId, worktreePath: activeWorktree ?? undefined })
    setStatus(result.status ?? status)
    setNotice({ ok: result.ok, text: result.ok ? 'Push 완료' : (result.reason ?? 'Push 실패') })
    if (result.ok) onSynced?.()
    setBusy(null)
  }

  const selectedSummary = useMemo(() => `${selected.length}/${selectableFiles.length} selected`, [selected.length, selectableFiles.length])

  return (
    <section className="git-sync panel" aria-label="Git sync">
      <header className="panel__header git-sync__header">
        <div>
          <h2>Git 동기화</h2>
          <p>{activeWorktree ?? repoPath ?? '등록된 repo 경로 없음'}{activeWorktree ? ' (worktree)' : ''}</p>
          <p className="git-sync__summary">{summarize(status)}</p>
        </div>
        <div className="git-sync__actions">
          <button type="button" disabled={!!busy || !projectId} onClick={() => void loadStatus(false)}>새로고침</button>
          <button type="button" disabled={!!busy || !projectId} onClick={() => void loadStatus(true)}>Fetch</button>
          <button type="button" disabled={!canPull} onClick={() => void runPull()}>Pull</button>
        </div>
      </header>

      <div className="git-sync__body">
        {notice && <div className={`git-sync__notice${notice.ok ? ' git-sync__notice--ok' : ' git-sync__notice--err'}`}>{notice.text}</div>}
        {status?.warnings.map((warning) => <div key={warning} className="git-sync__warning">⚠ {warning}</div>)}
        {status && !status.ok && <div className="git-sync__warning">⚠ {status.reason}</div>}

        <div className="git-sync__list-head">
          <button type="button" disabled={selectableFiles.length === 0} onClick={toggleAll}>{allSelected ? '전체 해제' : '전체 선택'}</button>
          <span>{selectedSummary}</span>
        </div>

        <div className="git-sync__files">
          {status === null && <div className="git-sync__empty">Git 상태 확인 중…</div>}
          {status?.ok && status.files.length === 0 && <div className="git-sync__empty">working tree clean</div>}
          {status?.files.map((file) => (
            <label key={file.path} className={`git-sync__file${file.conflict ? ' git-sync__file--conflict' : ''}`}>
              <input
                type="checkbox"
                checked={selected.includes(file.path)}
                disabled={file.conflict || !!busy}
                onChange={() => toggleFile(file.path)}
              />
              <span className="git-sync__file-path">{file.path}</span>
              <span className="git-sync__file-status">{shortStatus(file)}</span>
            </label>
          ))}
        </div>

        <label className="git-sync__message">
          Commit message
          <input
            value={message}
            disabled={!!busy}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="예: feat: add git sync panel"
          />
        </label>
        <div className="git-sync__commit-row">
          <span>선택한 파일만 commit합니다. Push는 별도 Learning Gate 검증을 받습니다.</span>
          <button type="button" disabled={!canCommit} onClick={() => void runCommit()}>
            {busy === 'commit' ? '커밋 중…' : 'Commit'}
          </button>
          <button type="button" className="button--accent" disabled={!canPush} onClick={() => void runPush()}>
            {busy === 'push' ? 'Push 중…' : `Push${status?.ok && status.ahead > 0 ? ` (↑${status.ahead})` : ''}`}
          </button>
        </div>
      </div>
    </section>
  )
}
