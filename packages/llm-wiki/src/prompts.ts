import type { NormalizedSession } from '@apc/shared'

const MAX_TRANSCRIPT = 24000

function renderTranscript(session: NormalizedSession): string {
  const text = session.turns.map((t) => `### ${t.role}\n${t.text}`).join('\n\n')
  return text.length > MAX_TRANSCRIPT ? text.slice(0, MAX_TRANSCRIPT) + '\n…[truncated]' : text
}

export function buildWikiPrompt(session: NormalizedSession, ctx: { currentCanonical: string }): string {
  return [
    'You are a PM assistant. Summarize an AI agent work session and propose project-memory updates.',
    'Respond with ONLY a single JSON object (no prose, no code fences) with exactly these keys:',
    '{"workSummary": string, "filesTouched": string[], "openProblems": string[],',
    ' "nextTasks": [{"title": string, "rationale": string}], "currentProposalMarkdown": string}',
    '',
    `Repo: ${session.repoPath ?? 'unknown'} (branch ${session.branch ?? 'unknown'})`,
    `Files the agent touched: ${session.filesTouched.join(', ') || 'none recorded'}`,
    '',
    '## Current canonical (current.md)',
    ctx.currentCanonical || '(empty)',
    '',
    '## Session transcript',
    renderTranscript(session),
  ].join('\n')
}
