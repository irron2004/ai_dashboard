import { type ReactNode, useEffect, useMemo, useRef } from 'react'

type Props = {
  code: string
  targetLine?: number
}

const PYTHON_KEYWORDS = [
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'case', 'class',
  'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
  'if', 'import', 'in', 'is', 'lambda', 'match', 'nonlocal', 'not', 'or', 'pass', 'raise',
  'return', 'try', 'while', 'with', 'yield',
]

const TOKEN_PATTERN = new RegExp(
  `(""".*?"""|'''.*?'''|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|#.*$|\\b(?:${PYTHON_KEYWORDS.join('|')})\\b|\\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\\d+(?:\\.\\d+)?)\\b)`,
  'g',
)

function tokenClass(token: string): string {
  if (token.startsWith('#')) return 'python-preview__token--comment'
  if (/^(?:"|')/u.test(token)) return 'python-preview__token--string'
  if (/^(?:\d|0[xXbB])/u.test(token)) return 'python-preview__token--number'
  return 'python-preview__token--keyword'
}

function tokenizeLine(line: string, lineIndex: number): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  TOKEN_PATTERN.lastIndex = 0
  for (let match = TOKEN_PATTERN.exec(line); match; match = TOKEN_PATTERN.exec(line)) {
    if (match.index > last) nodes.push(line.slice(last, match.index))
    nodes.push(
      <span key={`${lineIndex}:${match.index}`} className={`python-preview__token ${tokenClass(match[0])}`}>
        {match[0]}
      </span>,
    )
    last = match.index + match[0].length
  }
  if (last < line.length) nodes.push(line.slice(last))
  return nodes
}

/** Python source highlighting via React text nodes only; source is never interpreted as HTML. */
export function PythonCodePreview({ code, targetLine }: Props) {
  const lines = useMemo(() => code.split(/\r?\n/u), [code])
  const targetRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    targetRef.current?.scrollIntoView?.({ block: 'center' })
  }, [code, targetLine])

  return (
    <div className="python-preview" aria-label="Python source">
      {lines.map((line, index) => {
        const lineNumber = index + 1
        const target = lineNumber === targetLine
        const tokens = tokenizeLine(line, index)
        return (
          <div
            key={lineNumber}
            ref={target ? targetRef : undefined}
            className={`python-preview__line${target ? ' python-preview__line--target' : ''}`}
            data-line={lineNumber}
          >
            <span className="python-preview__line-number" aria-hidden="true">{lineNumber}</span>
            <code>{tokens.length ? tokens : '\u00a0'}</code>
          </div>
        )
      })}
    </div>
  )
}
