import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/ipc-contract.js'

// Exposed as window.apc in the renderer. Queries/commands go through invoke();
// the PTY stream is event-based.
contextBridge.exposeInMainWorld('apc', {
  invoke: (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload),

  startPty: (req: unknown) => ipcRenderer.send(CH.ptyStart, req),
  writePty: (req: unknown) => ipcRenderer.send(CH.ptyInput, req),
  killPty: (req: unknown) => ipcRenderer.send(CH.ptyKill, req),

  onPtyData: (cb: (id: string, data: string) => void) => {
    const handler = (_e: unknown, id: string, data: string) => cb(id, data)
    ipcRenderer.on(CH.ptyData, handler)
    return () => ipcRenderer.removeListener(CH.ptyData, handler)
  },
  onPtyExit: (cb: (id: string, code: number) => void) => {
    const handler = (_e: unknown, id: string, code: number) => cb(id, code)
    ipcRenderer.on(CH.ptyExit, handler)
    return () => ipcRenderer.removeListener(CH.ptyExit, handler)
  },
})
