import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, migrate, ProjectRegistry, type Db } from '@apc/core'
import { VaultAdapter } from '@apc/vault'
import { VaultWriter } from '@apc/pm'
import { generateRemote, type SshExec } from './remote-generate.js'

// One assistant turn that edits a file, so the parsed session has a filesTouched entry.
const TRANSCRIPT = [
  JSON.stringify({ type: 'user', sessionId: 'remote-sess', cwd: '/home/me/work/apc', timestamp: '2026-06-02T00:00:00Z', message: { role: 'user', content: [{ type: 'text', text: 'do the thing' }] } }),
  JSON.stringify({ type: 'assistant', timestamp: '2026-06-02T00:01:00Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/home/me/work/apc/a.ts' } }] } }),
].join('\n')

const ENGINE_JSON = JSON.stringify({
  workSummary: 'remote summary', filesTouched: ['a.ts'], openProblems: [],
  nextTasks: [{ title: 'next', rationale: 'r' }], currentProposalMarkdown: '## Current\n- remote update\n',
})

describe('generateRemote', () => {
  let db: Db; let dir: string
  beforeEach(() => { db = openDb(':memory:'); migrate(db); dir = mkdtempSync(join(tmpdir(), 'apc-remote-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function deps(exec: SshExec) {
    const registry = new ProjectRegistry(db)
    const vault = new VaultAdapter(dir)
    return { registry, vault, vaultWriter: new VaultWriter(vault), now: () => '2026-06-02T00:00:00Z', exec }
  }

  test('reads remote transcript, runs the remote engine, writes summary + proposal locally', async () => {
    const calls: { cmd: string; stdin?: string }[] = []
    const exec: SshExec = async (ssh, cmd, opts) => {
      calls.push({ cmd, stdin: opts?.stdin })
      if (cmd.includes('.claude/projects')) {
        // verify Claude's path-encoding scheme is applied to the remote path
        expect(cmd).toContain('-home-me-work-apc')
        expect(cmd).toContain('find')
        expect(cmd).toContain('-type f')
        expect(ssh.host).toBe('a6000')
        return { ok: true, stdout: TRANSCRIPT, stderr: '' }
      }
      return { ok: true, stdout: ENGINE_JSON, stderr: '' }
    }
    const d = deps(exec)
    d.registry.register({ id: 'p1', name: 'P1', status: 'active', projectType: 'git', domain: 'project-docs', repoPaths: ['ssh://me@a6000:22/home/me/work/apc'], vaultPaths: [], sourcePaths: [] })

    const res = await generateRemote(d, { projectId: 'p1', engine: 'claude' })
    expect(res.ok).toBe(true)
    expect(res.generation?.workSummary).toBe('remote summary')
    expect(res.summaryPath).toContain('projects/p1/agent-runs/')
    expect(res.proposalPath).toBe('projects/p1/current.proposal.md')
    // engine ran inside the remote project dir, with the built prompt on stdin
    const engineCall = calls.find((c) => !c.cmd.includes('.claude/projects'))
    expect(engineCall?.cmd).toContain('claude')
    expect(engineCall?.cmd).toMatch(/cd .*\/home\/me\/work\/apc/) // engine cd's into the project dir
    expect(engineCall?.stdin).toBeTruthy()
  })

  test('ok:false when the remote has no Claude session', async () => {
    const exec: SshExec = async () => ({ ok: true, stdout: '', stderr: '' })
    const d = deps(exec)
    d.registry.register({ id: 'p2', name: 'P2', status: 'active', projectType: 'git', domain: 'project-docs', repoPaths: ['ssh://me@a6000/home/me/work/apc'], vaultPaths: [], sourcePaths: [] })
    const res = await generateRemote(d, { projectId: 'p2', engine: 'claude' })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/no remote.*session/i)
  })

  test('ok:false when the project is not an ssh project', async () => {
    const exec: SshExec = async () => ({ ok: true, stdout: '', stderr: '' })
    const d = deps(exec)
    d.registry.register({ id: 'p3', name: 'P3', status: 'active', projectType: 'git', domain: 'project-docs', repoPaths: ['/local/path'], vaultPaths: [], sourcePaths: [] })
    const res = await generateRemote(d, { projectId: 'p3', engine: 'claude' })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/not an ssh project/i)
  })
})
