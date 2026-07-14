import { useEffect, useRef, useState } from 'react'
import type { ProjectStructureHintDto } from '../../shared/ipc-contract.js'

type Props = {
  open: boolean
  projectId: string | null
  modeLabel: string
  suggestedFolders: string[]
  onCancel: () => void
  onConfirm: (hint: ProjectStructureHintDto) => void
}

type FolderRow = { id: number; path: string; description: string }

const storageKey = (projectId: string): string => `apc:wiki-structure-hint:${projectId}`

function readSaved(projectId: string | null): ProjectStructureHintDto | null {
  if (!projectId) return null
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(projectId)) ?? 'null') as ProjectStructureHintDto | null
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch { return null }
}

/** Pre-run human steering. Empty fields are meaningful: they explicitly delegate inference to the agent. */
export function WikiGenerationSetup({ open, projectId, modeLabel, suggestedFolders, onCancel, onConfirm }: Props) {
  const nextId = useRef(1)
  const [projectCharacter, setProjectCharacter] = useState('')
  const [folders, setFolders] = useState<FolderRow[]>([])

  useEffect(() => {
    if (!open) return
    const saved = readSaved(projectId)
    setProjectCharacter(saved?.projectCharacter ?? '')
    const byPath = new Map((saved?.folderClassifications ?? []).map((row) => [row.path, row.description ?? '']))
    for (const path of suggestedFolders) if (!byPath.has(path)) byPath.set(path, '')
    setFolders([...byPath].map(([path, description]) => ({ id: nextId.current++, path, description })))
  }, [open, projectId, suggestedFolders])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const updateFolder = (id: number, patch: Partial<Pick<FolderRow, 'path' | 'description'>>) => {
    setFolders((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row))
  }
  const submit = () => {
    const hint: ProjectStructureHintDto = {
      projectCharacter: projectCharacter.trim(),
      folderClassifications: folders
        .map((row) => ({ path: row.path.trim(), description: row.description.trim() }))
        .filter((row) => row.path.length > 0),
    }
    if (projectId) {
      try { localStorage.setItem(storageKey(projectId), JSON.stringify(hint)) } catch { /* best-effort */ }
    }
    onConfirm(hint)
  }

  return (
    <div className="wiki-setup" role="dialog" aria-modal="true" aria-label="위키 생성 전 구조 설정">
      <div className="wiki-setup__card">
        <header className="wiki-setup__header">
          <div>
            <h2>위키 생성 전 프로젝트 이해</h2>
            <p>{modeLabel} · 이 힌트는 project-discovery와 폴더별 문서 분류에 사용됩니다.</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="구조 설정 닫기">✕</button>
        </header>

        <div className="wiki-setup__body">
          <label className="wiki-setup__character">
            <span>이 프로젝트는 어떤 성격인가요?</span>
            <textarea
              value={projectCharacter}
              onChange={(event) => setProjectCharacter(event.target.value)}
              placeholder="예: 고객용 웹 앱과 내부 운영 도구가 함께 있는 모노레포"
              rows={3}
              autoFocus
            />
            <small>비워두면 project-discovery agent가 저장소 근거를 바탕으로 추론합니다.</small>
          </label>

          <section className="wiki-setup__folders">
            <div className="wiki-setup__section-head">
              <div>
                <h3>폴더 분류</h3>
                <p>설명을 쓰면 사용자 분류, 비워두면 agent 자동 분류입니다.</p>
              </div>
              <button
                type="button"
                onClick={() => setFolders((rows) => [...rows, { id: nextId.current++, path: '', description: '' }])}
              >
                + 폴더 추가
              </button>
            </div>
            {folders.length === 0 && (
              <div className="wiki-setup__empty">문서 폴더를 찾지 못했습니다. 필요하면 직접 추가하세요.</div>
            )}
            <div className="wiki-setup__folder-list">
              {folders.map((row) => (
                <div className="wiki-setup__folder-row" key={row.id}>
                  <input
                    value={row.path}
                    onChange={(event) => updateFolder(row.id, { path: event.target.value })}
                    aria-label="폴더 경로"
                    placeholder="docs/"
                  />
                  <span aria-hidden="true">:</span>
                  <input
                    value={row.description}
                    onChange={(event) => updateFolder(row.id, { description: event.target.value })}
                    aria-label={`${row.path || '새 폴더'} 분류`}
                    placeholder="비워두면 agent가 분류"
                  />
                  <span className={row.description.trim() ? 'wiki-setup__source wiki-setup__source--user' : 'wiki-setup__source'}>
                    {row.description.trim() ? '사용자' : 'AI'}
                  </span>
                  <button
                    type="button"
                    className="wiki-setup__remove"
                    onClick={() => setFolders((rows) => rows.filter((item) => item.id !== row.id))}
                    aria-label={`${row.path || '새 폴더'} 제거`}
                  >
                    −
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer className="wiki-setup__actions">
          <button type="button" onClick={onCancel}>취소</button>
          <button type="button" className="button button--accent" onClick={submit}>이 설정으로 위키 생성</button>
        </footer>
      </div>
    </div>
  )
}
