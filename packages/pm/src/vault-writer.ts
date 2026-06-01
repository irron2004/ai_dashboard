import type { VaultAdapter } from '@apc/vault'

export type RunSummaryInput = {
  runId: string; taskId: string; agent: string
  summary: string; filesTouched: string[]; openProblems: string[]
}

export class VaultWriter {
  constructor(private readonly vault: VaultAdapter) {}

  writeRunSummary(projectId: string, input: RunSummaryInput): string {
    const rel = `projects/${projectId}/agent-runs/${input.runId}-summary.md`
    const body = [
      `# Run ${input.runId} — [[${input.taskId}]]`,
      '',
      '## Summary',
      input.summary,
      '',
      '## Files touched',
      input.filesTouched.map((f) => `- ${f}`).join('\n') || '- (none)',
      '',
      '## Open problems',
      input.openProblems.map((p) => `- ${p}`).join('\n') || '- (none)',
      '',
    ].join('\n')
    this.vault.writeDoc(rel, {
      frontmatter: { type: 'agent-run', run_id: input.runId, task_id: input.taskId, agent: input.agent },
      body,
    })
    return rel
  }

  /** Writes the LLM's proposed current.md. Canonical current.md is only ever written on human approval (UI layer). */
  writeCurrentProposal(projectId: string, proposedMarkdown: string): string {
    const rel = `projects/${projectId}/current.proposal.md`
    this.vault.writeDoc(rel, { frontmatter: { type: 'current-proposal', project_id: projectId }, body: proposedMarkdown })
    return rel
  }
}
