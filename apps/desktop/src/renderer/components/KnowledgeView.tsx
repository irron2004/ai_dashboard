import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { useStore } from '../store.js'
import {
  artifactLabel, artifactToMarkdown, buildHarnessGraphData, buildLiveGraphData, buildPaperGraphData, buildWikiGraphData, isMarkdownArtifact, pickNodeArtifact,
  resolveStagedRel,
  type GraphNodeRef, type HarnessRunBundle,
} from '../harness-utils.js'
import { GraphVisualization } from './GraphVisualization.js'
import { MarkdownContent } from './MarkdownContent.js'
import type { StagedDocDto, GraphEdgeDto, ReadProjectWikiRes } from '../../shared/ipc-contract.js'
import { buildWorkGraphData } from '@apc/graph-view'
import type { Task } from '@apc/shared'

type Mode = 'docs' | 'graph'
type TaskNodeDetail = { kind: 'task'; id: string; label: string; todos: { title: string; status: string }[]; sessionId?: string }
/** 트리/뷰어가 가리키는 문서: run 아티팩트 · 디스크의 md · staging의 생성된 노드(검수중). */
type DocRef = { kind: 'artifact'; path: string } | { kind: 'file'; relPath: string } | { kind: 'staged'; relPath: string }
const nodeIdOf = (rel: string): string => rel.replace(/^.*[\\/]/, '').replace(/\.md$/i, '')
/** 그래프 노드 미리보기. relPath가 있으면 문서 모드로 점프 가능하다. */
type Peek = { title: string; relPath?: string; docKind?: 'file' | 'staged'; markdown?: string; error?: string }

function latestWikiRun(runs: HarnessRunBundle[]): HarnessRunBundle | null {
  return runs.find((r) => ['MERGED', 'HUMAN_REVIEW_REQUIRED', 'VALIDATED'].includes(r.runState.state)) ?? runs[0] ?? null
}

function runStateLabel(state: string | undefined): string {
  if (!state) return '상태 없음'
  if (state === 'HUMAN_REVIEW_REQUIRED') return '검수중'
  if (state === 'MERGED') return '병합됨'
  if (state === 'VALIDATED') return '검증됨'
  return state.replace(/_/g, ' ')
}

export function KnowledgeView() {
  const selectedProjectId = useStore((state) => state.selectedProjectId)
  const projectSurfaceRevision = useStore((state) => state.projectSurfaceRevision)
  const projects = useStore((state) => state.projects)
  const harnessRuns = useStore((state) => state.harnessRuns)
  const harnessLiveNodes = useStore((state) => state.harnessLiveNodes)
  const harnessLiveNodesRunId = useStore((state) => state.harnessLiveNodesRunId)
  const harnessLoading = useStore((state) => state.harnessLoading)
  // Paper-domain projects publish autosci's own knowledge graph (wiki/<type>/<slug>.md + edges.jsonl);
  // project-docs projects don't, so the graph source differs by domain.
  const domain = projects.find((p) => p.id === selectedProjectId)?.domain
  const [mode, setMode] = useState<Mode>('docs')
  const [selectedDoc, setSelectedDoc] = useState<DocRef | null>(null)
  const [fileContent, setFileContent] = useState<{ relPath: string; content: string } | { relPath: string; error: string } | null>(null)
  const [stagedContent, setStagedContent] = useState<{ relPath: string; content: string } | { relPath: string; error: string } | null>(null)
  const [projectDocs, setProjectDocs] = useState<{ relPath: string; mtimeMs: number }[]>([])
  const [peek, setPeek] = useState<Peek | null>(null)
  const [selectedNode, setSelectedNode] = useState<TaskNodeDetail | null>(null)
  // 노드를 빠르게 연속 클릭할 때 늦게 도착한 디스크 응답이 최신 선택을 덮어쓰지 않도록.
  const peekReq = useRef(0)

  const [projectWiki, setProjectWiki] = useState<ReadProjectWikiRes | null>(null)
  const [graphSource, setGraphSource] = useState<'run' | 'wiki' | 'work'>('run')
  const [tasks, setTasks] = useState<Task[]>([])

  const run = useMemo(() => latestWikiRun(harnessRuns), [harnessRuns])
  const runId = run?.runState.runId
  const wikiArtifacts = useMemo(() => (run?.artifacts ?? []).filter(isMarkdownArtifact), [run])
  const graphData = useMemo(() => buildHarnessGraphData(run), [run])
  // Actual staged docs listed from disk, not inferred from reports. Only frontmatter'd docs are real nodes.
  const [stagedEntries, setStagedEntries] = useState<StagedDocDto[]>([])
  useEffect(() => {
    if (!runId) { setStagedEntries([]); return }
    let stale = false
    void api.harnessListStagedDocs({ runId })
      .then((res) => { if (!stale) setStagedEntries(res.docs ?? []) })
      .catch(() => { if (!stale) setStagedEntries([]) })
    return () => { stale = true }
  }, [runId])
  const nodeDocs = useMemo(() => stagedEntries.filter((e) => e.isNode), [stagedEntries])
  const byNodeId = useMemo(() => new Map(nodeDocs.filter((e) => e.nodeId).map((e) => [e.nodeId as string, e.relPath])), [nodeDocs])
  const byStem = useMemo(() => new Map(nodeDocs.map((e) => [nodeIdOf(e.relPath), e.relPath])), [nodeDocs])
  const nodeTitleByRel = useMemo(() => new Map(nodeDocs.map((e) => [e.relPath, e.title ?? nodeIdOf(e.relPath)])), [nodeDocs])
  // While a run is generating, prefer the LIVE stream graph (nodes appear folder-by-folder); the richer
  // artifact graph takes over once the run finishes.
  const liveActive = harnessLoading && harnessLiveNodes.length > 0
  const liveGraph = useMemo(
    () => buildLiveGraphData(harnessLiveNodesRunId ?? 'run', harnessLiveNodes),
    [harnessLiveNodesRunId, harnessLiveNodes],
  )
  // For paper runs the rendered graph IS autosci's knowledge graph: typed entity nodes (the staged
  // node docs) wired by the kernel's typed edges (wiki/graph/edges.jsonl). project-docs runs have no
  // edges.jsonl, so this loads nothing and the provenance graph (graphData) is used instead.
  const [paperEdges, setPaperEdges] = useState<GraphEdgeDto[]>([])
  useEffect(() => {
    if (!runId || domain !== 'paper') { setPaperEdges([]); return }
    let stale = false
    void api.harnessReadGraphEdges({ runId })
      .then((res) => { if (!stale) setPaperEdges(res.edges ?? []) })
      .catch(() => { if (!stale) setPaperEdges([]) })
    return () => { stale = true }
  }, [runId, domain])
  const paperGraph = useMemo(() => buildPaperGraphData(nodeDocs, paperEdges), [nodeDocs, paperEdges])
  const wikiGraph = useMemo(
    () => (projectWiki?.available ? buildWikiGraphData(projectWiki.nodes, projectWiki.edges) : { nodes: [], links: [] }),
    [projectWiki],
  )
  useEffect(() => {
    if (graphSource !== 'work' || !selectedProjectId) return
    void api.tasksList(selectedProjectId).then(setTasks).catch(() => setTasks([]))
  }, [graphSource, selectedProjectId])
  const workGraph = useMemo(() => {
    const reqs = tasks.filter((t) => t.id.startsWith('req:'))
    const items = reqs.map((t) => ({
      id: t.id, title: t.title, status: t.status, linkedWikiPages: t.linkedWikiPages, blockedBy: t.blockedBy,
      data: { sessionId: t.contextPackage, todos: tasks.filter((c) => c.parentTaskId === t.id).map((c) => ({ title: c.title, status: c.status })) },
    }))
    return buildWorkGraphData(items, projectWiki?.available ? projectWiki.nodes : [])
  }, [tasks, projectWiki])
  const effectiveGraph = liveActive ? liveGraph
    : (graphSource === 'work') ? workGraph
    : (graphSource === 'wiki' && projectWiki?.available) ? wikiGraph
    : (domain === 'paper' ? paperGraph : graphData)

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
  }, [projectSurfaceRevision, selectedProjectId])

  useEffect(() => {
    if (!selectedProjectId) { setProjectWiki(null); setGraphSource('run'); return }
    let stale = false
    void api.readProjectWiki({ projectId: selectedProjectId })
      .then((res) => { if (stale) return; setProjectWiki(res); setGraphSource(res.available ? 'wiki' : 'run') })
      .catch(() => { if (!stale) { setProjectWiki(null); setGraphSource('run') } })
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
    setStagedContent(null)
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
    : selectedDoc?.kind === 'staged' ? nodeTitleByRel.get(selectedDoc.relPath) ?? nodeIdOf(selectedDoc.relPath)
    : selectedDoc?.kind === 'file' ? selectedDoc.relPath : wikiArtifacts[0] ? artifactLabel(wikiArtifacts[0].name) : '문서를 선택하세요'
  const fallbackMarkdown = !selectedDoc && wikiArtifacts[0] ? artifactToMarkdown(wikiArtifacts[0]) : null

  const openWikiLink = (target: string) => {
    // [[node-id]] → the matching generated wiki node (so the rendered graph is navigable like a wiki).
    const stagedRel = byNodeId.get(target) ?? byStem.get(target) ?? byStem.get(nodeIdOf(target))
    if (stagedRel) { setSelectedDoc({ kind: 'staged', relPath: stagedRel }); return }
    const hit = run ? pickNodeArtifact(run.artifacts, { id: `document:${target}`, label: target }) : undefined
    if (hit) setSelectedDoc({ kind: 'artifact', path: hit.path })
  }

  const handleNodeClick = (node: GraphNodeRef) => {
    if ((node as { type?: string }).type === 'task') {
      const d = node.data as { sessionId?: string; todos?: { title: string; status: string }[] } | undefined
      setSelectedNode({ kind: 'task', id: node.id, label: node.label ?? node.id, todos: d?.todos ?? [], sessionId: d?.sessionId })
      setPeek(null)
      return
    }
    setSelectedNode(null)
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
    const stagedRel = resolveStagedRel(node, nodeDocs)
    const nodePath = stagedRel ?? (node.data as { path?: string } | undefined)?.path?.replace(/^vault-staging[\\/]/, '')
    if (!nodePath || !/\.(md|mdx|txt)$/i.test(nodePath)) {
      setPeek({ title, error: nodePath ? `원문 없음: ${nodePath}` : '연결된 문서가 없는 노드입니다' })
      return
    }
    // Resolve the doc in order: the run's STAGED draft (unpromoted HUMAN_REVIEW output — concept/
    // decision md that isn't a run.artifact and isn't in the vault yet) → then a promoted/project doc
    // on disk. Without the staging read, draft nodes wrongly showed "원문 없음".
    // Wiki-source nodes live on disk (wiki/<type>/<slug>.md) — skip staged lookup to avoid false
    // "no staging" errors and go straight to the disk read.
    const runId = run?.runState.runId
    const isWikiNode = graphSource === 'wiki' && /^wiki[\\/]/.test(nodePath)
    void (async () => {
      if (runId && !isWikiNode) {
        try {
          const staged = await api.harnessReadStagedDoc({ runId, relPath: nodePath })
          if (reqId !== peekReq.current) return
          if (staged.ok) { setPeek({ title, relPath: nodePath, docKind: stagedRel ? 'staged' : 'file', markdown: staged.content }); return }
        } catch { /* staging channel unavailable (e.g. dev hot-reload) — fall through to disk */ }
      }
      if (selectedProjectId) {
        const res = await api.fsReadDoc({ projectId: selectedProjectId, relPath: nodePath })
        if (reqId !== peekReq.current) return
        if (res.ok && res.content !== undefined) { setPeek({ title, relPath: nodePath, docKind: 'file', markdown: res.content }); return }
        setPeek({ title, error: `원문 없음: ${nodePath} (${res.reason ?? ''})` })
        return
      }
      setPeek({ title, error: `원문 없음: ${nodePath}` })
    })()
  }

  const openPeekAsDoc = (p: Peek) => {
    setMode('docs')
    if (p.relPath) {
      setSelectedDoc({ kind: p.docKind === 'staged' ? 'staged' : 'file', relPath: p.relPath })
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
        <span className="knowledge__trust">진짜 노드 {nodeDocs.length}개 · {runStateLabel(run?.runState.state)}</span>
        {liveActive && (
          <span className="knowledge__live" title="생성 중 — 노드가 폴더별로 추가됩니다">
            <span className="knowledge__live-dot" /> 생성 중 · {harnessLiveNodes.length}개 노드
          </span>
        )}
      </div>

      {mode === 'docs' ? (
        <div className="knowledge__docs">
          <aside className="knowledge__tree panel">
            <div className="knowledge__tree-group">노드</div>
            {nodeDocs.length === 0 && <div className="knowledge__tree-empty">아직 노드 없음 — ⚙ Wiki Gen에서 생성</div>}
            {nodeDocs.map((entry) => (
              <button key={entry.relPath} type="button"
                className={selectedDoc?.kind === 'staged' && selectedDoc.relPath === entry.relPath ? 'knowledge__tree-item knowledge__tree-item--on' : 'knowledge__tree-item'}
                onClick={() => setSelectedDoc({ kind: 'staged', relPath: entry.relPath })}>
                {entry.nodeType && <span className="knowledge__tree-type">{entry.nodeType}</span>} {entry.title ?? nodeIdOf(entry.relPath)}
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
            <div className="knowledge__graph-source">
              <button type="button"
                className={graphSource === 'wiki' ? 'knowledge__seg-btn knowledge__seg-btn--on' : 'knowledge__seg-btn'}
                disabled={!projectWiki?.available}
                onClick={() => setGraphSource('wiki')}>프로젝트 위키</button>
              <button type="button"
                className={graphSource === 'run' ? 'knowledge__seg-btn knowledge__seg-btn--on' : 'knowledge__seg-btn'}
                onClick={() => setGraphSource('run')}>최신 런</button>
              <button type="button"
                className={graphSource === 'work' ? 'knowledge__seg-btn knowledge__seg-btn--on' : 'knowledge__seg-btn'}
                onClick={() => setGraphSource('work')}>Work</button>
            </div>
            <GraphVisualization data={effectiveGraph} onNodeClick={handleNodeClick} />
          </div>
          {(peek || selectedNode) && (
            <aside className="knowledge__peek panel">
              <header className="panel__header knowledge__peek-header">
                <h2>{selectedNode?.kind === 'task' ? selectedNode.label : peek!.title}</h2>
                <div>
                  {!selectedNode && peek?.markdown && (
                    <button type="button" onClick={() => openPeekAsDoc(peek)}>문서로 열기 ↗</button>
                  )}
                  <button type="button" onClick={() => { setPeek(null); setSelectedNode(null) }} aria-label="미리보기 닫기">✕</button>
                </div>
              </header>
              <div className="knowledge__peek-body">
                {selectedNode?.kind === 'task' ? (
                  <ul>
                    {selectedNode.todos.map((td, i) => (
                      <li key={i}>[{td.status}] {td.title}</li>
                    ))}
                    {selectedNode.todos.length === 0 && <li>할 일 없음</li>}
                  </ul>
                ) : peek?.markdown
                  ? <MarkdownContent markdown={peek.markdown} onOpenWikiLink={openWikiLink} />
                  : <div className="knowledge__error">⚠ {peek?.error}</div>}
              </div>
            </aside>
          )}
        </div>
      )}
    </section>
  )
}
