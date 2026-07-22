import { useEffect, useMemo, useRef, useState } from 'react'

type Props = {
  html: string
  targetLine?: number
}

export const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  'img-src data:',
  "style-src 'unsafe-inline'",
].join('; ')

/** Security metadata is emitted before every byte of user HTML. Later meta tags can only add policy. */
export function buildSandboxedHtmlDocument(html: string): string {
  return '<!doctype html><html><head>'
    + `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`
    + '<meta name="referrer" content="no-referrer">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '</head><body>'
    + html
    + '</body></html>'
}

function HtmlSource({ html, targetLine }: Props) {
  const lines = useMemo(() => html.split(/\r?\n/u), [html])
  const targetRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    targetRef.current?.scrollIntoView?.({ block: 'center' })
  }, [html, targetLine])

  return (
    <div className="html-source" aria-label="HTML source">
      {lines.map((line, index) => {
        const lineNumber = index + 1
        const target = lineNumber === targetLine
        return (
          <div
            key={lineNumber}
            ref={target ? targetRef : undefined}
            className={`html-source__line${target ? ' html-source__line--target' : ''}`}
            data-line={lineNumber}
          >
            <span aria-hidden="true">{lineNumber}</span>
            <code>{line || '\u00a0'}</code>
          </div>
        )
      })}
    </div>
  )
}

export function SandboxedHtmlPreview({ html, targetLine }: Props) {
  const [tab, setTab] = useState<'preview' | 'source'>(() => targetLine ? 'source' : 'preview')
  const srcDoc = useMemo(() => buildSandboxedHtmlDocument(html), [html])

  useEffect(() => setTab(targetLine ? 'source' : 'preview'), [html, targetLine])

  return (
    <section className="sandboxed-html-preview">
      <div className="sandboxed-html-preview__tabs" role="tablist" aria-label="HTML 보기 방식">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'preview'}
          onClick={() => setTab('preview')}
        >
          미리보기
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'source'}
          onClick={() => setTab('source')}
        >
          Source
        </button>
      </div>
      {tab === 'preview' ? (
        <iframe
          title="샌드박스 HTML 미리보기"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
        />
      ) : <HtmlSource html={html} targetLine={targetLine} />}
    </section>
  )
}
