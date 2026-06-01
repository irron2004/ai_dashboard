import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api.js'

export type AgentTerminalProps = {
  sessionId: string
  command: string
  args: string[]
  cwd: string
}

/**
 * Agent Work Execution Panel terminal. Spawns a PTY in the main process and
 * mirrors it with xterm. Output streams in via window.apc.onPtyData; keystrokes
 * go out via window.apc.writePty.
 */
export function AgentTerminal({ sessionId, command, args, cwd }: AgentTerminalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const term = new Terminal({ convertEol: true, fontSize: 13, cursorBlink: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    fit.fit()

    const offData = api.onPtyData((id, data) => { if (id === sessionId) term.write(data) })
    const offExit = api.onPtyExit((id, code) => { if (id === sessionId) term.write(`\r\n[process exited: ${code}]\r\n`) })
    const inputSub = term.onData((data) => api.writePty({ id: sessionId, data }))

    api.startPty({ id: sessionId, command, args, cwd })

    const onResize = () => fit.fit()
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      inputSub.dispose()
      offData()
      offExit()
      api.killPty({ id: sessionId })
      term.dispose()
    }
  }, [sessionId, command, args, cwd])

  return <div ref={hostRef} className="agent-terminal" style={{ width: '100%', height: '100%' }} />
}
