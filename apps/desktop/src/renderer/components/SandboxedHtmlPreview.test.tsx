import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import {
  HTML_PREVIEW_CSP,
  SandboxedHtmlPreview,
  buildSandboxedHtmlDocument,
} from './SandboxedHtmlPreview.js'

const hostileHtml = `<!doctype html><html><head>
  <script>fetch('https://example.test'); window.open('https://popup.test'); top.location='https://top.test'</script>
  </head><body><form action="https://submit.test"><button>send</button></form>
  <iframe src="https://frame.test"></iframe><img src="https://image.test/a.png">
  </body></html>`

describe('SandboxedHtmlPreview', () => {
  test('places CSP before hostile source and grants no iframe sandbox capability', () => {
    const { container } = render(<SandboxedHtmlPreview html={hostileHtml} />)
    const iframe = container.querySelector('iframe')!
    const srcDoc = iframe.getAttribute('srcdoc')!

    expect(iframe.getAttribute('sandbox')).toBe('')
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(iframe.getAttribute('allow')).toBeNull()
    expect(srcDoc.indexOf('Content-Security-Policy')).toBeLessThan(srcDoc.indexOf('<script>'))
    for (const directive of [
      "default-src 'none'", "script-src 'none'", "connect-src 'none'", "object-src 'none'",
      "frame-src 'none'", "form-action 'none'", "base-uri 'none'", 'img-src data:', "style-src 'unsafe-inline'",
    ]) expect(srcDoc).toContain(directive)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('form')).toBeNull()
  })

  test('uses Source by default for a line target and highlights that exact line', () => {
    const html = '<main>one</main>\n<section>two</section>\n<footer>three</footer>'
    const { container } = render(<SandboxedHtmlPreview html={html} targetLine={2} />)
    expect(screen.getByRole('tab', { name: 'Source' }).getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('[data-line="2"]')?.className).toContain('html-source__line--target')
    expect(container.querySelector('iframe')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '미리보기' }))
    expect(container.querySelector('iframe')).not.toBeNull()
  })

  test('always wraps raw HTML in the fixed security document', () => {
    const document = buildSandboxedHtmlDocument('</head><meta http-equiv="refresh" content="0;url=https://escape.test"><body>x')
    expect(document).toContain(HTML_PREVIEW_CSP)
    expect(document.startsWith('<!doctype html><html><head><meta http-equiv="Content-Security-Policy"')).toBe(true)
  })
})
