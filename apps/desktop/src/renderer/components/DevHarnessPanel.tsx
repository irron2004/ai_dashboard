import { useEffect, useRef, useState } from 'react'
import type { Task } from '@apc/shared'
import { api } from '../api.js'

type Props = { projectId: string; tasks: Task[] }

/**
 * Drives the multi-agent dev harness (S3) for one task: ▶ starts a run via the CLI contract, streams
 * its stdout/stderr into a live log, and ⏹ cancels the in-flight run. The run's id arrives with the
 * first log chunk (the run() promise only resolves at completion), so cancel can target the live run.
 */
export function DevHarnessPanel({ projectId, tasks }: Props) {
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? '')
  const [runId, setRunId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const runIdRef = useRef<string | null>(null)

  useEffect(() => api.onDevHarnessLog((e) => {
    // First chunk after a start carries the runId; capture it so cancel can target the live run.
    if (!runIdRef.current) { runIdRef.current = e.runId; setRunId(e.runId) }
    if (e.runId !== runIdRef.current) return
    setLog((prev) => prev + e.chunk)
  }), [])

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
      </div>
      <pre className="dev-harness__log" data-testid="dev-harness-log">{log}</pre>
    </div>
  )
}
