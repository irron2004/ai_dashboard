import { useEffect, useMemo, useState } from 'react'
import type { KhNodeProposal } from '@apc/shared'
import { api } from '../api.js'
import { MarkdownContent } from './MarkdownContent.js'

export type EvidenceFinding = { proposal_id: string; evidence_id: string; source_path: string; reason: string }
export type PolicyViolation = { proposal_id: string; rule: string; severity: 'block' | 'warn'; detail: string }

type Props = {
  runId: string
  projectId: string | null
  proposals: KhNodeProposal[]
  /** EvidenceVerifier soft findings (quote not verbatim, etc.) — the verifier agent's per-evidence opinion. */
  warnings: EvidenceFinding[]
  /** PolicyGuard violations — the policy agent's per-proposal opinion. */
  violations: PolicyViolation[]
}

const REASON_LABEL: Record<string, string> = {
  quote_not_found: '인용이 원문과 정확히 일치하지 않음 — 요약으로 간주됨',
  source_not_found: '근거 소스 파일을 찾을 수 없음',
  path_escape: '근거 경로가 vault를 벗어남',
}
const RULE_LABEL: Record<string, string> = {
  no_evidence: '근거 또는 주장이 없음',
  shared_evidence_min: 'shared 노드는 근거 2개 이상 필요',
  secret: '근거 텍스트에 비밀정보(키 등)로 의심되는 내용',
  raw_write: '쓰기 대상이 불변 raw/ 경로',
  delete: '삭제 작업은 금지',
  non_markdown_write: '쓰기 대상이 .md 파일이 아님',
  secret_in_write: '작성될 본문에 비밀정보 의심',
  canonical_overwrite: 'canonical 문서는 proposal_only여야 함',
}

/** Severity score for ordering: surface the proposals that most need a human first. */
function attentionScore(p: KhNodeProposal, w: number, blocks: number, warnViol: number): number {
  return blocks * 100 + (p.evidence.length === 0 ? 60 : 0) + (p.risk?.level === 'high' ? 40 : 0) + warnViol * 10 + w
}

export function ReviewPanel({ runId, projectId, proposals, warnings, violations }: Props) {
  const grouped = useMemo(() => {
    const w = new Map<string, EvidenceFinding[]>()
    for (const x of warnings) w.set(x.proposal_id, [...(w.get(x.proposal_id) ?? []), x])
    const v = new Map<string, PolicyViolation[]>()
    for (const x of violations) v.set(x.proposal_id, [...(v.get(x.proposal_id) ?? []), x])
    return { w, v }
  }, [warnings, violations])

  const ordered = useMemo(() => {
    return [...proposals].sort((a, b) => {
      const wa = grouped.w.get(a.proposal_id) ?? [], wb = grouped.w.get(b.proposal_id) ?? []
      const va = grouped.v.get(a.proposal_id) ?? [], vb = grouped.v.get(b.proposal_id) ?? []
      const sa = attentionScore(a, wa.length, va.filter(x => x.severity === 'block').length, va.filter(x => x.severity === 'warn').length)
      const sb = attentionScore(b, wb.length, vb.filter(x => x.severity === 'block').length, vb.filter(x => x.severity === 'warn').length)
      return sb - sa
    })
  }, [proposals, grouped])

  const [selId, setSelId] = useState<string | null>(null)
  const selected = ordered.find(p => p.proposal_id === selId) ?? ordered[0] ?? null

  // Best-effort: load the rendered staging draft for the selected node (named nodes/<id>.md). Missing is fine —
  // the structured content below is the authoritative review surface.
  const [draft, setDraft] = useState<{ id: string; content: string } | null>(null)
  useEffect(() => {
    if (!selected) { setDraft(null); return }
    const node = selected.node
    let stale = false
    void api.harnessReadStagedDoc({ runId, relPath: `nodes/${node.id}.md` }).then((res) => {
      if (!stale) setDraft(res.ok ? { id: node.id, content: res.content } : null)
    }).catch(() => { if (!stale) setDraft(null) })
    return () => { stale = true }
  }, [selected, runId, projectId])

  if (proposals.length === 0) return <div className="wikigen__placeholder">검수할 노드 제안이 없습니다.</div>

  return (
    <div className="review">
      <aside className="review__list">
        {ordered.map((p) => {
          const w = grouped.w.get(p.proposal_id) ?? []
          const v = grouped.v.get(p.proposal_id) ?? []
          const blocks = v.filter(x => x.severity === 'block').length
          const on = (selected?.proposal_id === p.proposal_id)
          return (
            <button key={p.proposal_id} type="button" className={on ? 'review__item review__item--on' : 'review__item'} onClick={() => setSelId(p.proposal_id)}>
              <span className="review__item-title">{p.node.title}</span>
              <span className="review__item-tags">
                <em className="review__type">{p.node.type.replace('Node', '')}</em>
                {p.evidence.length === 0 && <span className="review__flag review__flag--err">근거없음</span>}
                {blocks > 0 && <span className="review__flag review__flag--err">정책차단 {blocks}</span>}
                {p.risk?.level === 'high' && <span className="review__flag review__flag--warn">위험</span>}
                {w.length > 0 && <span className="review__flag">인용 {w.length}</span>}
                {p.review?.requires_human_review && <span className="review__flag review__flag--ask">질문</span>}
              </span>
            </button>
          )
        })}
      </aside>

      {selected && (
        <section className="review__detail">
          <header className="review__detail-head">
            <h3>{selected.node.title}</h3>
            <div className="review__badges">
              <span className="review__badge">{selected.node.type}</span>
              <span className="review__badge">{selected.node.scope}</span>
              <span className="review__badge review__badge--muted">{selected.node.id}</span>
            </div>
            {selected.node.summary && <p className="review__summary">{selected.node.summary}</p>}
          </header>

          {/* (c) agents' opinions on this node */}
          <div className="review__opinions">
            <h4>🧠 에이전트 의견</h4>
            <div className="review__opinion">
              <span className="review__agent">🔍 추출기</span>
              <div>
                {selected.risk && <p>위험도 <b className={`review__risk review__risk--${selected.risk.level}`}>{selected.risk.level}</b> — {selected.risk.reason}</p>}
                {selected.review?.reviewer_question && <p className="review__question">❓ {selected.review.reviewer_question}</p>}
              </div>
            </div>
            <div className="review__opinion">
              <span className="review__agent">✓ 근거검증</span>
              <div>
                {(grouped.w.get(selected.proposal_id) ?? []).length === 0
                  ? <p className="review__ok">모든 근거 인용 검증됨</p>
                  : (grouped.w.get(selected.proposal_id) ?? []).map((f, i) => (
                    <p key={i} className="review__warnline">⚠ {REASON_LABEL[f.reason] ?? f.reason} <small>({f.source_path.split(/[\\/]/).pop()})</small></p>
                  ))}
              </div>
            </div>
            <div className="review__opinion">
              <span className="review__agent">🛡 정책</span>
              <div>
                {(grouped.v.get(selected.proposal_id) ?? []).length === 0
                  ? <p className="review__ok">정책 위반 없음</p>
                  : (grouped.v.get(selected.proposal_id) ?? []).map((v, i) => (
                    <p key={i} className={v.severity === 'block' ? 'review__warnline review__warnline--err' : 'review__warnline'}>
                      {v.severity === 'block' ? '🚫' : '⚠'} {RULE_LABEL[v.rule] ?? v.rule} <small>{v.detail}</small>
                    </p>
                  ))}
              </div>
            </div>
          </div>

          {/* (b) the proposed node's claims + evidence = the reviewable content */}
          <div className="review__claims">
            <h4>📌 주장 {selected.claims.length}개</h4>
            {selected.claims.map((c) => (
              <div key={c.claim_id} className="review__claim">
                <p>{c.text}</p>
                <span className="review__claim-meta">
                  {c.claim_type ? <em>{c.claim_type}</em> : null}
                  {c.confidence ? ` · 확신 ${c.confidence}` : ''}
                  {c.inference ? ' · 추론' : ''}
                </span>
              </div>
            ))}
          </div>

          <div className="review__evidence">
            <h4>🔗 근거 {selected.evidence.length}개</h4>
            {selected.evidence.map((e) => (
              <div key={e.evidence_id} className="review__ev">
                <span className="review__ev-src">{e.source_path}</span>
                {e.quote_or_summary && <blockquote>{e.quote_or_summary}</blockquote>}
              </div>
            ))}
          </div>

          {draft && draft.id === selected.node.id && (
            <details className="review__draft">
              <summary>📄 생성된 초안 (staging)</summary>
              <MarkdownContent markdown={draft.content} onOpenWikiLink={() => { /* 검수 화면에서는 링크 점프 비활성 */ }} />
            </details>
          )}
        </section>
      )}
    </div>
  )
}
