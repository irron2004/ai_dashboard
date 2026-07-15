import type { AgentIngestAdapter } from '@apc/agents'
import { repoPathMatches } from '@apc/app-services'
import { isHumanQuestionText, type AgentSource, type NormalizedSession } from '@apc/shared'
import type {
  ConversationHistoryReq,
  ConversationHistoryRes,
  ConversationSession,
} from '../shared/ipc-contract.js'

export const CONVERSATION_HISTORY_MAX_LIMIT = 100
export const CONVERSATION_HISTORY_RECENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

function rankTime(value: string | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Pair each human user prompt with assistant text up to the next user prompt. A non-human,
 * non-empty user prompt deliberately closes the active unit so an internal harness response cannot
 * be appended to the preceding real conversation.
 */
export function toConversationSession(session: NormalizedSession): ConversationSession {
  const exchanges: ConversationSession['exchanges'] = []
  let active: { index: number; answers: string[] } | null = null

  for (const turn of session.turns) {
    const text = turn.text.trim()
    if (turn.role === 'user' && text) {
      if (!isHumanQuestionText(text)) {
        active = null
        continue
      }
      const index = exchanges.length
      exchanges.push({
        id: turn.uuid ?? `question-${index + 1}`,
        askedAt: turn.timestamp ?? session.startedAt,
        question: text,
        answer: null,
      })
      active = { index, answers: [] }
      continue
    }

    if (turn.role === 'assistant' && text && active) {
      active.answers.push(text)
      exchanges[active.index].answer = active.answers.join('\n\n')
    }
  }

  const newestFirst = exchanges
    .map((exchange, index) => ({ exchange, index }))
    .sort((left, right) => {
      const byTime = rankTime(right.exchange.askedAt) - rankTime(left.exchange.askedAt)
      return byTime || right.index - left.index
    })
    .map(({ exchange }) => exchange)

  return {
    id: session.id,
    agent: session.agentType,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    branch: session.branch,
    preview: newestFirst[0]?.question ?? '사용자 질문 없음',
    exchanges: newestFirst,
  }
}

type LoadConversationHistoryOpts = {
  adapters: readonly AgentIngestAdapter[]
  projectId: string
  repoPaths: readonly string[]
  agent: ConversationHistoryReq['agent']
  includeOlder?: boolean
  limit?: number
  nowMs?: number
}

type RankedSession = { session: ConversationSession; rank: number }
type CandidateSource = { adapter: AgentIngestAdapter; source: AgentSource }

function canBelongToProject(source: AgentSource, repoPaths: readonly string[]): boolean {
  return !source.repoPath || repoPathMatches(source.repoPath, repoPaths)
}

/** Read recent live CLI transcripts for one agent. This intentionally does not depend on ingest:
 * the history dialog must work immediately after opening the app, before `c:ingestAll` has run. */
export async function loadConversationHistory(opts: LoadConversationHistoryOpts): Promise<ConversationHistoryRes> {
  const limit = Number.isFinite(opts.limit)
    ? Math.max(1, Math.min(CONVERSATION_HISTORY_MAX_LIMIT, Math.trunc(opts.limit!)))
    : undefined
  const cutoff = opts.includeOlder
    ? undefined
    : (opts.nowMs ?? Date.now()) - CONVERSATION_HISTORY_RECENT_WINDOW_MS
  const empty: ConversationHistoryRes = {
    projectId: opts.projectId,
    agent: opts.agent,
    sessions: [],
    scannedSources: 0,
    skippedSources: 0,
    truncated: false,
  }
  if (opts.repoPaths.length === 0) return empty

  const adapters = opts.adapters.filter((candidate) => candidate.agentKind === opts.agent)
  if (adapters.length === 0) return empty

  const candidates: CandidateSource[] = []
  let hasOlder = false
  for (const adapter of adapters) {
    const discovered = await adapter.discoverSources(() => undefined)
    for (const source of discovered) {
      if (!canBelongToProject(source, opts.repoPaths)) continue
      if (cutoff !== undefined && source.mtimeMs !== undefined && source.mtimeMs < cutoff) {
        hasOlder = true
        continue
      }
      candidates.push({ adapter, source })
    }
  }
  candidates.sort((left, right) => (right.source.mtimeMs ?? 0) - (left.source.mtimeMs ?? 0))
  const byId = new Map<string, RankedSession>()
  let skippedSources = 0

  for (const { adapter, source } of candidates) {
    try {
      const { session } = await adapter.parseSource(source)
      const candidatePath = session.repoPath ?? session.worktreePath ?? source.repoPath
      if (!repoPathMatches(candidatePath, opts.repoPaths)) continue
      const rank = Math.max(rankTime(session.endedAt), rankTime(session.startedAt), source.mtimeMs ?? 0)
      if (cutoff !== undefined && rank < cutoff) {
        hasOlder = true
        continue
      }
      const view = toConversationSession(session)
      const previous = byId.get(session.id)
      if (!previous || rank > previous.rank) byId.set(session.id, { session: view, rank })
    } catch {
      skippedSources += 1
    }
  }

  const ranked = [...byId.values()].sort((left, right) => right.rank - left.rank)
  const visible = limit === undefined ? ranked : ranked.slice(0, limit)
  return {
    projectId: opts.projectId,
    agent: opts.agent,
    sessions: visible.map((item) => item.session),
    scannedSources: candidates.length,
    skippedSources,
    truncated: hasOlder || (limit !== undefined && ranked.length > limit),
  }
}
