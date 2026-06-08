import type { AgentIngestAdapter } from '@apc/agents'
import type { ProjectRegistry } from '@apc/core'
import type { VaultAdapter } from '@apc/vault'
import type { VaultWriter } from '@apc/pm'
import type { WikiEngine } from '@apc/llm-wiki'
import type { AgentSource, AgentType, NormalizedSession, Project, WikiGeneration } from '@apc/shared'
import { isAbsolute, resolve } from 'node:path'

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

export function normalizeRepoPath(path: string | undefined): string | undefined {
  const trimmed = path?.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('ssh://')) {
    try {
      const url = new URL(trimmed)
      const pathName = url.pathname.replace(/\/+/g, '/').replace(/\/+$/, '') || '/'
      const port = url.port ? `:${url.port}` : ''
      const auth = url.username ? `${url.username}@` : ''
      return `ssh://${auth}${url.hostname.toLowerCase()}${port}${pathName}`
    } catch {
      return trimmed.replace(/\\/g, '/').replace(/\/+$/, '')
    }
  }
  const normalized = trimmed.replace(/\\/g, '/')
  const absolute = isAbsolute(normalized) ? normalized : resolve(normalized)
  return absolute.replace(/\/+$/, '') || '/'
}

export function repoPathMatches(candidate: string | undefined, repoPaths: readonly string[]): boolean {
  const candidatePath = normalizeRepoPath(candidate)
  if (!candidatePath) return false
  return repoPaths.some((repoPath) => {
    const projectPath = normalizeRepoPath(repoPath)
    if (!projectPath) return false
    if (candidatePath === projectPath) return true
    if (candidatePath.startsWith('ssh://') || projectPath.startsWith('ssh://')) return false
    return candidatePath.startsWith(`${projectPath}/`)
  })
}

function sourceCanBelongToProject(source: AgentSource, repoPaths: readonly string[]): boolean {
  return !source.repoPath || repoPathMatches(source.repoPath, repoPaths)
}

/**
 * Summarize the latest local agent session for a project into a work summary + a
 * current.md proposal (Obsidian-compatible). No Task/AgentRun prerequisite.
 */
export class GenerateService {
  constructor(private readonly deps: GenerateDeps) {}

  async countProjectSources(projectId: string): Promise<number> {
    const project = this.deps.registry.get(projectId)
    if (!project || project.repoPaths.length === 0) return 0
    const pairs = await this.discoverCandidateSources(project)
    const counted = new Set<string>()
    for (const pair of pairs.slice(0, GENERATE_SOURCE_SCAN_LIMIT)) {
      if (pair.source.repoPath) {
        counted.add(pair.source.id)
        continue
      }
      try {
        const session = (await pair.parse()).session
        if (repoPathMatches(session.repoPath, project.repoPaths)) counted.add(pair.source.id)
      } catch {
        // Preflight counts should stay best-effort; generation will surface parse errors on the selected path.
      }
    }
    return counted.size
  }

  private async discoverCandidateSources(project: Project): Promise<Array<{ source: AgentSource; mtime: number; parse: () => Promise<{ session: NormalizedSession }> }>> {
    const pairs: Array<{ source: AgentSource; mtime: number; parse: () => Promise<{ session: NormalizedSession }> }> = []
    for (const adapter of this.deps.adapters) {
      const sources = await adapter.discoverSources(() => undefined)
      for (const source of sources) {
        if (!sourceCanBelongToProject(source, project.repoPaths)) continue
        pairs.push({ source, mtime: source.mtimeMs ?? 0, parse: async () => adapter.parseSource(source) })
      }
    }
    return pairs.sort((a, b) => b.mtime - a.mtime)
  }

  async generateForProject(input: { projectId: string; engine: AgentType }): Promise<GenerateResult> {
    const project = this.deps.registry.get(input.projectId)
    if (!project) return { ok: false, reason: 'project not found' }
    if (project.repoPaths.length === 0) return { ok: false, reason: 'project has no repo path' }

    // Gather candidate sources most-recent-first, scoped to the selected project's registered repo paths.
    const pairs = await this.discoverCandidateSources(project)

    let session: NormalizedSession | undefined
    for (const p of pairs.slice(0, GENERATE_SOURCE_SCAN_LIMIT)) {
      const s = (await p.parse()).session
      if (repoPathMatches(s.repoPath ?? p.source.repoPath, project.repoPaths)) { session = s; break }
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
