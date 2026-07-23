import { useCallback, useEffect, useRef, useState } from 'react'
import type { Task } from '@apc/shared'
import { api } from '../api.js'
import { appendBoundedLog } from '../bounded-log.js'

export type DevHarnessPanelRequest =
  | { requestId: number; projectId: string; action: 'compose' | 'run'; taskId: string }
  | { requestId: number; projectId: string; action: 'open-transcript'; runId: string; title: string }

type Props = { projectId: string; tasks: Task[]; request?: DevHarnessPanelRequest | null }

// dock pty keys are `${projectId}:${agent}` (App.tsx). Order matches App.tsx AGENTS.
const INJECT_AGENTS = ['claude', 'opencode', 'codex'] as const
const LOG_BATCH_MS = 50
const LOG_BATCH_CHARS = 64 * 1024

/**
 * Drives the multi-agent dev harness (S3) for one task and composes an LLM-handoff prompt (P2).
 * runId is captured from the `devHarness:started` ack (primary) so Cancel works immediately; the
 * first-log-chunk capture is kept only as a defensive fallback. The composed prompt can be injected
 * into a dock agent's terminal (pty write, no trailing newline — the user reviews then hits Enter)
 * or copied.
 */
export function DevHarnessPanel({ projectId, tasks, request = null }: Props) {
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? '')
  const [runId, setRunId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const runIdRef = useRef<string | null>(null)
  const pendingLogRef = useRef('')
  const logTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // composer state
  const [prompt, setPrompt] = useState('')
  const [composing, setComposing] = useState(false)
  const [injectAgent, setInjectAgent] = useState<(typeof INJECT_AGENTS)[number]>('claude')
  const [status, setStatus] = useState('')
  // transcript modal state
  const [transcriptRunId, setTranscriptRunId] = useState<string | null>(null)
  const [transcriptTitle, setTranscriptTitle] = useState('')
  const [transcript, setTranscript] = useState('')
  const handledRequestRef = useRef<number | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  const flushLog = useCallback(() => {
    if (logTimerRef.current) clearTimeout(logTimerRef.current)
    logTimerRef.current = null
    const chunk = pendingLogRef.current
    pendingLogRef.current = ''
    if (chunk) setLog((previous) => appendBoundedLog(previous, chunk))
  }, [])

  const queueLog = useCallback((chunk: string) => {
    if (!chunk) return
    pendingLogRef.current += chunk
    if (pendingLogRef.current.length >= LOG_BATCH_CHARS) {
      flushLog()
      return
    }
    if (!logTimerRef.current) logTimerRef.current = setTimeout(flushLog, LOG_BATCH_MS)
  }, [flushLog])

  const resetLog = useCallback(() => {
    if (logTimerRef.current) clearTimeout(logTimerRef.current)
    logTimerRef.current = null
    pendingLogRef.current = ''
    setLog('')
  }, [])

  useEffect(() => () => {
    if (logTimerRef.current) clearTimeout(logTimerRef.current)
    logTimerRef.current = null
    pendingLogRef.current = ''
  }, [])

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
      queueLog(e.chunk)
    })
    return typeof off === 'function' ? off : undefined
  }, [queueLog])

  const start = useCallback(async (requestedTaskId = taskId) => {
    if (!requestedTaskId || running || composing) return
    setTaskId(requestedTaskId)
    runIdRef.current = null
    setRunId(null); resetLog(); setStatus('Harness 실행 중…'); setRunning(true)
    try {
      const res = await api.devHarnessRun({ projectId, taskId: requestedTaskId })
      if (res.runId) { runIdRef.current = res.runId; setRunId(res.runId) }
      queueLog(`\n[${res.ok ? 'done' : 'failed'}${res.exitCode != null ? ` · exit ${res.exitCode}` : ''}${res.reason ? ` · ${res.reason}` : ''}]\n`)
      flushLog()
      setStatus(res.ok ? 'Harness 실행 완료' : `Harness 실행 실패: ${res.reason ?? 'unknown'}`)
    } catch (err) {
      setStatus(`Harness 실행 실패: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunning(false)
    }
  }, [composing, flushLog, projectId, queueLog, resetLog, running, taskId])

  function cancel() {
    if (runIdRef.current) void api.devHarnessCancel({ runId: runIdRef.current })
  }

  const compose = useCallback(async (requestedTaskId = taskId) => {
    if (!requestedTaskId || composing || running) return
    setTaskId(requestedTaskId)
    setComposing(true); setStatus('')
    try {
      const res = await api.composeContext({ projectId, taskId: requestedTaskId })
      if (res.ok && res.prompt) { setPrompt(res.prompt); setStatus('조립 완료 — 검토 후 주입/복사') }
      else setStatus(`조립 실패: ${res.reason ?? 'unknown'}`)
    } catch (err) {
      setStatus(`조립 실패: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setComposing(false)
    }
  }, [composing, projectId, running, taskId])

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

  const openTranscript = useCallback(async (id: string, title: string) => {
    setTranscriptRunId(id); setTranscript('불러오는 중…')
    setTranscriptTitle(title)
    try {
      const res = await api.devHarnessReadTranscript({ runId: id })
      setTranscript(res.ok ? (res.content ?? '') : `읽기 실패: ${res.reason ?? 'unknown'}`)
    } catch (err) {
      setTranscript(`읽기 실패: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  function closeComposer() {
    setPrompt('')
    setStatus('')
  }

  useEffect(() => {
    if (!request || request.projectId !== projectId || handledRequestRef.current === request.requestId) return
    handledRequestRef.current = request.requestId
    if (request.action === 'open-transcript') {
      void openTranscript(request.runId, request.title)
      return
    }
    if (!tasks.some((task) => task.id === request.taskId)) {
      setStatus('요청한 작업을 찾을 수 없습니다')
      return
    }
    if (request.action === 'compose') void compose(request.taskId)
    else void start(request.taskId)
  }, [compose, openTranscript, projectId, request, start, tasks])

  useEffect(() => {
    if (prompt) composerRef.current?.focus()
  }, [prompt])

  return (
    <div className="dev-harness">
      <div className="dev-harness__controls">
        <select className="dev-harness__task" aria-label="실행할 작업" value={taskId}
                onChange={(e) => setTaskId(e.target.value)} disabled={running || composing || tasks.length === 0}>
          {tasks.length === 0
            ? <option value="">(작업 없음)</option>
            : tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        <button className="dev-harness__run" onClick={() => void start()} disabled={running || composing || !taskId}>▶ Harness 실행</button>
        <button className="dev-harness__cancel" onClick={cancel} disabled={!running || !runId}>⏹ 중단</button>
        <button className="dev-harness__compose" onClick={() => void compose()} disabled={composing || running || !taskId}>📋 컨텍스트 조립</button>
      </div>

      {composing && !prompt && (
        <div className="context-composer-modal" role="dialog" aria-modal="true" aria-label="컨텍스트 패키지 조립 중">
          <div className="context-composer-modal__body context-composer-modal__body--loading">
            <div className="context-composer-modal__head">
              <span>컨텍스트 패키지 — {tasks.find((task) => task.id === taskId)?.title ?? '선택한 작업'}</span>
            </div>
            <div className="context-composer-modal__loading" role="status" aria-live="polite">
              <span className="context-composer-modal__spinner" aria-hidden="true" />
              작업에 필요한 컨텍스트를 조립하고 있습니다…
            </div>
          </div>
        </div>
      )}

      {prompt && (
        <div
          className="context-composer-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`컨텍스트 패키지 — ${tasks.find((task) => task.id === taskId)?.title ?? '선택한 작업'}`}
          onClick={closeComposer}
          onKeyDown={(event) => { if (event.key === 'Escape') closeComposer() }}
        >
          <div className="context-composer-modal__body" onClick={(event) => event.stopPropagation()}>
            <div className="context-composer-modal__head">
              <span>컨텍스트 패키지 — {tasks.find((task) => task.id === taskId)?.title ?? '선택한 작업'}</span>
              <button type="button" aria-label="컨텍스트 패키지 닫기" onClick={closeComposer}>✕</button>
            </div>
            <div className="dev-harness__composer">
              <textarea ref={composerRef} data-testid="composer-prompt" className="dev-harness__prompt" value={prompt}
                        aria-label="조립된 컨텍스트 검토"
                        onChange={(e) => setPrompt(e.target.value)} rows={12} />
              <div className="dev-harness__composer-actions">
                <select aria-label="주입 대상 에이전트" value={injectAgent}
                        onChange={(e) => setInjectAgent(e.target.value as (typeof INJECT_AGENTS)[number])}>
                  {INJECT_AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <button className="dev-harness__inject" onClick={inject} disabled={!prompt}>▸ 터미널에 주입</button>
                <button
                  className="dev-harness__composer-run"
                  onClick={() => { closeComposer(); void start(taskId) }}
                  disabled={running || composing || !taskId}
                >▶ Harness로 실행</button>
                <button className="dev-harness__copy" onClick={() => void copy()} disabled={!prompt}>복사</button>
              </div>
              <p className="dev-harness__safety-note">주입 후 해당 터미널에서 Enter로 전송합니다. 자동 전송하지 않습니다.</p>
              {status && <div className="dev-harness__status" role="status">{status}</div>}
            </div>
          </div>
        </div>
      )}
      {!prompt && status && <div className="dev-harness__status" role="status">{status}</div>}

      {transcriptRunId && (
        <div className="transcript-modal" role="dialog" aria-label="dev-run transcript"
             onClick={() => setTranscriptRunId(null)}>
          <div className="transcript-modal__body" onClick={(e) => e.stopPropagation()}>
            <div className="transcript-modal__head">
              <span>{transcriptTitle || '실행 transcript'}</span>
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
