import type { KhNodeProposal } from '@apc/shared'

type Props = { proposals: KhNodeProposal[] }

export function ProposalsPanel({ proposals }: Props) {
  return (
    <div className="proposals">
      <header className="proposals__summary" data-testid="proposals-summary">노드 제안 {proposals.length}개</header>
      {proposals.length === 0 ? (
        <p className="proposals__empty">제안 없음</p>
      ) : (
        <ul className="proposals__list">
          {proposals.map((p) => {
            const noEvidence = p.evidence.length === 0
            const sources = Array.from(new Set(p.evidence.map((e) => e.source_path)))
            return (
              <li key={p.proposal_id} data-testid={`proposal-${p.node.id}`} className={`proposals__item${noEvidence ? ' proposals__item--warn' : ''}`}>
                <span className="proposals__title">{p.node.title}</span>
                <span className="proposals__type">{p.node.type}</span>
                <span className="proposals__meta">근거 {p.evidence.length} · 주장 {p.claims.length}{noEvidence ? ' · ⚠ 근거 없음' : ''}</span>
                {sources.length > 0 && <span className="proposals__sources">{sources.join(', ')}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
