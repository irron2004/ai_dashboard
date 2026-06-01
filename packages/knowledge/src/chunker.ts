export type MarkdownChunkDraft = {
  headingPath: string[]
  body: string
  ordinal: number
  tokenEstimate: number
}

export type ChunkOptions = { targetTokens?: number }

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3))
}

function headingLevel(line: string): number | undefined {
  const match = /^(#{1,6})\s+(.+)$/.exec(line)
  return match ? match[1].length : undefined
}

function headingTitle(line: string): string | undefined {
  return /^(#{1,6})\s+(.+)$/.exec(line)?.[2]?.trim()
}

export function chunkMarkdown(markdown: string, opts: ChunkOptions = {}): MarkdownChunkDraft[] {
  const target = opts.targetTokens ?? 900
  const lines = markdown.split('\n')
  const chunks: MarkdownChunkDraft[] = []
  const headings: string[] = []
  let current: string[] = []
  let currentHeadingPath: string[] = []
  let inFence = false

  const flush = () => {
    const body = current.join('\n').trim()
    if (!body) return
    chunks.push({ headingPath: currentHeadingPath, body, ordinal: chunks.length, tokenEstimate: estimateTokens(body) })
    current = []
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) inFence = !inFence
    const level = !inFence ? headingLevel(line) : undefined
    if (level) {
      flush()
      headings.splice(level - 1)
      headings[level - 1] = headingTitle(line) ?? line.replace(/^#+\s*/, '')
      currentHeadingPath = headings.filter(Boolean)
      current.push(line)
      continue
    }
    const nextBody = [...current, line].join('\n')
    if (!inFence && current.length > 0 && estimateTokens(nextBody) > target && line.trim() === '') {
      flush()
      currentHeadingPath = headings.filter(Boolean)
      continue
    }
    current.push(line)
  }
  flush()
  return chunks
}
