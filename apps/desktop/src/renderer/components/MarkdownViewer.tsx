import { useMemo } from 'react'
import {
  artifactLabel, artifactToMarkdown, extractWikiLinks, isMarkdownArtifact, type HarnessRunArtifact,
} from '../harness-utils.js'
import { MarkdownContent } from './MarkdownContent.js'

type Props = {
  artifacts: HarnessRunArtifact[]
  selectedArtifactPath: string | null
  onSelectArtifactPath: (path: string) => void
  onOpenWikiLink: (target: string) => void
}

export function MarkdownViewer({ artifacts, selectedArtifactPath, onSelectArtifactPath, onOpenWikiLink }: Props) {
  const artifactTabs = useMemo(() => artifacts.filter((artifact) => isMarkdownArtifact(artifact) || artifact.name === 'git-diff-report' || artifact.name === 'eval-report' || artifact.name === 'final-policy-report'), [artifacts])
  const selected = useMemo(() => artifactTabs.find((artifact) => artifact.path === selectedArtifactPath) ?? artifactTabs[0] ?? artifacts[0] ?? null, [artifactTabs, artifacts, selectedArtifactPath])
  const markdown = useMemo(() => (selected ? artifactToMarkdown(selected) : ''), [selected])

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
        {markdown ? <MarkdownContent markdown={markdown} onOpenWikiLink={onOpenWikiLink} /> : <div className="panel__empty"><p>Select an artifact to render.</p></div>}
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
