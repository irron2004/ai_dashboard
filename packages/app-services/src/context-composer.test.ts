import { test, expect } from 'vitest'
import type { Task } from '@apc/shared'
import { composeContextPackage } from './context-composer.js'

const mk = (over: Partial<Task>): Task => ({
  id: 't', projectId: 'p', title: 't', status: 'todo', assigneeType: 'agent',
  priority: 'medium', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], blockedBy: [], ...over,
})

test('assembles title, parent background, acceptance criteria, wiki excerpts, session summary, and instruction', () => {
  const parent = mk({ id: 'req:p:s1', title: '결제 모듈 리팩터' })
  const task = mk({
    id: 'todo:p:s1:1', title: '토큰 만료 처리', parentTaskId: 'req:p:s1',
    acceptanceCriteria: ['만료 시 401 반환', '리프레시 플로우 테스트 green'],
    linkedWikiPages: ['docs/auth.md'],
  })
  const out = composeContextPackage({
    task, allTasks: [parent, task],
    wikiExcerpts: [{ path: 'docs/auth.md', excerpt: 'JWT는 15분 만료' }],
    sessionSummary: '직전 세션: 리프레시 엔드포인트 초안 작성',
  })
  expect(out).toContain('# 작업: 토큰 만료 처리')
  expect(out).toContain('결제 모듈 리팩터')          // 상위 요청 배경
  expect(out).toContain('- 만료 시 401 반환')         // 수용 기준 bullet
  expect(out).toContain('### docs/auth.md')          // 위키 발췌 헤더
  expect(out).toContain('JWT는 15분 만료')            // 위키 발췌 본문
  expect(out).toContain('직전 세션 요약')
  expect(out).toContain('리프레시 엔드포인트 초안')
  expect(out).toContain('## 지시')
})

test('omits optional sections and shows a placeholder when acceptance criteria are empty', () => {
  const task = mk({ id: 'todo:p:s1:2', title: '작은 작업' })
  const out = composeContextPackage({ task, allTasks: [task], wikiExcerpts: [] })
  expect(out).toContain('# 작업: 작은 작업')
  expect(out).toContain('- (명시된 수용 기준 없음)')
  expect(out).not.toContain('## 배경')               // parentTaskId 없음
  expect(out).not.toContain('## 관련 위키 발췌')      // 발췌 없음
  expect(out).not.toContain('## 직전 세션 요약')      // 요약 없음
  expect(out).toContain('## 지시')
})
