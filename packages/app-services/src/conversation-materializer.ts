import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { redact } from '@apc/agents'
import type { AgentIngestAdapter } from '@apc/agents'
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
  const flat = (call.isError ? `${line} (error)` : line).replace(/\s+/g, ' ')
  return redact(flat)
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
    if (!r) continue
    if (c === r || c.startsWith(`${r}/`)) return true
  }
  return false
}

/**
 * 현재 프로젝트에서 진행된 에이전트 세션을 Q&A 단위 파일로 materialize한다:
 * `<vaultRoot>/raw/conversations/<engine>/<sessionId>/NNNq_a.txt`.
 * 멱등(시작 시 conversations/ 전체 삭제 — materializeProjectDocs와 동일 패턴),
 * 어댑터/세션/파일 단위 실패는 skipped에 기록하고 계속한다(절대 run을 죽이지 않음).
 * 인제스트 커서와 독립적으로 항상 전체 세션을 보도록 cursorFor는 undefined를 돌려준다.
 * SourceReader가 raw/ 전체를 LLM 입력으로 넣으므로 최신 maxSessions개만 유지한다.
 */
export async function materializeConversations(opts: {
  adapters: AgentIngestAdapter[]
  repoPaths: string[]
  vaultRoot: string
  maxSessions?: number
}): Promise<ConversationManifest> {
  const destRoot = join(opts.vaultRoot, 'raw', 'conversations')
  rmSync(destRoot, { recursive: true, force: true })
  const skipped: string[] = []
  const matched: NormalizedSession[] = []
  for (const adapter of opts.adapters) {
    let sources
    try { sources = await adapter.discoverSources(() => undefined) }
    catch (e) { skipped.push(`${adapter.agentKind}: discover failed: ${String(e)}`); continue }
    for (const source of sources) {
      try {
        const { session } = await adapter.parseSource(source)
        if (sessionMatchesProject(session, opts.repoPaths)) matched.push(session)
      } catch (e) { skipped.push(`${source.id}: parse failed: ${String(e)}`) }
    }
  }
  matched.sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))
  const taken = matched.slice(0, opts.maxSessions ?? 10)
  let files = 0
  const usedDirs = new Set<string>()
  for (const session of taken) {
    const safeId = session.id.replace(/[^A-Za-z0-9._-]/g, '_')
    let dirName = safeId
    for (let n = 2; usedDirs.has(`${session.agentType}/${dirName}`); n++) dirName = `${safeId}-${n}`
    usedDirs.add(`${session.agentType}/${dirName}`)
    const dir = join(destRoot, session.agentType, dirName)
    groupQaUnits(session.turns).forEach((unit, i) => {
      const abs = join(dir, `${String(i + 1).padStart(3, '0')}q_a.txt`)
      try {
        mkdirSync(dir, { recursive: true })
        writeFileSync(abs, formatQaFile(unit))
        files++
      } catch (e) { skipped.push(`${abs}: write failed: ${String(e)}`) }
    })
  }
  return { sessions: taken.length, files, skipped }
}
