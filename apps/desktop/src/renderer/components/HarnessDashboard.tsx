import { useEffect, useMemo, useState } from 'react'
import type { AgentProfile } from '@apc/shared'
import { useStore } from '../store.js'
import { createDefaultHarnessConfig, buildHarnessGraphData, type HarnessRunArtifact } from '../harness-utils.js'
import { HarnessRunList } from './HarnessRunList.js'
import { MarkdownViewer } from './MarkdownViewer.js'
import { GraphVisualization } from './GraphVisualization.js'
import { TaskFlowView } from './TaskFlowView.js'
import { AgentConfigPanel } from './AgentConfigPanel.js'
import { DiffViewer } from './DiffViewer.js'
import { CoverageMatrix } from './CoverageMatrix.js'
import { QualityPanel } from './QualityPanel.js'
import { ProposalsPanel } from './ProposalsPanel.js'
import { AgentConfigEditorPanel } from './AgentConfigEditorPanel.js'
import { WikiProgress } from './WikiProgress.js'
import type { KhCoverageReport, KhEvalReport, KhNodeProposal } from '@apc/shared'

type Props = {
  profiles: AgentProfile[]
  onSelectProfile: (profileId: string) => void
}

type Tab = 'markdown' | 'graph' | 'flow' | 'coverage' | 'quality' | 'proposals' | 'config'

function artifactMatchesTarget(artifact: HarnessRunArtifact, target: string): boolean {
  const normalized = target.trim().toLowerCase()
  return artifact.path.toLowerCase().includes(normalized) || artifact.name.toLowerCase() === normalized || artifact.path.toLowerCase().endsWith(`/${normalized}`)
}

export function HarnessDashboard({ profiles, onSelectProfile }: Props) {
  const {
    selectedProjectId, dashboard, harnessRuns, selectedHarnessRunId, harnessLoading, harnessMessage, harnessProgress, harnessLiveLabel, harnessLiveTail, harnessConfigs,
    harnessCanonicalProposals, harnessPromoteBlockedReason,
    hydrateHarnessProject, selectHarnessRun, startHarnessRun, refreshHarnessRun, resumeHarnessRun, promoteHarnessRun,
    promoteCanonicalDoc, updateHarnessModel, updateHarnessSafety, toggleHarnessGate, updateHarnessPrompt,
  } = useStore()
  const [tab, setTab] = useState<Tab>('markdown')
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string | null>(null)
  const [runsCollapsed, setRunsCollapsed] = useState(() => {
    try { return localStorage.getItem('apc:runsCollapsed') === '1' } catch { return false }
  })
  const toggleRuns = () => setRunsCollapsed((prev) => {
    const next = !prev
    try { localStorage.setItem('apc:runsCollapsed', next ? '1' : '0') } catch { /* ignore */ }
    return next
  })

  useEffect(() => {
    if (selectedProjectId) hydrateHarnessProject(selectedProjectId)
  }, [hydrateHarnessProject, selectedProjectId])

  const currentRun = useMemo(() => harnessRuns.find((bundle) => bundle.runState.runId === selectedHarnessRunId) ?? harnessRuns[0] ?? null, [harnessRuns, selectedHarnessRunId])
  const config = selectedProjectId ? harnessConfigs[selectedProjectId] ?? createDefaultHarnessConfig() : createDefaultHarnessConfig()
  const graphData = useMemo(() => buildHarnessGraphData(currentRun), [currentRun])
  const diffArtifact = useMemo(() => currentRun?.artifacts.find((artifact) => artifact.name === 'git-diff-report'), [currentRun])
  const coverageData = currentRun?.artifacts.find((a) => a.name === 'coverage-report')?.data as KhCoverageReport | undefined
  const evalData = currentRun?.artifacts.find((a) => a.name === 'eval-report')?.data as KhEvalReport | undefined
  const proposalsData = (currentRun?.artifacts.find((a) => a.name === 'node-proposals')?.data as { proposals?: KhNodeProposal[] } | undefined)?.proposals
  const canPromote = currentRun?.runState.state === 'HUMAN_REVIEW_REQUIRED'

  useEffect(() => {
    const next = currentRun?.artifacts.find((artifact) => artifact.path === selectedArtifactPath) ?? currentRun?.artifacts[0] ?? null
    setSelectedArtifactPath(next?.path ?? null)
  }, [currentRun?.runState.runId])

  const handleOpenWikiLink = (target: string) => {
    if (!currentRun) return
    const found = currentRun.artifacts.find((artifact) => artifactMatchesTarget(artifact, target))
    if (found) setSelectedArtifactPath(found.path)
  }

  const handleNodeClick = (node: { id: string; data?: unknown }) => {
    if (!currentRun) return
    const candidate = currentRun.artifacts.find((artifact) => artifact.path === (node.data as { path?: string } | undefined)?.path)
      ?? currentRun.artifacts.find((artifact) => artifactMatchesTarget(artifact, node.id.replace(/^artifact:/, '')))
    // Jump to the Markdown viewer so the clicked node's document is actually shown (not left on the graph tab).
    if (candidate) { setSelectedArtifactPath(candidate.path); setTab('markdown') }
  }

  return (
    <section className="harness-dashboard">
      <header className="panel harness-dashboard__hero">
        <div className="panel__header harness-dashboard__hero-header">
          <div>
            <h1>Knowledge Harness</h1>
            <p>
              {dashboard?.project.name ?? 'Select a project'}
              {dashboard?.project.goal ? ` · ${dashboard.project.goal}` : ''}
            </p>
          </div>
          <div className="harness-dashboard__hero-actions">
            {harnessMessage && <span className="harness-dashboard__message">{harnessMessage}</span>}
            <button type="button" onClick={() => void startHarnessRun()} disabled={harnessLoading || !selectedProjectId}>Run harness</button>
            <button
              type="button"
              onClick={() => { setTab('coverage'); void startHarnessRun(true) }}
              disabled={harnessLoading || !selectedProjectId}
              title="프로젝트 하위 문서를 모아 위키 생성 후 커버리지 확인"
            >전 문서로 위키 생성</button>
            <button type="button" onClick={() => void resumeHarnessRun()} disabled={harnessLoading || !currentRun}>Resume</button>
          </div>
        </div>
      </header>

      <div className={`harness-dashboard__grid${runsCollapsed ? ' harness-dashboard__grid--runs-collapsed' : ''}`}>
        <HarnessRunList
          runs={harnessRuns}
          selectedRunId={selectedHarnessRunId}
          loading={harnessLoading}
          collapsed={runsCollapsed}
          onToggleCollapse={toggleRuns}
          onSelectRun={(runId) => selectHarnessRun(runId)}
          onRefresh={() => void refreshHarnessRun()}
          onStartRun={() => void startHarnessRun()}
        />

        <main className="harness-dashboard__main panel">
          <nav className="harness-dashboard__tabs">
            <button type="button" className={tab === 'markdown' ? 'harness-dashboard__tab harness-dashboard__tab--active' : 'harness-dashboard__tab'} onClick={() => setTab('markdown')}>Markdown Viewer</button>
            <button type="button" className={tab === 'graph' ? 'harness-dashboard__tab harness-dashboard__tab--active' : 'harness-dashboard__tab'} onClick={() => setTab('graph')}>Graph Visualization</button>
            <button type="button" className={tab === 'flow' ? 'harness-dashboard__tab harness-dashboard__tab--active' : 'harness-dashboard__tab'} onClick={() => setTab('flow')}>Task Flow View</button>
            <button type="button" className={tab === 'coverage' ? 'harness-dashboard__tab harness-dashboard__tab--active' : 'harness-dashboard__tab'} onClick={() => setTab('coverage')}>Coverage</button>
            <button type="button" className={tab === 'quality' ? 'harness-dashboard__tab harness-dashboard__tab--active' : 'harness-dashboard__tab'} onClick={() => setTab('quality')}>Quality</button>
            <button type="button" className={tab === 'proposals' ? 'harness-dashboard__tab harness-dashboard__tab--active' : 'harness-dashboard__tab'} onClick={() => setTab('proposals')}>Proposals</button>
            <button type="button" className={tab === 'config' ? 'harness-dashboard__tab harness-dashboard__tab--active' : 'harness-dashboard__tab'} onClick={() => setTab('config')}>Config</button>
          </nav>

          <div className="harness-dashboard__content">
            {tab === 'markdown' && (
              <div className="harness-dashboard__markdown-shell">
                <MarkdownViewer
                  artifacts={currentRun?.artifacts ?? []}
                  selectedArtifactPath={selectedArtifactPath}
                  onSelectArtifactPath={setSelectedArtifactPath}
                  onOpenWikiLink={handleOpenWikiLink}
                />
                {diffArtifact && <DiffViewer patch={typeof (diffArtifact.data as { patch?: string } | undefined)?.patch === 'string' ? (diffArtifact.data as { patch: string }).patch : null} />}
              </div>
            )}
            {tab === 'graph' && <GraphVisualization data={graphData} onNodeClick={handleNodeClick} />}
            {tab === 'flow' && <TaskFlowView run={currentRun} />}
            {tab === 'coverage' && (
              harnessLoading
                ? <WikiProgress state={harnessProgress} liveLabel={harnessLiveLabel} liveTail={harnessLiveTail} />
                : coverageData
                  ? <CoverageMatrix data={coverageData} onOpenSource={(p) => window.alert(p)} />
                  : currentRun?.runState.state === 'FAILED'
                    ? <div className="harness-dashboard__placeholder harness-dashboard__placeholder--error">❌ 실패: {currentRun.runState.error ?? '원인 미상'}</div>
                    : <div className="harness-dashboard__placeholder">아직 커버리지 데이터가 없습니다 — "전 문서로 위키 생성"을 실행하세요.</div>
            )}
            {tab === 'quality' && (
              evalData
                ? <QualityPanel data={evalData} />
                : <div className="harness-dashboard__placeholder">아직 품질 데이터가 없습니다 — run을 실행하세요.</div>
            )}
            {tab === 'proposals' && (
              proposalsData
                ? <ProposalsPanel proposals={proposalsData} />
                : <div className="harness-dashboard__placeholder">아직 노드 제안이 없습니다 — run을 실행하세요.</div>
            )}
            {tab === 'config' && <AgentConfigEditorPanel profiles={profiles} />}
          </div>

          {harnessCanonicalProposals.length > 0 && (
            <div className="harness-dashboard__canonical">
              <h3>Canonical proposals (hash-gated)</h3>
              <ul>
                {harnessCanonicalProposals.map((p) => (
                  <li key={p.proposalRelPath} className="harness-dashboard__canonical-item">
                    <span>{p.canonicalPath}{p.currentHash === null ? ' (new)' : ''}</span>
                    <button
                      type="button"
                      disabled={harnessLoading || !canPromote}
                      title={canPromote ? undefined : '리뷰 대기(HUMAN_REVIEW_REQUIRED) 상태에서만 promote할 수 있습니다'}
                      onClick={() => void promoteCanonicalDoc(p.proposalRelPath, p.currentHash ?? '')}
                    >
                      Promote to {p.canonicalPath}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </main>

        <AgentConfigPanel
          config={config}
          loading={harnessLoading}
          running={harnessLoading}
          activeState={harnessProgress}
          message={harnessMessage}
          profiles={profiles}
          onSelectProfile={onSelectProfile}
          onModelChange={(patch) => updateHarnessModel(patch)}
          onSafetyChange={(patch) => updateHarnessSafety(patch)}
          onToggleGate={(key) => toggleHarnessGate(key)}
          onPromptChange={(key, value) => updateHarnessPrompt(key, value)}
          onRefresh={() => void refreshHarnessRun()}
          onPromote={() => void promoteHarnessRun()}
          onForcePromote={() => void promoteHarnessRun(undefined, true)}
          promoteBlockedReason={harnessPromoteBlockedReason}
          canPromote={canPromote}
        />
      </div>
    </section>
  )
}
