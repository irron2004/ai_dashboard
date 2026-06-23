import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { exec, execFile } from 'node:child_process'
import { buildContainer } from './container.js'
import { registerIpc } from './ipc.js'
import { PtyManager } from './pty-manager.js'
import { SessionStore } from './session-store.js'
import { adapterFor, findLatestSession } from '@apc/agents'
import { CH, type StartPtyReq, type PtyInputReq, type PtyKillReq, type PtyResizeReq, type TestSshReq, type PaneRef, type WorkspaceRestore } from '../shared/ipc-contract.js'

// electron-vite injects import.meta.dirname-equivalent paths; on Node 24 ESM import.meta.dirname exists.
const here = import.meta.dirname

// Guard so before-quit is registered only once even if createWindow is called again
// (e.g. macOS dock re-activation via app.on('activate')).
let quitHandlerRegistered = false

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: join(here, '../preload/index.mjs'),
      sandbox: false,
    },
  })

  const userData = app.getPath('userData')
  const container = buildContainer({
    dbFile: join(userData, 'apc.db'),
    vaultRoot: join(userData, 'vault'),
    emitHarnessProgress: (e) => win.webContents.send(CH.harnessProgress, e),
    emitHarnessEngineLog: (e) => win.webContents.send(CH.harnessEngineLog, e),
    emitHarnessNodes: (e) => win.webContents.send(CH.harnessNodes, e),
  })

  const sessions = new SessionStore(container.db)
  sessions.ensureSchema()

  // Renderer reports pane open/close and selected project
  ipcMain.on(CH.paneOpened, (_e, p: PaneRef) =>
    sessions.upsertPane({ projectId: p.projectId, agent: p.agent, wasOpen: true }))
  ipcMain.on(CH.paneClosed, (_e, p: PaneRef) =>
    sessions.upsertPane({ projectId: p.projectId, agent: p.agent, wasOpen: false }))
  ipcMain.on(CH.selectProject, (_e, id: string) => sessions.setState('selected_project_id', id))

  // Snapshot latest session ids for open panes before the app quits — registered exactly once.
  if (!quitHandlerRegistered) {
    quitHandlerRegistered = true
    app.on('before-quit', () => {
      const open = sessions.listOpenPanes()
      void Promise.all(open.map(async (pane) => {
        const repoPath = container.registry.get(pane.projectId)?.repoPaths?.[0]
        if (!repoPath) return
        const found = await findLatestSession(adapterFor(pane.agent as 'claude' | 'codex' | 'opencode'), repoPath).catch(() => null)
        if (found) sessions.upsertPane({ projectId: pane.projectId, agent: pane.agent, lastSessionId: found.sessionId, wasOpen: true })
      }))
    })
  }

  // Send restore payload once renderer is ready
  win.webContents.on('did-finish-load', () => {
    const open = sessions.listOpenPanes()
    const payload: WorkspaceRestore = {
      panes: open.map((p) => ({ projectId: p.projectId, agent: p.agent as PaneRef['agent'], lastSessionId: p.lastSessionId })),
      selectedProjectId: sessions.getState('selected_project_id'),
    }
    win.webContents.send(CH.workspaceRestore, payload)
  })

  registerIpc(ipcMain, container)

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

  const pty = new PtyManager((channel, ...args) => win.webContents.send(channel, ...args))
  ipcMain.on(CH.ptyStart, (_e, req: StartPtyReq) => {
    void pty.start(req.id, req.command, req.args, req.cwd, { resume: req.resume, agent: req.agent, sessionId: req.sessionId })
  })
  ipcMain.on(CH.ptyInput, (_e, req: PtyInputReq) => pty.write(req.id, req.data))
  ipcMain.on(CH.ptyKill, (_e, req: PtyKillReq) => pty.kill(req.id))
  ipcMain.on(CH.ptyResize, (_e, req: PtyResizeReq) => pty.resize(req.id, req.cols, req.rows))

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(here, '../renderer/index.html'))
}

// Prevent unhandled errors from crashing the main process
process.on('uncaughtException', (err) => { console.error('[main] uncaughtException:', err) })
process.on('unhandledRejection', (err) => { console.error('[main] unhandledRejection:', err) })

app.whenReady().then(createWindow)
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
