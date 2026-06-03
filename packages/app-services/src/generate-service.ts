import type { AgentIngestAdapter } from '@apc/agents'
import type { ProjectRegistry } from '@apc/core'
import type { VaultAdapter } from '@apc/vault'
import type { VaultWriter } from '@apc/pm'
import type { WikiEngine } from '@apc/llm-wiki'
import type { AgentType, NormalizedSession, WikiGeneration } from '@apc/shared'

export const GENERATE_SOURCE_SCAN_LIMIT = 100

export type GenerateResult = {
  ok: boolean
  reason?: string
  sessionId?: string
  summaryPath?: string
  proposalPath?: string
  generation?: WikiGeneration
}

export type GenerateDeps = {
  adapters: AgentIngestAdapter[]
  registry: ProjectRegistry
  vault: VaultAdapter
  vaultWriter: VaultWriter
  wiki: WikiEngine
  now?: () => string
}

/**
 * Summarize the latest local agent session for a project into a work summary + a
 * current.md proposal (Obsidian-compatible). No Task/AgentRun prerequisite.
 */
export class GenerateService {
  constructor(private readonly deps: GenerateDeps) {}

  async generateForProject(input: { projectId: string; engine: AgentType }): Promise<GenerateResult> {
    const project = this.deps.registry.get(input.projectId)
    if (!project) return { ok: false, reason: 'project not found' }
    const repoPath = project.repoPaths[0]
    if (!repoPath) return { ok: false, reason: 'project has no repo path' }

    // Gather sources from all adapters, most-recent-first; parse a bounded scan until one matches repoPath.
    const pairs: { mtime: number; parse: () => Promise<NormalizedSession> }[] = []
    for (const adapter of this.deps.adapters) {
      const sources = await adapter.discoverSources(() => undefined)
      for (const source of sources) {
        pairs.push({ mtime: source.mtimeMs ?? 0, parse: async () => (await adapter.parseSource(source)).session })
      }
    }
    pairs.sort((a, b) => b.mtime - a.mtime)

    let session: NormalizedSession | undefined
    for (const p of pairs.slice(0, GENERATE_SOURCE_SCAN_LIMIT)) {
      const s = await p.parse()
      if (s.repoPath === repoPath) { session = s; break }
    }
    if (!session) return { ok: false, reason: 'no local session found for this project' }

    let currentCanonical = ''
    try { currentCanonical = this.deps.vault.readDoc(`projects/${input.projectId}/current.md`).body } catch { /* none yet */ }

    const generation = await this.deps.wiki.generate(session, { engine: input.engine, currentCanonical })
    const stamp = (this.deps.now ?? (() => new Date().toISOString()))().replace(/[:.]/g, '-')
    const summaryPath = this.deps.vaultWriter.writeRunSummary(input.projectId, {
      runId: `gen-${stamp}`, taskId: session.id, agent: session.agentType,
      summary: generation.workSummary, filesTouched: generation.filesTouched, openProblems: generation.openProblems,
    })
    let proposalPath: string | undefined
    if (generation.currentProposalMarkdown.trim()) {
      proposalPath = this.deps.vaultWriter.writeCurrentProposal(input.projectId, generation.currentProposalMarkdown)
    }
    return { ok: true, sessionId: session.id, summaryPath, proposalPath, generation }
  }
}
