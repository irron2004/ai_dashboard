import type { KhCoverageReport } from '@apc/shared'

type Props = { data: KhCoverageReport; onOpenSource?: (path: string) => void }

export function CoverageMatrix({ data, onOpenSource }: Props) {
  const { totals, sources, nodes } = data
  const unmapped = sources.filter((s) => s.status === 'unmapped')

  return (
    <div className="coverage">
      <header className="coverage__summary" data-testid="coverage-summary">
        {totals.covered}/{totals.sourcesTotal} 반영 · {totals.unmapped} 누락
      </header>

      <div className="coverage__cols">
        <ul className="coverage__sources">
          {sources.map((s) => (
            <li key={s.path} className={`coverage__src coverage__src--${s.status}`}>
              <button type="button" onClick={() => onOpenSource?.(s.path)}>
                {s.status === 'covered' ? '✓' : '✗'} {s.path}
              </button>
              {s.status === 'covered' && s.citedBy.length > 0 && (
                <span className="coverage__cited"> → {s.citedBy.join(', ')}</span>
              )}
            </li>
          ))}
        </ul>
        <ul className="coverage__nodes">
          {nodes.map((n) => <li key={n.id} className="coverage__node">{n.title}</li>)}
        </ul>
      </div>

      <section className="coverage__unmapped" data-testid="coverage-unmapped">
        <h3>누락 {unmapped.length}건</h3>
        {unmapped.length === 0 ? (
          <p className="coverage__empty">누락 없음 — 전 문서 반영됨</p>
        ) : (
          <ul>
            {unmapped.map((s) => (
              <li key={s.path}>
                <button type="button" onClick={() => onOpenSource?.(s.path)}>{s.path}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
