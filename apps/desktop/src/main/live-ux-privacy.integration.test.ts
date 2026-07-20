import { afterEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildContainer } from './container.js'
import { handlers } from './ipc.js'
import { CH } from '../shared/ipc-contract.js'

function filesBelow(root: string): string[] {
  const files: string[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry)
      const stat = statSync(absolute)
      if (stat.isDirectory()) visit(absolute)
      else if (stat.isFile()) files.push(absolute)
    }
  }
  visit(root)
  return files
}

describe('live UX privacy persistence boundary', () => {
  let root = ''
  const databases: Array<{ close(): void }> = []

  afterEach(() => {
    for (const database of databases.splice(0)) {
      try { database.close() } catch { /* already closed before the byte-level audit */ }
    }
    if (root) rmSync(root, { recursive: true, force: true })
    root = ''
  })

  test('returns clipboard text to the terminal but persists neither it nor a raw secret question', async () => {
    root = mkdtempSync(join(tmpdir(), 'apc-live-ux-privacy-'))
    const dbFile = join(root, 'apc.db')
    const vaultRoot = join(root, 'vault')
    const repoPath = join(root, 'repo')
    mkdirSync(vaultRoot, { recursive: true })
    mkdirSync(repoPath, { recursive: true })
    const clipboardSecret = 'clipboard-private-7Hn2Qx9Vz4'
    const questionSecret = 'password=private-question-8Km3Ry6Wa1'
    const container = buildContainer({
      dbFile,
      vaultRoot,
      ingestAdapters: [],
      readClipboardText: () => clipboardSecret,
      now: () => Date.parse('2026-07-20T12:00:00Z'),
    })
    databases.push(container.db)
    container.registry.register({
      id: 'privacy-project', name: 'Privacy project', status: 'active', projectType: 'git',
      domain: 'project-docs', repoPaths: [repoPath], vaultPaths: [], sourcePaths: [],
    })
    const pane = {
      paneId: 'privacy-pane', projectId: 'privacy-project', worktreePath: repoPath,
      slotId: 'codex-privacy', agent: 'codex' as const,
    }
    container.activityCoordinator.handle({ type: 'start', pane, launchId: 'privacy-launch' })
    container.activityCoordinator.handle({ type: 'spawn', paneId: pane.paneId, launchId: 'privacy-launch' })

    expect(await handlers(container)[CH.clipboardReadText](undefined))
      .toEqual({ ok: true, text: clipboardSecret })
    expect(container.liveQuestions.submit({
      paneId: pane.paneId,
      launchId: 'privacy-launch',
      text: `배포 전에 ${questionSecret} 값을 사용할까요?`,
    })).toMatchObject({
      ok: true,
      question: { displayText: '[민감한 질문]', privacy: 'masked' },
    })
    const snapshot = container.agentActivitySnapshot({ projectId: 'privacy-project' })
    expect(snapshot.activities[0]?.lastQuestion).toMatchObject({
      displayText: '[민감한 질문]', privacy: 'masked',
    })
    expect(JSON.stringify(snapshot)).not.toContain(questionSecret)
    expect(JSON.stringify(snapshot)).not.toContain(clipboardSecret)

    container.db.close()
    const persisted = filesBelow(root).map((file) => readFileSync(file))
    for (const bytes of persisted) {
      expect(bytes.includes(Buffer.from(questionSecret))).toBe(false)
      expect(bytes.includes(Buffer.from(clipboardSecret))).toBe(false)
    }
  })
})
