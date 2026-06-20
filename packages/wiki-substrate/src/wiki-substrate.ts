import type { KhKernelLintReport } from '@apc/shared'

/**
 * autosci-core vault 좌표: 계약 디렉터리 + 위키 디렉터리.
 *
 * **Kernel constraint**: `contractDir` and `wikiDir` must be siblings under one
 * vault root (e.g. `<root>/runtime` and `<root>/wiki`). The kernel resolves page
 * locations from `contractDir.parent`, not from `wikiDir` directly, so placing
 * them in separate directory trees will cause the kernel to mis-resolve paths.
 */
export type WikiVault = { contractDir: string; wikiDir: string }

export interface WikiSubstrate {
  lint(vault: WikiVault): Promise<KhKernelLintReport>
  rebuildIndex(vault: WikiVault): Promise<void>
  /** `raw/` 문서가 어댑터로 파싱되는지 점검 (autosci-read). */
  checkSources(vaultRoot: string): Promise<{ ok: boolean; output: string }>
  /** Parse binary/opaque `raw/` sources (e.g. PDFs) via autosci-read and emit each parsed record's text
   *  as `<vault>/raw/_parsed/<name>.md`, so the TS SourceReader (which skips binaries) feeds the parsed
   *  content to the extractor. Optional — only the PythonKernelAdapter implements it. */
  ingest?(vaultRoot: string): Promise<{ ok: boolean; output: string; count: number }>
}
