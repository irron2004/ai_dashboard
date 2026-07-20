import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'
import { api } from '../api.js'
import { TerminalPasteController, multilinePasteMessage, type TerminalNotice } from '../terminal-paste-controller.js'
import { TerminalQuestionBuffer } from '../terminal-question-buffer.js'
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  TerminalRenderCoordinator,
  activateUnicode11,
  inspectTerminalFonts,
  type TerminalFontDiagnostic,
  type TerminalFontProbeResult,
} from '../terminal-rendering.js'
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
  onRenderingDiagnostic?: (diagnostic: TerminalFontDiagnostic) => void
}

// Heuristic: agent CLIs print prompts when they need the user to approve/permit something.
const ATTENTION_RE = /(\(y\/n\)|\[y\/n\]|\by\/n\b|allow\b|permission|approve|proceed\?|grant|do you want)/i
const SECURE_PROMPT_RE = /(?:password|passphrase|pin|verification code|one[- ]time code)\s*[:?]?\s*$/i

function probeBrowserFont(family: string, sample: string, fontSize: number): TerminalFontProbeResult {
  if (!document.fonts) return { installed: true, glyphs: true }
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return { installed: true, glyphs: true }
  const escaped = family.replace(/"/g, '\\"')
  const quoted = `"${escaped}"`
  const genericFamilies = ['monospace', 'serif', 'sans-serif'] as const
  const probeText = 'mmmmmmmmmmlliWW@@'
  const measure = (text: string, stack: string) => {
    context.font = `${fontSize}px ${stack}`
    return context.measureText(text).width
  }
  const installed = genericFamilies.some((fallback) => (
    Math.abs(measure(probeText, `${quoted}, ${fallback}`) - measure(probeText, fallback)) > 0.01
  ))
  if (!installed) return { installed: false, glyphs: false }

  const fallbackWidths = genericFamilies.map((fallback) => measure(sample, `${quoted}, ${fallback}`))
  const stableAcrossFallbacks = Math.max(...fallbackWidths) - Math.min(...fallbackWidths) < 0.01
  const declaration = `${fontSize}px ${quoted}`
  return {
    installed: true,
    glyphs: stableAcrossFallbacks && document.fonts.check(declaration, sample),
  }
}

/**
 * Agent Work Execution Panel terminal. Spawns a PTY in the main process and mirrors it
 * with xterm. Reports lifecycle to onStatus: running → (attention on a permission prompt) → done.
 */
export function AgentTerminal({
  sessionId, command, args, cwd, agent, resumeSessionId, restartNonce,
  onStatus, onActivate, onQuestionCandidate, onRenderingDiagnostic,
}: AgentTerminalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const pasteControllerRef = useRef<TerminalPasteController | null>(null)
  const [notice, setNotice] = useState<TerminalNotice | null>(null)
  const [renderingDiagnostic, setRenderingDiagnostic] = useState<TerminalFontDiagnostic | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  // keep callbacks in refs so a new identity each render doesn't remount the terminal
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate
  const onQuestionCandidateRef = useRef(onQuestionCandidate)
  onQuestionCandidateRef.current = onQuestionCandidate
  const onRenderingDiagnosticRef = useRef(onRenderingDiagnostic)
  onRenderingDiagnosticRef.current = onRenderingDiagnostic

  useEffect(() => {
    if (!hostRef.current) return
    const host = hostRef.current
    const term = new Terminal({
      convertEol: true,
      fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
      fontSize: 13,
      cursorBlink: true,
    })
    const fit = new FitAddon()
    const unicode11 = new Unicode11Addon()
    const questionBuffer = new TerminalQuestionBuffer()
    activateUnicode11(term, unicode11)
    term.loadAddon(fit)
    term.open(host)
    terminalRef.current = term

    const requestFrame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16)
    const cancelFrame = typeof window.cancelAnimationFrame === 'function'
      ? window.cancelAnimationFrame.bind(window)
      : window.clearTimeout.bind(window)
    const renderCoordinator = new TerminalRenderCoordinator({
      fit: () => fit.fit(),
      dimensions: () => ({ cols: term.cols, rows: term.rows }),
      resize: (cols, rows) => { void api.resizePty({ id: sessionId, cols, rows }) },
      refresh: (start, end) => term.refresh(start, end),
      requestFrame,
      cancelFrame,
    })

    let disposed = false
    const updateFontDiagnostic = () => {
      if (disposed) return
      const diagnostic = inspectTerminalFonts(
        (family, sample) => probeBrowserFont(family, sample, term.options.fontSize ?? 13),
        term.options.fontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY,
      )
      setRenderingDiagnostic(diagnostic)
      onRenderingDiagnosticRef.current?.(diagnostic)
    }
    updateFontDiagnostic()
    renderCoordinator.schedule()

    void api.terminalGetPreferences()
      .then((result) => {
        if (disposed || !result.ok || !result.preferences) return
        term.options.fontFamily = result.preferences.fontFamily || DEFAULT_TERMINAL_FONT_FAMILY
        term.options.fontSize = result.preferences.fontSize
        updateFontDiagnostic()
        renderCoordinator.schedule()
      })
      .catch(() => { /* preferences are optional during an older-main upgrade */ })

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
      term.write(data, () => renderCoordinator.schedule())
      if (ATTENTION_RE.test(data)) onStatusRef.current?.('attention')
      if (SECURE_PROMPT_RE.test(data.trimEnd())) questionBuffer.setSecurePrompt(true)
    })
    const offExit = api.onPtyExit((id, code) => {
      if (id !== sessionId) return
      term.write(`\r\n[process exited: ${code}]\r\n`, () => renderCoordinator.schedule())
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

    const scheduleRender = () => renderCoordinator.schedule()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleRender()
    }
    window.addEventListener('resize', scheduleRender)
    document.addEventListener('visibilitychange', onVisibilityChange)
    host.addEventListener('transitionend', scheduleRender)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleRender)
    ro?.observe(host)
    document.fonts?.addEventListener('loadingdone', scheduleRender)
    void document.fonts?.ready.then(() => {
      if (disposed) return
      updateFontDiagnostic()
      scheduleRender()
    })

    return () => {
      disposed = true
      window.removeEventListener('resize', scheduleRender)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      host.removeEventListener('transitionend', scheduleRender)
      document.fonts?.removeEventListener('loadingdone', scheduleRender)
      ro?.disconnect()
      renderCoordinator.dispose()
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
      <div className="agent-terminal__diagnostic" aria-live="polite">
        {renderingDiagnostic?.warnings.join(' · ') ?? ''}
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
