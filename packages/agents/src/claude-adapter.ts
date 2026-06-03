import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { AgentSourceSchema, NormalizedSessionSchema, SourceMetaSchema, type AgentSource, type NormalizedSession, type NormalizedTurn, type SourceCursor } from '@apc/shared'
import { redact } from './redact.js'
import type { AgentIngestAdapter } from './types.js'
import { folderPathFor, walkFiles } from './source-discovery.js'

const FILE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** Parse Claude `.jsonl` transcript content (string) into a NormalizedSession. Reused for
 *  local files (ClaudeAdapter) and remote transcripts read over SSH. */
export function parseClaudeJsonl(raw: string, opts: { id?: string; transcriptPath?: string; sourceDirPath?: string; sourceKind?: 'jsonl-file' | 'ssh-jsonl'; discoveredAt?: string; sourceMeta?: Record<string, unknown> } = {}): NormalizedSession {
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const turns: NormalizedTurn[] = []
  const filesTouched = new Set<string>()
  let sessionId: string | undefined
  let repoPath: string | undefined
  let branch: string | undefined
  let startedAt: string | undefined
  let endedAt: string | undefined

  for (const line of lines) {
    let obj: any
    try { obj = JSON.parse(line) } catch { continue }
    if (obj.sessionId && !sessionId) sessionId = obj.sessionId
    if (obj.cwd && !repoPath) repoPath = obj.cwd
    if (obj.gitBranch && !branch && obj.gitBranch !== 'HEAD') branch = obj.gitBranch
    if (obj.timestamp) { if (!startedAt) startedAt = obj.timestamp; endedAt = obj.timestamp }

    if ((obj.type === 'user' || obj.type === 'assistant') && obj.message?.content) {
      const role = obj.message.role === 'assistant' ? 'assistant' : 'user'
      const texts: string[] = []
      const toolCalls: NormalizedTurn['toolCalls'] = []
      for (const block of obj.message.content) {
        if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
        else if (block.type === 'tool_use') {
          toolCalls.push({ id: block.id, name: block.name, input: block.input })
          const fp = block.input?.file_path
          if (FILE_EDIT_TOOLS.has(block.name) && typeof fp === 'string') filesTouched.add(fp)
        } else if (block.type === 'tool_result') {
          const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '')
          toolCalls.push({ id: block.tool_use_id, name: 'tool_result', resultText: redact(content).slice(0, 4000), isError: !!block.is_error })
        }
      }
      turns.push({ uuid: obj.uuid, role, text: redact(texts.join('\n')), timestamp: obj.timestamp, toolCalls })
    }
  }

  return NormalizedSessionSchema.parse({
    id: sessionId ?? opts.id ?? 'claude-session',
    agentType: 'claude',
    repoPath, branch, startedAt, endedAt,
    sourceDirPath: opts.sourceDirPath,
    sourceMeta: SourceMetaSchema.parse({
      provider: 'claude',
      sourceKind: opts.sourceKind ?? 'jsonl-file',
      rawLocator: opts.transcriptPath ?? opts.id ?? 'claude-session',
      sourceDirPath: opts.sourceDirPath,
      discoveredAt: opts.discoveredAt,
      sessionHeader: {
        sessionId: sessionId ?? opts.id ?? 'claude-session',
        cwd: repoPath,
        gitBranch: branch,
        startedAt,
        endedAt,
        transcriptPath: opts.transcriptPath,
        ...opts.sourceMeta,
      },
    }),
    transcriptPath: opts.transcriptPath,
    turns, filesTouched: [...filesTouched],
  })
}

export class ClaudeAdapter implements AgentIngestAdapter {
  readonly agentKind = 'claude' as const
  constructor(private readonly projectsDir: string | readonly string[] = join(homedir(), '.claude', 'projects')) {}

  async discoverSources(cursorFor: (id: string) => SourceCursor | undefined): Promise<AgentSource[]> {
    const out: AgentSource[] = []
    const discoveredAt = new Date().toISOString()
    for (const locator of walkFiles(this.projectsDir, (path) => path.endsWith('.jsonl'))) {
      const st = statSync(locator)
      const id = `claude:${locator}`
      const cur = cursorFor(id)
      if (cur) {
        try {
          const pos = JSON.parse(cur.position) as { sizeBytes?: number; mtimeMs?: number }
          if (pos.sizeBytes === st.size && pos.mtimeMs === Math.floor(st.mtimeMs)) continue
        } catch {
          // corrupted cursor — treat as changed so it will be re-ingested
        }
      }
      out.push(AgentSourceSchema.parse({
        id,
        agentKind: 'claude',
        kind: 'jsonl-file',
        locator,
        sourceDirPath: folderPathFor(locator),
        discoveredAt,
        mtimeMs: Math.floor(st.mtimeMs),
        sizeBytes: st.size,
      }))
    }
    return out
  }

  async parseSource(source: AgentSource): Promise<{ session: NormalizedSession; position: string }> {
    const raw = readFileSync(source.locator, 'utf8')
    const session = parseClaudeJsonl(raw, {
      id: source.locator,
      transcriptPath: source.locator,
      sourceDirPath: source.sourceDirPath ?? dirname(source.locator),
      discoveredAt: source.discoveredAt,
      sourceMeta: { sourceLocator: source.locator },
    })
    const position = JSON.stringify({ sizeBytes: source.sizeBytes, mtimeMs: source.mtimeMs })
    return { session, position }
  }
}
