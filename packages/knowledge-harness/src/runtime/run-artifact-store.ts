import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  RunStateSchema,
  WikiProgressSummarySchema,
  WikiRunEventSchema,
  type RunState,
  type KhState,
  type WikiProgressSummary,
  type WikiRunEvent,
} from '@apc/shared'
import { reduceWikiProgress } from './wiki-progress-reducer.js'

type WithoutProgressEnvelope<T> = T extends WikiRunEvent
  ? Omit<T, 'version' | 'seq' | 'eventId'>
  : never
export type WikiRunEventInput = WithoutProgressEnvelope<WikiRunEvent>

type RunArtifactStoreOptions = {
  eventId?: (seq: number) => string
}

const PROGRESS_JOURNAL = 'progress.jsonl'
const PROGRESS_SUMMARY = 'progress-summary.json'

/** Reads/writes one run directory: runs/RUN-<id>/. The only component that touches the run's filesystem. */
export class RunArtifactStore {
  private progressQueue: Promise<void> = Promise.resolve()
  private nextProgressSeq: number | undefined
  private readonly eventId: (seq: number) => string

  /** @param runDir absolute path to the run directory. */
  constructor(private readonly runDir: string, options: RunArtifactStoreOptions = {}) {
    this.eventId = options.eventId ?? (() => randomUUID())
  }

  init(): void {
    for (const d of ['inputs', 'artifacts', 'proposals', 'validation']) {
      mkdirSync(join(this.runDir, d), { recursive: true })
    }
  }

  /** Write to a sibling .tmp then rename — rename is atomic on the same filesystem, so a reader
   * (or a crash) never observes a half-written file. The .tmp name is pid-qualified to avoid
   * collisions between concurrent writers in the same dir. */
  private writeAtomic(abs: string, data: string): void {
    const tmp = `${abs}.${process.pid}.tmp`
    writeFileSync(tmp, data)
    renameSync(tmp, abs)
  }

  saveRunState(state: RunState): void {
    mkdirSync(this.runDir, { recursive: true })
    this.writeAtomic(join(this.runDir, 'run.json'), JSON.stringify(state, null, 2))
  }

  loadRunState(): RunState {
    return RunStateSchema.parse(JSON.parse(readFileSync(join(this.runDir, 'run.json'), 'utf8')))
  }

  /** Serial append boundary for progress.jsonl. The summary is derived only after the event is durable. */
  appendProgressEvent(input: WikiRunEventInput): Promise<WikiRunEvent> {
    const operation = this.progressQueue.then(() => this.appendProgressEventNow(input))
    this.progressQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  /** Bootstrap-only synchronous append used by createRun before any queued producer exists. */
  appendProgressEventSync(input: WikiRunEventInput): WikiRunEvent {
    return this.appendProgressEventNow(input)
  }

  readProgressEvents(): WikiRunEvent[] {
    const abs = join(this.runDir, PROGRESS_JOURNAL)
    if (!existsSync(abs)) return []
    const text = readFileSync(abs, 'utf8')
    const lines = text.split('\n')
    let lastContentLine = -1
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (lines[index].trim()) { lastContentLine = index; break }
    }
    const events: WikiRunEvent[] = []
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim()
      if (!line) continue
      try {
        events.push(WikiRunEventSchema.parse(JSON.parse(line)))
      } catch (error) {
        const incompleteTail = index === lastContentLine && !text.endsWith('\n')
        if (incompleteTail) break
        throw new Error(`Invalid progress journal line ${index + 1}`, { cause: error })
      }
    }
    return events
  }

  loadProgressSummary(): WikiProgressSummary | undefined {
    const abs = join(this.runDir, PROGRESS_SUMMARY)
    if (!existsSync(abs)) return undefined
    return WikiProgressSummarySchema.parse(JSON.parse(readFileSync(abs, 'utf8')))
  }

  rebuildProgressSummary(): WikiProgressSummary | undefined {
    const summary = reduceWikiProgress(this.readProgressEvents())
    if (summary) this.saveProgressSummary(summary)
    return summary
  }

  private appendProgressEventNow(input: WikiRunEventInput): WikiRunEvent {
    mkdirSync(this.runDir, { recursive: true })
    this.repairProgressJournalTail()
    if (this.nextProgressSeq === undefined) {
      this.nextProgressSeq = this.readProgressEvents().reduce((maximum, event) => Math.max(maximum, event.seq), 0) + 1
    }
    const seq = this.nextProgressSeq
    const event = WikiRunEventSchema.parse({ version: 1, seq, eventId: this.eventId(seq), ...input })
    appendFileSync(join(this.runDir, PROGRESS_JOURNAL), `${JSON.stringify(event)}\n`, 'utf8')
    this.nextProgressSeq += 1
    const summary = reduceWikiProgress(this.readProgressEvents())
    if (summary) this.saveProgressSummary(summary)
    return event
  }

  private saveProgressSummary(summary: WikiProgressSummary): void {
    this.writeAtomic(join(this.runDir, PROGRESS_SUMMARY), JSON.stringify(summary, null, 2))
  }

  /** Drops only a malformed, non-newline-terminated crash tail before the next append. */
  private repairProgressJournalTail(): void {
    const abs = join(this.runDir, PROGRESS_JOURNAL)
    if (!existsSync(abs)) return
    const text = readFileSync(abs, 'utf8')
    if (!text || text.endsWith('\n')) return
    const lastNewline = text.lastIndexOf('\n')
    const tail = text.slice(lastNewline + 1)
    try {
      WikiRunEventSchema.parse(JSON.parse(tail))
      appendFileSync(abs, '\n', 'utf8')
    } catch {
      truncateSync(abs, lastNewline + 1)
    }
  }

  /** Persist one artifact as artifacts/<STATE>/<name>.json; returns its path relative to runDir. */
  writeArtifact(state: KhState, name: string, data: unknown): string {
    mkdirSync(join(this.runDir, 'artifacts', state), { recursive: true })
    const rel = join('artifacts', state, `${name}.json`)
    this.writeAtomic(join(this.runDir, rel), JSON.stringify(data, null, 2))
    return rel
  }

  readArtifact<T = unknown>(rel: string): T {
    return JSON.parse(readFileSync(join(this.runDir, rel), 'utf8')) as T
  }

  /** Write a top-level run deliverable verbatim (e.g. diff.patch, final-report.md — design §6.2). */
  writeFile(rel: string, text: string): string {
    const abs = join(this.runDir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    this.writeAtomic(abs, text)
    return rel
  }

  exists(): boolean {
    return existsSync(join(this.runDir, 'run.json'))
  }

  /** Resume validation: which of the run's indexed artifact paths are absent on disk.
   * An empty result means the persisted state is self-consistent and safe to resume. */
  missingArtifacts(state: RunState): string[] {
    const missing: string[] = []
    for (const paths of Object.values(state.artifacts)) {
      for (const rel of paths) {
        if (!existsSync(join(this.runDir, rel))) missing.push(rel)
      }
    }
    return missing
  }
}
