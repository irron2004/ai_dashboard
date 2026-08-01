import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const mainEntry = join(desktopDir, 'out/main/index.js')

function stringEnvironment(extra: Record<string, string>): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
  return { ...inherited, ...extra }
}

async function writeClaudeSession(home: string, name: string, input: {
  sessionId: string
  repoPath: string
  text: string
}): Promise<void> {
  const directory = join(home, '.claude', 'projects', name)
  await mkdir(directory, { recursive: true })
  const rows = [{
    type: 'user',
    sessionId: input.sessionId,
    cwd: input.repoPath,
    gitBranch: 'main',
    timestamp: '2026-08-02T00:00:00Z',
    uuid: `${input.sessionId}:turn-0`,
    message: { role: 'user', content: input.text },
  }]
  await writeFile(
    join(directory, `${input.sessionId}.jsonl`),
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  )
}

async function createFailingClaude(binDir: string): Promise<void> {
  await mkdir(binDir, { recursive: true })
  const unix = join(binDir, 'claude')
  await writeFile(unix, '#!/bin/sh\nexit 1\n', 'utf8')
  await chmod(unix, 0o755)
  await writeFile(join(binDir, 'claude.cmd'), '@exit /b 1\r\n', 'utf8')
}

async function launch(userDataDir: string, homeDir: string, binDir: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [
      mainEntry,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--user-data-dir=${userDataDir}`,
    ],
    cwd: desktopDir,
    env: stringEnvironment({
      APC_E2E_USER_DATA_DIR: userDataDir,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      HOME: homeDir,
      USERPROFILE: homeDir,
      PATH: binDir,
    }),
    locale: 'ko-KR',
    timeout: 60_000,
  })
}

async function firstWindow(application: ElectronApplication): Promise<Page> {
  const page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page).toHaveTitle('Agent Project Console')
  return page
}

test('real Electron retrieval: scope, sources, context, partial failure, and restart', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const root = await mkdtemp(join(tmpdir(), 'apc-retrieval-e2e-'))
  const userDataDir = join(root, 'user-data')
  const homeDir = join(root, 'home')
  const binDir = join(root, 'bin')
  const repoAlpha = join(root, 'repo-alpha')
  const repoBeta = join(root, 'repo-beta')
  const dbFile = join(userDataDir, 'apc.db')
  await Promise.all([
    mkdir(userDataDir, { recursive: true }),
    mkdir(homeDir, { recursive: true }),
    mkdir(repoAlpha, { recursive: true }),
    mkdir(repoBeta, { recursive: true }),
    createFailingClaude(binDir),
  ])
  await Promise.all([
    writeClaudeSession(homeDir, 'alpha', {
      sessionId: 'retrieval-alpha',
      repoPath: repoAlpha,
      text: 'sharedretrieval sessionalpha partialfailure contextsearch evidence',
    }),
    writeClaudeSession(homeDir, 'beta', {
      sessionId: 'retrieval-beta',
      repoPath: repoBeta,
      text: 'sharedretrieval sessionbeta globalonly evidence',
    }),
  ])

  let application: ElectronApplication | null = null
  let page: Page | null = null
  try {
    application = await launch(userDataDir, homeDir, binDir)
    page = await firstWindow(application)

    const alpha = await page.evaluate((repoPath) => window.apc.invoke('c:registerProject', {
      name: 'Retrieval Alpha', projectType: 'git', repoPath, domain: 'project-docs',
    }), repoAlpha) as { id: string }
    await page.waitForTimeout(5)
    const beta = await page.evaluate((repoPath) => window.apc.invoke('c:registerProject', {
      name: 'Retrieval Beta', projectType: 'git', repoPath, domain: 'project-docs',
    }), repoBeta) as { id: string }
    expect(alpha.id).not.toBe(beta.id)

    const alphaVault = join(userDataDir, 'vault', 'projects', alpha.id)
    const betaVault = join(userDataDir, 'vault', 'projects', beta.id)
    await Promise.all([
      mkdir(join(alphaVault, 'docs'), { recursive: true }),
      mkdir(join(alphaVault, 'conflicts'), { recursive: true }),
      mkdir(join(betaVault, 'docs'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(alphaVault, 'docs', 'retrieval.md'), '# Alpha Retrieval\n\nsharedretrieval knowledgealpha evidence.\n', 'utf8'),
      writeFile(join(alphaVault, 'docs', 'pinned.md'), '# Pinned Context\n\ncontextsearch pinnedwiki verified guidance.\n', 'utf8'),
      writeFile(join(alphaVault, 'conflicts', 'runbook.md'), '# Conflict Runbook\n\nconflictdoc competing recovery guidance.\n', 'utf8'),
      writeFile(join(betaVault, 'docs', 'retrieval.md'), '# Beta Retrieval\n\nsharedretrieval knowledgebeta evidence.\n', 'utf8'),
    ])

    const ingest = await page.evaluate(() => window.apc.invoke('c:ingestAll')) as {
      sources: number
      sessions: number
      documents: number
    }
    expect(ingest).toMatchObject({ sources: 2, sessions: 2, documents: 4 })

    const scoped = await page.evaluate((projectId) => window.apc.invoke('q:searchEvidence', {
      query: 'sharedretrieval', projectId, limit: 20,
    }), alpha.id) as any
    expect(scoped.ok).toBe(true)
    expect(new Set(scoped.response.evidence.map((item: any) => item.sourceKind)))
      .toEqual(new Set(['session', 'knowledge']))
    expect(scoped.response.evidence.every((item: any) => item.projectId === alpha.id)).toBe(true)

    const global = await page.evaluate(() => window.apc.invoke('q:searchEvidence', {
      query: 'sharedretrieval', limit: 20,
    })) as any
    expect(global.ok).toBe(true)
    expect(new Set(global.response.evidence.map((item: any) => item.projectId)))
      .toEqual(new Set([alpha.id, beta.id]))

    const writable = new DatabaseSync(dbFile)
    try {
      writable.prepare(`UPDATE knowledge_documents SET status = 'conflict'
        WHERE project_id = ? AND rel_path = 'conflicts/runbook.md'`).run(alpha.id)
    } finally {
      writable.close()
    }

    await page.keyboard.press('Control+K')
    await expect(page.getByRole('heading', { name: 'Search' })).toBeVisible()
    await page.getByLabel('search').fill('conflictdoc')
    await page.getByLabel('search').press('Enter')
    const conflictResult = page.locator('.search-modal__result').filter({ hasText: 'Conflict Runbook' })
    await expect(conflictResult).toContainText('conflict')
    await expect(conflictResult).toContainText('conflict-document')
    await conflictResult.getByRole('button', { name: /원문 보기/ }).click()
    await expect(page.getByRole('region', { name: '원문 상세' })).toContainText('competing recovery guidance')
    const screenshotPath = testInfo.outputPath('retrieval-warning-source.png')
    await page.screenshot({ path: screenshotPath, fullPage: true })
    await testInfo.attach('retrieval-warning-source', { path: screenshotPath, contentType: 'image/png' })
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    const task = await page.evaluate((projectId) => window.apc.invoke('c:taskCreate', {
      projectId,
      title: 'contextsearch sharedretrieval implementation',
      status: 'todo',
      priority: 'high',
    }), alpha.id) as { ok: boolean; task?: { id: string } }
    expect(task.ok).toBe(true)
    const taskDb = new DatabaseSync(dbFile)
    try {
      taskDb.prepare(`UPDATE tasks SET acceptance_criteria = ?, linked_wiki_pages = ? WHERE id = ?`)
        .run(JSON.stringify(['preserve evidence URI']), JSON.stringify(['docs/pinned.md']), task.task!.id)
    } finally {
      taskDb.close()
    }
    const context = await page.evaluate(({ projectId, taskId }) => window.apc.invoke('q:composeContext', {
      projectId, taskId,
    }), { projectId: alpha.id, taskId: task.task!.id }) as any
    expect(context.ok).toBe(true)
    expect(context.prompt).toContain('contextsearch pinnedwiki verified guidance')
    expect(context.prompt).toContain('## 검색 근거')
    expect(context.prompt).toMatch(/- source: (?:apc|pmw):\/\//)
    expect(context.prompt.indexOf('## 관련 위키 발췌')).toBeLessThan(context.prompt.indexOf('## 검색 근거'))

    await application.close()
    application = null
    page = null

    application = await launch(userDataDir, homeDir, binDir)
    page = await firstWindow(application)
    const restarted = await page.evaluate((projectId) => window.apc.invoke('q:searchEvidence', {
      query: 'sharedretrieval', projectId, limit: 20,
    }), alpha.id) as any
    expect(restarted.ok).toBe(true)
    expect(new Set(restarted.response.evidence.map((item: any) => item.sourceKind)))
      .toEqual(new Set(['session', 'knowledge']))

    const failingDb = new DatabaseSync(dbFile)
    try {
      failingDb.exec('DROP TABLE knowledge_chunk_fts')
    } finally {
      failingDb.close()
    }
    const partial = await page.evaluate((projectId) => window.apc.invoke('q:searchEvidence', {
      query: 'partialfailure', projectId, limit: 20,
    }), alpha.id) as any
    expect(partial.ok).toBe(true)
    expect(partial.response.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKind: 'session', projectId: alpha.id }),
    ]))
    expect(partial.response.diagnostics.retrievers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'knowledge-fts', error: expect.objectContaining({ code: 'retriever-failed' }) }),
    ]))

    await page.keyboard.press('Control+K')
    await page.getByLabel('search').fill('partialfailure')
    await page.getByLabel('search').press('Enter')
    await expect(page.getByLabel('검색 진단')).toContainText('knowledge-fts')
    await expect(page.locator('.search-modal__result').filter({ hasText: 'retrieval-alpha' })).toBeVisible()
  } catch (error) {
    await testInfo.attach('retrieval-smoke-error', { body: String(error), contentType: 'text/plain' })
    throw error
  } finally {
    await application?.close().catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
})
