import { Fragment, useEffect, useRef, useState } from 'react'
import type { AgentType } from '@apc/shared'
import { useStore, type AgentRunStatus } from './store.js'
import { api } from './api.js'
import { ProjectSidebar } from './components/ProjectSidebar.js'
import { PmHome } from './components/PmHome.js'
import { HarnessPanel } from './components/HarnessPanel.js'
import { AgentTerminal } from './components/AgentTerminal.js'
import './app.css'

// Display/shortcut order: claude | opencode | codex
const AGENTS: AgentType[] = ['claude', 'opencode', 'codex']

const STATUS_COLOR: Record<AgentRunStatus, string> = {
  idle: '#666',         // not started — grey
  running: '#4ade80',   // 동작중 — green
  attention: '#facc15', // 사용자 허가 필요 — yellow
  done: '#f87171',      // 완료 — red
}

export function App() {
  const {
    projects, selectedProjectId, dashboard, profiles, ingesting, lastIngest, error, agentStatus,
    loadProjects, addProject, updateProject, deleteProject, selectProject, loadProfiles, ingest, clearError, setAgentStatus,
  } = useStore()
  const [agent, setAgent] = useState<AgentType>('claude')
  const [sizes, setSizes] = useState<number[]>([1, 1, 1]) // horizontal column flex per agent; drag to resize
  const [sidebarW, setSidebarW] = useState(220)            // projects sidebar width (grid track)
  const termRef = useRef<HTMLDivElement | null>(null)
  const [upd, setUpd] = useState<{ open: boolean; running: boolean; log: string; ok: boolean }>(
    { open: false, running: false, log: '', ok: false },
  )

  // Drag a divider between terminal column i and i+1 (horizontal resize).
  const startColDrag = (i: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const start = [...sizes]
    const w = termRef.current?.clientWidth ?? 1
    const total = start.reduce((x, y) => x + y, 0)
    const onMove = (ev: MouseEvent) => {
      const d = ((ev.clientX - startX) / w) * total
      const next = [...start]
      next[i] = Math.max(0.15, start[i] + d)
      next[i + 1] = Math.max(0.15, start[i + 1] - d)
      setSizes(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Drag the sidebar/main divider to resize the projects bar.
  const startSidebarDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarW
    const onMove = (ev: MouseEvent) => setSidebarW(Math.min(480, Math.max(150, startW + (ev.clientX - startX))))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  useEffect(() => { loadProjects() }, [loadProjects])

  useEffect(() => {
    if (selectedProjectId) {
      const project = projects.find((p) => p.id === selectedProjectId)
      loadProfiles(project?.repoPaths[0] ?? '')
    }
  }, [selectedProjectId, projects, loadProfiles])

  // Keyboard: Ctrl+1..9 → project by index; Shift+1/2/3 → agent.
  // Use e.code (Digit1..) because Shift turns e.key '1' into '!'. Capture phase + stopPropagation
  // so a focused terminal doesn't also receive the keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.code.startsWith('Digit')) return
      const n = Number(e.code.slice(5))
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && n >= 1 && n <= AGENTS.length) {
        e.preventDefault(); e.stopPropagation()
        setAgent(AGENTS[n - 1])
        return
      }
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && n >= 1 && n <= 9 && projects[n - 1]) {
        e.preventDefault(); e.stopPropagation()
        selectProject(projects[n - 1].id)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [projects, selectProject])

  // The active agent pane grows; the others shrink. Focus/typing in a pane makes it active.
  useEffect(() => {
    setSizes(AGENTS.map((a) => (a === agent ? 2 : 1)))
  }, [agent])

  const project = projects.find((p) => p.id === selectedProjectId)
  const cwd = project?.repoPaths[0] ?? '.'

  const handleSelectProfile = (profileId: string) => {
    const taskId = dashboard?.activeTasks[0]?.id
    if (!taskId) { window.alert('Select/create a task first to attach a profile.'); return }
    void api.selectProfile({ taskId, profileId })
  }

  const runUpdate = async () => {
    setUpd({ open: true, running: true, log: 'Running: git pull --ff-only && pnpm install …', ok: false })
    try {
      const res = await api.appUpdate()
      setUpd({ open: true, running: false, log: res.output || '(no output)', ok: res.ok })
    } catch (e) {
      setUpd({ open: true, running: false, log: String(e), ok: false })
    }
  }

  return (
    <div className="app-layout" style={{ gridTemplateColumns: `${sidebarW}px 1fr 240px` }}>
      {/* Update button — fixed at the top-right of the window */}
      <button
        disabled={upd.running}
        onClick={runUpdate}
        title="git pull + pnpm install"
        style={{ position: 'fixed', top: 6, right: 8, zIndex: 60 }}
      >
        {upd.running ? 'Updating…' : '⭳ Update'}
      </button>

      <aside className="app-layout__sidebar">
        <ProjectSidebar
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelect={selectProject}
          onAdd={addProject}
          onUpdate={updateProject}
          onDelete={deleteProject}
        />
      </aside>

      {/* draggable sidebar/main divider */}
      <div
        onMouseDown={startSidebarDrag}
        title="드래그하여 사이드바 크기 조정"
        style={{ position: 'fixed', top: 0, left: sidebarW - 2, width: 5, height: '100vh', cursor: 'col-resize', zIndex: 50 }}
      />

      <main className="app-layout__main">
        <header className="app-layout__toolbar">
          <button disabled={ingesting} onClick={() => ingest()}>
            {ingesting ? 'Ingesting...' : 'Ingest now'}
          </button>
          {lastIngest && <span>ingested {lastIngest.sessions} session(s)</span>}
          <span style={{ marginLeft: 'auto', fontSize: '0.72rem', opacity: 0.55 }}>
            Ctrl+1..9 project · Shift+1/2/3 agent
          </span>
        </header>
        {dashboard ? (
          <PmHome dashboard={dashboard} />
        ) : (
          <div className="app-layout__placeholder">
            {selectedProjectId ? 'Loading...' : 'Select a project or add one'}
          </div>
        )}
      </main>

      <aside className="app-layout__harness">
        <HarnessPanel profiles={profiles} onSelect={handleSelectProfile} />
      </aside>

      {/* Agent Work Execution Panel — horizontal claude | opencode | codex; drag dividers to resize */}
      <div ref={termRef} className="app-layout__terminal" style={{ display: 'flex', flexDirection: 'row', minHeight: 0 }}>
        {selectedProjectId ? (
          AGENTS.map((a, i) => (
            <Fragment key={a}>
              {i > 0 && (
                <div
                  onMouseDown={startColDrag(i - 1)}
                  title="드래그하여 크기 조정"
                  style={{ width: 6, cursor: 'col-resize', background: '#333', flex: '0 0 auto' }}
                />
              )}
              <div
                style={{
                  flex: sizes[i], display: 'flex', flexDirection: 'column', minWidth: 0,
                  border: a === agent ? '1px solid #4a8a4a' : '1px solid #2c2c2c',
                  borderRadius: 4, overflow: 'hidden',
                }}
              >
                <div
                  onClick={() => setAgent(a)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                    padding: '3px 8px', fontSize: '0.8rem', flex: '0 0 auto',
                    background: a === agent ? '#23311f' : '#161616',
                  }}
                  title={`Shift+${i + 1}`}
                >
                  <span style={{ color: STATUS_COLOR[agentStatus[a]], fontSize: '0.9rem', lineHeight: 1 }}>●</span>
                  <span style={{ fontWeight: a === agent ? 600 : 400 }}>{a}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.65rem', opacity: 0.5 }}>⇧{i + 1}</span>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <AgentTerminal
                    key={`${selectedProjectId}:${a}`}
                    sessionId={`${selectedProjectId}:${a}`}
                    command={a}
                    args={[]}
                    cwd={cwd}
                    onStatus={(s) => setAgentStatus(a, s)}
                    onActivate={() => setAgent(a)}
                  />
                </div>
              </div>
            </Fragment>
          ))
        ) : (
          <div className="app-layout__placeholder">Select a project to open agent terminals</div>
        )}
      </div>

      {upd.open && (
        <div className="add-project-overlay" onClick={() => { if (!upd.running) setUpd((u) => ({ ...u, open: false })) }}>
          <div className="add-project-dialog" onClick={(e) => e.stopPropagation()} style={{ width: 640, maxWidth: '92vw' }}>
            <h2>Update {upd.running ? '…' : upd.ok ? '✓' : '✗'}</h2>
            <pre style={{
              background: '#111', color: upd.ok ? '#cfc' : '#ddd', padding: 10, borderRadius: 6,
              maxHeight: 360, overflow: 'auto', fontSize: '0.78rem', whiteSpace: 'pre-wrap', margin: 0,
            }}>
              {upd.log}
            </pre>
            {!upd.running && upd.ok && (
              <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>완료. 변경된 코드를 적용하려면 재시작하세요.</p>
            )}
            <div className="add-project-dialog__actions">
              <button type="button" disabled={upd.running} onClick={() => setUpd((u) => ({ ...u, open: false }))}>
                Close
              </button>
              <button
                type="button"
                disabled={upd.running || !upd.ok}
                onClick={() => api.appRestart()}
                style={{ background: '#2a4a2a', borderColor: '#4a8a4a' }}
              >
                Restart now
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="error-toast" onClick={clearError}>
          {error} (click to dismiss)
        </div>
      )}
    </div>
  )
}
