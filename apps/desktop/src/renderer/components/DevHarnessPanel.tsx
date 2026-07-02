import { useEffect, useRef, useState } from 'react'
import type { Task } from '@apc/shared'
import { api } from '../api.js'

type Props = { projectId: string; tasks: Task[] }

// dock pty keys are `${projectId}:${agent}` (App.tsx). Order matches App.tsx AGENTS.
const INJECT_AGENTS = ['claude', 'opencode', 'codex'] as const

/**
 * Drives the multi-agent dev harness (S3) for one task and composes an LLM-handoff prompt (P2).
 * runId is captured from the `devHarness:started` ack (primary) so Cancel works immediately; the
 * first-log-chunk capture is kept only as a defensive fallback. The composed prompt can be injected
 * into a dock agent's terminal (pty write, no trailing newline — the user reviews then hits Enter)
 * or copied.
 */
export function DevHarnessPanel({ projectId, tasks }: Props) {
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? '')
  const [runId, setRunId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const runIdRef = useRef<string | null>(null)
  // composer state
  const [prompt, setPrompt] = useState('')
  const [composing, setComposing] = useState(false)
  const [injectAgent, setInjectAgent] = useState<(typeof INJECT_AGENTS)[number]>('claude')
  const [status, setStatus] = useState('')

  useEffect(() => {
    // Primary runId source: the started ack (fires before any log chunk).
    const off = api.onDevHarnessStarted((e) => {
      if (e.projectId !== projectId) return
      runIdRef.current = e.runId
      setRunId(e.runId)
    })
    return typeof off === 'function' ? off : undefined
  }, [projectId])

  useEffect(() => {
    const off = api.onDevHarnessLog((e) => {
      // Fallback capture if the started ack has not arrived yet; then filter to the live run.
      if (!runIdRef.current) { runIdRef.current = e.runId; setRunId(e.runId) }
      if (e.runId !== runIdRef.current) return
      setLog((prev) => prev + e.chunk)
    })
    return typeof off === 'function' ? off : undefined
  }, [])

  async function start() {
    if (!taskId || running) return
    runIdRef.current = null
    setRunId(null); setLog(''); setRunning(true)
    try {
      const res = await api.devHarnessRun({ projectId, taskId })
      if (res.runId) { runIdRef.current = res.runId; setRunId(res.runId) }
      setLog((prev) => prev + `\n[${res.ok ? 'done' : 'failed'}${res.exitCode != null ? ` · exit ${res.exitCode}` : ''}${res.reason ? ` · ${res.reason}` : ''}]\n`)
    } finally {
      setRunning(false)
    }
  }

  function cancel() {
    if (runIdRef.current) void api.devHarnessCancel({ runId: runIdRef.current })
  }

  async function compose() {
    if (!taskId || composing) return
    setComposing(true); setStatus('')
    try {
      const res = await api.composeContext({ projectId, taskId })
      if (res.ok && res.prompt) { setPrompt(res.prompt); setStatus('조립 완료 — 검토 후 주입/복사') }
      else setStatus(`조립 실패: ${res.reason ?? 'unknown'}`)
    } finally {
      setComposing(false)
    }
  }

  function inject() {
    if (!prompt) return
    // No trailing newline: the user reviews in the terminal, then presses Enter (safer than auto-send).
    api.writePty({ id: `${projectId}:${injectAgent}`, data: prompt })
    setStatus(`${injectAgent} 터미널에 주입됨 — 해당 탭에서 Enter를 누르세요 (탭이 열려 있어야 함)`)
  }

  async function copy() {
    try { await navigator.clipboard.writeText(prompt); setStatus('클립보드에 복사됨') }
    catch { setStatus('복사 실패 (클립보드 차단)') }
  }

  return (
    <div className="dev-harness">
      <div className="dev-harness__controls">
        <select className="dev-harness__task" aria-label="harness task" value={taskId}
                onChange={(e) => setTaskId(e.target.value)} disabled={running || tasks.length === 0}>
          {tasks.length === 0
            ? <option value="">(no tasks)</option>
            : tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        <button className="dev-harness__run" onClick={() => void start()} disabled={running || !taskId}>▶ Run harness</button>
        <button className="dev-harness__cancel" onClick={cancel} disabled={!running || !runId}>⏹ Cancel</button>
        <button className="dev-harness__compose" onClick={() => void compose()} disabled={composing || !taskId}>📋 컨텍스트 조립</button>
      </div>

      {prompt && (
        <div className="dev-harness__composer">
          <textarea data-testid="composer-prompt" className="dev-harness__prompt" value={prompt}
                    onChange={(e) => setPrompt(e.target.value)} rows={12} />
          <div className="dev-harness__composer-actions">
            <select aria-label="주입 대상 에이전트" value={injectAgent}
                    onChange={(e) => setInjectAgent(e.target.value as (typeof INJECT_AGENTS)[number])}>
              {INJECT_AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <button className="dev-harness__inject" onClick={inject}>▸ 터미널에 주입</button>
            <button className="dev-harness__copy" onClick={() => void copy()}>복사</button>
          </div>
        </div>
      )}
      {status && <div className="dev-harness__status" role="status">{status}</div>}

      <pre className="dev-harness__log" data-testid="dev-harness-log">{log}</pre>
    </div>
  )
}
