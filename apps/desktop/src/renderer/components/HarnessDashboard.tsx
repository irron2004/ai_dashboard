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

type Props = {
  profiles: AgentProfile[]
  onSelectProfile: (profileId: string) => void
}

type Tab = 'markdown' | 'graph' | 'flow'

function artifactMatchesTarget(artifact: HarnessRunArtifact, target: string): boolean {
  const normalized = target.trim().toLowerCase()
  return artifact.path.toLowerCase().includes(normalized) || artifact.name.toLowerCase() === normalized || artifact.path.toLowerCase().endsWith(`/${normalized}`)
}

export function HarnessDashboard({ profiles, onSelectProfile }: Props) {
  const {
    selectedProjectId, dashboard, harnessRuns, selectedHarnessRunId, harnessLoading, harnessMessage, harnessConfigs,
    hydrateHarnessProject, selectHarnessRun, startHarnessRun, refreshHarnessRun, resumeHarnessRun, promoteHarnessRun,
    updateHarnessModel, updateHarnessSafety, toggleHarnessGate, updateHarnessPrompt,
  } = useStore()
  const [tab, setTab] = useState<Tab>('markdown')
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string | null>(null)

  useEffect(() => {
    if (selectedProjectId) hydrateHarnessProject(selectedProjectId)
  }, [hydrateHarnessProject, selectedProjectId])

  const currentRun = useMemo(() => harnessRuns.find((bundle) => bundle.runState.runId === selectedHarnessRunId) ?? harnessRuns[0] ?? null, [harnessRuns, selectedHarnessRunId])
  const config = selectedProjectId ? harnessConfigs[selectedProjectId] ?? createDefaultHarnessConfig() : createDefaultHarnessConfig()
  const graphData = useMemo(() => buildHarnessGraphData(currentRun), [currentRun])
  const diffArtifact = useMemo(() => currentRun?.artifacts.find((artifact) => artifact.name === 'git-diff-report'), [currentRun])

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
    if (candidate) setSelectedArtifactPath(candidate.path)
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
            <button type="button" onClick={() => void resumeHarnessRun()} disabled={harnessLoading || !currentRun}>Resume</button>
          </div>
        </div>
      </header>

      <div className="harness-dashboard__grid">
        <HarnessRunList
          runs={harnessRuns}
          selectedRunId={selectedHarnessRunId}
          loading={harnessLoading}
          onSelectRun={(runId) => selectHarnessRun(runId)}
          onRefresh={() => void refreshHarnessRun()}
          onStartRun={() => void startHarnessRun()}
        />

        <main className="harness-dashboard__main panel">
          <nav className="harness-dashboard__tabs">
            <button type="button" className={tab === 'markdown' ? 'harness-dashboard__tab harness-dashboard__tab--active' : 'harness-dashboard__tab'} onClick={() => setTab('markdown')}>Markdown Viewer</button>
            <button type="button" className={tab === 'graph' ? 'harness-dashboard__tab harness-dashboard__tab--active' : 'harness-dashboard__tab'} onClick={() => setTab('graph')}>Graph Visualization</button>
            <button type="button" className={tab === 'flow' ? 'harness-dashboard__tab harness-dashboard__tab--active' : 'harness-dashboard__tab'} onClick={() => setTab('flow')}>Task Flow View</button>
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
          </div>
        </main>

        <AgentConfigPanel
          config={config}
          loading={harnessLoading}
          message={harnessMessage}
          profiles={profiles}
          onSelectProfile={onSelectProfile}
          onModelChange={(patch) => updateHarnessModel(patch)}
          onSafetyChange={(patch) => updateHarnessSafety(patch)}
          onToggleGate={(key) => toggleHarnessGate(key)}
          onPromptChange={(key, value) => updateHarnessPrompt(key, value)}
          onRefresh={() => void refreshHarnessRun()}
          onPromote={() => void promoteHarnessRun()}
        />
      </div>
    </section>
  )
}
