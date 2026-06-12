import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { useStore } from '../store.js'
import {
  artifactLabel, artifactToMarkdown, buildHarnessGraphData, isMarkdownArtifact, pickNodeArtifact,
  type GraphNodeRef, type HarnessRunBundle,
} from '../harness-utils.js'
import { GraphVisualization } from './GraphVisualization.js'
import { MarkdownContent } from './MarkdownContent.js'

type Mode = 'docs' | 'graph'
/** 트리/뷰어가 가리키는 문서: run 아티팩트이거나 디스크의 md. */
type DocRef = { kind: 'artifact'; path: string } | { kind: 'file'; relPath: string }

function latestWikiRun(runs: HarnessRunBundle[]): HarnessRunBundle | null {
  return runs.find((r) => ['MERGED', 'HUMAN_REVIEW_REQUIRED', 'VALIDATED'].includes(r.runState.state)) ?? runs[0] ?? null
}

export function KnowledgeView() {
  const { selectedProjectId, harnessRuns } = useStore()
  const [mode, setMode] = useState<Mode>('docs')
  const [selectedDoc, setSelectedDoc] = useState<DocRef | null>(null)
  const [fileContent, setFileContent] = useState<{ relPath: string; content: string } | { relPath: string; error: string } | null>(null)
  const [projectDocs, setProjectDocs] = useState<{ relPath: string; mtimeMs: number }[]>([])
  const [peek, setPeek] = useState<{ title: string; markdown?: string; error?: string } | null>(null)

  const run = useMemo(() => latestWikiRun(harnessRuns), [harnessRuns])
  const wikiArtifacts = useMemo(() => (run?.artifacts ?? []).filter(isMarkdownArtifact), [run])
  const graphData = useMemo(() => buildHarnessGraphData(run), [run])

  useEffect(() => {
    if (!selectedProjectId) return
    let stale = false
    void api.fsListDocs({ projectId: selectedProjectId }).then((res) => {
      if (!stale) setProjectDocs(res.docs.filter((d) => /\.mdx?$/i.test(d.relPath)))
    })
    return () => { stale = true }
  }, [selectedProjectId])

  // 디스크 문서 로드 (선택이 file일 때)
  useEffect(() => {
    if (!selectedProjectId || selectedDoc?.kind !== 'file') return
    const relPath = selectedDoc.relPath
    let stale = false
    void api.fsReadDoc({ projectId: selectedProjectId, relPath }).then((res) => {
      if (stale) return
      setFileContent(res.ok && res.content !== undefined ? { relPath, content: res.content } : { relPath, error: res.reason ?? '읽기 실패' })
    })
    return () => { stale = true }
  }, [selectedProjectId, selectedDoc])

  const selectedArtifact = selectedDoc?.kind === 'artifact'
    ? wikiArtifacts.find((a) => a.path === selectedDoc.path) ?? null
    : null
  const viewerMarkdown = selectedArtifact
    ? artifactToMarkdown(selectedArtifact)
    : (fileContent && 'content' in fileContent ? fileContent.content : null)
  const viewerTitle = selectedArtifact
    ? artifactLabel(selectedArtifact.name)
    : selectedDoc?.kind === 'file' ? selectedDoc.relPath : wikiArtifacts[0] ? artifactLabel(wikiArtifacts[0].name) : '문서를 선택하세요'
  const fallbackMarkdown = !selectedDoc && wikiArtifacts[0] ? artifactToMarkdown(wikiArtifacts[0]) : null

  const openWikiLink = (target: string) => {
    const hit = run ? pickNodeArtifact(run.artifacts, { id: `document:${target}`, label: target }) : undefined
    if (hit) setSelectedDoc({ kind: 'artifact', path: hit.path })
  }

  const handleNodeClick = (node: GraphNodeRef) => {
    const title = node.label ?? node.id
    const hit = run ? pickNodeArtifact(run.artifacts, node) : undefined
    if (hit && (isMarkdownArtifact(hit) || hit.name === 'git-diff-report' || hit.name === 'eval-report' || hit.name === 'final-policy-report')) {
      setPeek({ title, markdown: artifactToMarkdown(hit) })
      return
    }
    const nodePath = (node.data as { path?: string } | undefined)?.path
    if (nodePath && selectedProjectId && /\.(md|mdx|txt)$/i.test(nodePath)) {
      void api.fsReadDoc({ projectId: selectedProjectId, relPath: nodePath }).then((res) => {
        setPeek(res.ok && res.content !== undefined ? { title, markdown: res.content } : { title, error: `원문 없음: ${nodePath} (${res.reason ?? ''})` })
      })
      return
    }
    setPeek({ title, error: nodePath ? `원문 없음: ${nodePath}` : '연결된 문서가 없는 노드입니다' })
  }

  return (
    <section className="knowledge">
      <div className="knowledge__modebar">
        <div className="knowledge__seg">
          <button type="button" aria-selected={mode === 'docs'} className={mode === 'docs' ? 'knowledge__seg-btn knowledge__seg-btn--on' : 'knowledge__seg-btn'} onClick={() => setMode('docs')}>문서</button>
          <button type="button" aria-selected={mode === 'graph'} className={mode === 'graph' ? 'knowledge__seg-btn knowledge__seg-btn--on' : 'knowledge__seg-btn'} onClick={() => setMode('graph')}>그래프</button>
        </div>
      </div>

      {mode === 'docs' ? (
        <div className="knowledge__docs">
          <aside className="knowledge__tree panel">
            <div className="knowledge__tree-group">위키 (생성됨)</div>
            {wikiArtifacts.length === 0 && <div className="knowledge__tree-empty">아직 위키 없음 — ⚙ Wiki Gen에서 생성</div>}
            {wikiArtifacts.map((a) => (
              <button key={a.path} type="button"
                className={selectedDoc?.kind === 'artifact' && selectedDoc.path === a.path ? 'knowledge__tree-item knowledge__tree-item--on' : 'knowledge__tree-item'}
                onClick={() => setSelectedDoc({ kind: 'artifact', path: a.path })}>
                {a.name.replace(/-/g, ' ')}
              </button>
            ))}
            <div className="knowledge__tree-group">프로젝트 문서</div>
            {projectDocs.map((d) => (
              <button key={d.relPath} type="button"
                className={selectedDoc?.kind === 'file' && selectedDoc.relPath === d.relPath ? 'knowledge__tree-item knowledge__tree-item--on' : 'knowledge__tree-item'}
                onClick={() => setSelectedDoc({ kind: 'file', relPath: d.relPath })}>
                {d.relPath}
              </button>
            ))}
          </aside>
          <main className="knowledge__viewer panel">
            <header className="panel__header"><h2>{viewerTitle}</h2></header>
            <div className="knowledge__viewer-body">
              {viewerMarkdown ?? fallbackMarkdown
                ? <MarkdownContent markdown={(viewerMarkdown ?? fallbackMarkdown)!} onOpenWikiLink={openWikiLink} />
                : fileContent && 'error' in fileContent
                  ? <div className="knowledge__error">⚠ {fileContent.error}</div>
                  : <div className="knowledge__empty">왼쪽에서 문서를 선택하세요.</div>}
            </div>
          </main>
        </div>
      ) : (
        <div className={peek ? 'knowledge__graph knowledge__graph--peek' : 'knowledge__graph'}>
          <div className="knowledge__graph-canvas panel">
            <GraphVisualization data={graphData} onNodeClick={handleNodeClick} />
          </div>
          {peek && (
            <aside className="knowledge__peek panel">
              <header className="panel__header knowledge__peek-header">
                <h2>{peek.title}</h2>
                <div>
                  {peek.markdown && (
                    <button type="button" onClick={() => {
                      const hit = run ? pickNodeArtifact(run.artifacts, { id: `document:${peek.title}`, label: peek.title }) : undefined
                      setMode('docs')
                      if (hit) setSelectedDoc({ kind: 'artifact', path: hit.path })
                      setPeek(null)
                    }}>문서로 열기 ↗</button>
                  )}
                  <button type="button" onClick={() => setPeek(null)} aria-label="미리보기 닫기">✕</button>
                </div>
              </header>
              <div className="knowledge__peek-body">
                {peek.markdown
                  ? <MarkdownContent markdown={peek.markdown} onOpenWikiLink={openWikiLink} />
                  : <div className="knowledge__error">⚠ {peek.error}</div>}
              </div>
            </aside>
          )}
        </div>
      )}
    </section>
  )
}
