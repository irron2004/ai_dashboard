import { useState } from 'react'
import type { Project } from '@apc/shared'
import type { ProjectContextConfirmReq, ProjectContextInput, ProjectContextMutRes } from '../../shared/ipc-contract.js'
import { api } from '../api.js'
import { ProjectContextFields, type ProjectContextField } from './ProjectContextFields.js'

type ProjectSaveResult = void | { ok: boolean; reason?: string }

type Props = {
  projects: Project[]
  selectedProjectId: string | null
  collapsed: boolean
  onToggleCollapse: () => void
  onSelect: (projectId: string) => void
  onAdd: (name: string, projectType: string, repoPath: string, domain: string, context?: ProjectContextInput) => ProjectSaveResult | Promise<ProjectSaveResult>
  onUpdate: (id: string, name: string, projectType: string, repoPath: string, domain: string, context?: ProjectContextInput) => ProjectSaveResult | Promise<ProjectSaveResult>
  onConfirmContext?: (req: ProjectContextConfirmReq) => ProjectContextMutRes | Promise<ProjectContextMutRes>
  onDelete: (id: string) => void
  badges?: Record<string, { running: number; review: number }>
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
const STATUS_LABEL: Record<Project['status'], string> = {
  active: '진행 중',
  maintenance: '유지보수',
  paused: '일시정지',
  archived: '보관됨',
}

export function ProjectSidebar({ projects, selectedProjectId, collapsed, onToggleCollapse, onSelect, onAdd, onUpdate, onConfirmContext, onDelete, badges = {} }: Props) {
  const groups = groupByStatus(projects)
  const [showDialog, setShowDialog] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [name, setName] = useState('')
  const [projectType, setProjectType] = useState('git')
  const [pathMode, setPathMode] = useState<PathMode>('local')
  const [domain, setDomain] = useState<'project-docs' | 'paper'>('project-docs')
  const [goal, setGoal] = useState('')
  const [currentFocus, setCurrentFocus] = useState('')
  const [goalSource, setGoalSource] = useState<Project['goalSource']>()
  const [goalConfirmedAt, setGoalConfirmedAt] = useState<string>()
  const [currentFocusSource, setCurrentFocusSource] = useState<Project['currentFocusSource']>()
  const [currentFocusConfirmedAt, setCurrentFocusConfirmedAt] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [confirmingField, setConfirmingField] = useState<ProjectContextField | null>(null)

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
    setSshStatus('idle'); setSshError(''); setEditingId(null); setDomain('project-docs')
    setGoal(''); setCurrentFocus(''); setGoalSource(undefined); setGoalConfirmedAt(undefined)
    setCurrentFocusSource(undefined); setCurrentFocusConfirmedAt(undefined)
    setSaving(false); setSaveError(''); setConfirmingField(null)
  }

  const openAdd = () => { resetForm(); setShowDialog(true) }

  const openEdit = (p: Project) => {
    resetForm()
    setEditingId(p.id)
    setName(p.name)
    setProjectType(p.projectType)
    setDomain((p.domain ?? 'project-docs') as 'project-docs' | 'paper')
    setGoal(p.goal ?? '')
    setCurrentFocus(p.currentFocus ?? '')
    setGoalSource(p.goalSource)
    setGoalConfirmedAt(p.goalConfirmedAt)
    setCurrentFocusSource(p.currentFocusSource)
    setCurrentFocusConfirmedAt(p.currentFocusConfirmedAt)
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

  const handleSubmit = async () => {
    if (!name.trim()) return
    let finalPath = ''
    if (pathMode === 'local') {
      finalPath = repoPath.trim()
    } else {
      if (!sshHost || !sshUser || !sshPath) return
      finalPath = `ssh://${sshUser}@${sshHost}:${sshPort}${sshPath}`
    }
    const context: ProjectContextInput = {
      // Keep empty strings as explicit clear operations. `undefined` is dropped by IPC serialization
      // and would accidentally preserve an old value while editing.
      goal: goal.trim(),
      currentFocus: currentFocus.trim(),
    }
    setSaving(true)
    setSaveError('')
    try {
      const result = editingId
        ? await onUpdate(editingId, name.trim(), projectType, finalPath, domain, context)
        : await onAdd(name.trim(), projectType, finalPath, domain, context)
      if (result && !result.ok) throw new Error(result.reason ?? '프로젝트를 저장하지 못했습니다')
      resetForm()
      setShowDialog(false)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      setSaving(false)
    }
  }

  const handleConfirmContext = async (field: ProjectContextField) => {
    if (!editingId || !onConfirmContext) return
    setConfirmingField(field)
    setSaveError('')
    try {
      const result = await onConfirmContext({ projectId: editingId, field })
      if (!result.ok || !result.project) throw new Error(result.reason ?? '제안을 확정하지 못했습니다')
      setGoal(result.project.goal ?? '')
      setCurrentFocus(result.project.currentFocus ?? '')
      setGoalSource(result.project.goalSource)
      setGoalConfirmedAt(result.project.goalConfirmedAt)
      setCurrentFocusSource(result.project.currentFocusSource)
      setCurrentFocusConfirmedAt(result.project.currentFocusConfirmedAt)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setConfirmingField(null)
    }
  }

  const handleDelete = (p: Project) => {
    setMenu(null)
    if (window.confirm(`Delete project "${p.name}"? Removes it from the console (vault files are not deleted).`)) {
      onDelete(p.id)
    }
  }

  // Why Save is blocked, mirroring handleSubmit's gates — so the button shows DISABLED with a reason
  // instead of silently no-op'ing (the "확인이 안 눌려요" bug: an empty required field, e.g. an ssh url
  // with no `user@`, made the submit return without any feedback).
  const submitReason = !name.trim()
    ? '이름을 입력하세요'
    : (pathMode === 'ssh' && (!sshHost || !sshUser || !sshPath)) ? 'SSH 호스트·사용자·경로를 모두 입력하세요'
    : ''

  return (
    <>
      {collapsed ? (
        <nav className="project-sidebar project-sidebar--rail">
          <button
            type="button"
            className="project-sidebar__rail-toggle"
            onClick={onToggleCollapse}
            title="사이드바 펼치기"
            aria-label="사이드바 펼치기"
          >
            ▸
          </button>
          <div className="project-sidebar__rail-list">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`project-sidebar__rail-dot${p.id === selectedProjectId ? ' project-sidebar__rail-dot--selected' : ''}`}
                onClick={() => onSelect(p.id)}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ id: p.id, x: e.clientX, y: e.clientY }) }}
                title={`${p.name} · ${p.status}`}
                aria-label={p.name}
              >
                {p.name.trim().charAt(0).toUpperCase() || '·'}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="project-sidebar__rail-add"
            onClick={openAdd}
            title="새 프로젝트"
            aria-label="새 프로젝트"
          >
            +
          </button>
        </nav>
      ) : (
        <nav className="project-sidebar">
          <div className="project-sidebar__header">
            <h2>프로젝트</h2>
            <button
              type="button"
              className="project-sidebar__collapse-btn"
              onClick={onToggleCollapse}
              title="사이드바 접기"
              aria-label="사이드바 접기"
            >
              ◂
            </button>
          </div>
          {projects.length === 0 && (
            <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: 8 }}>아직 프로젝트가 없습니다</p>
          )}
          {Object.entries(groups).map(([status, projs]) => (
            <section key={status} className="project-sidebar__group">
              <h3 className="project-sidebar__group-title">{STATUS_LABEL[status as Project['status']] ?? status}</h3>
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
                      {(badges[p.id]?.running ?? 0) > 0 && (
                        <span className="project-sidebar__badge project-sidebar__badge--running" title="실행중">{badges[p.id].running}</span>
                      )}
                      {(badges[p.id]?.review ?? 0) > 0 && (
                        <span className="project-sidebar__badge project-sidebar__badge--review" title="리뷰 대기">{badges[p.id].review}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <button type="button" className="project-sidebar__add-btn" onClick={openAdd}>
            + 프로젝트 추가
          </button>
        </nav>
      )}

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
                ✎ 프로젝트 편집
              </button>
              <button type="button" style={{ ...menuItemStyle, color: '#e06c6c' }} onClick={() => handleDelete(target)}>
                🗑 삭제
              </button>
            </div>
          </>
        )
      })()}

      {showDialog && (
        <div className="add-project-overlay" onClick={() => { if (!saving) { resetForm(); setShowDialog(false) } }}>
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

            <label htmlFor="domain-select">Domain</label>
            <select id="domain-select" aria-label="Domain" value={domain} onChange={(e) => setDomain(e.target.value as 'project-docs' | 'paper')}>
              <option value="project-docs">Project docs</option>
              <option value="paper">Paper (autosci)</option>
            </select>

            <ProjectContextFields
              goal={goal}
              currentFocus={currentFocus}
              goalSource={goalSource}
              goalConfirmedAt={goalConfirmedAt}
              currentFocusSource={currentFocusSource}
              currentFocusConfirmedAt={currentFocusConfirmedAt}
              disabled={saving}
              confirmingField={confirmingField}
              onGoalChange={(value) => {
                setGoal(value); setGoalSource(value.trim() ? 'user' : undefined); setGoalConfirmedAt(undefined)
              }}
              onCurrentFocusChange={(value) => {
                setCurrentFocus(value); setCurrentFocusSource(value.trim() ? 'user' : undefined); setCurrentFocusConfirmedAt(undefined)
              }}
              onConfirm={onConfirmContext ? handleConfirmContext : undefined}
            />

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

            {submitReason && (
              <p style={{ color: '#d9a', fontSize: '0.8rem', margin: '4px 0 0' }}>{submitReason}</p>
            )}
            {saveError && <p role="alert" className="add-project-dialog__error">{saveError}</p>}
            <div className="add-project-dialog__actions">
              <button type="button" disabled={saving} onClick={() => { resetForm(); setShowDialog(false) }}>Cancel</button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!!submitReason || saving}
                style={{ background: '#2a4a2a', borderColor: '#4a8a4a', opacity: submitReason ? 0.5 : 1 }}
              >
                {saving ? 'Saving…' : editingId ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
  background: 'transparent', border: 'none', color: '#ddd', cursor: 'pointer', fontSize: '0.85rem',
}
