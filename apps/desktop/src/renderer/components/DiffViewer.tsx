import { useMemo } from 'react'
import { parseUnifiedDiff } from '../harness-utils.js'

type Props = {
  patch: string | null
}

export function DiffViewer({ patch }: Props) {
  const files = useMemo(() => (patch ? parseUnifiedDiff(patch) : []), [patch])

  return (
    <section className="panel diff-viewer">
      <header className="panel__header diff-viewer__header">
        <div>
          <h2>Diff Viewer</h2>
          <p>Side-by-side staging changes</p>
        </div>
      </header>

      {files.length === 0 ? (
        <div className="panel__empty">
          <p>No diff artifact available for this run.</p>
        </div>
      ) : (
        <div className="diff-viewer__files">
          {files.map((file) => (
            <article key={file.path} className="diff-viewer__file">
              <h3>{file.path}</h3>
              <div className="diff-viewer__grid">
                <div className="diff-viewer__column">
                  <div className="diff-viewer__column-heading">Before</div>
                  {file.rows.map((row, index) => (
                    <div key={`${file.path}:left:${index}`} className={row.kind === 'delete' ? 'diff-viewer__row diff-viewer__row--delete' : 'diff-viewer__row'}>
                      <span className="diff-viewer__lineno">{row.leftNumber ?? ''}</span>
                      <code>{row.left}</code>
                    </div>
                  ))}
                </div>
                <div className="diff-viewer__column">
                  <div className="diff-viewer__column-heading">After</div>
                  {file.rows.map((row, index) => (
                    <div key={`${file.path}:right:${index}`} className={row.kind === 'add' ? 'diff-viewer__row diff-viewer__row--add' : 'diff-viewer__row'}>
                      <span className="diff-viewer__lineno">{row.rightNumber ?? ''}</span>
                      <code>{row.right}</code>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
