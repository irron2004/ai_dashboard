import { useState } from 'react'

type Row = { id?: string; title: string; type?: string; source_proposal_id?: string; keep: boolean }

export function NodeConfirmPanel({ proposed, onConfirm }: {
  proposed: Array<{ id?: string; title: string; type?: string; source_proposal_id?: string }>
  onConfirm: (a: { nodes: Array<{ id?: string; title: string; type?: string; source_proposal_id?: string }> }) => void
}) {
  const [rows, setRows] = useState<Row[]>(proposed.map((p) => ({ ...p, keep: true })))
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, ...patch } : r))
  const confirm = () => onConfirm({ nodes: rows.filter((r) => r.keep).map(({ keep, ...n }) => n) })
  return (
    <div className="node-confirm">
      <h3>생성할 노드 확인</h3>
      <ul>
        {rows.map((r, i) => (
          <li key={r.source_proposal_id ?? r.id ?? i}>
            <input type="checkbox" aria-label={`keep ${r.title}`} checked={r.keep} onChange={(e) => set(i, { keep: e.target.checked })} />
            <input aria-label={`title ${i}`} value={r.title} onChange={(e) => set(i, { title: e.target.value })} />
            <button type="button" aria-label={`제거 ${r.title}`} onClick={() => set(i, { keep: false })}>제거</button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={confirm}>이대로 생성</button>
    </div>
  )
}
