import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  createElement,
  useMemo,
} from 'react'
import type { ResolvedFileReference } from '@apc/shared'
import {
  type ResolveFileReferences,
  useResolvedFileReferences,
} from './FileReferenceText.js'

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'table'; header: string[]; rows: string[][] }

function parseBlocks(source: string): Block[] {
  const lines = source.split(/\r?\n/)
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i += 1; continue }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] })
      i += 1
      continue
    }

    if (/^```/.test(line)) {
      const language = line.slice(3).trim()
      const code: string[] = []
      i += 1
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push({ type: 'code', language, code: code.join('\n') })
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [line.replace(/^>\s?/, '')]
      i += 1
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''))
        i += 1
      }
      blocks.push({ type: 'blockquote', text: quote.join(' ') })
      continue
    }

    if (/^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/, ''))
        i += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?[- ]+:?\s*(?:\|\s*:?[- ]+:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      const header = line.split('|').map((cell) => cell.trim()).filter(Boolean)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(lines[i].split('|').map((cell) => cell.trim()).filter(Boolean))
        i += 1
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }

    const paragraph: string[] = [line]
    i += 1
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s+/.test(lines[i]) && !/^```/.test(lines[i]) && !/^>\s?/.test(lines[i]) && !/^\s*(?:[-*+]\s+|\d+\.\s+)/.test(lines[i])) {
      paragraph.push(lines[i])
      i += 1
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
  }

  return blocks
}

type InlineContext = {
  onOpenWikiLink: (target: string) => void
  onOpenFileReference?: (reference: ResolvedFileReference) => void
  markdownReferences: ReadonlyMap<string, ResolvedFileReference>
}

function openMarkdownReference(
  event: ReactMouseEvent<HTMLAnchorElement> | ReactKeyboardEvent<HTMLAnchorElement>,
  reference: ResolvedFileReference,
  onOpen: (reference: ResolvedFileReference) => void,
): void {
  if ('key' in event) {
    if (event.key !== 'Enter' && event.key !== ' ') return
  } else if (!event.ctrlKey && !event.metaKey) {
    return
  }
  event.preventDefault()
  event.stopPropagation()
  onOpen(reference)
}

function tokenizeInline(text: string, context: InlineContext): ReactNode[] {
  const parts: ReactNode[] = []
  const onOpenFileReference = context.onOpenFileReference
  const pattern = /(\[\[[^\]]+\]\]|\[[^\]]+\]\((?:[^()]|\([^()]*\))+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('[[')) {
      const raw = token.slice(2, -2)
      const [target, alias] = raw.split('|')
      parts.push(
        <button key={`${match.index}:${token}`} type="button" className="markdown-viewer__wikilink" onClick={() => context.onOpenWikiLink(target.trim())}>
          {alias?.trim() || target.trim()}
        </button>,
      )
    } else if (token.startsWith('`')) {
      parts.push(<code key={`${match.index}:${token}`}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**')) {
      parts.push(<strong key={`${match.index}:${token}`}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*')) {
      parts.push(<em key={`${match.index}:${token}`}>{token.slice(1, -1)}</em>)
    } else {
      const link = /^\[([^\]]+)\]\(((?:[^()]|\([^()]*\))+)\)$/.exec(token)
      if (link) {
        const reference = context.markdownReferences.get(token)
        parts.push(
          <a
            key={`${match.index}:${token}`}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            className={reference ? 'markdown-viewer__file-reference' : undefined}
            title={reference ? `${reference.displayPath} · Ctrl/Cmd+클릭 또는 Enter로 미리보기` : undefined}
            onClick={reference && onOpenFileReference
              ? (event) => openMarkdownReference(event, reference, onOpenFileReference)
              : undefined}
            onKeyDown={reference && onOpenFileReference
              ? (event) => openMarkdownReference(event, reference, onOpenFileReference)
              : undefined}
          >
            {link[1]}
          </a>,
        )
      } else {
        parts.push(token)
      }
    }
    last = pattern.lastIndex
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function renderCode(code: string, language: string): ReactNode {
  const keywords = language.includes('json')
    ? ['true', 'false', 'null']
    : ['const', 'let', 'var', 'function', 'return', 'import', 'from', 'export', 'class', 'async', 'await', 'if', 'else', 'switch', 'case', 'for', 'while', 'try', 'catch', 'throw', 'new']

  const tokenPattern = new RegExp(`(//.*$|#.*$|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\\b(?:${keywords.join('|')})\\b|\\b\\d+(?:\\.\\d+)?\\b)`, 'g')

  return code.split(/\r?\n/).map((line, index) => {
    const tokens: ReactNode[] = []
    let last = 0
    let match: RegExpExecArray | null
    tokenPattern.lastIndex = 0
    while ((match = tokenPattern.exec(line))) {
      if (match.index > last) tokens.push(line.slice(last, match.index))
      const token = match[0]
      let className = 'md-code__token'
      if (/^\/\//.test(token) || /^#/.test(token)) className += ' md-code__token--comment'
      else if (/^"|^'/.test(token)) className += ' md-code__token--string'
      else if (/^\d/.test(token)) className += ' md-code__token--number'
      else className += ' md-code__token--keyword'
      tokens.push(<span key={`${index}:${match.index}:${token}`} className={className}>{token}</span>)
      last = match.index + token.length
    }
    if (last < line.length) tokens.push(line.slice(last))
    return <div key={`${index}:${line}`} className="md-code__line">{tokens}</div>
  })
}

function renderBlocks(blocks: Block[], context: InlineContext): ReactNode[] {
  return blocks.map((block, index) => {
    switch (block.type) {
      case 'heading':
        return createElement(`h${Math.min(block.level, 4)}`, { key: index, className: 'markdown-viewer__heading' }, tokenizeInline(block.text, context))
      case 'paragraph':
        return <p key={index}>{tokenizeInline(block.text, context)}</p>
      case 'blockquote':
        return <blockquote key={index}>{tokenizeInline(block.text, context)}</blockquote>
      case 'list':
        return block.ordered
          ? <ol key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{tokenizeInline(item, context)}</li>)}</ol>
          : <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{tokenizeInline(item, context)}</li>)}</ul>
      case 'table':
        {
          const table = block as Extract<Block, { type: 'table' }>
        return (
          <table key={index} className="markdown-viewer__table">
            <thead><tr>{table.header.map((cell, cellIndex) => <th key={cellIndex}>{tokenizeInline(cell, context)}</th>)}</tr></thead>
            <tbody>
              {table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{tokenizeInline(cell, context)}</td>)}</tr>)}
            </tbody>
          </table>
        )
        }
      case 'code':
        return (
          <pre key={index} className="markdown-viewer__code">
            <div className="markdown-viewer__code-lang">{block.language || 'text'}</div>
            <code>{renderCode(block.code, block.language)}</code>
          </pre>
        )
      default:
        return null
    }
  })
}

export type MarkdownContentProps = {
  markdown: string
  onOpenWikiLink: (target: string) => void
  projectId?: string
  activeWorktreePath?: string
  sessionWorkspacePath?: string
  resolveFileReferences?: ResolveFileReferences
  onOpenFileReference?: (reference: ResolvedFileReference) => void
}

export function MarkdownContent({
  markdown,
  onOpenWikiLink,
  projectId,
  activeWorktreePath,
  sessionWorkspacePath,
  resolveFileReferences,
  onOpenFileReference,
}: MarkdownContentProps) {
  const blocks = useMemo(() => parseBlocks(markdown), [markdown])
  const resolution = useResolvedFileReferences({
    text: markdown,
    projectId,
    activeWorktreePath,
    sessionWorkspacePath,
    resolveReferences: resolveFileReferences,
    enabled: Boolean(projectId && onOpenFileReference),
  })
  const markdownReferences = useMemo(() => new Map(
    resolution.resolved
      .filter((reference) => reference.form === 'markdown')
      .map((reference) => [reference.raw, reference] as const),
  ), [resolution.resolved])
  const context = useMemo<InlineContext>(() => ({
    onOpenWikiLink,
    onOpenFileReference,
    markdownReferences,
  }), [markdownReferences, onOpenFileReference, onOpenWikiLink])
  const reason = resolution.reason ?? resolution.unresolved[0]?.reason

  return (
    <>
      {renderBlocks(blocks, context)}
      {resolution.loading && resolution.candidates.length > 0 && (
        <span className="file-reference-text__notice" role="status">파일 경로 확인 중…</span>
      )}
      {reason && (
        <span className="file-reference-text__notice" role="status">파일 미리보기를 열 수 없습니다: {reason}</span>
      )}
    </>
  )
}
