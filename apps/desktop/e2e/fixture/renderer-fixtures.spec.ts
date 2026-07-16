import { expect, test, type Page } from '@playwright/test'
import { expectElementContained, expectNoOverlap, expectSingleLineButton, expectViewportContained } from './layout-contracts.js'

const PROJECT_ID = 'qa-project-01'

async function openFixture(page: Page, scenario: string): Promise<void> {
  await page.goto(`/?fixture=${scenario}`)
  await expect(page.locator('html')).toHaveAttribute('data-apc-fixture', scenario)
  await expect(page.getByRole('tab', { name: '전체', exact: true })).toBeVisible()
}

async function openTab(page: Page, name: '전체' | '홈' | '문서' | '지식' | '위키 생성'): Promise<void> {
  await page.getByRole('tab', { name, exact: name !== '위키 생성' }).click()
  await expect(page.getByRole('tab', { name, exact: name !== '위키 생성' })).toHaveAttribute('aria-selected', 'true')
}

test('empty-project: 빈 프로젝트와 빈 workspace를 결정적으로 렌더한다', async ({ page }) => {
  await openFixture(page, 'empty-project')
  await expect(page.getByText('프로젝트 없음', { exact: true })).toBeVisible()
  await expect(page.getByText('아직 프로젝트가 없습니다', { exact: true })).toBeVisible()
  await expectViewportContained(page)
})

test('many-projects-docs: 프로젝트 다수와 문서 240개를 실제 renderer에 공급한다', async ({ page }) => {
  await openFixture(page, 'many-projects-docs')
  await expect(page.locator('.workspace-card')).toHaveCount(18)
  await openTab(page, '지식')
  await expect(page.locator('.knowledge__tree-item')).toHaveCount(240)
  await expect(page.getByText('docs/section-01/architecture-and-quality-contract-001.md', { exact: true })).toBeVisible()
  await expectViewportContained(page)
})

test('wiki-generating: 실행 중 progress, 긴 로그, live node 이벤트를 고정한다', async ({ page }) => {
  await openFixture(page, 'wiki-generating')
  await openTab(page, '위키 생성')

  const start = page.locator('.start-run-dropdown > button')
  await expectSingleLineButton(start)
  await start.click()
  await page.getByRole('menuitem', { name: /^전체 문서/ }).click()
  await page.getByRole('button', { name: '이 설정으로 위키 생성' }).click()

  await expect(page.getByText('위키 생성 중…', { exact: true })).toBeVisible()
  await expect(page.getByTestId('wikigen-running-dot')).toBeVisible()
  await expect(page.getByText(/문서와 세션을 분석 중입니다/)).toBeVisible()
  await page.getByRole('button', { name: '자세히 ▾' }).click()
  await expect(page.locator('.wiki-progress__log')).toContainText('stderr-with-a-very-long-filename.log')
  await expectViewportContained(page)
})

test('auth-failure-long-path: 401과 긴 로그 경로 및 B2 구분자를 보존한다', async ({ page }) => {
  await openFixture(page, 'auth-failure-long-path')
  await openTab(page, '위키 생성')

  await expect(page.locator('.wikigen__error')).toContainText('HTTP 401 Unauthorized')
  await expect(page.locator('.wikigen__error')).toContainText('stderr-with-a-very-long-filename.log')
  await expect(page.locator('.harness-run-list__footer span')).toContainText('오후 9:25 · 0 artifacts')
  const headerTextWidth = await page.locator('.harness-run-list__header > div:first-child').evaluate((element) => element.getBoundingClientRect().width)
  expect(headerTextWidth).toBeGreaterThan(180)
  await expectElementContained(page.locator('.wikigen__main'))
  await expectViewportContained(page)
})

test('many-changes: 변경 파일 20개 이상을 dialog와 내부 스크롤로 처리한다', async ({ page }) => {
  await openFixture(page, 'many-changes')
  await page.keyboard.press('Control+Shift+D')
  const dialog = page.getByRole('dialog', { name: '변경사항' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.diff-panel__totals')).toContainText('파일 24')
  await expect(dialog.locator('.diff-panel__item')).toHaveCount(24)
  await expectElementContained(dialog)
  await expectViewportContained(page)
})

test('large-graph: 노드 96개와 엣지 180개의 graph fixture를 렌더한다', async ({ page }) => {
  await openFixture(page, 'large-graph')
  await openTab(page, '지식')
  await page.getByRole('button', { name: '그래프', exact: true }).click()
  await expect(page.locator('.cy-canvas')).toBeVisible()

  const counts = await page.evaluate(async (projectId) => {
    const result = await window.apc.invoke('c:readProjectWiki', { projectId }) as { nodes: unknown[]; edges: unknown[] }
    return { nodes: result.nodes.length, edges: result.edges.length }
  }, PROJECT_ID)
  expect(counts).toEqual({ nodes: 96, edges: 180 })
  await expectViewportContained(page)
})

test('long-korean-narrow: 좁은 viewport에서도 버튼 nowrap과 비겹침 계약을 지킨다', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 800 })
  await openFixture(page, 'long-korean-narrow')
  await openTab(page, '위키 생성')

  await expectSingleLineButton(page.locator('.start-run-dropdown > button'))
  await expectNoOverlap(page.locator('.harness-run-list__actions button'))
  await expect(page.getByRole('button', { name: /긴 한글 프로젝트 이름/ })).toBeVisible()
  await expectViewportContained(page)
})

test('conversation-history: 세 에이전트, 최신순, 3일 이전 더 불러오기와 질문 답변을 렌더한다', async ({ page }) => {
  await page.goto('/?fixture=many-projects-docs&history=1')
  await expect(page.locator('html')).toHaveAttribute('data-apc-fixture', 'many-projects-docs')
  await page.getByRole('button', { name: '질문 히스토리' }).click()

  await expect(page.getByRole('tab', { name: '히스토리' })).toHaveAttribute('aria-selected', 'true')
  const panel = page.getByRole('tabpanel')
  await expect(panel.getByRole('tab', { name: 'Codex' })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.locator('.question-history__session')).toHaveCount(1)
  const questions = panel.locator('.question-history__question-text')
  await expect(questions.nth(0)).toHaveText('codex 최신 질문이 먼저 보이는지 확인해 줘')
  await expect(questions.nth(1)).toHaveText('codex 대화 히스토리 화면을 검증해 줘')
  await panel.getByRole('button', { name: /^Q2 codex 대화 히스토리 화면을 검증해 줘/ }).click()
  await expect(panel.getByRole('region', { name: 'Q2 답변' })).toContainText('세션 목록과 질문 아코디언을 확인했습니다.')

  await panel.getByRole('tab', { name: 'Claude' }).click()
  await expect(panel.getByText('claude 대화 히스토리 화면을 검증해 줘').first()).toBeVisible()

  await panel.getByRole('tab', { name: 'OpenCode' }).click()
  await expect(panel.getByText('opencode 대화 히스토리 화면을 검증해 줘').first()).toBeVisible()
  await panel.getByRole('button', { name: '3일 이전 대화 더 불러오기' }).click()
  await expect(panel.locator('.question-history__session')).toHaveCount(2)
  const sessionPreviews = panel.locator('.question-history__session-preview')
  await expect(sessionPreviews.nth(0)).toHaveText('opencode 대화 히스토리 화면을 검증해 줘')
  await expect(sessionPreviews.nth(1)).toHaveText('opencode 3일 이전 대화')
  await expect(panel.getByRole('button', { name: '3일 이전 대화 더 불러오기' })).toHaveCount(0)
  await expectElementContained(panel)
  await expectViewportContained(page)
})

test('worktree-agent-dock: worktree 전환과 동적 에이전트 추가를 실제 renderer에서 처리한다', async ({ page }) => {
  await openFixture(page, 'many-projects-docs')

  const featureWorktree = page.getByRole('tab', { name: 'feat/fixture-browser-qa', exact: true })
  await expect(featureWorktree).toBeVisible()
  await featureWorktree.click()
  await expect(featureWorktree).toHaveAttribute('aria-selected', 'true')
  const activePanes = page.locator('.agent-panes:visible')
  await expect(activePanes.getByText('이 worktree에는 아직 에이전트가 없습니다.', { exact: true })).toBeVisible()
  await expect(activePanes.locator('.agent-pane')).toHaveCount(0)

  await page.getByRole('button', { name: '에이전트 추가', exact: true }).click()
  await page.getByRole('menuitem', { name: /Codex/ }).click()
  await expect(page.getByRole('button', { name: 'Codex 에이전트 제거', exact: true })).toBeVisible()
  await expect(activePanes.locator('.agent-pane')).toHaveCount(1)
  await expectViewportContained(page)
})

test('Windows 핵심 컴포넌트 snapshot: 실패 run list', async ({ page }) => {
  test.skip(process.platform !== 'win32', 'Pixel golden은 Windows 기준 환경에서만 비교한다.')
  await openFixture(page, 'auth-failure-long-path')
  await openTab(page, '위키 생성')
  await expect(page.locator('.harness-run-list')).toHaveScreenshot('failed-run-list.png', {
    animations: 'disabled',
    maxDiffPixels: 80,
  })
})
