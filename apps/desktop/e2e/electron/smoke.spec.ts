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
  'onPtyData', 'onPtyExit',
  'onHarnessProgress', 'onHarnessEngineLog', 'onHarnessNodes',
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

    const tabs = ['전체', '홈', '문서', '지식', '위키 생성', '히스토리']
    await expect(page.getByRole('tab')).toHaveCount(tabs.length)
    for (const name of tabs) {
      const tab = page.getByRole('tab', { name, exact: true })
      await tab.click()
      await expect(tab).toHaveAttribute('aria-selected', 'true')
    }

    await page.keyboard.press('Control+Shift+D')
    await expect(page.getByRole('dialog', { name: '변경사항' })).toBeVisible()
    await expect(page.getByText('프로젝트를 선택하세요', { exact: true })).toBeVisible()
  } catch (error) {
    await testInfo.attach('electron-smoke-error', { body: String(error), contentType: 'text/plain' })
    throw error
  } finally {
    await application?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true })
  }
})
