import { join, dirname } from 'node:path'
import { appendFileSync, mkdirSync } from 'node:fs'
import type { AgentRunStore } from '@apc/pm'
import type { DevHarnessCli } from './dev-harness-cli.js'

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
    const onChunk = (stream: 'stdout' | 'stderr', text: string) => {
      try { appendFileSync(transcriptPath, text) } catch { /* transcript is best-effort; never fail the run */ }
      onLog?.({ runId, label: 'harness', stream, chunk: text })
    }
    const result = await this.deps.cli.run({
      root, taskId: input.taskId, workflow: input.workflow, graphProfile: input.graphProfile,
      onChunk, timeoutMs: this.deps.timeoutMs, signal: controller.signal,
    })
    this.active.delete(runId)

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
