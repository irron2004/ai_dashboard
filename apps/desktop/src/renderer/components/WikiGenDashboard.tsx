import { useEffect, useMemo, useRef, useState } from 'react'
import type { KhCoverageReport, KhEvalReport, KhNodeProposal } from '@apc/shared'
import type { HarnessRunProgressDto } from '../../shared/ipc-contract.js'
import { useStore } from '../store.js'
import { api } from '../api.js'
import { createDefaultHarnessConfig, runModeLabel, readFanoutSummary, type HarnessRunBundle } from '../harness-utils.js'
import {
  appendWikiProgressEvent,
  createWikiProgressState,
  mergeWikiProgressReplay,
  wikiProgressSummary,
  type WikiProgressState,
} from '../wiki-progress-state.js'
import { HarnessRunList } from './HarnessRunList.js'
import { HarnessStructurePanel } from './HarnessStructurePanel.js'
import { WikiProgress } from './WikiProgress.js'
import { OverviewPanel } from './OverviewPanel.js'
import { ReviewPanel, type EvidenceFinding, type PolicyViolation, type ReviewFilter } from './ReviewPanel.js'
import { TaskFlowView } from './TaskFlowView.js'
import { NodeConfirmPanel } from './NodeConfirmPanel.js'
import { ProjectStructureView } from './ProjectStructureView.js'
import { WikiGenerationSetup } from './WikiGenerationSetup.js'

type ReviewTab = 'overview' | 'review' | 'structure' | 'flow'

const REVIEW_TABS: { id: ReviewTab; label: string }[] = [
  { id: 'overview', label: '개요' },
  { id: 'review', label: '🔎 검수' },
  { id: 'structure', label: '구조' },
  { id: 'flow', label: '진행' },
]

export function WikiGenDashboard() {
  const {
    selectedProjectId, projectSurfaceRevision, harnessRuns, selectedHarnessRunId, harnessLoading, harnessMessage,
    harnessProgress, harnessLiveLabel, harnessLiveTail, harnessConfigs,
    harnessCanonicalProposals, harnessPromoteBlockedReason, harnessCanonicalBlock,
    harnessReviewDecisions,
    wikiPolicy, wikiPolicyPreview, wikiPolicyBusy,
    hydrateHarnessProject, selectHarnessRun, startHarnessRun, refreshHarnessRun, resumeHarnessRun,
    promoteHarnessRun, promoteCanonicalDoc, exportWiki, updateHarnessModel, updateHarnessSafety, toggleHarnessGate, updateHarnessPrompt,
    proposeWikiPolicy, approveWikiPolicy, loadWikiPolicy, revertWikiPolicy,
    confirmNodes, setReviewVerdict,
  } = useStore()

  const [reviewTab, setReviewTab] = useState<ReviewTab>('overview')
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [interactiveMode, setInteractiveMode] = useState(false)
  const [pendingRun, setPendingRun] = useState<{ materialize: boolean; fullRegen?: boolean } | null>(null)
  const [projectFolders, setProjectFolders] = useState<string[]>([])
  const [wikiProgress, setWikiProgress] = useState<WikiProgressState | null>(null)
  const [wikiProgressRuns, setWikiProgressRuns] = useState<HarnessRunProgressDto[]>([])
  const listRequest = useRef(0)
  const replayRequest = useRef(0)
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

  useEffect(() => {
    if (selectedProjectId) loadWikiPolicy(selectedProjectId)
  }, [loadWikiPolicy, selectedProjectId])

  useEffect(() => {
    const request = ++listRequest.current
    if (!selectedProjectId) {
      setWikiProgressRuns([])
      setWikiProgress(null)
      return
    }
    void api.harnessListRuns({ projectId: selectedProjectId, limit: 100 }).then((result) => {
      if (request !== listRequest.current) return
      const next = result.ok ? result.runs ?? [] : []
      setWikiProgressRuns((current) => current.length === next.length
        && current.every((run, index) => run.runId === next[index]?.runId
          && run.summary.lastActivityAt === next[index]?.summary.lastActivityAt
          && run.active === next[index]?.active)
        ? current
        : next)
    }).catch(() => {
      if (request === listRequest.current) setWikiProgressRuns([])
    })
  }, [selectedProjectId])

  useEffect(() => {
    const targetRunId = selectedHarnessRunId
    const targetProjectId = selectedProjectId
    const request = ++replayRequest.current
    if (!targetRunId || !targetProjectId) {
      setWikiProgress(null)
      return
    }
    setWikiProgress((current) => current?.runId === targetRunId ? current : null)
    void api.harnessGetProgress({ runId: targetRunId }).then((result) => {
      if (request !== replayRequest.current || !result.ok || !result.summary) return
      setWikiProgress((current) => mergeWikiProgressReplay(current, {
        snapshot: result.summary!,
        events: result.events ?? [],
        active: result.active ?? false,
      }))
    }).catch(() => { /* legacy builds may not expose the replay query yet */ })
  }, [selectedHarnessRunId, selectedProjectId])

  useEffect(() => {
    const off = api.onHarnessActivity((event) => {
      if (event.projectId !== selectedProjectId) return
      setWikiProgress((current) => {
        const selected = event.runId === selectedHarnessRunId
        const continuing = current?.runId === event.runId
        const newlyStarted = harnessLoading && event.kind === 'run_started'
        return selected || continuing || newlyStarted ? appendWikiProgressEvent(current, event) : current
      })
    })
    return typeof off === 'function' ? off : undefined
  }, [harnessLoading, selectedHarnessRunId, selectedProjectId])

  useEffect(() => {
    if (!selectedProjectId) { setProjectFolders([]); return }
    let stale = false
    void api.fsListDocs({ projectId: selectedProjectId }).then((result) => {
      if (stale) return
      const folders = new Set<string>()
      for (const doc of result.docs ?? []) {
        const normalized = doc.relPath.replace(/\\/g, '/')
        const slash = normalized.indexOf('/')
        folders.add(slash < 0 ? '(root)' : normalized.slice(0, slash))
      }
      const next = [...folders].sort().slice(0, 40)
      setProjectFolders((current) => current.length === next.length
        && current.every((folder, index) => folder === next[index]) ? current : next)
    }).catch(() => { if (!stale) setProjectFolders([]) })
    return () => { stale = true }
  }, [projectSurfaceRevision, selectedProjectId])

  const currentRun: HarnessRunBundle | null = useMemo(
    () => harnessRuns.find((b) => b.runState.runId === selectedHarnessRunId) ?? harnessRuns[0] ?? null,
    [harnessRuns, selectedHarnessRunId],
  )
  const config = selectedProjectId ? harnessConfigs[selectedProjectId] ?? createDefaultHarnessConfig() : createDefaultHarnessConfig()
  const coverageData = currentRun?.artifacts.find((a) => a.name === 'coverage-report')?.data as KhCoverageReport | undefined
  const evalData = currentRun?.artifacts.find((a) => a.name === 'eval-report')?.data as KhEvalReport | undefined
  const proposalsData = (currentRun?.artifacts.find((a) => a.name === 'node-proposals')?.data as { proposals?: KhNodeProposal[] } | undefined)?.proposals
  // The verifier + policy agents' per-proposal findings — surfaced alongside each node in the 검수 tab.
  const evidenceReport = currentRun?.artifacts.find((a) => a.name === 'evidence-verification-report')?.data as
    { warnings?: EvidenceFinding[]; unverifiable?: EvidenceFinding[] } | undefined
  const evidenceWarnings = evidenceReport?.warnings ?? []
  const evidenceUnverifiable = evidenceReport?.unverifiable ?? []
  const policyViolations = (currentRun?.artifacts.find((a) => a.name === 'policy-report')?.data as { violations?: PolicyViolation[] } | undefined)?.violations ?? []
  const diffPatch = (currentRun?.artifacts.find((a) => a.name === 'git-diff-report')?.data as { patch?: string } | undefined)?.patch ?? null
  const approvedCount = proposalsData?.filter((proposal) => harnessReviewDecisions[proposal.proposal_id] === 'approved').length ?? 0
  const excludedCount = proposalsData?.filter((proposal) => harnessReviewDecisions[proposal.proposal_id] === 'excluded').length ?? 0
  const pendingCount = Math.max(0, (proposalsData?.length ?? 0) - approvedCount - excludedCount)
  const warningCount = proposalsData?.filter((proposal) => proposal.evidence.length === 0
    || evidenceWarnings.some((warning) => warning.proposal_id === proposal.proposal_id)
    || evidenceUnverifiable.some((finding) => finding.proposal_id === proposal.proposal_id)
    || policyViolations.some((violation) => violation.proposal_id === proposal.proposal_id)).length ?? 0
  // Only proposal-bearing runs use verdict gating. Older/headless runs retain the service's legacy path.
  const reviewGated = Boolean(proposalsData?.length)
  const goToReview = (filter: ReviewFilter) => {
    setReviewFilter(filter)
    setReviewTab('review')
  }
  const openSource = (sourcePath: string) => {
    if (currentRun) void api.harnessOpenSourceFile({ runId: currentRun.runState.runId, sourcePath })
  }
  const canPromote = currentRun?.runState.state === 'HUMAN_REVIEW_REQUIRED'
  const fanout = currentRun ? readFanoutSummary(currentRun.artifacts) : null
  const awaiting = currentRun?.runState.awaiting
  const nodeConfirmProposed = useMemo(() => {
    if (awaiting !== 'node-confirmation' || !proposalsData) return null
    return proposalsData.map((p) => ({
      id: p.node.id,
      title: p.node.title,
      type: p.node.type,
      source_proposal_id: p.proposal_id,
    }))
  }, [awaiting, proposalsData])
  const replaySummary = wikiProgressSummary(wikiProgress)
  const replayIsNonterminal = replaySummary != null
    && replaySummary.status !== 'completed'
    && replaySummary.status !== 'failed'
  const progressForCurrentRun = wikiProgress?.runId === currentRun?.runState.runId
  const progressRunId = harnessLoading && wikiProgress?.runId ? wikiProgress.runId : currentRun?.runState.runId
  const readProgressLog = (runId: string) => api.harnessReadLog({ runId, offset: 0, limit: 256 * 1024 })

  return (
    <section className="wikigen">
      <div className={`wikigen__grid${runsCollapsed ? ' wikigen__grid--runs-collapsed' : ''}${settingsOpen ? ' wikigen__grid--settings' : ''}`}>
        <HarnessRunList
          runs={harnessRuns}
          selectedRunId={selectedHarnessRunId}
          loading={harnessLoading}
          collapsed={runsCollapsed}
          onToggleCollapse={toggleRuns}
          onSelectRun={(runId) => selectHarnessRun(runId)}
          onRefresh={() => void refreshHarnessRun()}
          onStartRun={(materialize, fullRegen) => setPendingRun({ materialize, fullRegen })}
          onResumeRun={(runId) => void resumeHarnessRun(runId)}
          progressRuns={wikiProgressRuns}
        />

        <main className="wikigen__main panel">
          <header className="panel__header wikigen__header">
            <div>
              <h2>{progressRunId ?? 'Wiki Gen'}</h2>
              <p>
                {currentRun ? `${runModeLabel(currentRun.mode) || currentRun.runState.engine} · ${currentRun.runState.state.replace(/_/g, ' ')}` : 'run을 시작하세요'}
                {harnessMessage ? ` — ${harnessMessage}` : ''}
              </p>
            </div>
            <div className="wikigen__header-actions">
              <label className="wikigen__interactive-toggle">
                <input
                  type="checkbox"
                  checked={interactiveMode}
                  onChange={(e) => setInteractiveMode(e.target.checked)}
                  disabled={harnessLoading}
                />
                확인 모드
              </label>
              <button type="button" onClick={() => setSettingsOpen((v) => !v)}>⚙ 에이전트 설정</button>
            </div>
          </header>

          {harnessLoading ? (
            <WikiProgress
              progress={wikiProgress}
              legacyState={harnessProgress}
              liveLabel={harnessLiveLabel}
              liveTail={harnessLiveTail}
              onReadLog={readProgressLog}
              onResume={(runId) => void resumeHarnessRun(runId)}
            />
          ) : nodeConfirmProposed && currentRun ? (
            <NodeConfirmPanel
              proposed={nodeConfirmProposed}
              onConfirm={(approvedNodes) => void confirmNodes(currentRun.runState.runId, approvedNodes)}
            />
          ) : replayIsNonterminal ? (
            <WikiProgress
              progress={wikiProgress}
              legacyState={harnessProgress}
              liveLabel={harnessLiveLabel}
              liveTail={harnessLiveTail}
              onReadLog={readProgressLog}
              onResume={(runId) => void resumeHarnessRun(runId)}
            />
          ) : !currentRun ? (
            <div className="wikigen__placeholder">아직 run이 없습니다 — ▶ 위키 생성으로 시작하세요.</div>
          ) : (
            <>
              <nav className="wikigen__subtabs">
                {REVIEW_TABS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={reviewTab === id ? 'wikigen__subtab wikigen__subtab--active' : 'wikigen__subtab'}
                    aria-pressed={reviewTab === id}
                    onClick={() => setReviewTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </nav>

              <div className="wikigen__content">
                {reviewTab === 'overview' && (
                  <OverviewPanel
                    run={currentRun}
                    coverage={coverageData}
                    quality={evalData}
                    proposalsCount={proposalsData?.length ?? 0}
                    approvedCount={approvedCount}
                    excludedCount={excludedCount}
                    warningCount={warningCount}
                    fanout={fanout}
                    onGoToReview={goToReview}
                    onOpenSource={openSource}
                  >
                    {progressForCurrentRun && wikiProgress && (
                      <WikiProgress
                        progress={wikiProgress}
                        liveLabel={harnessLiveLabel}
                        liveTail={harnessLiveTail}
                        onReadLog={readProgressLog}
                      />
                    )}
                  </OverviewPanel>
                )}
                {reviewTab === 'review' && (proposalsData && proposalsData.length > 0
                  ? <ReviewPanel
                      runId={currentRun.runState.runId}
                      projectId={selectedProjectId}
                      proposals={proposalsData}
                      warnings={evidenceWarnings}
                      unverifiable={evidenceUnverifiable}
                      violations={policyViolations}
                      diffPatch={diffPatch}
                      decisions={harnessReviewDecisions}
                      onVerdict={(proposalIds, verdict) => void setReviewVerdict(proposalIds, verdict)}
                      initialFilter={reviewFilter}
                    />
                  : <div className="wikigen__placeholder">검수할 노드 제안이 없습니다 — 전체 문서 모드로 실행하세요.</div>)}
                {reviewTab === 'structure' && <ProjectStructureView artifacts={currentRun.artifacts} />}
                {reviewTab === 'flow' && <TaskFlowView run={currentRun} />}
              </div>

              <div className="wikigen__promote">
                <div className="wikigen__promote-run">
                  <button
                    type="button"
                    disabled={harnessLoading || !canPromote || (reviewGated && approvedCount === 0)}
                    title={!canPromote
                      ? '리뷰 대기(HUMAN_REVIEW_REQUIRED) 상태에서만 반영할 수 있습니다'
                      : reviewGated && approvedCount === 0
                        ? '검수 탭에서 항목을 승인해야 반영할 수 있습니다'
                        : '승인한 항목만 vault로 반영'}
                    onClick={() => {
                      if (
                        reviewGated
                        && pendingCount > 0
                        && !window.confirm(`미결 ${pendingCount}건은 반영되지 않습니다. 승인 ${approvedCount}건만 반영할까요?`)
                      ) return
                      void promoteHarnessRun()
                    }}
                  >
                    {reviewGated ? `승인 ${approvedCount}건 반영` : 'Promote run'}
                  </button>
                  {harnessPromoteBlockedReason && (
                    <button type="button" className="wikigen__force" disabled={harnessLoading || (reviewGated && approvedCount === 0)} title={harnessPromoteBlockedReason} onClick={() => void promoteHarnessRun(undefined, true)}>
                      ⚠ 검증 무시
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={harnessLoading || !selectedProjectId}
                    title="promote된 위키를 워크스페이스의 wiki/ 폴더로 publish ({repo}/wiki)"
                    onClick={() => void exportWiki()}
                  >
                    📤 워크스페이스로 export
                  </button>
                </div>
                {harnessCanonicalProposals.length > 0 && (
                  <ul className="wikigen__canonical">
                    {harnessCanonicalProposals.map((p) => {
                      const blocked = harnessCanonicalBlock?.proposalRelPath === p.proposalRelPath
                      return (
                        <li key={p.proposalRelPath}>
                          <span>📄 {p.canonicalPath}{p.currentHash === null ? ' (new)' : ''}</span>
                          {blocked ? (
                            <button type="button" className="wikigen__force" disabled={harnessLoading} title={harnessCanonicalBlock?.reason}
                              onClick={() => void promoteCanonicalDoc(p.proposalRelPath, p.currentHash ?? '', true)}>
                              ⚠ 검증 무시하고 promote
                            </button>
                          ) : (
                            <button type="button" disabled={harnessLoading || !canPromote}
                              onClick={() => void promoteCanonicalDoc(p.proposalRelPath, p.currentHash ?? '')}>
                              Promote
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </main>

        {settingsOpen && (
          <HarnessStructurePanel
            config={config}
            activeState={harnessProgress}
            onModelChange={updateHarnessModel}
            onSafetyChange={updateHarnessSafety}
            onToggleGate={toggleHarnessGate}
            onPromptChange={updateHarnessPrompt}
            onClose={() => setSettingsOpen(false)}
            policy={wikiPolicy}
            policyPreview={wikiPolicyPreview}
            policyBusy={wikiPolicyBusy}
            onProposePolicy={() => selectedProjectId && proposeWikiPolicy(selectedProjectId)}
            onApprovePolicy={() => selectedProjectId && approveWikiPolicy(selectedProjectId)}
            onRevertPolicy={() => selectedProjectId && revertWikiPolicy(selectedProjectId)}
          />
        )}
      </div>
      <WikiGenerationSetup
        open={pendingRun !== null}
        projectId={selectedProjectId}
        modeLabel={pendingRun?.fullRegen ? '전체 재생성' : pendingRun?.materialize ? '전체 문서' : '최근 세션'}
        suggestedFolders={projectFolders}
        onCancel={() => setPendingRun(null)}
        onConfirm={(projectContext) => {
          const run = pendingRun
          setPendingRun(null)
          if (run) void startHarnessRun(run.materialize, run.fullRegen, interactiveMode, projectContext)
        }}
      />
    </section>
  )
}
