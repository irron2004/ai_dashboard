import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunStateSchema } from '@apc/shared'
import { RunArtifactStore } from './run-artifact-store.js'

describe('RunArtifactStore', () => {
  let dir: string
  let store: RunArtifactStore
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kh-run-')); store = new RunArtifactStore(dir) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  test('init creates the run subdirectories', () => {
    store.init()
    for (const d of ['inputs', 'artifacts', 'proposals', 'validation']) {
      expect(existsSync(join(dir, d))).toBe(true)
    }
  })

  test('saveRunState / loadRunState round-trips via schema', () => {
    const rs = RunStateSchema.parse({ runId: 'RUN-1', projectId: 'p1', engine: 'claude', state: 'CREATED' })
    store.saveRunState(rs)
    expect(store.loadRunState()).toEqual(rs)
  })

  test('writeArtifact persists JSON under artifacts/<STATE>/ and returns its relative path; readArtifact reads it back', () => {
    const rel = store.writeArtifact('PROJECT_SCANNED', 'report', { hello: 'world' })
    expect(rel).toBe(join('artifacts', 'PROJECT_SCANNED', 'report.json'))
    expect(store.readArtifact(rel)).toEqual({ hello: 'world' })
  })

  test('exists reflects whether run.json is present', () => {
    expect(store.exists()).toBe(false)
    store.saveRunState(RunStateSchema.parse({ runId: 'RUN-1', projectId: 'p1', engine: 'claude', state: 'CREATED' }))
    expect(store.exists()).toBe(true)
  })
})
