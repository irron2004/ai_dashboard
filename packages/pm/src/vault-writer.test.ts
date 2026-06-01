import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultAdapter } from '@apc/vault'
import { VaultWriter } from './vault-writer.js'

describe('VaultWriter', () => {
  let dir: string; let writer: VaultWriter
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apc-vw-')); writer = new VaultWriter(new VaultAdapter(dir)) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('writes an agent-run summary with frontmatter + link to the task', () => {
    const rel = writer.writeRunSummary('p1', {
      runId: 'RUN-1', taskId: 'TASK-001', agent: 'codex',
      summary: 'did the thing', filesTouched: ['a.ts'], openProblems: [],
    })
    expect(rel).toBe('projects/p1/agent-runs/RUN-1-summary.md')
    const doc = new VaultAdapter(dir).readDoc(rel)
    expect(doc.frontmatter.task_id).toBe('TASK-001')
    expect(doc.body).toContain('[[TASK-001]]')
    expect(doc.body).toContain('did the thing')
  })

  test('writes the current PROPOSAL to current.proposal.md, never current.md', () => {
    const rel = writer.writeCurrentProposal('p1', '## Current\n- updated\n')
    expect(rel).toBe('projects/p1/current.proposal.md')
    expect(() => new VaultAdapter(dir).readDoc('projects/p1/current.md')).toThrow(/not found/i)
  })
})
