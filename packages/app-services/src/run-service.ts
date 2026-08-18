import type { AgentRun, AgentType, NormalizedSession, WikiGeneration } from '@apc/shared'
import type { WikiEngine } from '@apc/llm-wiki'
import type { TaskStore, AgentRunStore, VaultWriter } from '@apc/pm'

export type RunServiceDeps = {
  wiki: WikiEngine
  vaultWriter: VaultWriter
  tasks: Pick<TaskStore, 'updateStatus'>
  runs: AgentRunStore
}

export type CompleteRunInput = {
  run: AgentRun; session: NormalizedSession; projectId: string
  engine: AgentType; currentCanonical: string; endedAt: string
}
export type CompleteRunResult = { generation: WikiGeneration; summaryPath: string; proposalPath?: string }

export class RunService {
  constructor(private readonly deps: RunServiceDeps) {}

  async completeRun(input: CompleteRunInput): Promise<CompleteRunResult> {
    const generation = await this.deps.wiki.generate(input.session, {
      engine: input.engine, currentCanonical: input.currentCanonical,
    })
    const summaryPath = this.deps.vaultWriter.writeRunSummary(input.projectId, {
      runId: input.run.id, taskId: input.run.taskId, agent: input.run.agent,
      summary: generation.workSummary, filesTouched: generation.filesTouched, openProblems: generation.openProblems,
    })
    let proposalPath: string | undefined
    if (generation.currentProposalMarkdown.trim()) {
      proposalPath = this.deps.vaultWriter.writeCurrentProposal(input.projectId, generation.currentProposalMarkdown)
    }
    this.deps.runs.complete(input.run.id, { endedAt: input.endedAt, summaryPath })
    this.deps.tasks.updateStatus(input.run.taskId, 'review', 'pending')
    return { generation, summaryPath, proposalPath }
  }
}
