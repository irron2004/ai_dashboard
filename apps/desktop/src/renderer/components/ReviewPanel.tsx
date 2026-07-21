import { useEffect, useMemo, useState } from 'react'
import type { KhNodeProposal } from '@apc/shared'
import { api } from '../api.js'
import { parseUnifiedDiff } from '../harness-utils.js'
import { MarkdownContent } from './MarkdownContent.js'

export type EvidenceFinding = {
  proposal_id: string
  evidence_id: string
  source_path: string
  reason: string
}
export type PolicyViolation = {
  proposal_id: string
  rule: string
  severity: 'block' | 'warn'
  detail: string
}
export type ReviewVerdict = 'approved' | 'excluded'
export type ReviewFilter = 'all' | 'pending' | 'flagged' | 'approved' | 'excluded'

type Props = {
  runId: string
  projectId: string | null
  proposals: KhNodeProposal[]
  /** Soft verifier findings: an AI-provided quote may actually be a summary. */
  warnings: EvidenceFinding[]
  /** Blocking verifier findings: the cited immutable source itself could not be verified. */
  unverifiable: EvidenceFinding[]
  violations: PolicyViolation[]
  /** Full staging ↔ vault patch from git-diff-report. */
  diffPatch: string | null
  /** proposal_id → verdict. A missing key is pending. */
  decisions: Record<string, ReviewVerdict>
  onVerdict: (proposalIds: string[], verdict: ReviewVerdict | null) => void
  initialFilter?: ReviewFilter
}

const REASON_LABEL: Record<string, string> = {
  quote_not_found: 'AI가 제시한 인용이 원문과 정확히 일치하지 않아 요약으로 간주됨',
  source_not_found: '근거 소스 파일을 찾을 수 없음',
  path_escape: '근거 경로가 vault를 벗어남',
}
const RULE_LABEL: Record<string, string> = {
  no_evidence: '근거 또는 주장이 없음',
  shared_evidence_min: 'shared 노드는 근거 2개 이상 필요',
  secret: '근거 텍스트에 비밀정보로 의심되는 내용',
  raw_write: '쓰기 대상이 불변 raw/ 경로',
  delete: '삭제 작업은 금지',
  non_markdown_write: '쓰기 대상이 .md 파일이 아님',
  secret_in_write: '작성될 본문에 비밀정보 의심',
  canonical_overwrite: 'canonical 문서는 proposal_only여야 함',
}
const FILTERS: Array<{ id: ReviewFilter; label: string }> = [
  { id: 'all', label: '전체' },
  { id: 'pending', label: '미결' },
  { id: 'flagged', label: '경고' },
  { id: 'approved', label: '승인' },
  { id: 'excluded', label: '제외' },
]
const MAX_EXCERPTS = 8

type Excerpt = { matched: boolean; excerpt: string; line?: number }

function attentionScore(
  proposal: KhNodeProposal,
  warningCount: number,
  unverifiableCount: number,
  blockingPolicies: number,
  warningPolicies: number,
): number {
  return unverifiableCount * 150
    + blockingPolicies * 100
    + (proposal.evidence.length === 0 ? 60 : 0)
    + (proposal.risk?.level === 'high' ? 40 : 0)
    + warningPolicies * 10
    + warningCount
}

function verdictLabel(verdict: ReviewVerdict | undefined): string {
  if (verdict === 'approved') return '✓ 승인'
  if (verdict === 'excluded') return '✗ 제외'
  return '미결'
}

export function ReviewPanel({
  runId,
  projectId,
  proposals,
  warnings,
  unverifiable,
  violations,
  diffPatch,
  decisions,
  onVerdict,
  initialFilter,
}: Props) {
  const grouped = useMemo(() => {
    const warningMap = new Map<string, EvidenceFinding[]>()
    const unverifiableMap = new Map<string, EvidenceFinding[]>()
    const violationMap = new Map<string, PolicyViolation[]>()
    for (const finding of warnings) {
      warningMap.set(finding.proposal_id, [...(warningMap.get(finding.proposal_id) ?? []), finding])
    }
    for (const finding of unverifiable) {
      unverifiableMap.set(finding.proposal_id, [...(unverifiableMap.get(finding.proposal_id) ?? []), finding])
    }
    for (const violation of violations) {
      violationMap.set(violation.proposal_id, [...(violationMap.get(violation.proposal_id) ?? []), violation])
    }
    return { warnings: warningMap, unverifiable: unverifiableMap, violations: violationMap }
  }, [warnings, unverifiable, violations])

  const ordered = useMemo(() => [...proposals].sort((left, right) => {
    const leftPolicies = grouped.violations.get(left.proposal_id) ?? []
    const rightPolicies = grouped.violations.get(right.proposal_id) ?? []
    const leftScore = attentionScore(
      left,
      grouped.warnings.get(left.proposal_id)?.length ?? 0,
      grouped.unverifiable.get(left.proposal_id)?.length ?? 0,
      leftPolicies.filter((item) => item.severity === 'block').length,
      leftPolicies.filter((item) => item.severity === 'warn').length,
    )
    const rightScore = attentionScore(
      right,
      grouped.warnings.get(right.proposal_id)?.length ?? 0,
      grouped.unverifiable.get(right.proposal_id)?.length ?? 0,
      rightPolicies.filter((item) => item.severity === 'block').length,
      rightPolicies.filter((item) => item.severity === 'warn').length,
    )
    return rightScore - leftScore
  }), [grouped, proposals])

  const flagged = useMemo(() => new Set(proposals
    .filter((proposal) => proposal.evidence.length === 0
      || (grouped.warnings.get(proposal.proposal_id)?.length ?? 0) > 0
      || (grouped.unverifiable.get(proposal.proposal_id)?.length ?? 0) > 0
      || (grouped.violations.get(proposal.proposal_id)?.length ?? 0) > 0)
    .map((proposal) => proposal.proposal_id)), [grouped, proposals])

  const [filter, setFilter] = useState<ReviewFilter>(initialFilter ?? 'all')
  useEffect(() => { if (initialFilter) setFilter(initialFilter) }, [initialFilter])
  const visible = useMemo(() => ordered.filter((proposal) => {
    const verdict = decisions[proposal.proposal_id]
    if (filter === 'pending') return verdict === undefined
    if (filter === 'flagged') return flagged.has(proposal.proposal_id)
    if (filter === 'approved') return verdict === 'approved'
    if (filter === 'excluded') return verdict === 'excluded'
    return true
  }), [decisions, filter, flagged, ordered])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = visible.find((proposal) => proposal.proposal_id === selectedId) ?? visible[0] ?? null

  const [draft, setDraft] = useState<{ nodeId: string; content: string } | null>(null)
  const [draftLoading, setDraftLoading] = useState(false)
  useEffect(() => {
    if (!selected) { setDraft(null); setDraftLoading(false); return }
    let stale = false
    setDraft(null)
    setDraftLoading(true)
    void api.harnessReadStagedDoc({ runId, relPath: `nodes/${selected.node.id}.md` })
      .then((response) => {
        if (!stale) setDraft(response.ok ? { nodeId: selected.node.id, content: response.content } : null)
      })
      .catch(() => { if (!stale) setDraft(null) })
      .finally(() => { if (!stale) setDraftLoading(false) })
    return () => { stale = true }
  }, [projectId, runId, selected])

  const [excerpts, setExcerpts] = useState<Record<string, Excerpt | null>>({})
  useEffect(() => {
    if (!selected) { setExcerpts({}); return }
    let stale = false
    setExcerpts({})
    for (const evidence of selected.evidence.slice(0, MAX_EXCERPTS)) {
      void api.harnessReadSourceExcerpt({
        runId,
        sourcePath: evidence.source_path,
        quote: evidence.quote_or_summary || undefined,
      }).then((response) => {
        if (stale) return
        setExcerpts((current) => ({
          ...current,
          [evidence.evidence_id]: response.ok
            ? {
                matched: response.matched ?? false,
                excerpt: response.excerpt ?? '',
                line: response.line,
              }
            : null,
        }))
      }).catch(() => {
        if (!stale) setExcerpts((current) => ({ ...current, [evidence.evidence_id]: null }))
      })
    }
    return () => { stale = true }
  }, [runId, selected])

  const [sourceMessage, setSourceMessage] = useState<string | null>(null)
  const openSource = async (sourcePath: string) => {
    setSourceMessage(null)
    try {
      const response = await api.harnessOpenSourceFile({ runId, sourcePath })
      if (!response.ok) setSourceMessage(`원본 열기 실패: ${response.reason ?? 'unknown'}`)
    } catch (error) {
      setSourceMessage(`원본 열기 실패: ${String(error)}`)
    }
  }

  const diffFiles = useMemo(() => diffPatch ? parseUnifiedDiff(diffPatch) : [], [diffPatch])
  const nodeDiff = selected
    ? diffFiles.find((file) => file.path.replace(/\\/g, '/').endsWith(`nodes/${selected.node.id}.md`))
    : undefined
  const meaningfulDiffRows = nodeDiff?.rows.filter((row) => row.left.length > 0 || row.right.length > 0) ?? []
  const isNewFile = nodeDiff === undefined
    || (meaningfulDiffRows.length > 0 && meaningfulDiffRows.every((row) => row.kind === 'add'))

  if (proposals.length === 0) {
    return <div className="wikigen__placeholder">검수할 노드 제안이 없습니다.</div>
  }

  const evidenceBadge = (evidenceId: string, excerpt: Excerpt | null | undefined) => {
    if (unverifiable.some((finding) => finding.evidence_id === evidenceId)) {
      return <span className="review__flag review__flag--err">⛔ 원본 확인 불가</span>
    }
    if (warnings.some((finding) => finding.evidence_id === evidenceId)) {
      return <span className="review__flag review__flag--warn">⚠ AI 요약일 수 있음</span>
    }
    if (excerpt === undefined) return <span className="review__flag">원문 확인 중</span>
    if (excerpt === null) return <span className="review__flag review__flag--err">원문 읽기 실패</span>
    if (excerpt.matched) return <span className="review__flag review__flag--ok">✓ 원문 일치</span>
    return <span className="review__flag review__flag--warn">⚠ 인용 위치 못 찾음</span>
  }

  const selectedVerdict = selected ? decisions[selected.proposal_id] : undefined
  const visibleIds = visible.map((proposal) => proposal.proposal_id)

  return (
    <div className="review">
      <aside className="review__list" data-testid="review-list" aria-label="검수 항목">
        <div className="review__filters" aria-label="검수 필터">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              className={filter === id ? 'review__chip review__chip--on' : 'review__chip'}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="review__bulk">
          <button type="button" disabled={!visibleIds.length} onClick={() => onVerdict(visibleIds, 'approved')}>
            표시된 항목 모두 승인
          </button>
          <button type="button" disabled={!visibleIds.length} onClick={() => onVerdict(visibleIds, 'excluded')}>
            모두 제외
          </button>
          <button type="button" disabled={!visibleIds.length} onClick={() => onVerdict(visibleIds, null)}>
            판단 해제
          </button>
        </div>

        {visible.map((proposal) => {
          const warningCount = grouped.warnings.get(proposal.proposal_id)?.length ?? 0
          const unverifiableCount = grouped.unverifiable.get(proposal.proposal_id)?.length ?? 0
          const policies = grouped.violations.get(proposal.proposal_id) ?? []
          const blockingCount = policies.filter((item) => item.severity === 'block').length
          const verdict = decisions[proposal.proposal_id]
          return (
            <button
              key={proposal.proposal_id}
              type="button"
              className={selected?.proposal_id === proposal.proposal_id ? 'review__item review__item--on' : 'review__item'}
              onClick={() => setSelectedId(proposal.proposal_id)}
            >
              <span className="review__item-title">{proposal.node.title}</span>
              <span className="review__item-tags">
                <span className={`review__flag review__flag--${verdict ?? 'pending'}`}>{verdictLabel(verdict)}</span>
                <em className="review__type">{proposal.node.type.replace('Node', '')}</em>
                {proposal.evidence.length === 0 && <span className="review__flag review__flag--err">근거없음</span>}
                {unverifiableCount > 0 && <span className="review__flag review__flag--err">원본불가 {unverifiableCount}</span>}
                {blockingCount > 0 && <span className="review__flag review__flag--err">정책차단 {blockingCount}</span>}
                {proposal.risk?.level === 'high' && <span className="review__flag review__flag--warn">위험</span>}
                {warningCount > 0 && <span className="review__flag review__flag--warn">인용경고 {warningCount}</span>}
                {proposal.review?.requires_human_review && <span className="review__flag review__flag--ask">질문</span>}
              </span>
            </button>
          )
        })}
        {visible.length === 0 && <p className="review__empty">이 필터에 해당하는 항목이 없습니다.</p>}
      </aside>

      {selected && (
        <section className="review__detail" aria-label={`${selected.node.title} 검수 상세`}>
          <header className="review__detail-head">
            <div>
              <span className="review__eyebrow">AI 생성 노드 제안</span>
              <h3>{selected.node.title}</h3>
            </div>
            <span className={`review__status review__status--${selectedVerdict ?? 'pending'}`}>
              {verdictLabel(selectedVerdict)}
            </span>
          </header>

          <section className="review__section review__source" data-testid="review-source" aria-labelledby="review-source-title">
            <div className="review__section-head">
              <h4 id="review-source-title">📄 원본</h4>
              <span>raw 사본에서 직접 읽은 내용</span>
            </div>
            {selected.evidence.length === 0 && (
              <p className="review__warnline review__warnline--err">이 제안에는 연결된 원본 근거가 없습니다.</p>
            )}
            {selected.evidence.slice(0, MAX_EXCERPTS).map((evidence) => {
              const excerpt = excerpts[evidence.evidence_id]
              return (
                <article key={evidence.evidence_id} className="review__ev">
                  <div className="review__ev-head">
                    <button
                      type="button"
                      className="review__ev-src"
                      title="OS 기본 앱으로 원본 열기"
                      onClick={() => void openSource(evidence.source_path)}
                    >
                      {evidence.source_path}
                    </button>
                    {evidenceBadge(evidence.evidence_id, excerpt)}
                    {excerpt?.line !== undefined && <small>{excerpt.line}행 부근</small>}
                  </div>
                  {excerpt === undefined && <p className="review__loading">원문 문맥을 불러오는 중…</p>}
                  {excerpt === null && <p className="review__warnline review__warnline--err">원문 문맥을 읽지 못했습니다. 경로를 눌러 직접 확인하세요.</p>}
                  {excerpt && (
                    <>
                      {!excerpt.matched && evidence.quote_or_summary && (
                        <p className="review__excerpt-note">AI 인용 위치를 찾지 못해 파일 첫 부분을 표시합니다.</p>
                      )}
                      <pre className="review__excerpt" data-testid={`excerpt-${evidence.evidence_id}`}>{excerpt.excerpt}</pre>
                    </>
                  )}
                </article>
              )
            })}
            {selected.evidence.length > MAX_EXCERPTS && (
              <p className="review__muted">원문 {selected.evidence.length}개 중 처음 {MAX_EXCERPTS}개를 표시합니다.</p>
            )}
            {sourceMessage && <p className="review__warnline review__warnline--err">{sourceMessage}</p>}
          </section>

          <section className="review__section review__ai" data-testid="review-ai" aria-labelledby="review-ai-title">
            <div className="review__section-head">
              <h4 id="review-ai-title">🤖 AI 해석</h4>
              <span>아래 제목·요약·주장·판단은 모두 AI 산출물</span>
            </div>
            <div className="review__badges">
              <span className="review__badge">{selected.node.type}</span>
              <span className="review__badge">{selected.node.scope}</span>
              <span className="review__badge review__badge--muted">{selected.node.id}</span>
            </div>
            {selected.node.summary
              ? <p className="review__summary">{selected.node.summary}</p>
              : <p className="review__muted">AI 요약 없음</p>}

            {selected.evidence.some((evidence) => evidence.quote_or_summary) && (
              <div className="review__ai-quotes">
                <h5>AI가 제시한 인용/요약</h5>
                {selected.evidence.filter((evidence) => evidence.quote_or_summary).map((evidence) => (
                  <blockquote key={evidence.evidence_id}>
                    <span>{evidence.source_path}</span>
                    {evidence.quote_or_summary}
                  </blockquote>
                ))}
              </div>
            )}

            <div className="review__claims">
              <h5>📌 AI 주장 {selected.claims.length}개</h5>
              {selected.claims.length === 0 && <p className="review__muted">추출된 주장 없음</p>}
              {selected.claims.map((claim) => (
                <div key={claim.claim_id} className="review__claim">
                  <p>{claim.text}</p>
                  <span className="review__claim-meta">
                    {claim.claim_type && <em>{claim.claim_type}</em>}
                    {claim.confidence ? ` · 확신 ${claim.confidence}` : ''}
                    {claim.inference ? ' · 추론(AI가 원문에서 유추)' : ''}
                  </span>
                </div>
              ))}
            </div>

            <div className="review__opinions">
              <div className="review__opinion">
                <span className="review__agent">🔍 추출기 판단</span>
                <div>
                  {selected.risk && (
                    <p>위험도 <b className={`review__risk review__risk--${selected.risk.level}`}>{selected.risk.level}</b>{selected.risk.reason ? ` — ${selected.risk.reason}` : ''}</p>
                  )}
                  {selected.review?.reviewer_question && <p className="review__question">❓ {selected.review.reviewer_question}</p>}
                </div>
              </div>
              <div className="review__opinion">
                <span className="review__agent">✓ 근거 검증</span>
                <div>
                  {[...(grouped.unverifiable.get(selected.proposal_id) ?? []), ...(grouped.warnings.get(selected.proposal_id) ?? [])].length === 0
                    ? <p className="review__ok">등록된 근거 경로와 인용에 경고 없음</p>
                    : [...(grouped.unverifiable.get(selected.proposal_id) ?? []), ...(grouped.warnings.get(selected.proposal_id) ?? [])].map((finding, index) => (
                        <p key={`${finding.evidence_id}:${index}`} className={grouped.unverifiable.get(selected.proposal_id)?.includes(finding) ? 'review__warnline review__warnline--err' : 'review__warnline'}>
                          ⚠ {REASON_LABEL[finding.reason] ?? finding.reason} <small>({finding.source_path.split(/[\\/]/).pop()})</small>
                        </p>
                      ))}
                </div>
              </div>
              <div className="review__opinion">
                <span className="review__agent">🛡 정책 판단</span>
                <div>
                  {(grouped.violations.get(selected.proposal_id) ?? []).length === 0
                    ? <p className="review__ok">정책 위반 없음</p>
                    : (grouped.violations.get(selected.proposal_id) ?? []).map((violation, index) => (
                        <p key={`${violation.rule}:${index}`} className={violation.severity === 'block' ? 'review__warnline review__warnline--err' : 'review__warnline'}>
                          {violation.severity === 'block' ? '🚫' : '⚠'} {RULE_LABEL[violation.rule] ?? violation.rule} <small>{violation.detail}</small>
                        </p>
                      ))}
                </div>
              </div>
            </div>
          </section>

          <section className="review__section review__result" data-testid="review-result" aria-labelledby="review-result-title">
            <div className="review__section-head">
              <h4 id="review-result-title">📝 반영 결과</h4>
              <span>승인할 때 위키에 들어갈 staging 문서</span>
            </div>
            {nodeDiff && !isNewFile ? (
              <div className="review__diff" data-testid="review-diff" aria-label={`${nodeDiff.path} 변경 내용`}>
                <div className="review__diff-head">{nodeDiff.path}</div>
                {meaningfulDiffRows.map((row, index) => (
                  <div key={`${row.kind}:${index}`} className={`review__diff-row review__diff-row--${row.kind}`}>
                    <span>{row.kind === 'add' ? '+' : row.kind === 'delete' ? '−' : ' '}</span>
                    <small>{row.kind === 'add' ? row.rightNumber : row.leftNumber}</small>
                    <code>{row.kind === 'add' ? row.right : row.left}</code>
                  </div>
                ))}
              </div>
            ) : (
              <p className="review__new-file">🆕 신규 문서 — 승인하면 <code>nodes/{selected.node.id}.md</code>로 추가됩니다.</p>
            )}

            {draftLoading && <p className="review__loading">생성된 초안을 불러오는 중…</p>}
            {draft && draft.nodeId === selected.node.id ? (
              <details className="review__draft" open>
                <summary>생성된 초안 (staging)</summary>
                <MarkdownContent markdown={draft.content} onOpenWikiLink={() => { /* review is intentionally non-navigating */ }} />
              </details>
            ) : !draftLoading && <p className="review__muted">이 노드의 staging 초안을 찾지 못했습니다.</p>}
          </section>

          <div className="review__verdict" data-testid="review-verdict-bar">
            <button
              type="button"
              aria-pressed={selectedVerdict === 'approved'}
              className={selectedVerdict === 'approved' ? 'review__verdict-btn review__verdict-btn--approve review__verdict-btn--on' : 'review__verdict-btn review__verdict-btn--approve'}
              onClick={() => onVerdict([selected.proposal_id], selectedVerdict === 'approved' ? null : 'approved')}
            >
              ✓ 승인
            </button>
            <button
              type="button"
              aria-pressed={selectedVerdict === 'excluded'}
              className={selectedVerdict === 'excluded' ? 'review__verdict-btn review__verdict-btn--exclude review__verdict-btn--on' : 'review__verdict-btn review__verdict-btn--exclude'}
              onClick={() => onVerdict([selected.proposal_id], selectedVerdict === 'excluded' ? null : 'excluded')}
            >
              ✗ 제외
            </button>
            <span className="review__verdict-state">
              {selectedVerdict === 'approved'
                ? '승인됨 — 반영 대상'
                : selectedVerdict === 'excluded'
                  ? '제외됨 — 반영하지 않음'
                  : '미결 — 반영할 때 자동 제외'}
            </span>
          </div>
        </section>
      )}
    </div>
  )
}
