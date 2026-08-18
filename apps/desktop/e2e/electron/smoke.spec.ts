import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const mainEntry = join(desktopDir, 'out/main/index.js')
const BRIDGE_METHODS = [
  'invoke',
  'startPty', 'writePty', 'killPty', 'resizePty',
  'onPtyDataV2', 'onPtyExitV2',
  'onAgentActivity',
  'onHarnessProgress', 'onHarnessEngineLog', 'onHarnessNodes', 'onHarnessActivity',
  'onDevHarnessLog', 'onDevHarnessStarted',
  'paneOpened', 'paneClosed', 'selectProject', 'onWorkspaceRestore',
] as const

function stringEnvironment(extra: Record<string, string>): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
  return { ...inherited, ...extra }
}

test('Windows Electron: isolated boot, preload, IPC, tabs, shortcut', async ({}, testInfo) => {
  test.skip(process.platform !== 'win32', 'Electron integration smoke의 기준 환경은 Windows x64다.')
  expect(existsSync(mainEntry), `먼저 desktop production build가 필요합니다: ${mainEntry}`).toBe(true)

  const userDataDir = await mkdtemp(join(tmpdir(), 'apc-electron-e2e-'))
  let application: ElectronApplication | null = null
  let originalClipboard: string | null = null
  try {
    application = await electron.launch({
      args: [mainEntry],
      cwd: desktopDir,
      env: stringEnvironment({
        APC_E2E_USER_DATA_DIR: userDataDir,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      }),
      locale: 'ko-KR',
      timeout: 45_000,
    })
    const page = await application.firstWindow()
    await expect(page).toHaveTitle('Agent Project Console')

    const actualUserData = await application.evaluate(({ app }) => app.getPath('userData'))
    expect(resolve(actualUserData).toLocaleLowerCase()).toBe(resolve(userDataDir).toLocaleLowerCase())

    const bridgeContract = await page.evaluate((methods) => Object.fromEntries(
      methods.map((method) => [method, typeof window.apc[method] === 'function']),
    ), BRIDGE_METHODS)
    expect(Object.values(bridgeContract)).toEqual(BRIDGE_METHODS.map(() => true))

    const projects = await page.evaluate(() => window.apc.invoke('q:listProjects'))
    expect(projects).toEqual([])
    expect(existsSync(join(userDataDir, 'apc.db'))).toBe(true)

    originalClipboard = await application.evaluate(({ clipboard }) => clipboard.readText())
    const clipboardFixture = 'APC Electron 실제 클립보드 한글 붙여넣기'
    await application.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardFixture)
    const clipboardRead = await page.evaluate(() => window.apc.invoke('q:clipboardReadText'))
    expect(clipboardRead).toEqual({ ok: true, text: clipboardFixture })

    const tabs = ['전체', '홈', '문서', '지식', '위키 생성', '히스토리', '회고']
    await expect(page.getByRole('tab')).toHaveCount(tabs.length)
    for (const name of tabs) {
      const tab = page.getByRole('tab', { name, exact: true })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
    }

    await page.keyboard.press('Control+Shift+D')
    await expect(page.getByRole('dialog', { name: '변경사항' })).toBeVisible()
    await expect(page.getByText('프로젝트를 선택하세요', { exact: true })).toBeVisible()

    const project = await page.evaluate((repoPath) => window.apc.invoke('c:registerProject', {
      name: 'Electron PTY smoke', projectType: 'git', repoPath, domain: 'project-docs',
    }), desktopDir) as { id: string }
    const scopedPty = await page.evaluate(async ({ projectId, cwd }) => {
      const pane = {
        paneId: `${projectId}:main:codex-smoke`, projectId, worktreePath: cwd,
        slotId: 'codex-smoke', agent: 'codex' as const,
      }
      const launchId = 'electron-pty-launch-smoke'
      const dataEvents: Array<{ id: string; launchId: string; data: string }> = []
      const activities: Array<{ pane: typeof pane; launchId: string; connection: string }> = []
      let exitEvent: { id: string; launchId: string; code: number; reason?: string } | undefined
      let wrote = false

      return new Promise<{ dataEvents: typeof dataEvents; activities: typeof activities; exitEvent: typeof exitEvent }>((resolveResult, reject) => {
        const cleanup = () => {
          offData()
          offExit()
          offActivity()
          window.clearTimeout(timeout)
        }
        const complete = () => {
          if (!exitEvent || !dataEvents.some((event) => event.data.includes('APC_PTY_SMOKE'))) return
          cleanup()
          resolveResult({ dataEvents, activities, exitEvent })
        }
        const offData = window.apc.onPtyDataV2(pane.paneId, (event) => {
          dataEvents.push(event)
          complete()
        })
        const offExit = window.apc.onPtyExitV2(pane.paneId, (event) => {
          exitEvent = event
          complete()
        })
        const offActivity = window.apc.onAgentActivity((event) => {
          if (event.pane.paneId !== pane.paneId) return
          activities.push(event as typeof activities[number])
          if (event.connection === 'connected' && !wrote) {
            wrote = true
            window.apc.writePty({
              id: pane.paneId, launchId, data: 'echo APC_PTY_SMOKE & exit\r',
            })
          }
        })
        const timeout = window.setTimeout(() => {
          cleanup()
          reject(new Error(`scoped PTY smoke timed out: ${JSON.stringify({ dataEvents, activities, exitEvent })}`))
        }, 10_000)
        window.apc.startPty({
          id: pane.paneId, command: 'codex', args: [], cwd,
          agent: 'codex', pane, launchId,
        })
      })
    }, { projectId: project.id, cwd: desktopDir })
    expect(scopedPty.dataEvents.length).toBeGreaterThan(0)
    expect(scopedPty.dataEvents.every((event) => (
      event.id === `${project.id}:main:codex-smoke` && event.launchId === 'electron-pty-launch-smoke'
    ))).toBe(true)
    expect(scopedPty.exitEvent).toMatchObject({
      id: `${project.id}:main:codex-smoke`, launchId: 'electron-pty-launch-smoke', code: 0,
    })
    expect(scopedPty.activities.some((activity) => (
      activity.launchId === 'electron-pty-launch-smoke'
      && activity.pane.paneId === `${project.id}:main:codex-smoke`
      && activity.pane.projectId === project.id
      && activity.pane.worktreePath === desktopDir
      && activity.pane.slotId === 'codex-smoke'
    ))).toBe(true)
  } catch (error) {
    await testInfo.attach('electron-smoke-error', { body: String(error), contentType: 'text/plain' })
    throw error
  } finally {
    if (application && originalClipboard !== null) {
      await application.evaluate(({ clipboard }, text) => clipboard.writeText(text), originalClipboard).catch(() => {})
    }
    await application?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true })
  }
})
