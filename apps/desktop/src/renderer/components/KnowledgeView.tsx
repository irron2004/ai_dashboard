import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { useStore } from '../store.js'
import {
  artifactLabel, artifactToMarkdown, buildHarnessGraphData, buildLiveGraphData, isMarkdownArtifact, pickNodeArtifact,
  type GraphNodeRef, type HarnessRunBundle,
} from '../harness-utils.js'
import { GraphVisualization } from './GraphVisualization.js'
import { MarkdownContent } from './MarkdownContent.js'

type Mode = 'docs' | 'graph'
/** 트리/뷰어가 가리키는 문서: run 아티팩트 · 디스크의 md · staging의 생성된 노드(검수중). */
type DocRef = { kind: 'artifact'; path: string } | { kind: 'file'; relPath: string } | { kind: 'staged'; relPath: string }
const nodeIdOf = (rel: string): string => rel.replace(/^.*[\\/]/, '').replace(/\.md$/i, '')
/** 그래프 노드 미리보기. relPath가 있으면 디스크 폴백으로 연 파일(→ 문서 모드로 점프 가능). */
type Peek = { title: string; relPath?: string; markdown?: string; error?: string }

function latestWikiRun(runs: HarnessRunBundle[]): HarnessRunBundle | null {
  return runs.find((r) => ['MERGED', 'HUMAN_REVIEW_REQUIRED', 'VALIDATED'].includes(r.runState.state)) ?? runs[0] ?? null
}

export function KnowledgeView() {
  const { selectedProjectId, harnessRuns, harnessLiveNodes, harnessLiveNodesRunId, harnessLoading } = useStore()
  const [mode, setMode] = useState<Mode>('docs')
  const [selectedDoc, setSelectedDoc] = useState<DocRef | null>(null)
  const [fileContent, setFileContent] = useState<{ relPath: string; content: string } | { relPath: string; error: string } | null>(null)
  const [stagedContent, setStagedContent] = useState<{ relPath: string; content: string } | { relPath: string; error: string } | null>(null)
  const [projectDocs, setProjectDocs] = useState<{ relPath: string; mtimeMs: number }[]>([])
  const [peek, setPeek] = useState<Peek | null>(null)
  // 노드를 빠르게 연속 클릭할 때 늦게 도착한 디스크 응답이 최신 선택을 덮어쓰지 않도록.
  const peekReq = useRef(0)

  const run = useMemo(() => latestWikiRun(harnessRuns), [harnessRuns])
  const runId = run?.runState.runId
  const wikiArtifacts = useMemo(() => (run?.artifacts ?? []).filter(isMarkdownArtifact), [run])
  const graphData = useMemo(() => buildHarnessGraphData(run), [run])
  // The actual generated wiki nodes (staging md). Prefer what was really written (applied-write-report);
  // fall back to one doc per proposal. These are the browsable, [[link]]-navigable documents.
  const stagedDocs = useMemo(() => {
    const applied = (run?.artifacts.find((a) => a.name === 'applied-write-report')?.data as { applied?: string[] } | undefined)?.applied ?? []
    let docs = applied.filter((p) => /\.md$/i.test(p))
    if (docs.length === 0) {
      const props = (run?.artifacts.find((a) => a.name === 'node-proposals')?.data as { proposals?: { node?: { id?: string } }[] } | undefined)?.proposals ?? []
      docs = props.map((p) => p.node?.id).filter((id): id is string => !!id).map((id) => `nodes/${id}.md`)
    }
    return Array.from(new Set(docs)).sort()
  }, [run])
  // node id (filename stem) → staging relPath, so a [[node-id]] click can jump to the right doc.
  const stagedById = useMemo(() => new Map(stagedDocs.map((rel) => [nodeIdOf(rel), rel])), [stagedDocs])
  // While a run is generating, prefer the LIVE stream graph (nodes appear folder-by-folder); the richer
  // artifact graph takes over once the run finishes.
  const liveActive = harnessLoading && harnessLiveNodes.length > 0
  const liveGraph = useMemo(
    () => buildLiveGraphData(harnessLiveNodesRunId ?? 'run', harnessLiveNodes),
    [harnessLiveNodesRunId, harnessLiveNodes],
  )
  const effectiveGraph = liveActive ? liveGraph : graphData

  // Auto-reveal the graph the first time live nodes arrive for a run, so generation is visible.
  const revealedRunId = useRef<string | null>(null)
  useEffect(() => {
    if (liveActive && harnessLiveNodesRunId && revealedRunId.current !== harnessLiveNodesRunId) {
      revealedRunId.current = harnessLiveNodesRunId
      setMode('graph')
    }
  }, [liveActive, harnessLiveNodesRunId])

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

  // staging의 생성된 노드 로드 (선택이 staged일 때)
  useEffect(() => {
    if (!runId || selectedDoc?.kind !== 'staged') return
    const relPath = selectedDoc.relPath
    let stale = false
    void api.harnessReadStagedDoc({ runId, relPath }).then((res) => {
      if (stale) return
      setStagedContent(res.ok ? { relPath, content: res.content } : { relPath, error: res.reason ?? '읽기 실패' })
    }).catch(() => { if (!stale) setStagedContent({ relPath, error: '읽기 실패 (staging 채널 없음 — dev 재시작 필요)' }) })
    return () => { stale = true }
  }, [runId, selectedDoc])

  const selectedArtifact = selectedDoc?.kind === 'artifact'
    ? wikiArtifacts.find((a) => a.path === selectedDoc.path) ?? null
    : null
  // 선택한 파일과 로드된 내용의 relPath가 일치할 때만 사용 (전환 중 이전 파일 내용이 새는 것 방지).
  const loadedFile = selectedDoc?.kind === 'file' && fileContent?.relPath === selectedDoc.relPath ? fileContent : null
  const loadedStaged = selectedDoc?.kind === 'staged' && stagedContent?.relPath === selectedDoc.relPath ? stagedContent : null
  const viewerMarkdown = selectedArtifact
    ? artifactToMarkdown(selectedArtifact)
    : (loadedStaged && 'content' in loadedStaged) ? loadedStaged.content
    : (loadedFile && 'content' in loadedFile ? loadedFile.content : null)
  const viewerTitle = selectedArtifact
    ? artifactLabel(selectedArtifact.name)
    : selectedDoc?.kind === 'staged' ? nodeIdOf(selectedDoc.relPath)
    : selectedDoc?.kind === 'file' ? selectedDoc.relPath : wikiArtifacts[0] ? artifactLabel(wikiArtifacts[0].name) : '문서를 선택하세요'
  const fallbackMarkdown = !selectedDoc && wikiArtifacts[0] ? artifactToMarkdown(wikiArtifacts[0]) : null

  const openWikiLink = (target: string) => {
    // [[node-id]] → the matching generated wiki node (so the rendered graph is navigable like a wiki).
    const stagedRel = stagedById.get(target) ?? stagedById.get(nodeIdOf(target))
    if (stagedRel) { setSelectedDoc({ kind: 'staged', relPath: stagedRel }); return }
    const hit = run ? pickNodeArtifact(run.artifacts, { id: `document:${target}`, label: target }) : undefined
    if (hit) setSelectedDoc({ kind: 'artifact', path: hit.path })
  }

  const handleNodeClick = (node: GraphNodeRef) => {
    const reqId = ++peekReq.current
    const title = node.label ?? node.id
    const hit = run ? pickNodeArtifact(run.artifacts, node) : undefined
    if (hit && (isMarkdownArtifact(hit) || hit.name === 'git-diff-report' || hit.name === 'eval-report' || hit.name === 'final-policy-report')) {
      setPeek({ title, markdown: artifactToMarkdown(hit) })
      return
    }
    // Write-plan ops carry the staging-relative path WITH a leading `vault-staging/` (e.g.
    // `vault-staging/nodes/x.md`); readStagedDoc already resolves under <run>/vault-staging, so strip
    // that prefix or it doubles to <run>/vault-staging/vault-staging/... and every draft reads as missing.
    const nodePath = (node.data as { path?: string } | undefined)?.path?.replace(/^vault-staging[\\/]/, '')
    if (!nodePath || !/\.(md|mdx|txt)$/i.test(nodePath)) {
      setPeek({ title, error: nodePath ? `원문 없음: ${nodePath}` : '연결된 문서가 없는 노드입니다' })
      return
    }
    // Resolve the doc in order: the run's STAGED draft (unpromoted HUMAN_REVIEW output — concept/
    // decision md that isn't a run.artifact and isn't in the vault yet) → then a promoted/project doc
    // on disk. Without the staging read, draft nodes wrongly showed "원문 없음".
    const runId = run?.runState.runId
    void (async () => {
      if (runId) {
        try {
          const staged = await api.harnessReadStagedDoc({ runId, relPath: nodePath })
          if (reqId !== peekReq.current) return
          if (staged.ok) { setPeek({ title, relPath: nodePath, markdown: staged.content }); return }
        } catch { /* staging channel unavailable (e.g. dev hot-reload) — fall through to disk */ }
      }
      if (selectedProjectId) {
        const res = await api.fsReadDoc({ projectId: selectedProjectId, relPath: nodePath })
        if (reqId !== peekReq.current) return
        if (res.ok && res.content !== undefined) { setPeek({ title, relPath: nodePath, markdown: res.content }); return }
        setPeek({ title, error: `원문 없음: ${nodePath} (${res.reason ?? ''})` })
        return
      }
      setPeek({ title, error: `원문 없음: ${nodePath}` })
    })()
  }

  const openPeekAsDoc = (p: Peek) => {
    setMode('docs')
    if (p.relPath) {
      setSelectedDoc({ kind: 'file', relPath: p.relPath })
    } else {
      const hit = run ? pickNodeArtifact(run.artifacts, { id: `document:${p.title}`, label: p.title }) : undefined
      if (hit) setSelectedDoc({ kind: 'artifact', path: hit.path })
    }
    setPeek(null)
  }

  return (
    <section className="knowledge">
      <div className="knowledge__modebar">
        <div className="knowledge__seg">
          <button type="button" aria-pressed={mode === 'docs'} className={mode === 'docs' ? 'knowledge__seg-btn knowledge__seg-btn--on' : 'knowledge__seg-btn'} onClick={() => setMode('docs')}>문서</button>
          <button type="button" aria-pressed={mode === 'graph'} className={mode === 'graph' ? 'knowledge__seg-btn knowledge__seg-btn--on' : 'knowledge__seg-btn'} onClick={() => setMode('graph')}>그래프</button>
        </div>
        {liveActive && (
          <span className="knowledge__live" title="생성 중 — 노드가 폴더별로 추가됩니다">
            <span className="knowledge__live-dot" /> 생성 중 · {harnessLiveNodes.length}개 노드
          </span>
        )}
      </div>

      {mode === 'docs' ? (
        <div className="knowledge__docs">
          <aside className="knowledge__tree panel">
            <div className="knowledge__tree-group">🧩 노드 (생성됨{run?.runState.state === 'HUMAN_REVIEW_REQUIRED' ? ' · 검수중' : ''})</div>
            {stagedDocs.length === 0 && <div className="knowledge__tree-empty">아직 노드 없음 — ⚙ Wiki Gen에서 생성</div>}
            {stagedDocs.map((rel) => (
              <button key={rel} type="button"
                className={selectedDoc?.kind === 'staged' && selectedDoc.relPath === rel ? 'knowledge__tree-item knowledge__tree-item--on' : 'knowledge__tree-item'}
                onClick={() => setSelectedDoc({ kind: 'staged', relPath: rel })}>
                {nodeIdOf(rel)}
              </button>
            ))}
            {wikiArtifacts.length > 0 && <div className="knowledge__tree-group">리포트</div>}
            {wikiArtifacts.map((a) => (
              <button key={a.path} type="button"
                className={selectedDoc?.kind === 'artifact' && selectedDoc.path === a.path ? 'knowledge__tree-item knowledge__tree-item--on' : 'knowledge__tree-item'}
                onClick={() => setSelectedDoc({ kind: 'artifact', path: a.path })}>
                {artifactLabel(a.name)}
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
                : (loadedStaged && 'error' in loadedStaged)
                  ? <div className="knowledge__error">⚠ {loadedStaged.error}</div>
                  : loadedFile && 'error' in loadedFile
                    ? <div className="knowledge__error">⚠ {loadedFile.error}</div>
                    : (selectedDoc?.kind === 'file' || selectedDoc?.kind === 'staged')
                      ? <div className="knowledge__empty">로드 중…</div>
                      : <div className="knowledge__empty">왼쪽에서 문서를 선택하세요.</div>}
            </div>
          </main>
        </div>
      ) : (
        <div className={peek ? 'knowledge__graph knowledge__graph--peek' : 'knowledge__graph'}>
          <div className="knowledge__graph-canvas panel">
            <GraphVisualization data={effectiveGraph} onNodeClick={handleNodeClick} />
          </div>
          {peek && (
            <aside className="knowledge__peek panel">
              <header className="panel__header knowledge__peek-header">
                <h2>{peek.title}</h2>
                <div>
                  {peek.markdown && (
                    <button type="button" onClick={() => openPeekAsDoc(peek)}>문서로 열기 ↗</button>
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
