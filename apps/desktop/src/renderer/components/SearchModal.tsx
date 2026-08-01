import { useEffect, useRef, useState } from 'react'
import type { EvidenceCandidate, RetrieverDiagnostic } from '@apc/shared'
import type { ResolveEvidenceSourceRes, SearchEvidenceRes } from '../../shared/ipc-contract.js'
import { api } from '../api.js'

type Props = {
  open: boolean
  onClose: () => void
  onSelectProject: (projectId: string) => void
  onOpenSource?: (uri: string) => void | Promise<void>
}

function RetrieverDiagnostics({ diagnostics }: { diagnostics: RetrieverDiagnostic[] }) {
  const failures = diagnostics.filter((diagnostic) => diagnostic.error)
  if (failures.length === 0) return null
  return (
    <ul className="search-modal__diagnostics" aria-label="검색 진단">
      {failures.map((diagnostic) => (
        <li key={diagnostic.id}>
          <strong>{diagnostic.id}</strong>: {diagnostic.error?.message}
        </li>
      ))}
    </ul>
  )
}

function EvidenceResult({
  candidate,
  onClose,
  onSelectProject,
  onOpenSource,
}: {
  candidate: EvidenceCandidate
  onClose: () => void
  onSelectProject: (projectId: string) => void
  onOpenSource?: (uri: string) => void
}) {
  const signals = [
    ...(candidate.signals.conflict ? ['conflict'] : []),
    ...(candidate.signals.stale ? ['stale'] : []),
  ]
  return (
    <li className="search-modal__result">
      <button
        type="button"
        className="search-modal__project-action"
        aria-label={`프로젝트 열기: ${candidate.title}`}
        onClick={() => { onSelectProject(candidate.projectId); onClose() }}
      >
        <span className="search-modal__kind">{candidate.sourceKind}</span>
        <span className="search-modal__proj">{candidate.projectId}</span>
        <span className="search-modal__authority">{candidate.authority}</span>
        <span className="search-modal__title">{candidate.title}</span>
        <span className="search-modal__excerpt">{candidate.excerpt}</span>
      </button>
      <div className="search-modal__badges">
        {signals.map((signal) => <span key={signal} className="search-modal__signal">{signal}</span>)}
        {candidate.warnings.map((warning) => (
          <span key={warning} className="search-modal__warning">{warning}</span>
        ))}
        <button
          type="button"
          className="search-modal__source-action"
          aria-label={`원문 보기: ${candidate.title}`}
          title={candidate.uri}
          onClick={() => { void onOpenSource?.(candidate.uri) }}
        >
          원문 보기
        </button>
      </div>
    </li>
  )
}

export function SearchModal({ open, onClose, onSelectProject, onOpenSource }: Props) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchEvidenceRes | null>(null)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sourceResult, setSourceResult] = useState<ResolveEvidenceSourceRes | null>(null)
  const [sourceLoading, setSourceLoading] = useState(false)
  const requestGeneration = useRef(0)
  const sourceGeneration = useRef(0)

  useEffect(() => {
    if (!open) {
      requestGeneration.current += 1
      sourceGeneration.current += 1
    }
  }, [open])

  if (!open) return null

  const run = async () => {
    const generation = ++requestGeneration.current
    sourceGeneration.current += 1
    setSourceResult(null)
    setSourceLoading(false)
    const trimmed = query.trim()
    if (!trimmed) {
      setError('검색어를 입력하세요.')
      setResult(null)
      setSearched(true)
      return
    }
    try {
      const response = await api.searchEvidence({ query: trimmed, limit: 20 })
      if (generation !== requestGeneration.current) return
      setResult(response)
      setSearched(true)
      setError(null)
    } catch (caught) {
      if (generation !== requestGeneration.current) return
      setError(String(caught))
      setResult(null)
      setSearched(true)
    }
  }

  const openSource = async (uri: string) => {
    const generation = ++sourceGeneration.current
    if (onOpenSource) {
      try {
        await onOpenSource(uri)
      } catch {
        if (generation === sourceGeneration.current) {
          setSourceResult({
            ok: false,
            error: { code: 'source-unavailable', message: '원문을 안전하게 조회할 수 없습니다.' },
          })
        }
      }
      return
    }
    setSourceResult(null)
    setSourceLoading(true)
    try {
      const resolved = await api.resolveEvidenceSource({ uri, neighbors: 1 })
      if (generation === sourceGeneration.current) setSourceResult(resolved)
    } catch {
      if (generation === sourceGeneration.current) {
        setSourceResult({
          ok: false,
          error: { code: 'source-unavailable', message: '원문을 안전하게 조회할 수 없습니다.' },
        })
      }
    } finally {
      if (generation === sourceGeneration.current) setSourceLoading(false)
    }
  }

  const evidence = result?.ok ? result.response.evidence : []
  const retrieverDiagnostics = result?.ok
    ? result.response.diagnostics.retrievers
    : (result?.diagnostic.retrievers ?? [])

  return (
    <div className="add-project-overlay" onClick={onClose}>
      <div className="add-project-dialog search-modal" onClick={(event) => event.stopPropagation()}>
        <h2>Search</h2>
        <input
          autoFocus
          aria-label="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void run() }}
          placeholder="검색어 입력 후 Enter"
        />
        {error && <p className="search-modal__error">{error}</p>}
        {result && !result.ok && <p className="search-modal__error">{result.diagnostic.message}</p>}
        {searched && evidence.length === 0 && !error && <p className="search-modal__empty">결과 없음</p>}
        <RetrieverDiagnostics diagnostics={retrieverDiagnostics} />
        {result?.ok && (
          <p className="search-modal__summary">
            중복 {result.response.diagnostics.droppedDuplicates} · source cap {result.response.diagnostics.droppedByCap}
          </p>
        )}
        <ul className="search-modal__results">
          {evidence.map((candidate) => (
            <EvidenceResult
              key={`${candidate.sourceKind}:${candidate.candidateId}`}
              candidate={candidate}
              onClose={onClose}
              onSelectProject={onSelectProject}
              onOpenSource={openSource}
            />
          ))}
        </ul>
        {sourceLoading && <p className="search-modal__source-status">원문을 불러오는 중…</p>}
        {sourceResult?.ok && (
          <section className="search-modal__source-detail" aria-label="원문 상세">
            <div className="search-modal__source-heading">
              <strong>{sourceResult.source.title}</strong>
              <span>{sourceResult.source.sourceKind} · {sourceResult.source.projectId}</span>
            </div>
            {sourceResult.source.warnings.length > 0 && (
              <div className="search-modal__badges">
                {sourceResult.source.warnings.map((warning) => (
                  <span key={warning} className="search-modal__warning">{warning}</span>
                ))}
              </div>
            )}
            <pre>{sourceResult.source.content}</pre>
          </section>
        )}
        {sourceResult && !sourceResult.ok && (
          <p className="search-modal__error">
            {sourceResult.error.code}: {sourceResult.error.message}
          </p>
        )}
        <div className="add-project-dialog__actions">
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
