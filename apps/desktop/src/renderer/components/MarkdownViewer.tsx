import { type ReactNode, createElement, useMemo } from 'react'
import {
  artifactLabel, artifactToMarkdown, extractWikiLinks, isMarkdownArtifact, type HarnessRunArtifact,
} from '../harness-utils.js'

type Props = {
  artifacts: HarnessRunArtifact[]
  selectedArtifactPath: string | null
  onSelectArtifactPath: (path: string) => void
  onOpenWikiLink: (target: string) => void
}

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

function tokenizeInline(text: string, onOpenWikiLink: (target: string) => void): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /(\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('[[')) {
      const raw = token.slice(2, -2)
      const [target, alias] = raw.split('|')
      parts.push(
        <button key={`${match.index}:${token}`} type="button" className="markdown-viewer__wikilink" onClick={() => onOpenWikiLink(target.trim())}>
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
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      if (link) {
        parts.push(
          <a key={`${match.index}:${token}`} href={link[2]} target="_blank" rel="noreferrer">
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

function renderBlocks(blocks: Block[], onOpenWikiLink: (target: string) => void): ReactNode[] {
  return blocks.map((block, index) => {
    switch (block.type) {
      case 'heading':
        return createElement(`h${Math.min(block.level, 4)}`, { key: index, className: 'markdown-viewer__heading' }, tokenizeInline(block.text, onOpenWikiLink))
      case 'paragraph':
        return <p key={index}>{tokenizeInline(block.text, onOpenWikiLink)}</p>
      case 'blockquote':
        return <blockquote key={index}>{tokenizeInline(block.text, onOpenWikiLink)}</blockquote>
      case 'list':
        return block.ordered
          ? <ol key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{tokenizeInline(item, onOpenWikiLink)}</li>)}</ol>
          : <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{tokenizeInline(item, onOpenWikiLink)}</li>)}</ul>
      case 'table':
        {
          const table = block as Extract<Block, { type: 'table' }>
        return (
          <table key={index} className="markdown-viewer__table">
            <thead><tr>{table.header.map((cell, cellIndex) => <th key={cellIndex}>{tokenizeInline(cell, onOpenWikiLink)}</th>)}</tr></thead>
            <tbody>
              {table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{tokenizeInline(cell, onOpenWikiLink)}</td>)}</tr>)}
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

export function MarkdownViewer({ artifacts, selectedArtifactPath, onSelectArtifactPath, onOpenWikiLink }: Props) {
  const artifactTabs = useMemo(() => artifacts.filter((artifact) => isMarkdownArtifact(artifact) || artifact.name === 'git-diff-report' || artifact.name === 'eval-report' || artifact.name === 'final-policy-report'), [artifacts])
  const selected = useMemo(() => artifactTabs.find((artifact) => artifact.path === selectedArtifactPath) ?? artifactTabs[0] ?? artifacts[0] ?? null, [artifactTabs, artifacts, selectedArtifactPath])
  const markdown = useMemo(() => (selected ? artifactToMarkdown(selected) : ''), [selected])
  const blocks = useMemo(() => parseBlocks(markdown), [markdown])

  return (
    <section className="panel markdown-viewer">
      <header className="panel__header markdown-viewer__header">
        <div>
          <h2>Markdown Viewer</h2>
          <p>{selected ? `${artifactLabel(selected.name)} · ${selected.state}` : 'No artifact selected'}</p>
        </div>
        <span className="markdown-viewer__count">{artifactTabs.length} docs</span>
      </header>

      <div className="markdown-viewer__tabs">
        {artifactTabs.map((artifact) => (
          <button
            key={artifact.path}
            type="button"
            className={artifact.path === selected?.path ? 'markdown-viewer__tab markdown-viewer__tab--active' : 'markdown-viewer__tab'}
            onClick={() => onSelectArtifactPath(artifact.path)}
          >
            <span>{artifactLabel(artifact.name)}</span>
            <small>{artifact.state}</small>
          </button>
        ))}
      </div>

      <div className="markdown-viewer__body">
        {blocks.length ? renderBlocks(blocks, onOpenWikiLink) : <div className="panel__empty"><p>Select an artifact to render.</p></div>}
      </div>

      {selected && extractWikiLinks(markdown).length > 0 && (
        <footer className="markdown-viewer__links">
          <h3>Wiki links</h3>
          <div className="markdown-viewer__link-list">
            {extractWikiLinks(markdown).map((link) => (
              <button key={`${link.target}:${link.alias}`} type="button" className="markdown-viewer__wikilink markdown-viewer__wikilink--chip" onClick={() => onOpenWikiLink(link.target)}>
                {link.alias}
              </button>
            ))}
          </div>
        </footer>
      )}
    </section>
  )
}
