import { useState } from 'react'
import type { Project } from '@apc/shared'
import { api } from '../api.js'

type Props = {
  projects: Project[]
  selectedProjectId: string | null
  onSelect: (projectId: string) => void
  onAdd: (name: string, projectType: string, repoPath: string) => void
}

function groupByStatus(projects: Project[]): Record<string, Project[]> {
  const groups: Record<string, Project[]> = {}
  for (const p of projects) {
    if (!groups[p.status]) groups[p.status] = []
    groups[p.status].push(p)
  }
  return groups
}

type PathMode = 'local' | 'ssh'

export function ProjectSidebar({ projects, selectedProjectId, onSelect, onAdd }: Props) {
  const groups = groupByStatus(projects)
  const [showDialog, setShowDialog] = useState(false)
  const [name, setName] = useState('')
  const [projectType, setProjectType] = useState('git')
  const [pathMode, setPathMode] = useState<PathMode>('local')

  // local
  const [repoPath, setRepoPath] = useState('')

  // ssh
  const [sshHost, setSshHost] = useState('')
  const [sshPort, setSshPort] = useState('22')
  const [sshUser, setSshUser] = useState('')
  const [sshPath, setSshPath] = useState('')
  const [sshStatus, setSshStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [sshError, setSshError] = useState('')

  const resetForm = () => {
    setName(''); setRepoPath(''); setProjectType('git'); setPathMode('local')
    setSshHost(''); setSshPort('22'); setSshUser(''); setSshPath('')
    setSshStatus('idle'); setSshError('')
  }

  const handleBrowse = async () => {
    const selected = await api.selectFolder()
    if (selected) setRepoPath(selected)
  }

  const handleTestSsh = async () => {
    setSshStatus('testing'); setSshError('')
    try {
      const res = await api.testSsh({
        host: sshHost, port: Number(sshPort) || 22, username: sshUser, remotePath: sshPath,
      })
      if (res.ok) { setSshStatus('ok') }
      else { setSshStatus('fail'); setSshError(res.error ?? 'Connection failed') }
    } catch (e) {
      setSshStatus('fail'); setSshError(String(e))
    }
  }

  const handleSubmit = () => {
    if (!name.trim()) return
    let finalPath = ''
    if (pathMode === 'local') {
      finalPath = repoPath.trim()
    } else {
      if (!sshHost || !sshUser || !sshPath) return
      finalPath = `ssh://${sshUser}@${sshHost}:${sshPort}${sshPath}`
    }
    onAdd(name.trim(), projectType, finalPath)
    resetForm()
    setShowDialog(false)
  }

  return (
    <nav className="project-sidebar">
      <h2>Projects</h2>
      {projects.length === 0 && (
        <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: 8 }}>No projects yet</p>
      )}
      {Object.entries(groups).map(([status, projs]) => (
        <section key={status} className="project-sidebar__group">
          <h3 className="project-sidebar__group-title">{status}</h3>
          <ul className="project-sidebar__list">
            {projs.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`project-sidebar__item${p.id === selectedProjectId ? ' project-sidebar__item--selected' : ''}`}
                  onClick={() => onSelect(p.id)}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <button type="button" className="project-sidebar__add-btn" onClick={() => setShowDialog(true)}>
        + Add Project
      </button>

      {showDialog && (
        <div className="add-project-overlay" onClick={() => { resetForm(); setShowDialog(false) }}>
          <div className="add-project-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>New Project</h2>

            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Project" autoFocus />
            </label>

            <label>
              Type
              <select value={projectType} onChange={(e) => setProjectType(e.target.value)}>
                <option value="git">Git</option>
                <option value="obsidian">Obsidian</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </label>

            {/* Path mode toggle */}
            <div className="add-project-dialog__tabs">
              <button
                type="button"
                className={pathMode === 'local' ? 'active' : ''}
                onClick={() => setPathMode('local')}
              >
                Local
              </button>
              <button
                type="button"
                className={pathMode === 'ssh' ? 'active' : ''}
                onClick={() => setPathMode('ssh')}
              >
                SSH Remote
              </button>
            </div>

            {pathMode === 'local' ? (
              <label>
                Repository path
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={repoPath}
                    onChange={(e) => setRepoPath(e.target.value)}
                    placeholder="C:\Users\you\projects\my-repo"
                    style={{ flex: 1 }}
                  />
                  <button type="button" onClick={handleBrowse} style={{ whiteSpace: 'nowrap' }}>
                    Browse...
                  </button>
                </div>
              </label>
            ) : (
              <div className="add-project-dialog__ssh">
                <div style={{ display: 'flex', gap: 6 }}>
                  <label style={{ flex: 2 }}>
                    Host
                    <input value={sshHost} onChange={(e) => setSshHost(e.target.value)} placeholder="192.168.1.100" />
                  </label>
                  <label style={{ flex: 1 }}>
                    Port
                    <input value={sshPort} onChange={(e) => setSshPort(e.target.value)} placeholder="22" />
                  </label>
                </div>
                <label>
                  Username
                  <input value={sshUser} onChange={(e) => setSshUser(e.target.value)} placeholder="user" />
                </label>
                <label>
                  Remote path
                  <input value={sshPath} onChange={(e) => setSshPath(e.target.value)} placeholder="/home/user/project" />
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button type="button" onClick={handleTestSsh} disabled={!sshHost || !sshUser || !sshPath || sshStatus === 'testing'}>
                    {sshStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                  </button>
                  {sshStatus === 'ok' && <span style={{ color: '#6c6' }}>Connected</span>}
                  {sshStatus === 'fail' && <span style={{ color: '#c66', fontSize: '0.85rem' }}>{sshError}</span>}
                </div>
              </div>
            )}

            <div className="add-project-dialog__actions">
              <button type="button" onClick={() => { resetForm(); setShowDialog(false) }}>Cancel</button>
              <button type="button" onClick={handleSubmit} style={{ background: '#2a4a2a', borderColor: '#4a8a4a' }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
