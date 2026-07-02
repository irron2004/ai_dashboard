import { useEffect, useRef, useState } from 'react'
import type { Task, AgentRun } from '@apc/shared'
import { api } from '../api.js'

type Props = { projectId: string; tasks: Task[]; recentRuns?: AgentRun[] }

// dock pty keys are `${projectId}:${agent}` (App.tsx). Order matches App.tsx AGENTS.
const INJECT_AGENTS = ['claude', 'opencode', 'codex'] as const

/**
 * Drives the multi-agent dev harness (S3) for one task and composes an LLM-handoff prompt (P2).
 * runId is captured from the `devHarness:started` ack (primary) so Cancel works immediately; the
 * first-log-chunk capture is kept only as a defensive fallback. The composed prompt can be injected
 * into a dock agent's terminal (pty write, no trailing newline — the user reviews then hits Enter)
 * or copied.
 */
export function DevHarnessPanel({ projectId, tasks, recentRuns = [] }: Props) {
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
  // transcript modal state
  const [transcriptRunId, setTranscriptRunId] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')

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

  async function openTranscript(id: string) {
    setTranscriptRunId(id); setTranscript('불러오는 중…')
    const res = await api.devHarnessReadTranscript({ runId: id })
    setTranscript(res.ok ? (res.content ?? '') : `읽기 실패: ${res.reason ?? 'unknown'}`)
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

      {(() => {
        const devRuns = recentRuns.filter((r) => r.agent === 'harness')
        return devRuns.length > 0 && (
          <div className="dev-harness__runs">
            <span className="dev-harness__runs-label">dev-run 트랜스크립트:</span>
            {devRuns.map((r) => (
              <button key={r.id} className="dev-harness__run-link" onClick={() => void openTranscript(r.id)}>{r.id}</button>
            ))}
          </div>
        )
      })()}

      {transcriptRunId && (
        <div className="transcript-modal" role="dialog" aria-label="dev-run transcript"
             onClick={() => setTranscriptRunId(null)}>
          <div className="transcript-modal__body" onClick={(e) => e.stopPropagation()}>
            <div className="transcript-modal__head">
              <span>{transcriptRunId}</span>
              <button aria-label="닫기" onClick={() => setTranscriptRunId(null)}>✕</button>
            </div>
            <pre data-testid="transcript-content">{transcript}</pre>
          </div>
        </div>
      )}

      <pre className="dev-harness__log" data-testid="dev-harness-log">{log}</pre>
    </div>
  )
}
