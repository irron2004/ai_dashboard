import { cpSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import type { KhState } from '@apc/shared'
import type { Driver, DriverResult } from './harness-runner.js'
import type { WikiSubstrate } from '@apc/wiki-substrate'
import { ARTIFACTS } from './make-drivers.js'

export type PaperPhase1Deps = {
  substrate: WikiSubstrate
  vaultRoot: string        // 이 run의 autosci-core vault (wiki/ + runtime/ 가 놓인다)
  goldenWikiDir: string    // freeze된 골든 wiki/
  samplePdf: string        // freeze된 샘플 PDF
  contractDir: string      // wiki-domains/paper/runtime
}

/** 새 상태를 넣지 않고 주입형 driver로 Phase-1 경로를 구성한다 (스펙 §4a-2).
 *  생성 단계 = fixture(골든 상수), SOURCES_EXTRACTED·VALIDATED = 실제 substrate. */
export function makePaperPhase1Drivers(deps: PaperPhase1Deps): Partial<Record<KhState, Driver>> {
  const wikiDir = join(deps.vaultRoot, 'wiki')
  const vaultContractDir = join(deps.vaultRoot, 'runtime')
  const rawPapers = join(deps.vaultRoot, 'raw', 'papers')

  // kernel WikiContract는 contractDir.parent를 vault root로 보고 entity/edge 경로(`dir: wiki/...`)를
  // 거기서 해석한다(--wiki-dir은 page 위치에 안 씀). 그래서 계약과 wiki를 vault 아래 *형제*로 둔다.
  const seedGolden = () => {
    mkdirSync(wikiDir, { recursive: true }); cpSync(deps.goldenWikiDir, wikiDir, { recursive: true })
    mkdirSync(vaultContractDir, { recursive: true }); cpSync(deps.contractDir, vaultContractDir, { recursive: true })
  }

  const drivers: Partial<Record<KhState, Driver>> = {
    PROJECT_SCANNED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.projectDiscovery, data: { domain: 'paper' } }] }),

    // 실제 ingest 점검: PDF를 raw/에 두고 autosci-read로 파싱되는지 확인.
    SOURCES_EXTRACTED: async (): Promise<DriverResult> => {
      mkdirSync(rawPapers, { recursive: true })
      copyFileSync(deps.samplePdf, join(rawPapers, 'attnembed-2402-05370.pdf'))
      const check = await deps.substrate.checkSources(deps.vaultRoot)
      return { artifacts: [{ name: ARTIFACTS.conversationHistory, data: check }] }
    },

    DOCUMENTS_CLASSIFIED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.documentIntent, data: { documents: [] } }] }),

    // fixture: 골든 노드 상수 배치 (LLM 생성 대체).
    NODE_PROPOSALS_CREATED: async (): Promise<DriverResult> => { seedGolden(); return { artifacts: [{ name: ARTIFACTS.nodeProposals, data: { proposals: [] } }] } },
    LEAD_MERGED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.graphUpdatePlan, data: { node_ops: [] } }] }),
    WRITE_PLAN_CREATED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.writePlan, data: { ops: [] } }] }),
    STAGING_WRITTEN: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.appliedWriteReport, data: { applied: [], proposals: [], skipped: [] } }] }),

    // 실제 권위 게이트: kernel lint. 통과 시 index 재생성, 실패 시 리포트 보존 + run FAILED (§4a-1).
    // contractDir은 vault 안에 복사된 vaultContractDir(= <vault>/runtime) — wiki와 형제여야 kernel이 page를 찾는다.
    VALIDATED: async (): Promise<DriverResult> => {
      const report = await deps.substrate.lint({ contractDir: vaultContractDir, wikiDir })
      if (report.ok) await deps.substrate.rebuildIndex({ contractDir: vaultContractDir, wikiDir })
      return {
        artifacts: [{ name: ARTIFACTS.kernelLint, data: report }],
        status: report.ok ? 'ok' : 'failed',
        error: report.ok ? undefined : `kernel lint: ${report.issues.length} issue(s)`,
      }
    },
  }
  return drivers
}
