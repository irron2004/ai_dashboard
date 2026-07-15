import { useEffect, useState } from 'react'
import { WIKI_GENERATION_ENGINE, type GeneratePreflightCategoryId } from '../../shared/ipc-contract.js'
import { useStore } from '../store.js'
import { api } from '../api.js'

export function GeneratePreflightModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { selectedProjectId, preflighting, generatePreflight, generating, generation, generate, clearGeneratePreflight, clearGeneration } = useStore()
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<GeneratePreflightCategoryId[]>([])
  const [promoteMsg, setPromoteMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!generatePreflight?.categories) return
    setSelectedCategoryIds(generatePreflight.categories.filter((category) => category.selectedByDefault).map((category) => category.id))
  }, [generatePreflight])

  if (!open) return null

  const closeModal = () => {
    if (generating) return
    setPromoteMsg(null)
    clearGeneratePreflight()
    clearGeneration()
    onClose()
  }

  const handlePromote = async () => {
    if (!selectedProjectId) return
    try {
      const res = (await api.promoteCurrent({ projectId: selectedProjectId, lastReadHash: '' })) as
        { status: string; conflictPath?: string; canonicalPath?: string }
      if (res.status === 'conflict') setPromoteMsg(`충돌: ${res.conflictPath} 생성됨 (current.md 유지).`)
      else setPromoteMsg(`current.md에 반영됨 (${res.canonicalPath}).`)
    } catch (e) {
      setPromoteMsg(`Promote 실패: ${e}`)
    }
  }

  const toggleGenerateCategory = (categoryId: GeneratePreflightCategoryId) => {
    const category = generatePreflight?.categories?.find((item) => item.id === categoryId)
    if (category?.required) return
    setSelectedCategoryIds((current) => (
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId]
    ))
  }

  const selectedGenerateCount = generatePreflight?.categories
    ?.filter((category) => selectedCategoryIds.includes(category.id))
    .reduce((sum, category) => sum + category.count, 0) ?? 0
  const requiredGenerateCategoriesSelected = generatePreflight?.categories
    ?.filter((category) => category.required)
    .every((category) => selectedCategoryIds.includes(category.id)) ?? false

  const runGenerateFromPreflight = () => {
    void generate(selectedCategoryIds)
  }

  return (
    <div className="add-project-overlay" onClick={closeModal}>
      <div className="add-project-dialog generate-preflight" onClick={(e) => e.stopPropagation()}>
        <div className="generate-preflight__header">
          <div>
            <h2>Generate preflight</h2>
            <p>{generatePreflight?.projectName ? `${generatePreflight.projectName} source scan` : 'Scan project sources before generation.'}</p>
          </div>
          <span className="generate-preflight__badge">
            {generating ? 'Generating' : preflighting ? 'Scanning' : `${selectedGenerateCount} selected`}
          </span>
        </div>

        {preflighting && <div className="generate-preflight__status">Scanning documents, tasks, runs, and local LLM CLI sources…</div>}

        {!preflighting && generatePreflight && !generatePreflight.ok && (
          <div className="generate-preflight__status generate-preflight__status--error">
            {generatePreflight.reason ?? 'Preflight failed.'}
          </div>
        )}

        {!preflighting && generatePreflight?.ok && !generation && (
          <>
            <div className="generate-preflight__summary">
              <span>Total found: {generatePreflight.totalCount ?? 0}</span>
              <span>{generatePreflight.status}</span>
            </div>
            <div className="generate-preflight__grid">
              {generatePreflight.categories?.map((category) => {
                const checked = selectedCategoryIds.includes(category.id)
                return (
                  <label key={category.id} className={`generate-preflight__card${checked ? ' selected' : ''}${category.required ? ' required' : ''}`}>
                    <span className="generate-preflight__card-top">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={generating || category.required}
                        onChange={() => toggleGenerateCategory(category.id)}
                      />
                      <span>{category.label}</span>
                      <b>{category.count}</b>
                    </span>
                    <small>{category.description}</small>
                    {category.required && <em>Required for the current session-based generator</em>}
                  </label>
                )
              })}
            </div>

            <div className="generate-preflight__confirm">
              <label>
                Engine
                <input aria-label="Engine" value={WIKI_GENERATION_ENGINE} readOnly disabled />
              </label>
              <p>Codex로만 생성합니다. 정확한 퍼센트 대신 현재 단계와 결과를 표시합니다.</p>
            </div>
          </>
        )}

        {generating && (
          <div className="generate-preflight__status">
            Generating with {WIKI_GENERATION_ENGINE}. The app is summarizing the latest matching LLM CLI session and writing a proposal…
          </div>
        )}

        {generation && (
          generation.ok ? (
          <>
            <h2>Generated ✓</h2>
            <p style={{ fontSize: '0.85rem' }}><b>Summary:</b> {generation.generation?.workSummary}</p>
            {!!generation.generation?.filesTouched.length && (
              <p style={{ fontSize: '0.8rem' }}><b>Files:</b> {generation.generation.filesTouched.join(', ')}</p>
            )}
            {!!generation.generation?.openProblems.length && (
              <p style={{ fontSize: '0.8rem' }}><b>Open problems:</b> {generation.generation.openProblems.join('; ')}</p>
            )}
            {!!generation.generation?.nextTasks.length && (
              <div style={{ fontSize: '0.8rem' }}>
                <b>Next tasks:</b>
                <ul style={{ marginLeft: 16 }}>
                  {generation.generation.nextTasks.map((t, i) => <li key={i}>{t.title}</li>)}
                </ul>
              </div>
            )}
            <p style={{ fontSize: '0.8rem', marginTop: 6 }}><b>current.md proposal:</b></p>
            <pre style={{ background: '#111', color: '#cfc', padding: 10, borderRadius: 6, maxHeight: 240, overflow: 'auto', fontSize: '0.78rem', whiteSpace: 'pre-wrap', margin: 0 }}>
              {generation.generation?.currentProposalMarkdown || '(no proposal)'}
            </pre>
            {promoteMsg && <p style={{ fontSize: '0.8rem', color: '#9cf' }}>{promoteMsg}</p>}
            <div className="add-project-dialog__actions">
              <button type="button" onClick={closeModal}>Close</button>
              <button type="button" disabled={!generation.proposalPath} onClick={handlePromote} style={{ background: '#2a4a2a', borderColor: '#4a8a4a' }}>
                Promote current
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Generate ✗</h2>
            <p style={{ fontSize: '0.85rem' }}>{generation.reason ?? 'failed'}</p>
          </>
          )
        )}

        {!generation && (
          <div className="add-project-dialog__actions">
            <button type="button" disabled={generating} onClick={closeModal}>Cancel</button>
            <button
              type="button"
              disabled={preflighting || generating || !generatePreflight?.ok || selectedCategoryIds.length === 0 || !requiredGenerateCategoriesSelected}
              onClick={runGenerateFromPreflight}
              style={{ background: '#2a4a2a', borderColor: '#4a8a4a' }}
            >
              {generating ? 'Generating…' : 'Proceed'}
            </button>
          </div>
        )}

        {generation && !generation.ok && (
          <div className="add-project-dialog__actions">
            <button type="button" onClick={closeModal}>Close</button>
          </div>
        )}
      </div>
    </div>
  )
}
