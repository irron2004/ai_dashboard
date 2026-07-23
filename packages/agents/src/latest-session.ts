import type { AgentKind, NormalizedSession } from '@apc/shared'
import type { AgentIngestAdapter } from './types.js'
import { adapterFor } from './resume.js'

const _t = (s?: string) => (s ? Date.parse(s) : 0)

type Candidate = { agent: AgentKind; adapter: AgentIngestAdapter }
type DiscoveryCacheEntry = {
  generation: number
  expiresAt: number
  sources?: Awaited<ReturnType<AgentIngestAdapter['discoverSources']>>
  pending?: Promise<Awaited<ReturnType<AgentIngestAdapter['discoverSources']>>>
}

const SOURCE_DISCOVERY_TTL_MS = 10_000
const discoveryCache = new WeakMap<AgentIngestAdapter, DiscoveryCacheEntry>()
let discoveryGeneration = 0

async function discoverLatestSources(adapter: AgentIngestAdapter) {
  const now = Date.now()
  const cached = discoveryCache.get(adapter)
  if (cached?.generation === discoveryGeneration && cached.sources && cached.expiresAt > now) {
    return cached.sources
  }
  if (cached?.generation === discoveryGeneration && cached.pending) return cached.pending

  const entry: DiscoveryCacheEntry = {
    generation: discoveryGeneration,
    expiresAt: now + SOURCE_DISCOVERY_TTL_MS,
  }
  entry.pending = adapter.discoverSources(() => undefined).then((sources) => {
    entry.sources = sources
    entry.pending = undefined
    entry.expiresAt = Date.now() + SOURCE_DISCOVERY_TTL_MS
    return sources
  }, (error) => {
    discoveryCache.delete(adapter)
    throw error
  })
  discoveryCache.set(adapter, entry)
  return entry.pending
}

/** Force the next latest-session lookup to refresh source listings after an explicit ingest. */
export function invalidateLatestSessionDiscovery(): void {
  discoveryGeneration += 1
}

/** Pick the newest repoPath-matching session across the given (agent, adapter) pairs, returning the
 *  FULL parsed session (turns included). Sources are tried mtime-desc so the newest file usually wins
 *  after parsing a single candidate. */
export async function pickLatestSession(
  candidates: Candidate[],
  repoPath: string,
): Promise<{ agent: AgentKind; session: NormalizedSession } | null> {
  let best: { agent: AgentKind; session: NormalizedSession; rank: number } | null = null
  for (const { agent, adapter } of candidates) {
    const sources = (await discoverLatestSources(adapter))
      .filter((s) => !s.repoPath || s.repoPath === repoPath)
      .sort((x, y) => (y.mtimeMs ?? 0) - (x.mtimeMs ?? 0))
    for (const source of sources) {
      const { session } = await adapter.parseSource(source)
      if (session.repoPath !== repoPath) continue
      const rank = Math.max(_t(session.endedAt), _t(session.startedAt), source.mtimeMs ?? 0)
      if (!best || rank > best.rank) best = { agent, session, rank }
      break // sources are mtime-desc; the first repoPath match for this adapter is its newest
    }
  }
  return best ? { agent: best.agent, session: best.session } : null
}

/** Convenience wrapper over the real CLI adapters (container uses this). */
export function latestSessionDetail(agents: AgentKind[], repoPath: string) {
  return pickLatestSession(agents.map((agent) => ({ agent, adapter: adapterFor(agent) })), repoPath)
}
