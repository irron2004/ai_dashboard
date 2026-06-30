import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api.js'

export type AgentRunStatus = 'idle' | 'running' | 'attention' | 'done'

export type AgentTerminalProps = {
  sessionId: string
  command: string
  args: string[]
  cwd: string
  agent?: 'claude' | 'codex' | 'opencode'
  resumeSessionId?: string | null   // null = resume latest; undefined = no resume (fresh start)
  restartNonce?: number   // bump to force re-spawn (start/restart)
  onStatus?: (status: AgentRunStatus) => void
  onActivate?: () => void
}

// Heuristic: agent CLIs print prompts when they need the user to approve/permit something.
const ATTENTION_RE = /(\(y\/n\)|\[y\/n\]|\by\/n\b|allow\b|permission|approve|proceed\?|grant|do you want)/i

/**
 * Agent Work Execution Panel terminal. Spawns a PTY in the main process and mirrors it
 * with xterm. Reports lifecycle to onStatus: running → (attention on a permission prompt) → done.
 */
export function AgentTerminal({ sessionId, command, args, cwd, agent, resumeSessionId, restartNonce, onStatus, onActivate }: AgentTerminalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  // keep callbacks in refs so a new identity each render doesn't remount the terminal
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate

  useEffect(() => {
    if (!hostRef.current) return
    const term = new Terminal({ convertEol: true, fontSize: 13, cursorBlink: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    fit.fit()

    onStatusRef.current?.('running')
    const offData = api.onPtyData((id, data) => {
      if (id !== sessionId) return
      term.write(data)
      if (ATTENTION_RE.test(data)) onStatusRef.current?.('attention')
    })
    const offExit = api.onPtyExit((id, code) => {
      if (id !== sessionId) return
      term.write(`\r\n[process exited: ${code}]\r\n`)
      onStatusRef.current?.('done')
    })
    // Activation (pane grow) is click-only — see onMouseDown on the host below. Typing does NOT activate.
    const inputSub = term.onData((data) => { api.writePty({ id: sessionId, data }) })

    // Copy: auto-copy selected text to the clipboard. Paste: Ctrl+Shift+V.
    const selSub = term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (sel) { try { void navigator.clipboard.writeText(sel) } catch { /* clipboard blocked */ } }
    })
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        void navigator.clipboard.readText().then((t) => { if (t) api.writePty({ id: sessionId, data: t }) }).catch(() => {})
        return false
      }
      return true
    })

    api.startPty({
      id: sessionId, command, args, cwd,
      resume: agent != null && resumeSessionId !== undefined,
      agent,
      sessionId: resumeSessionId ?? undefined,
    })

    const onResize = () => {
      try {
        fit.fit()
        api.resizePty({ id: sessionId, cols: term.cols, rows: term.rows })
      } catch { /* not attached */ }
    }
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(onResize)
    ro.observe(hostRef.current)

    return () => {
      window.removeEventListener('resize', onResize)
      ro.disconnect()
      inputSub.dispose()
      selSub.dispose()
      offData()
      offExit()
      api.killPty({ id: sessionId })
      term.dispose()
    }
    // args is intentionally joined (array identity is unstable across renders)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, command, cwd, args.join(' '), restartNonce])

  return (
    <div
      ref={hostRef}
      className="agent-terminal"
      style={{ width: '100%', height: '100%' }}
      onMouseDown={() => onActivateRef.current?.()}
    />
  )
}
