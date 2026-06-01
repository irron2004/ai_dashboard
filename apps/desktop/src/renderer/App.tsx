import { useEffect } from 'react'
import { useStore } from './store.js'
import { ProjectSidebar } from './components/ProjectSidebar.js'
import { PmHome } from './components/PmHome.js'
import { HarnessPanel } from './components/HarnessPanel.js'

export function App() {
  const { projects, selectedProjectId, dashboard, profiles, loadProjects, selectProject, loadProfiles } = useStore()

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (selectedProjectId) {
      // Load profiles for the selected project's first repo path
      const project = projects.find((p) => p.id === selectedProjectId)
      const projectPath = project?.repoPaths[0] ?? ''
      loadProfiles(projectPath)
    }
  }, [selectedProjectId, projects, loadProfiles])

  const handleSelectProfile = (profileId: string) => {
    // selectProfile is wired via IPC; for now just log
    console.log('Selected profile:', profileId)
  }

  return (
    <div className="app-layout">
      <aside className="app-layout__sidebar">
        <ProjectSidebar
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelect={selectProject}
        />
      </aside>

      <main className="app-layout__main">
        {dashboard ? (
          <PmHome dashboard={dashboard} />
        ) : (
          <div className="app-layout__placeholder">
            {selectedProjectId ? 'Loading...' : 'Select a project'}
          </div>
        )}
      </main>

      <aside className="app-layout__harness">
        <HarnessPanel profiles={profiles} onSelect={handleSelectProfile} />
      </aside>

      <div className="app-layout__terminal">
        {/* Terminal (Part D) — AgentTerminal goes here */}
      </div>
    </div>
  )
}
