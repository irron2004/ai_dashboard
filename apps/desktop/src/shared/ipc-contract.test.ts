import { describe, expect, test } from 'vitest'
import { CH, type StartPtyReq } from './ipc-contract.js'

describe('desktop IPC contract', () => {
  test('channel values are unique', () => {
    const channels = Object.values(CH)
    expect(new Set(channels).size).toBe(channels.length)
  })

  test('contains all context and live UX seams', () => {
    expect(CH).toMatchObject({
      projectContextConfirm: 'c:projectContextConfirm',
      taskCreate: 'c:taskCreate',
      nextNotesList: 'q:nextNotesList',
      agentActivitySnapshot: 'q:agentActivitySnapshot',
      agentActivity: 'agent:activity',
      harnessActivity: 'harness:activity',
      fileRefsResolve: 'q:fileRefsResolve',
      filePreviewRead: 'q:filePreviewRead',
      clipboardReadText: 'q:clipboardReadText',
      terminalDiagnostics: 'q:terminalDiagnostics',
      projectImport: 'c:projectImport',
      searchEvidence: 'q:searchEvidence',
      resolveEvidenceSource: 'q:resolveEvidenceSource',
    })
  })

  test('requires a launch id for pane-scoped and unscoped PTY starts', () => {
    const scoped = {
      id: 'pane-1', command: 'codex', args: [], cwd: '/repo',
      pane: {
        paneId: 'pane-1', projectId: 'p1', worktreePath: '/repo', slotId: 'codex-1', agent: 'codex',
      },
      launchId: 'launch-1',
    } satisfies StartPtyReq
    const unscoped = {
      id: 'utility', command: 'codex', args: [], cwd: '/repo', launchId: 'launch-utility',
    } satisfies StartPtyReq
    expect(scoped.launchId).toBe('launch-1')
    expect(unscoped.launchId).toBe('launch-utility')
  })
})
