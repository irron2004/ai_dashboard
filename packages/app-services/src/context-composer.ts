import type { Task } from '@apc/shared'

export type WikiExcerpt = { path: string; excerpt: string }
export type ComposeContextInput = {
  task: Task
  allTasks: Task[]
  wikiExcerpts: WikiExcerpt[]
  sessionSummary?: string
}

/**
 * Returns a fenced-code-block delimiter that cannot be closed by any backtick run inside `text`.
 * CommonMark §6.1: a closing fence must be at least as long as the opening fence, so using one
 * more backtick than the longest run in the content makes the wrapper unclosable by inner fences.
 * Minimum length is 3 (standard triple-backtick).
 */
function fenceFor(text: string): string {
  let maxRun = 0
  let current = 0
  for (const ch of text) {
    if (ch === '`') { current++; if (current > maxRun) maxRun = current }
    else current = 0
  }
  return '`'.repeat(Math.max(3, maxRun + 1))
}

/**
 * Deterministic task → LLM-handoff prompt. Pure (no LLM, no IO) so it is fully unit-testable; the
 * main-process gatherer (container.composeContext) feeds it task/siblings/excerpts/summary.
 */
export function composeContextPackage(input: ComposeContextInput): string {
  const { task, allTasks, wikiExcerpts, sessionSummary } = input
  const parent = task.parentTaskId ? allTasks.find((t) => t.id === task.parentTaskId) : undefined
  const lines: string[] = []
  lines.push(`# 작업: ${task.title}`, '')
  if (parent) lines.push('## 배경 (상위 요청)', parent.title, '')
  lines.push('## 수용 기준')
  if (task.acceptanceCriteria.length === 0) lines.push('- (명시된 수용 기준 없음)')
  else for (const c of task.acceptanceCriteria) lines.push(`- ${c}`)
  lines.push('')
  if (wikiExcerpts.length > 0) {
    lines.push('## 관련 위키 발췌')
    for (const w of wikiExcerpts) {
      const fence = fenceFor(w.excerpt)
      lines.push(`### ${w.path}`, fence, w.excerpt, fence, '')
    }
  }
  if (sessionSummary && sessionSummary.trim()) lines.push('## 직전 세션 요약', sessionSummary.trim(), '')
  lines.push('## 지시', '위 컨텍스트를 바탕으로 이 작업을 수행하라. 수용 기준을 모두 충족하고, 불명확한 점은 먼저 질문하라.', '')
  return lines.join('\n')
}
