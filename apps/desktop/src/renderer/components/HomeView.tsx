import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { api } from '../api.js'
import { useStore } from '../store.js'
import { MarkdownContent } from './MarkdownContent.js'
import { DiffViewer } from './DiffViewer.js'
import { PmHome } from './PmHome.js'
import { GeneratePreflightModal } from './GeneratePreflightModal.js'
import { GitSyncPanel } from './GitSyncPanel.js'

type ChangedFile = { path: string; status: 'new' | 'modified' | 'deleted'; isMarkdown: boolean; mtimeMs: number; unreflected?: boolean }
type Viewer =
  | { kind: 'current'; content?: string; error?: string }
  | { kind: 'doc'; file: ChangedFile; content?: string; error?: string }
  | { kind: 'code'; file: ChangedFile; patch?: string | null; error?: string }
  | { kind: 'deleted'; file: ChangedFile }

function relTime(ms: number): string {
  if (!ms) return ''
  const d = Date.now() - ms
  if (d < 60_000) return '방금'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}분 전`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}시간 전`
  return `${Math.floor(d / 86_400_000)}일 전`
}

export function HomeView({ dashboard }: { dashboard: ProjectDashboardRes }) {
  const { selectedProjectId, ingesting, ingest, lastIngest, prepareGenerate, clearGeneration } = useStore()
  const [viewer, setViewer] = useState<Viewer>({ kind: 'current' })
  const [changes, setChanges] = useState<{ files?: ChangedFile[]; reason?: string } | null>(null)
  const [pmOpen, setPmOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)

  const loadCurrent = useCallback(() => {
    if (!selectedProjectId) return
    void api.fsReadDoc({ projectId: selectedProjectId, relPath: 'current.md' }).then((res) => {
      setViewer((v) => (v.kind === 'current' ? (res.ok ? { kind: 'current', content: res.content } : { kind: 'current', error: res.reason }) : v))
    })
  }, [selectedProjectId])

  const loadChanges = useCallback(() => {
    if (!selectedProjectId) return
    void api.changesList({ projectId: selectedProjectId }).then((res) => {
      setChanges(res.ok ? { files: res.files ?? [] } : { reason: res.reason ?? 'git 변경분을 가져올 수 없습니다' })
    })
  }, [selectedProjectId])

  useEffect(() => { loadCurrent(); loadChanges() }, [loadCurrent, loadChanges])

  const openFile = (file: ChangedFile) => {
    if (!selectedProjectId) return
    if (file.status === 'deleted') { setViewer({ kind: 'deleted', file }); return }
    if (file.isMarkdown) {
      setViewer({ kind: 'doc', file })
      void api.fsReadDoc({ projectId: selectedProjectId, relPath: file.path }).then((res) => {
        setViewer((v) => (v.kind === 'doc' && v.file.path === file.path
          ? (res.ok ? { kind: 'doc', file, content: res.content } : { kind: 'doc', file, error: res.reason })
          : v))
      })
      return
    }
    setViewer({ kind: 'code', file })
    void api.changesDiff({ projectId: selectedProjectId, relPath: file.path }).then((res) => {
      setViewer((v) => (v.kind === 'code' && v.file.path === file.path
        ? (res.ok ? { kind: 'code', file, patch: res.patch ?? '' } : { kind: 'code', file, error: res.reason })
        : v))
    })
  }

  const runIngest = async () => { await ingest(); loadChanges() }

  const groups = useMemo(() => {
    const files = changes?.files ?? []
    return {
      newDocs: files.filter((f) => f.isMarkdown && f.status === 'new'),
      modDocs: files.filter((f) => f.isMarkdown && f.status !== 'new'),
      code: files.filter((f) => !f.isMarkdown),
    }
  }, [changes])

  const doneCount = dashboard.allTasks.filter((t) => t.status === 'done').length

  const feedRow = (f: ChangedFile) => (
    <button key={f.path} type="button" className="home-feed__row" onClick={() => openFile(f)}>
      <span className={`home-feed__st home-feed__st--${f.status}`}>{f.status === 'new' ? '+' : f.status === 'deleted' ? '−' : '±'}</span>
      <span className="home-feed__path">{f.path}</span>
      {f.unreflected && <span className="home-feed__badge">미반영</span>}
      <span className="home-feed__when">{relTime(f.mtimeMs)}</span>
    </button>
  )

  return (
    <div className="home">
      <div className="home__panes">
        <main className="home-viewer panel">
          <header className="panel__header home-viewer__header">
            {viewer.kind === 'current' ? (
              <>
                <h2>current.md</h2>
                <button type="button" onClick={() => { setGenerateOpen(true); clearGeneration(); void prepareGenerate() }}>✨ 갱신 제안</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { setViewer({ kind: 'current' }); loadCurrent() }}>↩ current.md</button>
                <h2>{'file' in viewer ? viewer.file.path : ''}</h2>
                {'file' in viewer && viewer.file.unreflected && (
                  <button type="button" className="home-viewer__ingest" disabled={ingesting} onClick={() => void runIngest()}>
                    {ingesting ? 'Ingesting…' : 'Ingest now'}
                  </button>
                )}
              </>
            )}
          </header>
          <div className="home-viewer__body">
            {viewer.kind === 'current' && (viewer.content
              ? <MarkdownContent markdown={viewer.content} onOpenWikiLink={() => { /* current.md 내 위키링크는 Knowledge에서 */ }} />
              : <div className="home-viewer__empty">{viewer.error ? `current.md 없음 — ${viewer.error}` : '불러오는 중…'}<br />✨ 갱신 제안으로 첫 current.md를 만드세요.</div>)}
            {viewer.kind === 'doc' && (viewer.content
              ? <MarkdownContent markdown={viewer.content} onOpenWikiLink={() => { /* noop */ }} />
              : <div className="home-viewer__empty">{viewer.error ?? '불러오는 중…'}</div>)}
            {viewer.kind === 'code' && (viewer.error
              ? <div className="home-viewer__empty">⚠ {viewer.error}</div>
              : <DiffViewer patch={viewer.patch ?? null} />)}
            {viewer.kind === 'deleted' && <div className="home-viewer__empty">삭제된 파일입니다: {viewer.file.path}</div>}
          </div>
        </main>

        <aside className="home-side">
          <GitSyncPanel projectId={selectedProjectId} repoPath={dashboard.project.repoPaths[0]} onSynced={loadChanges} />
        <section className="home-feed panel">
          <header className="panel__header home-feed__header">
            <h2>변경분</h2>
            <span className="home-feed__meta">git · {changes?.files?.length ?? 0} files{lastIngest ? ` · ingested ${lastIngest.sessions} session(s)` : ''}</span>
            <button type="button" className="home-feed__ingest" disabled={ingesting} onClick={() => void runIngest()}>
              {ingesting ? 'Ingesting…' : 'Ingest now'}
            </button>
            <button type="button" onClick={loadChanges} aria-label="변경분 새로고침">⟳</button>
          </header>
          <div className="home-feed__list">
            {changes?.reason && <div className="home-feed__error">⚠ {changes.reason}</div>}
            {groups.newDocs.length > 0 && <div className="home-feed__group">새 문서 ({groups.newDocs.length})</div>}
            {groups.newDocs.map(feedRow)}
            {groups.modDocs.length > 0 && <div className="home-feed__group">수정된 문서 ({groups.modDocs.length})</div>}
            {groups.modDocs.map(feedRow)}
            {groups.code.length > 0 && <div className="home-feed__group">코드 ({groups.code.length})</div>}
            {groups.code.map(feedRow)}
            {changes && !changes.reason && (changes.files?.length ?? 0) === 0 && <div className="home-feed__empty">변경분 없음 — working tree clean</div>}
          </div>
        </section>
        </aside>
      </div>

      <footer className="home-strip">
        <span>🎯 <b>{dashboard.project.goal ?? '(목표 없음)'}</b></span>
        <span className="home-strip__bar"><i style={{ width: `${dashboard.allTasks.length ? Math.round((doneCount / dashboard.allTasks.length) * 100) : 0}%` }} /></span>
        <span>{doneCount}/{dashboard.allTasks.length} tasks</span>
        <span>리뷰 대기 <b className="home-strip__warn">{dashboard.reviewQueue.length}</b></span>
        <button type="button" onClick={() => setPmOpen((v) => !v)}>{pmOpen ? '접기 ▴' : '자세히 ▾'}</button>
      </footer>
      {pmOpen && <div className="home-strip__detail"><PmHome dashboard={dashboard} /></div>}

      <GeneratePreflightModal open={generateOpen} onClose={() => setGenerateOpen(false)} />
    </div>
  )
}
