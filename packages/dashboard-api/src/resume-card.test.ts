import { describe, expect, test } from 'vitest'
import type { Project, Task, NextNote } from '@apc/shared'
import { buildResumeCard, type ResumeDeps } from './resume-card.js'

const project = { id: 'p1', name: 'coin', repoPaths: ['/work/coin'] } as unknown as Project
function task(id: string, title: string): Task {
  return { id, projectId: 'p1', title, status: 'in_progress', assigneeType: 'agent', priority: 'medium', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [] }
}
function note(text: string): NextNote { return { id: `note:${text}`, projectId: 'p1', text, createdAt: '2026-07-07T00:00:00Z', done: false } }

function deps(over: Partial<ResumeDeps> = {}): ResumeDeps {
  return {
    registry: { get: () => project },
    tasks: { listByProject: () => [task('req:p1:s1', '지난번 요약')] },
    nextNotes: { listByProject: () => [note('7/10 상장 반영')] },
    latestSession: async () => ({ agent: 'claude', sessionId: 's1', lastUserTurn: { text: 'MA20 회복 조건?', ts: '2026-07-07T10:00:00Z' } }),
    ...over,
  }
}

describe('buildResumeCard', () => {
  test('assembles summary, last question, notes, resume target; hasHistory=true', async () => {
    const card = await buildResumeCard(deps(), 'p1')
    expect(card).toMatchObject({
      lastSummary: '지난번 요약',
      lastQuestion: { text: 'MA20 회복 조건?', agent: 'claude' },
      resumeTarget: { agent: 'claude', sessionId: 's1' },
      hasHistory: true,
    })
    expect(card?.nextNotes.map((n) => n.text)).toEqual(['7/10 상장 반영'])
  })

  test('empty project (no session, no notes, no req task) → hasHistory=false', async () => {
    const card = await buildResumeCard(deps({
      tasks: { listByProject: () => [] },
      nextNotes: { listByProject: () => [] },
      latestSession: async () => null,
    }), 'p1')
    expect(card).toMatchObject({ lastSummary: null, lastQuestion: null, resumeTarget: null, hasHistory: false })
  })

  test('notes-only project still surfaces (hasHistory=true)', async () => {
    const card = await buildResumeCard(deps({
      tasks: { listByProject: () => [] },
      latestSession: async () => null,
    }), 'p1')
    expect(card?.hasHistory).toBe(true)
    expect(card?.lastQuestion).toBeNull()
  })

  test('unknown project → null', async () => {
    const card = await buildResumeCard(deps({ registry: { get: () => undefined } }), 'nope')
    expect(card).toBeNull()
  })

  test('lastSummary comes from the latest session req: task, not the last id', async () => {
    const card = await buildResumeCard(deps({
      tasks: { listByProject: () => [task('req:p1:aaa', '최신 세션 요약'), task('req:p1:zzz', 'id상 마지막(오래됨)')] },
      latestSession: async () => ({ agent: 'claude', sessionId: 'aaa', lastUserTurn: { text: 'Q', ts: '2026-07-07T10:00:00Z' } }),
    }), 'p1')
    expect(card?.lastSummary).toBe('최신 세션 요약')
  })

  test('finds the latest next.yml-derived request by its chat session provenance', async () => {
    const current = {
      ...task('next:p1:chat-request-aaa', '현재 파일 요약'),
      source: 'conversation' as const,
      contextPackage: 'session-current',
    }
    const older = {
      ...task('next:p1:chat-request-zzz', '오래된 파일 요약'),
      source: 'conversation' as const,
      contextPackage: 'session-old',
    }
    const card = await buildResumeCard(deps({
      tasks: { listByProject: () => [older, current] },
      latestSession: async () => ({
        agent: 'claude',
        sessionId: 'session-current',
        lastUserTurn: { text: 'Q', ts: '2026-07-07T10:00:00Z' },
      }),
    }), 'p1')
    expect(card?.lastSummary).toBe('현재 파일 요약')
  })
})
