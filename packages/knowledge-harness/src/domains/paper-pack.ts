import { cpSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { WikiSubstrate } from '@apc/wiki-substrate'
import type { KhKernelLintReport } from '@apc/shared'
import type { DomainPack } from './types.js'

// repo-root/wiki-domains/paper/runtime, resolved relative to this file
// (packages/knowledge-harness/src/domains/ -> up 4 to repo root).
const here = dirname(fileURLToPath(import.meta.url))
const sourceContractDir = join(here, '..', '..', '..', '..', 'wiki-domains', 'paper', 'runtime')

/** The paper contract dir. An `APC_PAPER_CONTRACT_DIR` override lets a packaged build (where the
 *  source-relative path does not exist) point at the bundled contract. Does NOT assert existence —
 *  `validate` checks that and fails loudly, so importing the pack is always safe. */
export function resolvePaperContractDir(): string {
  return process.env.APC_PAPER_CONTRACT_DIR ?? sourceContractDir
}

export const paperPack: DomainPack = {
  id: 'paper',
  contractDir: resolvePaperContractDir(),
  async validate(wikiDir: string, deps: { substrate: WikiSubstrate }): Promise<KhKernelLintReport> {
    const src = resolvePaperContractDir()
    if (!existsSync(src)) {
      throw new Error(
        `paper contract not found at ${src} — bundle wiki-domains/paper/runtime with the app ` +
        `or set APC_PAPER_CONTRACT_DIR`,
      )
    }
    // The kernel resolves pages from contractDir.parent (WikiVault sibling constraint), so the contract
    // must sit next to the wiki dir. Seed it FRESH at `<parent-of-wikiDir>/runtime` (clear any prior
    // copy first so a re-validate can't leave stale contract files), then lint that pair.
    const seededContractDir = join(dirname(wikiDir), 'runtime')
    rmSync(seededContractDir, { recursive: true, force: true })
    cpSync(src, seededContractDir, { recursive: true })
    return deps.substrate.lint({ contractDir: seededContractDir, wikiDir })
  },
}
