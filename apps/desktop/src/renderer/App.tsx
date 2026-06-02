import { Fragment, useEffect, useRef, useState } from 'react'
import type { AgentType } from '@apc/shared'
import { useStore, type AgentRunStatus } from './store.js'
import { api } from './api.js'
import { ProjectSidebar } from './components/ProjectSidebar.js'
import { PmHome } from './components/PmHome.js'
import { HarnessPanel } from './components/HarnessPanel.js'
import { AgentTerminal } from './components/AgentTerminal.js'
import './app.css'

const AGENTS: AgentType[] = ['claude', 'codex', 'opencode']

const STATUS_COLOR: Record<AgentRunStatus, string> = {
  idle: '#666',       // not started — grey
  running: '#4ade80', // 동작중 — green
  attention: '#facc15', // 사용자 허가 필요 — yellow
  done: '#f87171',    // 완료 — red
}

export function App() {
  const {
    projects, selectedProjectId, dashboard, profiles, ingesting, lastIngest, error, agentStatus,
    loadProjects, addProject, updateProject, deleteProject, selectProject, loadProfiles, ingest, clearError, setAgentStatus,
  } = useStore()
  const [agent, setAgent] = useState<AgentType>('claude')
  const [sizes, setSizes] = useState<number[]>([1, 1, 1]) // vertical pane flex per agent; drag to resize
  const termRef = useRef<HTMLDivElement | null>(null)

  const startDrag = (i: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const start = [...sizes]
    const h = termRef.current?.clientHeight ?? 1
    const total = start.reduce((x, y) => x + y, 0)
    const onMove = (ev: MouseEvent) => {
      const d = ((ev.clientY - startY) / h) * total
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

  useEffect(() => { loadProjects() }, [loadProjects])

  useEffect(() => {
    if (selectedProjectId) {
      const project = projects.find((p) => p.id === selectedProjectId)
      loadProfiles(project?.repoPaths[0] ?? '')
    }
  }, [selectedProjectId, projects, loadProfiles])

  // Keyboard: Alt+1..9 → select project by index; Ctrl+Shift+1/2/3 → select agent
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && /^[1-3]$/.test(e.key)) {
        e.preventDefault()
        setAgent(AGENTS[Number(e.key) - 1])
        return
      }
      if (e.altKey && !e.ctrlKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1
        if (projects[idx]) { e.preventDefault(); selectProject(projects[idx].id) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [projects, selectProject])

  const project = projects.find((p) => p.id === selectedProjectId)
  const cwd = project?.repoPaths[0] ?? '.'

  const handleSelectProfile = (profileId: string) => {
    const taskId = dashboard?.activeTasks[0]?.id
    if (!taskId) { window.alert('Select/create a task first to attach a profile.'); return }
    void api.selectProfile({ taskId, profileId })
  }

  return (
    <div className="app-layout">
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

      <main className="app-layout__main">
        <header className="app-layout__toolbar">
          <button disabled={ingesting} onClick={() => ingest()}>
            {ingesting ? 'Ingesting...' : 'Ingest now'}
          </button>
          {lastIngest && <span>ingested {lastIngest.sessions} session(s)</span>}
          <span style={{ marginLeft: 'auto', fontSize: '0.72rem', opacity: 0.55 }}>
            Alt+1..9 project · Ctrl+Shift+1/2/3 agent
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

      {/* Agent Work Execution Panel — vertical split; drag dividers to resize, Ctrl+Shift+N to focus */}
      <div ref={termRef} className="app-layout__terminal" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {selectedProjectId ? (
          AGENTS.map((a, i) => (
            <Fragment key={a}>
              {i > 0 && (
                <div
                  onMouseDown={startDrag(i - 1)}
                  title="드래그하여 크기 조정"
                  style={{ height: 6, cursor: 'row-resize', background: '#333', flex: '0 0 auto' }}
                />
              )}
              <div
                style={{
                  flex: sizes[i], display: 'flex', flexDirection: 'column', minHeight: 0,
                  border: a === agent ? '1px solid #4a8a4a' : '1px solid #2c2c2c',
                  borderRadius: 4, overflow: 'hidden',
                }}
              >
                <div
                  onClick={() => setAgent(a)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                    padding: '3px 8px', fontSize: '0.8rem',
                    background: a === agent ? '#23311f' : '#161616', flex: '0 0 auto',
                  }}
                  title={`Ctrl+Shift+${i + 1}`}
                >
                  <span style={{ color: STATUS_COLOR[agentStatus[a]], fontSize: '0.9rem', lineHeight: 1 }}>●</span>
                  <span style={{ fontWeight: a === agent ? 600 : 400 }}>{a}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.65rem', opacity: 0.5 }}>⌃⇧{i + 1}</span>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <AgentTerminal
                    key={`${selectedProjectId}:${a}`}
                    sessionId={`${selectedProjectId}:${a}`}
                    command={a}
                    args={[]}
                    cwd={cwd}
                    onStatus={(s) => setAgentStatus(a, s)}
                  />
                </div>
              </div>
            </Fragment>
          ))
        ) : (
          <div className="app-layout__placeholder">Select a project to open agent terminals</div>
        )}
      </div>

      {error && (
        <div className="error-toast" onClick={clearError}>
          {error} (click to dismiss)
        </div>
      )}
    </div>
  )
}
