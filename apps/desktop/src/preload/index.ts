import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/ipc-contract.js'
import type { PtyDataEvent, PtyExitEvent, ResolveEvidenceSourceReq, SearchEvidenceReq } from '../shared/ipc-contract.js'
import type { AgentActivity, WikiRunEvent } from '@apc/shared'
import { PtyEventRouter } from './pty-event-router.js'

const ptyDataRouter = new PtyEventRouter<PtyDataEvent>()
const ptyExitRouter = new PtyEventRouter<PtyExitEvent>()

// Exactly one Electron listener per high-frequency PTY channel. Individual terminals subscribe to
// pane ids through the in-process routers below instead of each adding an ipcRenderer listener.
ipcRenderer.on(CH.ptyDataV2, (_event, payload: PtyDataEvent) => ptyDataRouter.emit(payload))
ipcRenderer.on(CH.ptyExitV2, (_event, payload: PtyExitEvent) => ptyExitRouter.emit(payload))

// Exposed as window.apc in the renderer. Queries/commands go through invoke();
// the PTY stream is event-based.
contextBridge.exposeInMainWorld('apc', {
  invoke: (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload),
  searchEvidence: (req: SearchEvidenceReq) => ipcRenderer.invoke(CH.searchEvidence, req),
  resolveEvidenceSource: (req: ResolveEvidenceSourceReq) => ipcRenderer.invoke(CH.resolveEvidenceSource, req),
  importProjectItems: (req: unknown) => ipcRenderer.invoke(CH.projectImport, req),

  startPty: (req: unknown) => ipcRenderer.send(CH.ptyStart, req),
  writePty: (req: unknown) => ipcRenderer.send(CH.ptyInput, req),
  killPty: (req: unknown) => ipcRenderer.send(CH.ptyKill, req),
  resizePty: (req: unknown) => ipcRenderer.send(CH.ptyResize, req),

  onPtyDataV2: (id: string, cb: (event: PtyDataEvent) => void) => ptyDataRouter.subscribe(id, cb),
  onPtyExitV2: (id: string, cb: (event: PtyExitEvent) => void) => ptyExitRouter.subscribe(id, cb),
  onAgentActivity: (cb: (event: AgentActivity) => void) => {
    const handler = (_e: unknown, event: AgentActivity) => cb(event)
    ipcRenderer.on(CH.agentActivity, handler)
    return () => ipcRenderer.removeListener(CH.agentActivity, handler)
  },
  onHarnessProgress: (cb: (e: { runId: string; state: string }) => void) => {
    const handler = (_e: unknown, ev: { runId: string; state: string }) => cb(ev)
    ipcRenderer.on(CH.harnessProgress, handler)
    return () => ipcRenderer.removeListener(CH.harnessProgress, handler)
  },
  onHarnessEngineLog: (cb: (e: { label: string; stream: 'stdout' | 'stderr'; chunk: string }) => void) => {
    const handler = (_e: unknown, ev: { label: string; stream: 'stdout' | 'stderr'; chunk: string }) => cb(ev)
    ipcRenderer.on(CH.harnessEngineLog, handler)
    return () => ipcRenderer.removeListener(CH.harnessEngineLog, handler)
  },
  onHarnessNodes: (cb: (e: { runId: string; folder: string; nodes: { id: string; title: string; type: string; scope: string }[] }) => void) => {
    const handler = (_e: unknown, ev: { runId: string; folder: string; nodes: { id: string; title: string; type: string; scope: string }[] }) => cb(ev)
    ipcRenderer.on(CH.harnessNodes, handler)
    return () => ipcRenderer.removeListener(CH.harnessNodes, handler)
  },
  onHarnessActivity: (cb: (event: WikiRunEvent) => void) => {
    const handler = (_e: unknown, event: WikiRunEvent) => cb(event)
    ipcRenderer.on(CH.harnessActivity, handler)
    return () => ipcRenderer.removeListener(CH.harnessActivity, handler)
  },
  onDevHarnessLog: (cb: (e: { runId: string; label: string; stream: 'stdout' | 'stderr'; chunk: string }) => void) => {
    const handler = (_e: unknown, ev: { runId: string; label: string; stream: 'stdout' | 'stderr'; chunk: string }) => cb(ev)
    ipcRenderer.on(CH.devHarnessLog, handler)
    return () => ipcRenderer.removeListener(CH.devHarnessLog, handler)
  },
  onDevHarnessStarted: (cb: (e: { runId: string; taskId: string; projectId: string }) => void) => {
    const handler = (_e: unknown, ev: { runId: string; taskId: string; projectId: string }) => cb(ev)
    ipcRenderer.on(CH.devHarnessStarted, handler)
    return () => ipcRenderer.removeListener(CH.devHarnessStarted, handler)
  },

  // Workspace session persistence
  paneOpened: (p: unknown) => ipcRenderer.send(CH.paneOpened, p),
  paneClosed: (p: unknown) => ipcRenderer.send(CH.paneClosed, p),
  selectProject: (id: string) => ipcRenderer.send(CH.selectProject, id),
  onWorkspaceRestore: (cb: (p: unknown) => void) => {
    const handler = (_e: unknown, p: unknown) => cb(p)
    ipcRenderer.on(CH.workspaceRestore, handler)
    return () => ipcRenderer.removeListener(CH.workspaceRestore, handler)
  },
})
