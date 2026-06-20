import { existsSync } from 'node:fs'
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
    const contractDir = resolvePaperContractDir()
    if (!existsSync(contractDir)) {
      throw new Error(
        `paper contract not found at ${contractDir} — bundle wiki-domains/paper/runtime with the app ` +
        `or set APC_PAPER_CONTRACT_DIR`,
      )
    }
    return deps.substrate.lint({ contractDir, wikiDir })
  },
}
