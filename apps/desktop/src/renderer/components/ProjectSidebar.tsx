import { useState } from 'react'
import type { Project } from '@apc/shared'
import { api } from '../api.js'

type Props = {
  projects: Project[]
  selectedProjectId: string | null
  onSelect: (projectId: string) => void
  onAdd: (name: string, projectType: string, repoPath: string) => void
  onUpdate: (id: string, name: string, projectType: string, repoPath: string) => void
  onDelete: (id: string) => void
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
type Menu = { id: string; x: number; y: number }

export function ProjectSidebar({ projects, selectedProjectId, onSelect, onAdd, onUpdate, onDelete }: Props) {
  const groups = groupByStatus(projects)
  const [showDialog, setShowDialog] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
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
    setSshStatus('idle'); setSshError(''); setEditingId(null)
  }

  const openAdd = () => { resetForm(); setShowDialog(true) }

  const openEdit = (p: Project) => {
    resetForm()
    setEditingId(p.id)
    setName(p.name)
    setProjectType(p.projectType)
    const path = p.repoPaths[0] ?? ''
    if (path.startsWith('ssh://')) {
      setPathMode('ssh')
      try {
        const url = new URL(path)
        setSshHost(url.hostname)
        setSshPort(url.port || '22')
        setSshUser(url.username)
        setSshPath(url.pathname)
      } catch {
        // malformed ssh url — fall back to a raw editable path
        setPathMode('local')
        setRepoPath(path)
      }
    } else {
      setPathMode('local')
      setRepoPath(path)
    }
    setShowDialog(true)
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
    if (editingId) onUpdate(editingId, name.trim(), projectType, finalPath)
    else onAdd(name.trim(), projectType, finalPath)
    resetForm()
    setShowDialog(false)
  }

  const handleDelete = (p: Project) => {
    setMenu(null)
    if (window.confirm(`Delete project "${p.name}"? Removes it from the console (vault files are not deleted).`)) {
      onDelete(p.id)
    }
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
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ id: p.id, x: e.clientX, y: e.clientY }) }}
                  title="우클릭: 편집 / 삭제"
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <button type="button" className="project-sidebar__add-btn" onClick={openAdd}>
        + Add Project
      </button>

      {/* Right-click context menu (편집 / 삭제) */}
      {menu && (() => {
        const target = projects.find((p) => p.id === menu.id)
        if (!target) return null
        return (
          <>
            <div
              onClick={() => setMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setMenu(null) }}
              style={{ position: 'fixed', inset: 0, zIndex: 1000 }}
            />
            <div
              role="menu"
              style={{
                position: 'fixed', top: menu.y, left: menu.x, zIndex: 1001,
                background: '#1e1e1e', border: '1px solid #444', borderRadius: 6,
                minWidth: 140, padding: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              }}
            >
              <button type="button" style={menuItemStyle} onClick={() => { setMenu(null); openEdit(target) }}>
                ✎ 연결 편집
              </button>
              <button type="button" style={{ ...menuItemStyle, color: '#e06c6c' }} onClick={() => handleDelete(target)}>
                🗑 삭제
              </button>
            </div>
          </>
        )
      })()}

      {showDialog && (
        <div className="add-project-overlay" onClick={() => { resetForm(); setShowDialog(false) }}>
          <div className="add-project-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? 'Edit Project' : 'New Project'}</h2>

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
              <button type="button" className={pathMode === 'local' ? 'active' : ''} onClick={() => setPathMode('local')}>
                Local
              </button>
              <button type="button" className={pathMode === 'ssh' ? 'active' : ''} onClick={() => setPathMode('ssh')}>
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
              <button type="button" onClick={handleSubmit} style={{ background: '#2a4a2a', borderColor: '#4a8a4a' }}>
                {editingId ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}

const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
  background: 'transparent', border: 'none', color: '#ddd', cursor: 'pointer', fontSize: '0.85rem',
}
