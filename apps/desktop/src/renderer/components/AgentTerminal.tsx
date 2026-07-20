import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api.js'
import { TerminalPasteController, multilinePasteMessage, type TerminalNotice } from '../terminal-paste-controller.js'
import { TerminalQuestionBuffer } from '../terminal-question-buffer.js'
import { TerminalContextMenu } from './TerminalContextMenu.js'

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
  onQuestionCandidate?: (text: string) => void
}

// Heuristic: agent CLIs print prompts when they need the user to approve/permit something.
const ATTENTION_RE = /(\(y\/n\)|\[y\/n\]|\by\/n\b|allow\b|permission|approve|proceed\?|grant|do you want)/i
const SECURE_PROMPT_RE = /(?:password|passphrase|pin|verification code|one[- ]time code)\s*[:?]?\s*$/i

/**
 * Agent Work Execution Panel terminal. Spawns a PTY in the main process and mirrors it
 * with xterm. Reports lifecycle to onStatus: running → (attention on a permission prompt) → done.
 */
export function AgentTerminal({
  sessionId, command, args, cwd, agent, resumeSessionId, restartNonce,
  onStatus, onActivate, onQuestionCandidate,
}: AgentTerminalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const pasteControllerRef = useRef<TerminalPasteController | null>(null)
  const [notice, setNotice] = useState<TerminalNotice | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  // keep callbacks in refs so a new identity each render doesn't remount the terminal
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate
  const onQuestionCandidateRef = useRef(onQuestionCandidate)
  onQuestionCandidateRef.current = onQuestionCandidate

  useEffect(() => {
    if (!hostRef.current) return
    const term = new Terminal({ convertEol: true, fontSize: 13, cursorBlink: true })
    const fit = new FitAddon()
    const questionBuffer = new TerminalQuestionBuffer()
    term.loadAddon(fit)
    term.open(hostRef.current)
    fit.fit()
    terminalRef.current = term

    const pasteController = new TerminalPasteController({
      readClipboard: () => api.clipboardReadText(),
      writeClipboard: async (text) => {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard-write-unavailable')
        await navigator.clipboard.writeText(text)
      },
      paste: (text) => term.paste(text),
      bracketedPasteEnabled: () => term.modes.bracketedPasteMode,
      confirmMultiline: (text) => window.confirm(multilinePasteMessage(text)),
      onNotice: setNotice,
    })
    pasteControllerRef.current = pasteController

    onStatusRef.current?.('running')
    const offData = api.onPtyData((id, data) => {
      if (id !== sessionId) return
      term.write(data)
      if (ATTENTION_RE.test(data)) onStatusRef.current?.('attention')
      if (SECURE_PROMPT_RE.test(data.trimEnd())) questionBuffer.setSecurePrompt(true)
    })
    const offExit = api.onPtyExit((id, code) => {
      if (id !== sessionId) return
      term.write(`\r\n[process exited: ${code}]\r\n`)
      onStatusRef.current?.('done')
    })
    // Activation (pane grow) is click-only — see onMouseDown on the host below. Typing does NOT activate.
    const inputSub = term.onData((data) => {
      for (const candidate of questionBuffer.push(data)) onQuestionCandidateRef.current?.(candidate)
      api.writePty({ id: sessionId, data })
    })

    // Copy: auto-copy selected text to the clipboard. Paste: Ctrl+Shift+V.
    const selSub = term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (sel) void pasteController.requestCopy(sel)
    })
    term.attachCustomKeyEventHandler((event) => pasteController.handleKey(event, navigator.platform))

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
      pasteController.dispose()
      pasteControllerRef.current = null
      terminalRef.current = null
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
      className="agent-terminal-shell"
      style={{ width: '100%', height: '100%' }}
      onMouseDown={() => onActivateRef.current?.()}
      onContextMenu={(event) => {
        event.preventDefault()
        onActivateRef.current?.()
        setContextMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      <div ref={hostRef} className="agent-terminal" style={{ width: '100%', height: '100%' }} />
      <div className={`agent-terminal__notice agent-terminal__notice--${notice?.kind ?? 'info'}`} role="status" aria-live="polite">
        {notice?.message ?? ''}
      </div>
      {contextMenu && (
        <TerminalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canCopy={Boolean(terminalRef.current?.getSelection())}
          onCopy={() => {
            const selection = terminalRef.current?.getSelection() ?? ''
            void pasteControllerRef.current?.requestCopy(selection)
          }}
          onPaste={() => { void pasteControllerRef.current?.requestPaste() }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
