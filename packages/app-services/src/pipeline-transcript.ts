import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One agent step of a harness run — the unit of the "conversation between agents". Each step's `prompt`
 * already embeds the prior agents' outputs (the pipeline threads them as input), so an ordered list of
 * these IS the full multi-agent collaboration, suitable for later study or as ML training data.
 */
export type PipelineStep = {
  runId: string
  projectId: string
  /** Terminal state of the whole run (same on every line) — lets a concatenated dataset be filtered by
   *  outcome, e.g. learn only from FAILED runs. */
  finalState: string
  seq: number
  label: string
  state: string | null
  agent: string | null
  engine: string | null
  ok: boolean | null
  exitCode: number | null
  durationMs: number | null
  startedAt: string | null
  endedAt: string | null
  prompt: string
  output: string
}

/** `${STATE}-${agent}` — states are UPPER_SNAKE (no hyphens), agents are kebab-case, so the first
 *  hyphen splits them unambiguously. */
const LABEL_RE = /^([A-Z][A-Z0-9_]*)-(.+)$/

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

/**
 * Read a finished run's per-step logs (written by LoggingAgentRunner to `<runDir>/logs/<NN>-<label>/`)
 * into an ordered list of pipeline steps. Best-effort: a missing meta.json/prompt/output yields empty or
 * null fields rather than throwing, so even a crashed run produces a usable (partial) transcript.
 */
export function buildPipelineTranscript(
  runDir: string,
  ctx: { runId: string; projectId: string; finalState: string },
): PipelineStep[] {
  const logsRoot = join(runDir, 'logs')
  let dirs: string[]
  try { dirs = readdirSync(logsRoot).filter((d) => /^\d+-/.test(d)).sort() } catch { return [] }
  return dirs.map((d) => {
    const dir = join(logsRoot, d)
    const read = (f: string): string => { try { return readFileSync(join(dir, f), 'utf8') } catch { return '' } }
    let meta: Record<string, unknown> = {}
    try { meta = JSON.parse(read('meta.json') || '{}') as Record<string, unknown> } catch { /* leave {} */ }
    const label = str(meta.label) ?? d.replace(/^\d+-/, '')
    const m = LABEL_RE.exec(label)
    return {
      runId: ctx.runId, projectId: ctx.projectId, finalState: ctx.finalState,
      seq: Number(d.slice(0, d.indexOf('-'))) || 0,
      label,
      state: m ? m[1] : null,
      agent: m ? m[2] : null,
      engine: str(meta.engine),
      ok: bool(meta.ok),
      exitCode: num(meta.exitCode),
      durationMs: num(meta.durationMs),
      startedAt: str(meta.startedAt),
      endedAt: str(meta.endedAt),
      prompt: read('prompt.txt'),
      output: read('stdout.log'),
    }
  })
}

/** Serialize steps as JSON Lines (one self-contained JSON object per line). */
export function transcriptToJsonl(steps: PipelineStep[]): string {
  return steps.map((s) => JSON.stringify(s)).join('\n') + (steps.length ? '\n' : '')
}
