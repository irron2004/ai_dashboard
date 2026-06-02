import { useEffect, useState } from 'react'
import type { AgentType } from '@apc/shared'
import { useStore } from './store.js'
import { api } from './api.js'
import { ProjectSidebar } from './components/ProjectSidebar.js'
import { PmHome } from './components/PmHome.js'
import { HarnessPanel } from './components/HarnessPanel.js'
import { AgentTerminal } from './components/AgentTerminal.js'
import './app.css'

const AGENTS: AgentType[] = ['claude', 'codex', 'opencode']

export function App() {
  const {
    projects, selectedProjectId, dashboard, profiles, ingesting, lastIngest, error,
    loadProjects, addProject, selectProject, loadProfiles, ingest, clearError,
  } = useStore()
  const [agent, setAgent] = useState<AgentType>('claude')

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (selectedProjectId) {
      const project = projects.find((p) => p.id === selectedProjectId)
      loadProfiles(project?.repoPaths[0] ?? '')
    }
  }, [selectedProjectId, projects, loadProfiles])

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
        />
      </aside>

      <main className="app-layout__main">
        <header className="app-layout__toolbar">
          <button disabled={ingesting} onClick={() => ingest()}>
            {ingesting ? 'Ingesting...' : 'Ingest now'}
          </button>
          {lastIngest && <span>ingested {lastIngest.sessions} session(s)</span>}
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

      <div className="app-layout__terminal">
        <nav className="terminal-tabs">
          {AGENTS.map((a) => (
            <button key={a} aria-pressed={a === agent} onClick={() => setAgent(a)}>{a}</button>
          ))}
        </nav>
        {selectedProjectId && (
          <AgentTerminal
            key={`${selectedProjectId}:${agent}`}
            sessionId={`${selectedProjectId}:${agent}`}
            command={agent}
            args={[]}
            cwd={cwd}
          />
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
