import type { KhKernelLintReport } from '@apc/shared'

/** autosci-core vault 좌표: 계약 디렉터리 + 위키 디렉터리. */
export type WikiVault = { contractDir: string; wikiDir: string }

export interface WikiSubstrate {
  lint(vault: WikiVault): Promise<KhKernelLintReport>
  rebuildIndex(vault: WikiVault): Promise<void>
  /** `raw/` 문서가 어댑터로 파싱되는지 점검 (autosci-read). */
  checkSources(vaultRoot: string): Promise<{ ok: boolean; output: string }>
}
