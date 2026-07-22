import type { ReactNode } from 'react'
import type { KhCoverageReport, KhEvalReport } from '@apc/shared'
import type { FanoutSummary, HarnessRunBundle } from '../harness-utils.js'
import { CoverageMatrix } from './CoverageMatrix.js'
import { QualityPanel } from './QualityPanel.js'
import type { ReviewFilter } from './ReviewPanel.js'

type Props = {
  run: HarnessRunBundle
  coverage?: KhCoverageReport
  quality?: KhEvalReport
  proposalsCount: number
  approvedCount: number
  excludedCount: number
  /** Same proposal-level condition as the review panel's flagged filter. */
  warningCount: number
  fanout: FanoutSummary | null
  onGoToReview: (filter: ReviewFilter) => void
  onOpenSource: (sourcePath: string) => void
  children?: ReactNode
}

export function OverviewPanel({
  run,
  coverage,
  quality,
  proposalsCount,
  approvedCount,
  excludedCount,
  warningCount,
  fanout,
  onGoToReview,
  onOpenSource,
  children,
}: Props) {
  const pendingCount = Math.max(0, proposalsCount - approvedCount - excludedCount)

  return (
    <div className="wikigen__summary overview">
      {children}
      {run.runState.state === 'FAILED' && (
        <p className="wikigen__error">❌ 실패: {run.runState.error ?? '원인 미상'} — 실행 이력에서 ↻ 이어하기</p>
      )}

      {proposalsCount > 0 ? (
        <div className="overview__chips" data-testid="overview-chips" aria-label="검수 현황">
          <button type="button" onClick={() => onGoToReview('all')}>노드 제안 {proposalsCount}</button>
          <button type="button" className="overview__chip overview__chip--approved" onClick={() => onGoToReview('approved')}>✓ 승인 {approvedCount}</button>
          <button type="button" className="overview__chip overview__chip--excluded" onClick={() => onGoToReview('excluded')}>✗ 제외 {excludedCount}</button>
          <button type="button" className="overview__chip" onClick={() => onGoToReview('pending')}>미결 {pendingCount}</button>
          <button
            type="button"
            className={warningCount > 0 ? 'overview__chip overview__chip--warn' : 'overview__chip'}
            onClick={() => onGoToReview('flagged')}
          >
            ⚠ 경고 {warningCount}
          </button>
        </div>
      ) : (
        <p className="overview__empty">검수할 노드 제안이 없습니다.</p>
      )}

      {coverage && (
        <p className="overview__coverage-line">
          소스 반영 {coverage.totals.covered}/{coverage.totals.sourcesTotal} · 누락 {coverage.totals.unmapped}
        </p>
      )}
      <p className="wikigen__hint">항목별 승인·제외는 🔎 검수 탭에서 합니다. 생성된 위키 문서는 📖 Knowledge 탭에서 읽습니다.</p>

      {fanout && (
        <div className="wikigen__folders">
          <h4>📁 폴더 워커 (orchestrator-workers)</h4>
          <p>{fanout.units}개 폴더 단위 · {fanout.ran}개 실행{fanout.skipped.length ? ` · ${fanout.skipped.length}개 스킵` : ''}</p>
          <ul className="wikigen__folder-list">
            {fanout.folders.map((folder) => (
              <li key={folder.label}>
                📁 {folder.label}
                {folder.role ? <em className="wikigen__folder-role"> {folder.role}</em> : null}
                {folder.members && folder.members !== folder.label ? <small> — {folder.members}</small> : null}
              </li>
            ))}
          </ul>
          {fanout.skipped.length > 0 && (
            <ul className="wikigen__folder-skipped">
              {fanout.skipped.map((item) => <li key={item.unit} title={item.reason}>⚠ {item.unit} 스킵</li>)}
            </ul>
          )}
        </div>
      )}

      <section className="overview__section">
        <h4>📊 Coverage</h4>
        {coverage
          ? <CoverageMatrix data={coverage} onOpenSource={onOpenSource} />
          : <p className="wikigen__placeholder">커버리지 데이터 없음 — 전체 문서 모드로 실행하세요.</p>}
      </section>
      <section className="overview__section">
        <h4>📈 Quality</h4>
        {quality
          ? <QualityPanel data={quality} />
          : <p className="wikigen__placeholder">품질 데이터 없음.</p>}
      </section>
    </div>
  )
}
