import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { exec, execFile } from 'node:child_process'
import { z } from 'zod'
import { buildContainer } from './container.js'
import { registerIpc, resolveGitRepoPath } from './ipc.js'
import { PtyManager } from './pty-manager.js'
import { SessionStore } from './session-store.js'
import { adapterFor, findLatestSession } from '@apc/agents'
import { AgentKind } from '@apc/shared'
import { CH, type TestSshReq, type PaneRef, type WorkspaceRestore } from '../shared/ipc-contract.js'
import { configureE2EUserDataPath } from './e2e-user-data.js'
import { authorizePtyStart, parsePtyInput, parsePtyKill, parsePtyResize, parsePtyStart } from './pty-ipc.js'
import { installNavigationGuard } from './navigation-guard.js'

// electron-vite injects import.meta.dirname-equivalent paths; on Node 24 ESM import.meta.dirname exists.
const here = import.meta.dirname

// Must run before app.ready: both Chromium session state and apc.db derive from userData.
configureE2EUserDataPath(app)

// Guard so before-quit is registered only once even if createWindow is called again
// (e.g. macOS dock re-activation via app.on('activate')).
let quitHandlerRegistered = false

function configurePackagedResources(): void {
  if (!app.isPackaged || process.env.APC_PAPER_CONTRACT_DIR) return
  process.env.APC_PAPER_CONTRACT_DIR = join(process.resourcesPath, 'wiki-domains', 'paper', 'runtime')
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: join(here, '../preload/index.mjs'),
      sandbox: false,
    },
  })
  installNavigationGuard(win.webContents)

  const userData = app.getPath('userData')
  const container = buildContainer({
    dbFile: join(userData, 'apc.db'),
    vaultRoot: join(userData, 'vault'),
    emitHarnessProgress: (e) => win.webContents.send(CH.harnessProgress, e),
    emitHarnessEngineLog: (e) => win.webContents.send(CH.harnessEngineLog, e),
    emitHarnessNodes: (e) => win.webContents.send(CH.harnessNodes, e),
    emitHarnessActivity: (e) => win.webContents.send(CH.harnessActivity, e),
    emitAgentActivity: (e) => win.webContents.send(CH.agentActivity, e),
    emitDevHarnessLog: (e) => win.webContents.send(CH.devHarnessLog, e),
    emitDevHarnessStarted: (e) => win.webContents.send(CH.devHarnessStarted, e),
    readClipboardText: () => clipboard.readText(),
  })

  const sessions = new SessionStore(container.db, {
    primaryWorktreeForProject: (projectId) => container.registry.get(projectId)?.repoPaths[0],
  })
  sessions.ensureSchema()
  sessions.pruneInactive(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString(),
    container.registry.list().map((project) => project.id),
  )

  const pty = new PtyManager(
    (channel, ...args) => win.webContents.send(channel, ...args),
    { onLifecycle: (event) => { container.activityCoordinator.handle(event) } },
  )
  type PendingStart = { token: symbol; projectId?: string; launchId?: string }
  const pendingStarts = new Map<string, PendingStart>()
  const cancelPendingProjectStarts = (projectId: string): void => {
    for (const [id, pending] of [...pendingStarts]) {
      if (pending.projectId !== projectId) continue
      pendingStarts.delete(id)
      if (pending.launchId) pty.kill(id, pending.launchId, 'unmount')
    }
  }

  const scopedPaneReport = z.object({
    projectId: z.string().min(1).max(2_048),
    agent: AgentKind,
    paneId: z.string().min(1).max(2_048),
    worktreePath: z.string().min(1).max(8_192),
    slotId: z.string().min(1).max(2_048),
  }).strict()
  const legacyPaneReport = z.object({
    projectId: z.string().min(1).max(2_048),
    agent: AgentKind,
  }).strict()
  const paneReport = z.union([scopedPaneReport, legacyPaneReport])

  // Renderer reports pane open/close and selected project
  ipcMain.on(CH.paneOpened, (_e, payload: unknown) => {
    const parsed = paneReport.safeParse(payload)
    if (parsed.success && container.registry.get(parsed.data.projectId)) {
      sessions.upsertPane({ ...parsed.data, wasOpen: true })
    }
  })
  ipcMain.on(CH.paneClosed, (_e, payload: unknown) => {
    const parsed = paneReport.safeParse(payload)
    if (parsed.success && container.registry.get(parsed.data.projectId)) {
      sessions.upsertPane({ ...parsed.data, wasOpen: false })
    }
  })
  ipcMain.on(CH.selectProject, (_e, payload: unknown) => {
    const parsed = z.string().min(1).max(2_048).safeParse(payload)
    if (parsed.success) sessions.setState('selected_project_id', parsed.data)
  })

  // Snapshot latest session ids for open panes before the app quits — registered exactly once.
  if (!quitHandlerRegistered) {
    quitHandlerRegistered = true
    app.on('before-quit', () => {
      container.activityCoordinator.flush()
      const open = sessions.listOpenPaneRecords()
      void Promise.all(open.map(async (pane) => {
        const repoPath = pane.worktreePath || container.registry.get(pane.projectId)?.repoPaths?.[0]
        if (!repoPath) return
        const found = await findLatestSession(adapterFor(pane.agent as 'claude' | 'codex' | 'opencode'), repoPath).catch(() => null)
        if (found) sessions.upsertPane({ ...pane, lastSessionId: found.sessionId, wasOpen: true })
      }))
    })
  }

  // Send restore payload once renderer is ready
  win.webContents.on('did-finish-load', () => {
    const open = sessions.listOpenPaneRecords()
    const payload: WorkspaceRestore = {
      panes: open.map((p) => ({
        projectId: p.projectId,
        agent: p.agent as PaneRef['agent'],
        paneId: p.paneId,
        worktreePath: p.worktreePath,
        slotId: p.slotId,
        lastSessionId: p.lastSessionId,
      })),
      selectedProjectId: sessions.getState('selected_project_id'),
    }
    win.webContents.send(CH.workspaceRestore, payload)
  })

  registerIpc(ipcMain, container, {
    pickProjectImportSources: async ({ kind, projectName }) => {
      const result = await dialog.showOpenDialog(win, {
        properties: kind === 'files' ? ['openFile', 'multiSelections'] : ['openDirectory'],
        title: kind === 'files'
          ? `${projectName}에 복사할 파일 선택`
          : `${projectName}에 복사할 폴더 선택`,
        buttonLabel: '프로젝트로 복사',
      })
      return result.canceled ? null : result.filePaths
    },
    beforeDeleteProject: (projectId) => {
      cancelPendingProjectStarts(projectId)
      pty.killProject(projectId, 'unmount')
      sessions.deleteProject(projectId)
      container.activityCoordinator.deleteProject(projectId)
    },
  })

  // Opening evidence is native-shell work, so keep it outside the generic service-only IPC table.
  // HarnessService resolves and realpaths the file under raw/ before this boundary sees it.
  ipcMain.handle(CH.harnessOpenSourceFile, async (_event, payload: unknown) => {
    const req = z.object({
      runId: z.string().min(1).max(512),
      sourcePath: z.string().min(1).max(8_192),
    }).strict().parse(payload)
    const resolved = container.harness.resolveRawSourceFile(req)
    if (!resolved.ok) return resolved
    const reason = await shell.openPath(resolved.absPath)
    return reason ? { ok: false, reason } : { ok: true }
  })

  // Native folder picker dialog
  ipcMain.handle(CH.selectFolder, async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select project folder',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // SSH connection test
  ipcMain.handle(CH.testSsh, async (_e, req: TestSshReq) => {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const args = [
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=5',
        '-p', String(req.port),
        `${req.username}@${req.host}`,
        `test -d "${req.remotePath}" && echo OK`,
      ]
      execFile('ssh', args, { timeout: 10_000 }, (err, stdout) => {
        if (err) resolve({ ok: false, error: err.message })
        else if (stdout.trim() === 'OK') resolve({ ok: true })
        else resolve({ ok: false, error: 'Remote path not found' })
      })
    })
  })

  // Self-update: git pull + pnpm install in the repo root (where the app was launched).
  ipcMain.handle(CH.appUpdate, async () => {
    return new Promise<{ ok: boolean; output: string }>((resolve) => {
      const cmd = 'git pull --ff-only && pnpm install'
      exec(cmd, { cwd: process.cwd(), timeout: 180_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        const output = `$ ${cmd}\n\n${stdout ?? ''}${stderr ? `\n${stderr}` : ''}`.trim()
        resolve({ ok: !err, output })
      })
    })
  })

  // Relaunch the app to load the pulled code.
  ipcMain.handle(CH.appRestart, async () => { app.relaunch(); app.quit() })

  const rejectPtyStart = (id: string, launchId: string, reason: string) => {
    win.webContents.send(CH.ptyExitV2, { id, launchId, code: 1, reason })
  }
  ipcMain.on(CH.ptyStart, (_e, payload: unknown) => {
    const parsed = parsePtyStart(payload)
    if (!parsed.ok) return
    const req = parsed.value
    const requestToken = Symbol(req.launchId ?? 'legacy-start')
    pendingStarts.set(req.id, {
      token: requestToken,
      projectId: req.pane?.projectId,
      launchId: req.launchId,
    })
    void authorizePtyStart(req, (projectId, worktreePath) => (
      resolveGitRepoPath(container, projectId, worktreePath)
    )).then((authorized) => {
      if (pendingStarts.get(req.id)?.token !== requestToken) return
      if (!authorized.ok) {
        pendingStarts.delete(req.id)
        if (req.launchId) rejectPtyStart(req.id, req.launchId, authorized.reason)
        return
      }
      void pty.start(req.id, req.command, req.args, req.cwd, {
        resume: req.resume,
        agent: req.agent,
        sessionId: req.sessionId,
        pane: req.pane,
        launchId: req.launchId,
      }).finally(() => {
        if (pendingStarts.get(req.id)?.token === requestToken) pendingStarts.delete(req.id)
      })
    }).catch(() => {
      if (pendingStarts.get(req.id)?.token !== requestToken) return
      pendingStarts.delete(req.id)
      if (req.launchId) rejectPtyStart(req.id, req.launchId, 'start-authorization-failed')
    })
  })
  ipcMain.on(CH.ptyInput, (_e, payload: unknown) => {
    const parsed = parsePtyInput(payload)
    if (!parsed.ok) return
    const req = parsed.value
    if (!pty.write(req.id, req.data, req.launchId)) return
    if (!req.launchId) return
    for (const text of req.questionCandidates ?? []) {
      container.liveQuestions.submit({ paneId: req.id, launchId: req.launchId, text })
    }
  })
  ipcMain.on(CH.ptyKill, (_e, payload: unknown) => {
    const parsed = parsePtyKill(payload)
    if (!parsed.ok) return
    const req = parsed.value
    const pending = pendingStarts.get(req.id)
    if (pending && (!req.launchId || pending.launchId === req.launchId)) pendingStarts.delete(req.id)
    pty.kill(req.id, req.launchId, req.reason)
  })
  ipcMain.on(CH.ptyResize, (_e, payload: unknown) => {
    const parsed = parsePtyResize(payload)
    if (!parsed.ok) return
    const req = parsed.value
    pty.resize(req.id, req.cols, req.rows, req.launchId)
  })

  const silenceTimer = setInterval(() => {
    for (const activity of container.activityCoordinator.listLive()) {
      container.activityCoordinator.handle({
        type: 'silence', paneId: activity.pane.paneId, launchId: activity.launchId,
      })
    }
  }, 5_000)
  win.once('closed', () => clearInterval(silenceTimer))

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(here, '../renderer/index.html'))
}

// Prevent unhandled errors from crashing the main process
process.on('uncaughtException', (err) => { console.error('[main] uncaughtException:', err) })
process.on('unhandledRejection', (err) => { console.error('[main] unhandledRejection:', err) })

app.whenReady().then(() => {
  configurePackagedResources()
  createWindow()
})
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
