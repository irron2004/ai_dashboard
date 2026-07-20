import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { AgentActivityStore, migratePm } from '@apc/pm'
import type { AgentPaneIdentity } from '@apc/shared'
import { AgentRuntimeCoordinator } from './agent-runtime-coordinator.js'
import {
  LIVE_QUESTION_MAX_CHARS,
  LiveQuestionService,
  MASKED_QUESTION_TEXT,
  sanitizeLiveQuestion,
} from './live-question-service.js'

const pane: AgentPaneIdentity = {
  paneId: 'pane-1', projectId: 'p1', worktreePath: '/repo', slotId: 'codex-1', agent: 'codex',
}

describe('LiveQuestionService', () => {
  let db: Db
  let store: AgentActivityStore
  let coordinator: AgentRuntimeCoordinator

  beforeEach(() => {
    db = openDb(':memory:')
    migrate(db)
    migratePm(db)
    store = new AgentActivityStore(db, () => '2026-07-20T10:00:00Z')
    coordinator = new AgentRuntimeCoordinator(store, { now: () => '2026-07-20T10:00:00Z' })
    coordinator.handle({ type: 'start', pane, launchId: 'L1' })
    coordinator.handle({ type: 'spawn', paneId: pane.paneId, launchId: 'L1' })
  })

  test('stores a one-line bounded optimistic question without control characters', () => {
    const service = new LiveQuestionService(coordinator, { now: () => '2026-07-20T10:01:00Z' })
    const result = service.submit({
      paneId: pane.paneId,
      launchId: 'L1',
      text: `\x1b[31m첫 줄\x1b[0m\n${'가'.repeat(LIVE_QUESTION_MAX_CHARS + 20)}`,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.question.displayText).not.toContain('\x1b')
    expect(result.question.displayText).not.toContain('\n')
    expect(Array.from(result.question.displayText)).toHaveLength(LIVE_QUESTION_MAX_CHARS)
    expect(store.get(pane.paneId)?.lastQuestion).toEqual(result.question)
  })

  test('replaces the entire title when any secret is redacted and never persists the raw value', () => {
    const raw = '이 키 확인해줘 sk-abcdef0123456789abcdef0123'
    const service = new LiveQuestionService(coordinator)
    const result = service.submit({ paneId: pane.paneId, launchId: 'L1', text: raw })
    expect(result).toMatchObject({
      ok: true,
      question: { displayText: MASKED_QUESTION_TEXT, privacy: 'masked', source: 'pty' },
    })
    const row = db.prepare('SELECT * FROM agent_activity WHERE pane_id = ?').get(pane.paneId)
    expect(JSON.stringify(row)).not.toContain('sk-abcdef')
    expect(JSON.stringify(store.get(pane.paneId))).not.toContain('sk-abcdef')
  })

  test('drops secure-prompt, one-token approval, and internal machine input before coordinator mutation', () => {
    const service = new LiveQuestionService(coordinator)
    const revision = store.get(pane.paneId)?.revision
    expect(service.submit({ paneId: pane.paneId, launchId: 'L1', text: 'password123', securePrompt: true })).toEqual({ ok: false, reason: 'secure-prompt' })
    expect(service.submit({ paneId: pane.paneId, launchId: 'L1', text: 'y' })).toEqual({ ok: false, reason: 'approval-input' })
    expect(service.submit({
      paneId: pane.paneId,
      launchId: 'L1',
      text: '# Knowledge Harness Rules\n\n## Role: wiki-graph-lead\n\n## Input\n{}\n\n## Output\nRespond with ONLY a single JSON object',
    })).toEqual({ ok: false, reason: 'internal-prompt' })
    expect(store.get(pane.paneId)?.revision).toBe(revision)
  })

  test('reconciles and restores an optimistic title from an exact transcript session/exchange', async () => {
    const findConfirmedQuestion = vi.fn(async () => ({
      sessionId: 'S1', exchangeId: 'Q7', text: '확정된 질문', askedAt: '2026-07-20T10:02:00Z',
    }))
    const service = new LiveQuestionService(coordinator, { findConfirmedQuestion })
    service.submit({ paneId: pane.paneId, launchId: 'L1', text: '낙관적 후보' })
    const reconciled = await service.reconcile(pane.paneId, 'L1', 'S1')
    expect(findConfirmedQuestion).toHaveBeenCalledWith('S1')
    expect(reconciled).toMatchObject({
      ok: true,
      question: {
        displayText: '확정된 질문', source: 'transcript', sessionId: 'S1', exchangeId: 'Q7',
      },
    })
    expect(await service.restoreSessionQuestion(pane.paneId, 'L1', 'S1')).toMatchObject({ ok: true })
  })

  test('rejects a candidate for a superseded launch', () => {
    const service = new LiveQuestionService(coordinator)
    coordinator.handle({ type: 'start', pane, launchId: 'L2' })
    expect(service.submit({ paneId: pane.paneId, launchId: 'L1', text: '늦은 질문' })).toEqual({ ok: false, reason: 'stale-launch' })
  })
})

test('sanitizeLiveQuestion treats already-redacted transcript text conservatively', () => {
  expect(sanitizeLiveQuestion('token [REDACTED] 확인', {
    askedAt: '2026-07-20T10:00:00Z', source: 'transcript', sessionId: 'S1', exchangeId: 'Q1',
  })).toMatchObject({ ok: true, question: { displayText: MASKED_QUESTION_TEXT, privacy: 'masked' } })
})
