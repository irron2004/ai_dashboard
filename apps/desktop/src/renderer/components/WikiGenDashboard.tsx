import { useEffect, useMemo, useState } from 'react'
import type { KhCoverageReport, KhEvalReport, KhNodeProposal } from '@apc/shared'
import { useStore } from '../store.js'
import { createDefaultHarnessConfig, runModeLabel, readFanoutSummary, type HarnessRunBundle } from '../harness-utils.js'
import { HarnessRunList } from './HarnessRunList.js'
import { HarnessStructurePanel } from './HarnessStructurePanel.js'
import { WikiProgress } from './WikiProgress.js'
import { CoverageMatrix } from './CoverageMatrix.js'
import { QualityPanel } from './QualityPanel.js'
import { ProposalsPanel } from './ProposalsPanel.js'
import { TaskFlowView } from './TaskFlowView.js'

type ReviewTab = 'summary' | 'coverage' | 'quality' | 'proposals' | 'flow'

const REVIEW_TABS: { id: ReviewTab; label: string }[] = [
  { id: 'summary', label: '요약' }, { id: 'coverage', label: 'Coverage' }, { id: 'quality', label: 'Quality' },
  { id: 'proposals', label: 'Proposals' }, { id: 'flow', label: 'Flow' },
]

export function WikiGenDashboard() {
  const {
    selectedProjectId, harnessRuns, selectedHarnessRunId, harnessLoading, harnessMessage,
    harnessProgress, harnessLiveLabel, harnessLiveTail, harnessConfigs,
    harnessCanonicalProposals, harnessPromoteBlockedReason, harnessCanonicalBlock,
    wikiPolicy, wikiPolicyPreview, wikiPolicyBusy,
    hydrateHarnessProject, selectHarnessRun, startHarnessRun, refreshHarnessRun, resumeHarnessRun,
    promoteHarnessRun, promoteCanonicalDoc, exportWiki, updateHarnessModel, updateHarnessSafety, toggleHarnessGate, updateHarnessPrompt,
    proposeWikiPolicy, approveWikiPolicy, loadWikiPolicy, revertWikiPolicy,
  } = useStore()

  const [reviewTab, setReviewTab] = useState<ReviewTab>('summary')
  const [settingsOpen, setSettingsOpen] = useState(false)
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

  const currentRun: HarnessRunBundle | null = useMemo(
    () => harnessRuns.find((b) => b.runState.runId === selectedHarnessRunId) ?? harnessRuns[0] ?? null,
    [harnessRuns, selectedHarnessRunId],
  )
  const config = selectedProjectId ? harnessConfigs[selectedProjectId] ?? createDefaultHarnessConfig() : createDefaultHarnessConfig()
  const coverageData = currentRun?.artifacts.find((a) => a.name === 'coverage-report')?.data as KhCoverageReport | undefined
  const evalData = currentRun?.artifacts.find((a) => a.name === 'eval-report')?.data as KhEvalReport | undefined
  const proposalsData = (currentRun?.artifacts.find((a) => a.name === 'node-proposals')?.data as { proposals?: KhNodeProposal[] } | undefined)?.proposals
  const canPromote = currentRun?.runState.state === 'HUMAN_REVIEW_REQUIRED'
  const fanout = currentRun ? readFanoutSummary(currentRun.artifacts) : null

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
          onStartRun={(materialize) => void startHarnessRun(materialize)}
          onResumeRun={(runId) => void resumeHarnessRun(runId)}
        />

        <main className="wikigen__main panel">
          <header className="panel__header wikigen__header">
            <div>
              <h2>{currentRun ? currentRun.runState.runId : 'Wiki Gen'}</h2>
              <p>
                {currentRun ? `${runModeLabel(currentRun.mode) || currentRun.runState.engine} · ${currentRun.runState.state.replace(/_/g, ' ')}` : 'run을 시작하세요'}
                {harnessMessage ? ` — ${harnessMessage}` : ''}
              </p>
            </div>
            <button type="button" onClick={() => setSettingsOpen((v) => !v)}>⚙ 에이전트 설정</button>
          </header>

          {harnessLoading ? (
            <WikiProgress state={harnessProgress} liveLabel={harnessLiveLabel} liveTail={harnessLiveTail} />
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
                {reviewTab === 'summary' && (
                  <div className="wikigen__summary">
                    {currentRun.runState.state === 'FAILED' && (
                      <p className="wikigen__error">❌ 실패: {currentRun.runState.error ?? '원인 미상'} — 실행 이력에서 ↻ 이어하기</p>
                    )}
                    <p>
                      아티팩트 {currentRun.artifacts.length}개
                      {coverageData ? ` · 커버리지 리포트 있음` : ''}
                      {evalData ? ` · 품질 리포트 있음` : ''}
                      {proposalsData ? ` · 노드 제안 ${proposalsData.length}개` : ''}
                    </p>
                    <p className="wikigen__hint">생성된 위키 문서는 📖 Knowledge 탭에서 읽습니다.</p>
                    {fanout && (
                      <div className="wikigen__folders">
                        <h4>📁 폴더 워커 (orchestrator-workers)</h4>
                        <p>{fanout.units}개 폴더 단위 · {fanout.ran}개 실행{fanout.skipped.length ? ` · ${fanout.skipped.length}개 스킵` : ''}</p>
                        <ul className="wikigen__folder-list">
                          {fanout.folders.map((f) => (
                            <li key={f.label}>📁 {f.label}{f.role ? <em className="wikigen__folder-role"> {f.role}</em> : null}{f.members && f.members !== f.label ? <small> — {f.members}</small> : null}</li>
                          ))}
                        </ul>
                        {fanout.skipped.length > 0 && (
                          <ul className="wikigen__folder-skipped">
                            {fanout.skipped.map((s) => <li key={s.unit} title={s.reason}>⚠ {s.unit} 스킵</li>)}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {reviewTab === 'coverage' && (coverageData
                  ? <CoverageMatrix data={coverageData} onOpenSource={(p) => window.alert(p)} />
                  : <div className="wikigen__placeholder">커버리지 데이터 없음 — 전체 문서 모드로 실행하세요.</div>)}
                {reviewTab === 'quality' && (evalData
                  ? <QualityPanel data={evalData} />
                  : <div className="wikigen__placeholder">품질 데이터 없음.</div>)}
                {reviewTab === 'proposals' && (proposalsData
                  ? <ProposalsPanel proposals={proposalsData} />
                  : <div className="wikigen__placeholder">노드 제안 없음.</div>)}
                {reviewTab === 'flow' && <TaskFlowView run={currentRun} />}
              </div>

              <div className="wikigen__promote">
                <div className="wikigen__promote-run">
                  <button
                    type="button"
                    disabled={harnessLoading || !canPromote}
                    title={canPromote ? 'staging 결과를 vault로 반영' : '리뷰 대기(HUMAN_REVIEW_REQUIRED) 상태에서만 promote할 수 있습니다'}
                    onClick={() => void promoteHarnessRun()}
                  >
                    Promote run
                  </button>
                  {harnessPromoteBlockedReason && (
                    <button type="button" className="wikigen__force" disabled={harnessLoading} title={harnessPromoteBlockedReason} onClick={() => void promoteHarnessRun(undefined, true)}>
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
            onProposePolicy={() => selectedProjectId && proposeWikiPolicy(selectedProjectId, config.model.engine)}
            onApprovePolicy={() => selectedProjectId && approveWikiPolicy(selectedProjectId)}
            onRevertPolicy={() => selectedProjectId && revertWikiPolicy(selectedProjectId)}
          />
        )}
      </div>
    </section>
  )
}
