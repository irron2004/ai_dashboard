export type SourceExcerpt = { matched: boolean; excerpt: string; line?: number }

const DEFAULT_CONTEXT_LINES = 5

/** 공백 붕괴 + 소문자 정규화 뷰와 정규화 인덱스→원문 오프셋 맵을 함께 만든다. */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = ''
  const map: number[] = []
  let pendingSpace = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      pendingSpace = norm.length > 0
      continue
    }
    if (pendingSpace) {
      norm += ' '
      map.push(i)
      pendingSpace = false
    }
    norm += ch.toLowerCase()
    map.push(i)
  }
  return { norm, map }
}

/** 인용문 주변 원문 ±contextLines줄을 돌려준다. 미매칭이면 파일 머리를 폴백으로 준다. */
export function extractSourceExcerpt(
  text: string,
  quote: string | undefined,
  contextLines = DEFAULT_CONTEXT_LINES,
): SourceExcerpt {
  const lines = text.split(/\r?\n/)
  const head = lines.slice(0, contextLines * 2 + 1).join('\n')
  const normQuote = (quote ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!normQuote) return { matched: false, excerpt: head }
  const { norm, map } = normalizeWithMap(text)
  const idx = norm.indexOf(normQuote)
  if (idx < 0 || map[idx] === undefined) return { matched: false, excerpt: head }
  const line = text.slice(0, map[idx]).split(/\r?\n/).length
  const start = Math.max(0, line - 1 - contextLines)
  const end = Math.min(lines.length, line + contextLines)
  return { matched: true, excerpt: lines.slice(start, end).join('\n'), line }
}
