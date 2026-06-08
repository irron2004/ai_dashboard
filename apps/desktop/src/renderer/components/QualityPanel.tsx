import type { KhEvalReport } from '@apc/shared'

type Row = { key: string; label: string; value: number | string; warn?: boolean }
type Group = { title: string; rows: Row[] }
type Props = { data: KhEvalReport }

export function QualityPanel({ data }: Props) {
  const ev = data.evidence_quality
  const gq = data.graph_quality
  const sf = data.safety
  const us = data.usefulness
  const groups: Group[] = [
    { title: '근거 품질', rows: [
      { key: 'node_proposals_total', label: '노드 제안 수', value: ev.node_proposals_total },
      { key: 'proposals_without_evidence', label: '근거 없는 제안', value: ev.proposals_without_evidence, warn: ev.proposals_without_evidence > 0 },
      { key: 'proposals_with_minimum_evidence', label: '최소 근거 충족', value: ev.proposals_with_minimum_evidence },
      { key: 'inference_without_note', label: '추론(근거주석 없음)', value: ev.inference_without_note, warn: ev.inference_without_note > 0 },
    ] },
    { title: '그래프 무결성', rows: [
      { key: 'orphan_nodes', label: '고아 노드', value: gq.orphan_nodes },
      { key: 'duplicate_candidates', label: '중복 후보', value: gq.duplicate_candidates, warn: gq.duplicate_candidates > 0 },
      { key: 'broken_links', label: '깨진 링크', value: gq.broken_links, warn: gq.broken_links > 0 },
      { key: 'missing_backlinks', label: '누락 백링크', value: gq.missing_backlinks },
    ] },
    { title: '안전성', rows: [
      { key: 'raw_modified', label: 'raw 변경됨', value: sf.raw_modified ? 'YES' : 'no', warn: sf.raw_modified },
      { key: 'secret_warnings', label: 'secret 경고', value: sf.secret_warnings, warn: sf.secret_warnings > 0 },
      { key: 'canonical_direct_overwrite_attempts', label: 'canonical 덮어쓰기 시도', value: sf.canonical_direct_overwrite_attempts, warn: sf.canonical_direct_overwrite_attempts > 0 },
      { key: 'delete_attempts', label: 'delete 시도', value: sf.delete_attempts, warn: sf.delete_attempts > 0 },
    ] },
    { title: '유용성', rows: [
      { key: 'current_update_proposals', label: 'current 업데이트 제안', value: us.current_update_proposals },
      { key: 'next_task_candidates', label: '다음 task 후보', value: us.next_task_candidates },
      { key: 'shared_promotion_candidates', label: 'shared 승격 후보', value: us.shared_promotion_candidates },
    ] },
  ]

  return (
    <div className="quality">
      {groups.map((g) => (
        <section key={g.title} className="quality__group">
          <h3 className="quality__title">{g.title}</h3>
          <ul className="quality__rows">
            {g.rows.map((r) => (
              <li key={r.key} data-testid={`q-${r.key}`} className={`quality__row${r.warn ? ' quality__row--warn' : ''}`}>
                <span className="quality__label">{r.label}</span>
                <span className="quality__value">{r.value}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
