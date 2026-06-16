import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPipelineTranscript, transcriptToJsonl } from './pipeline-transcript.js'

describe('buildPipelineTranscript', () => {
  let runDir: string
  beforeEach(() => { runDir = mkdtempSync(join(tmpdir(), 'pt-')) })
  afterEach(() => { rmSync(runDir, { recursive: true, force: true }) })

  const step = (name: string, meta: object, prompt: string, output: string) => {
    const dir = join(runDir, 'logs', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta))
    writeFileSync(join(dir, 'prompt.txt'), prompt)
    writeFileSync(join(dir, 'stdout.log'), output)
  }

  test('reads ordered steps with prompt/output and splits state/agent from the label', () => {
    step('01-PROJECT_SCANNED-project-discovery', { label: 'PROJECT_SCANNED-project-discovery', engine: 'codex', ok: true, exitCode: 0, durationMs: 12, startedAt: 'A', endedAt: 'B' }, 'P1', 'O1')
    step('02-SOURCES_EXTRACTED-conversation-history-reader', { label: 'SOURCES_EXTRACTED-conversation-history-reader', engine: 'codex', ok: false, exitCode: 1, durationMs: 34 }, 'P2', 'O2')

    const steps = buildPipelineTranscript(runDir, { runId: 'RUN-x', projectId: 'p1', finalState: 'FAILED' })
    expect(steps.length).toBe(2)
    expect(steps[0]).toMatchObject({
      runId: 'RUN-x', projectId: 'p1', finalState: 'FAILED', seq: 1,
      state: 'PROJECT_SCANNED', agent: 'project-discovery', engine: 'codex', ok: true, prompt: 'P1', output: 'O1',
    })
    expect(steps[1]).toMatchObject({ seq: 2, state: 'SOURCES_EXTRACTED', agent: 'conversation-history-reader', ok: false, exitCode: 1 })
  })

  test('is best-effort: a missing meta.json yields null fields, not a throw', () => {
    const dir = join(runDir, 'logs', '01-PROJECT_SCANNED-project-discovery')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'prompt.txt'), 'P')
    const steps = buildPipelineTranscript(runDir, { runId: 'r', projectId: 'p', finalState: 'MERGED' })
    expect(steps[0]).toMatchObject({ seq: 1, state: 'PROJECT_SCANNED', agent: 'project-discovery', engine: null, ok: null, prompt: 'P', output: '' })
  })

  test('returns [] when there are no logs', () => {
    expect(buildPipelineTranscript(runDir, { runId: 'r', projectId: 'p', finalState: 'CREATED' })).toEqual([])
  })

  test('transcriptToJsonl emits one parseable JSON object per line', () => {
    step('01-PROJECT_SCANNED-project-discovery', { label: 'PROJECT_SCANNED-project-discovery', ok: true }, 'P', 'O')
    const jsonl = transcriptToJsonl(buildPipelineTranscript(runDir, { runId: 'r', projectId: 'p', finalState: 'MERGED' }))
    const lines = jsonl.trimEnd().split('\n')
    expect(lines.length).toBe(1)
    expect(JSON.parse(lines[0]).agent).toBe('project-discovery')
  })
})
