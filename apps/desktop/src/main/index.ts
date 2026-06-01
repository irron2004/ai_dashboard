import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { buildContainer } from './container.js'
import { registerIpc } from './ipc.js'
import { PtyManager } from './pty-manager.js'
import { CH, type StartPtyReq, type PtyInputReq, type PtyKillReq } from '../shared/ipc-contract.js'

// electron-vite injects import.meta.dirname-equivalent paths; on Node 24 ESM import.meta.dirname exists.
const here = import.meta.dirname

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: join(here, '../preload/index.js'),
      sandbox: false,
    },
  })

  const userData = app.getPath('userData')
  const container = buildContainer({
    dbFile: join(userData, 'apc.db'),
    vaultRoot: join(userData, 'vault'),
  })

  registerIpc(ipcMain, container)

  const pty = new PtyManager((channel, ...args) => win.webContents.send(channel, ...args))
  ipcMain.on(CH.ptyStart, (_e, req: StartPtyReq) => { void pty.start(req.id, req.command, req.args, req.cwd) })
  ipcMain.on(CH.ptyInput, (_e, req: PtyInputReq) => pty.write(req.id, req.data))
  ipcMain.on(CH.ptyKill, (_e, req: PtyKillReq) => pty.kill(req.id))

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(here, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
