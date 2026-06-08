import { useState } from 'react'
import type { UnifiedSearchHit } from '@apc/shared'
import { api } from '../api.js'

type Props = { open: boolean; onClose: () => void; onSelectProject: (projectId: string) => void }

export function SearchModal({ open, onClose, onSelectProject }: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<UnifiedSearchHit[]>([])
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const run = async () => {
    try {
      const res = await api.search({ query })
      setHits(res.hits); setSearched(true); setError(null)
    } catch (e) {
      setError(String(e)); setHits([]); setSearched(true)
    }
  }

  return (
    <div className="add-project-overlay" onClick={onClose}>
      <div className="add-project-dialog search-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Search</h2>
        <input
          autoFocus
          aria-label="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void run() }}
          placeholder="검색어 입력 후 Enter"
        />
        {error && <p className="search-modal__error">{error}</p>}
        {searched && hits.length === 0 && !error && <p className="search-modal__empty">결과 없음</p>}
        <ul className="search-modal__results">
          {hits.map((h) => (
            <li key={`${h.kind}:${h.id}`}>
              <button type="button" onClick={() => { onSelectProject(h.projectId); onClose() }}>
                <span className="search-modal__kind">[{h.kind}]</span>
                <span className="search-modal__proj">{h.projectId}</span>
                <span className="search-modal__title">{h.title}</span>
                <span className="search-modal__excerpt">{h.excerpt}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="add-project-dialog__actions">
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
