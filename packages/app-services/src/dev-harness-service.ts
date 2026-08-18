import { join, dirname } from 'node:path'
import { appendFileSync, mkdirSync } from 'node:fs'
import type { AgentRunStore } from '@apc/pm'
import type { DevHarnessCli, DevHarnessCliResult } from './dev-harness-cli.js'

export type DevHarnessLogEvent = { runId: string; label: string; stream: 'stdout' | 'stderr'; chunk: string }
export type DevHarnessRunInput = { projectId: string; taskId: string; workflow?: string; graphProfile?: string }
export type DevHarnessRunResult = { ok: boolean; runId?: string; exitCode?: number | null; reason?: string }
/** Narrow view of ProjectRegistry — only repoPaths is needed, so the service stays DB-free in tests. */
export type ProjectLookup = { get(id: string): { repoPaths: string[] } | undefined }

export type DevHarnessServiceDeps = {
  cli: DevHarnessCli
  runs: AgentRunStore
  registry: ProjectLookup
  runsRoot: string
  now?: () => string
  timeoutMs?: number
  logBatchMs?: number
  logBatchBytes?: number
}

const DEFAULT_LOG_BATCH_MS = 50
const DEFAULT_LOG_BATCH_BYTES = 64 * 1024

type PendingLog = { stream: DevHarnessLogEvent['stream']; parts: string[] }

class DevHarnessLogBatcher {
  private transcriptParts: string[] = []
  private logs: PendingLog[] = []
  private pendingBytes = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly transcriptPath: string,
    private readonly runId: string,
    private readonly onLog: ((event: DevHarnessLogEvent) => void) | undefined,
    private readonly batchMs: number,
    private readonly batchBytes: number,
  ) {}

  push(stream: DevHarnessLogEvent['stream'], text: string): void {
    if (!text) return
    this.transcriptParts.push(text)
    const previous = this.logs.at(-1)
    if (previous?.stream === stream) previous.parts.push(text)
    else this.logs.push({ stream, parts: [text] })
    this.pendingBytes += Buffer.byteLength(text)
    if (this.pendingBytes >= this.batchBytes) this.flush()
    else this.schedule()
  }

  flush = (): void => {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (this.transcriptParts.length === 0) return
    const transcript = this.transcriptParts.join('')
    const logs = this.logs
    this.transcriptParts = []
    this.logs = []
    this.pendingBytes = 0
    try { appendFileSync(this.transcriptPath, transcript) } catch { /* transcript is best-effort */ }
    for (const log of logs) {
      try {
        this.onLog?.({ runId: this.runId, label: 'harness', stream: log.stream, chunk: log.parts.join('') })
      } catch { /* a live-tail listener must never fail the run */ }
    }
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(this.flush, this.batchMs)
    this.timer.unref?.()
  }
}

/**
 * Drives the multi-agent dev harness via the CLI_CONTRACT seam (DevHarnessCli), records the run
 * lifecycle in AgentRunStore (create → complete/fail), and fans stdout/stderr to a transcript file
 * plus a live-tail callback. Independent of the wiki HarnessService (only shares ProjectRegistry +
 * AgentRunStore).
 */
export class DevHarnessService {
  private readonly now: () => string
  private readonly active = new Map<string, AbortController>()
  constructor(private readonly deps: DevHarnessServiceDeps) {
    this.now = deps.now ?? (() => new Date().toISOString())
  }

  async run(
    input: DevHarnessRunInput,
    onLog?: (e: DevHarnessLogEvent) => void,
    onStarted?: (e: { runId: string; taskId: string; projectId: string }) => void,
  ): Promise<DevHarnessRunResult> {
    const root = this.deps.registry.get(input.projectId)?.repoPaths?.[0]
    if (!root) return { ok: false, reason: `project not found or has no repoPath: ${input.projectId}` }

    const startedAt = this.now()
    // Random suffix: the ISO timestamp alone is not unique — two runs of the same project within one
    // millisecond would collide, and AgentRunStore.create is INSERT OR REPLACE (clobber + active-map
    // overwrite → the first run leaks and becomes uncancellable). The suffix makes each id distinct.
    const runId = `run:${input.projectId}:${startedAt.replace(/[:.]/g, '-')}:${Math.random().toString(36).slice(2, 8)}`
    // The DB id keeps the `run:project:…` convention, but a filesystem path segment must not contain ':'
    // (illegal on Windows → mkdir/append silently throw and the transcript is lost). Derive a safe dir.
    const runDirName = runId.replace(/[^A-Za-z0-9._-]/g, '-')
    const transcriptPath = join(this.deps.runsRoot, '.agent-runs', runDirName, 'transcript.log')
    try { mkdirSync(dirname(transcriptPath), { recursive: true }) } catch { /* best-effort */ }

    this.deps.runs.create({
      id: runId, taskId: input.taskId, agent: 'harness', repoPath: root,
      startedAt, status: 'running', transcriptPath,
    })
    onStarted?.({ runId, taskId: input.taskId, projectId: input.projectId })

    const controller = new AbortController()
    this.active.set(runId, controller)
    const logBatch = new DevHarnessLogBatcher(
      transcriptPath,
      runId,
      onLog,
      this.deps.logBatchMs ?? DEFAULT_LOG_BATCH_MS,
      this.deps.logBatchBytes ?? DEFAULT_LOG_BATCH_BYTES,
    )
    let result: DevHarnessCliResult
    try {
      result = await this.deps.cli.run({
        root, taskId: input.taskId, workflow: input.workflow, graphProfile: input.graphProfile,
        onChunk: (stream, text) => logBatch.push(stream, text),
        timeoutMs: this.deps.timeoutMs, signal: controller.signal,
      })
    } finally {
      logBatch.flush()
      this.active.delete(runId)
    }

    const endedAt = this.now()
    if (result.exitCode === 0) {
      this.deps.runs.complete(runId, { endedAt })
      return { ok: true, runId, exitCode: 0 }
    }
    this.deps.runs.fail(runId, { endedAt })
    return { ok: false, runId, exitCode: result.exitCode, reason: result.error ?? `exit code ${result.exitCode}` }
  }

  /** Abort an in-flight run (SIGTERM via the CLI's signal). No-op (ok:false) if the run already ended. */
  cancel(input: { runId: string }): { ok: boolean } {
    const controller = this.active.get(input.runId)
    if (!controller) return { ok: false }
    controller.abort()
    return { ok: true }
  }
}
