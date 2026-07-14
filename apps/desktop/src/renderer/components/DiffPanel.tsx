import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangesListRes } from '../../shared/ipc-contract.js'
import { api } from '../api.js'
import { parseUnifiedDiff } from '../harness-utils.js'

type ChangedFile = NonNullable<ChangesListRes['files']>[number]
type PatchState = { patch?: string; error?: string }

type Props = {
  open: boolean
  projectId: string | null
  onClose: () => void
}

const MARKER: Record<ChangedFile['status'], string> = { new: '+', modified: '±', deleted: '−' }

/** 우측 오버레이에서 변경 파일 통계와 필요할 때만 불러온 unified diff를 보여준다. */
export function DiffPanel({ open, projectId, onClose }: Props) {
  const [files, setFiles] = useState<ChangedFile[] | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [patches, setPatches] = useState<Record<string, PatchState>>({})
  const listRequest = useRef(0)
  const diffGeneration = useRef(0)

  const load = useCallback(() => {
    if (!projectId) return
    const request = ++listRequest.current
    diffGeneration.current += 1
    setFiles(null)
    setReason(null)
    setExpanded(null)
    setPatches({})
    void api.changesList({ projectId }).then((res) => {
      if (listRequest.current !== request) return
      if (res.ok) setFiles(res.files ?? [])
      else setReason(res.reason ?? '변경분을 가져올 수 없습니다')
    }).catch((error: unknown) => {
      if (listRequest.current === request) setReason(`변경분을 가져올 수 없습니다: ${String(error)}`)
    })
  }, [projectId])

  useEffect(() => {
    if (open) load()
    return () => {
      listRequest.current += 1
      diffGeneration.current += 1
    }
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const totals = useMemo(() => {
    let additions = 0
    let deletions = 0
    for (const file of files ?? []) {
      additions += file.additions ?? 0
      deletions += file.deletions ?? 0
    }
    return { additions, deletions }
  }, [files])

  const toggle = (file: ChangedFile) => {
    const next = expanded === file.path ? null : file.path
    setExpanded(next)
    if (!next || patches[file.path] || !projectId) return

    const generation = diffGeneration.current
    const requestedProjectId = projectId
    void api.changesDiff({ projectId: requestedProjectId, relPath: file.path }).then((res) => {
      if (diffGeneration.current !== generation) return
      setPatches((previous) => ({
        ...previous,
        [file.path]: res.ok
          ? { patch: res.patch ?? '' }
          : { error: res.reason ?? 'diff 조회 실패' },
      }))
    }).catch((error: unknown) => {
      if (diffGeneration.current !== generation) return
      setPatches((previous) => ({ ...previous, [file.path]: { error: `diff 조회 실패: ${String(error)}` } }))
    })
  }

  if (!open) return null

  return (
    <aside className="diff-panel" role="dialog" aria-label="변경사항">
      <header className="diff-panel__header">
        <h2>변경사항</h2>
        {files && (
          <span className="diff-panel__totals">
            파일 {files.length} · <span className="diff-panel__total-add">+{totals.additions}</span>{' '}
            <span className="diff-panel__total-del">−{totals.deletions}</span>
          </span>
        )}
        <button type="button" onClick={load} aria-label="변경사항 새로고침" disabled={!projectId}>⟳</button>
        <button type="button" onClick={onClose} aria-label="변경사항 닫기">✕</button>
      </header>

      <div className="diff-panel__list">
        {!projectId && <div className="diff-panel__empty">프로젝트를 선택하세요</div>}
        {projectId && reason && <div className="diff-panel__empty">⚠ {reason}</div>}
        {projectId && !reason && files === null && <div className="diff-panel__empty">불러오는 중…</div>}
        {projectId && files?.length === 0 && <div className="diff-panel__empty">변경분 없음 — working tree clean</div>}

        {files?.map((file) => (
          <div key={file.path} className="diff-panel__item">
            <button
              type="button"
              className="diff-panel__row"
              aria-expanded={expanded === file.path}
              onClick={() => toggle(file)}
            >
              <span className={`diff-panel__st diff-panel__st--${file.status}`}>{MARKER[file.status]}</span>
              <span className="diff-panel__path">{file.path}</span>
              {file.binary
                ? <span className="diff-panel__binary">binary</span>
                : (
                  <span className="diff-panel__stats">
                    {file.additions !== undefined && <span className="diff-panel__add">+{file.additions}</span>}
                    {file.deletions !== undefined && <span className="diff-panel__del">−{file.deletions}</span>}
                  </span>
                )}
            </button>
            {expanded === file.path && <ExpandedDiff state={patches[file.path]} />}
          </div>
        ))}
      </div>
    </aside>
  )
}

function ExpandedDiff({ state }: { state: PatchState | undefined }) {
  const parsed = useMemo(() => parseUnifiedDiff(state?.patch ?? ''), [state?.patch])
  if (!state) return <div className="diff-panel__empty">불러오는 중…</div>
  if (state.error) return <div className="diff-panel__empty">⚠ {state.error}</div>
  if (parsed.length === 0) return <div className="diff-panel__empty">표시할 diff 없음</div>

  return (
    <div className="diff-panel__patch">
      {parsed.flatMap((file) => file.rows.map((row, index) => (
        <div key={`${file.path}:${index}`} className={`diff-panel__line diff-panel__line--${row.kind}`}>
          <span className="diff-panel__lineno">{row.leftNumber ?? ''}</span>
          <span className="diff-panel__lineno">{row.rightNumber ?? ''}</span>
          <code>{row.kind === 'delete' ? row.left : row.right}</code>
        </div>
      )))}
    </div>
  )
}
