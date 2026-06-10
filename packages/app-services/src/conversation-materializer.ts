import type { NormalizedSession, NormalizedTurn, NormalizedToolCall } from '@apc/shared'

export type QaUnit = { q: NormalizedTurn; answers: NormalizedTurn[] }
export type ConversationManifest = { sessions: number; files: number; skipped: string[] }

/**
 * 시간순 turn들을 Q&A 단위로 묶는다. 새 단위는 "텍스트가 있는 user turn"에서만 시작한다 —
 * claude jsonl에서 tool_result는 user role 메시지(빈 text + toolCalls)로 도착하므로,
 * 빈 텍스트 user turn은 새 질문이 아니라 현재 단위의 answers에 합류시킨다.
 * 첫 질문 이전의 turn(system 프리앰블 등)은 위키 근거가 아니므로 버린다.
 */
export function groupQaUnits(turns: NormalizedTurn[]): QaUnit[] {
  const units: QaUnit[] = []
  let current: QaUnit | null = null
  for (const turn of turns) {
    if (turn.role === 'user' && turn.text.trim()) {
      current = { q: turn, answers: [] }
      units.push(current)
    } else if (current) {
      current.answers.push(turn)
    }
  }
  return units
}

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read'])

/** 툴콜 1개를 "무엇을 했는지" 한 줄로. tool_result(원 호출에 이미 표시됨)는 null → 제외. */
function summarizeToolCall(call: NormalizedToolCall): string | null {
  if (call.name === 'tool_result') return null
  const input = (call.input ?? {}) as Record<string, unknown>
  let line: string
  if (FILE_TOOLS.has(call.name) && typeof input.file_path === 'string') line = `${call.name} ${input.file_path}`
  else if (call.name === 'Bash' && typeof input.command === 'string') line = `Bash: ${input.command.slice(0, 80)}`
  else line = call.name
  return call.isError ? `${line} (error)` : line
}

/** 스타일 B: Q 전문 + A 텍스트 + `### tools` 요약. tool_result 본문(노이즈)은 싣지 않는다. */
export function formatQaFile(unit: QaUnit): string {
  const qHeader = unit.q.timestamp ? `## Q (user, ${unit.q.timestamp})` : '## Q (user)'
  const parts: string[] = [qHeader, '', unit.q.text.trim(), '']
  if (unit.answers.length === 0) {
    parts.push('## A (no answer recorded)', '')
    return parts.join('\n')
  }
  const aTexts = unit.answers.map((a) => a.text.trim()).filter(Boolean)
  parts.push('## A (assistant)', '', aTexts.length ? aTexts.join('\n\n') : '(no text)', '')
  const tools = unit.answers.flatMap((a) => a.toolCalls.map(summarizeToolCall)).filter((l): l is string => l !== null)
  if (tools.length) parts.push('### tools', ...tools.map((l) => `- ${l}`), '')
  return parts.join('\n')
}

/** 드라이브 표기(C:\)·역슬래시·대소문자·트레일링 슬래시를 정규화해 비교 가능하게. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/^([a-z]):\//, '/mnt/$1/').replace(/\/+$/, '')
}

/** 세션의 작업 디렉터리(repoPath, 없으면 worktreePath)가 프로젝트 repoPath와 같거나 그 하위면 매칭. */
export function sessionMatchesProject(session: NormalizedSession, repoPaths: string[]): boolean {
  const candidate = session.repoPath ?? session.worktreePath
  if (!candidate) return false
  const c = normalizePath(candidate)
  for (const repoPath of repoPaths) {
    if (repoPath.startsWith('ssh://')) continue
    const r = normalizePath(repoPath)
    if (c === r || c.startsWith(`${r}/`)) return true
  }
  return false
}
