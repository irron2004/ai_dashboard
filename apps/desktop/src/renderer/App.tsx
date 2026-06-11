import { Fragment, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import type { AgentType } from '@apc/shared'
import type { GeneratePreflightCategoryId } from '../shared/ipc-contract.js'
import { useStore, type AgentRunStatus } from './store.js'
import { api } from './api.js'
import { ProjectSidebar } from './components/ProjectSidebar.js'
import { MainPanel, type MainTab } from './components/MainPanel.js'
import { AgentTerminal } from './components/AgentTerminal.js'
import { SearchModal } from './components/SearchModal.js'
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
    preflighting, generatePreflight, generating, generation,
    loadProjects, addProject, updateProject, deleteProject, selectProject, loadProfiles, ingest, clearError, setAgentStatus,
    prepareGenerate, generate, clearGeneratePreflight, clearGeneration,
  } = useStore()
  const [agent, setAgent] = useState<AgentType>('claude')
  const [mainTab, setMainTab] = useState<MainTab>('pm')
  const [generateModalOpen, setGenerateModalOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedGenerateEngine, setSelectedGenerateEngine] = useState<AgentType>('claude')
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<GeneratePreflightCategoryId[]>([])
  const [promoteMsg, setPromoteMsg] = useState<string | null>(null)
  const [sizes, setSizes] = useState<number[]>([1, 1, 1]) // horizontal column flex per agent; drag to resize
  const [sidebarW, setSidebarW] = useState(220)            // projects sidebar width (grid track) when expanded
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('apc:sidebarCollapsed') === '1' } catch { return false }
  })
  const RAIL_W = 56                                        // collapsed icon-rail width
  const termRef = useRef<HTMLDivElement | null>(null)
  const [upd, setUpd] = useState<{ open: boolean; running: boolean; log: string; ok: boolean }>(
    { open: false, running: false, log: '', ok: false },
  )
  const dragRef = useRef<{ onMove: (e: MouseEvent) => void; onUp: (e: MouseEvent) => void } | null>(null)
  const effectiveSidebarW = sidebarCollapsed ? RAIL_W : sidebarW
  const appLayoutStyle: CSSProperties & Record<'--sidebar-width', string> = { '--sidebar-width': `${effectiveSidebarW}px` }
  const toggleSidebar = () => setSidebarCollapsed((prev) => {
    const next = !prev
    try { localStorage.setItem('apc:sidebarCollapsed', next ? '1' : '0') } catch { /* ignore */ }
    return next
  })

  useEffect(() => {
    return () => {
      if (dragRef.current) {
        window.removeEventListener('mousemove', dragRef.current.onMove)
        window.removeEventListener('mouseup', dragRef.current.onUp)
      }
    }
  }, [])

  // Drag a divider between terminal column i and i+1 (horizontal resize).
  const startColDrag = (i: number) => (e: ReactMouseEvent) => {
    e.preventDefault()
    if (dragRef.current) {
      window.removeEventListener('mousemove', dragRef.current.onMove)
      window.removeEventListener('mouseup', dragRef.current.onUp)
    }
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
      dragRef.current = null
    }
    dragRef.current = { onMove, onUp }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Drag the sidebar/main divider to resize the projects bar.
  const startSidebarDrag = (e: ReactMouseEvent) => {
    e.preventDefault()
    if (dragRef.current) {
      window.removeEventListener('mousemove', dragRef.current.onMove)
      window.removeEventListener('mouseup', dragRef.current.onUp)
    }
    const startX = e.clientX
    const startW = sidebarW
    const onMove = (ev: MouseEvent) => setSidebarW(Math.min(480, Math.max(150, startW + (ev.clientX - startX))))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      dragRef.current = null
    }
    dragRef.current = { onMove, onUp }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  useEffect(() => api.onHarnessProgress((e) => useStore.getState().setHarnessProgress(e.state)), [])
  useEffect(() => api.onHarnessEngineLog((e) => useStore.getState().appendHarnessEngineLog(e)), [])

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyK') {
        e.preventDefault(); setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The active agent pane grows; the others shrink. Focus/typing in a pane makes it active.
  useEffect(() => {
    setSizes(AGENTS.map((a) => (a === agent ? 2 : 1)))
  }, [agent])

  useEffect(() => {
    if (!generatePreflight?.categories) return
    setSelectedCategoryIds(generatePreflight.categories.filter((category) => category.selectedByDefault).map((category) => category.id))
  }, [generatePreflight])

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

  const handlePromote = async () => {
    if (!selectedProjectId) return
    try {
      const res = (await api.promoteCurrent({ projectId: selectedProjectId, lastReadHash: '' })) as
        { status: string; conflictPath?: string; canonicalPath?: string }
      if (res.status === 'conflict') setPromoteMsg(`충돌: ${res.conflictPath} 생성됨 (current.md 유지).`)
      else setPromoteMsg(`current.md에 반영됨 (${res.canonicalPath}).`)
    } catch (e) {
      setPromoteMsg(`Promote 실패: ${e}`)
    }
  }

  const openGeneratePreflight = () => {
    setGenerateModalOpen(true)
    setPromoteMsg(null)
    clearGeneration()
    void prepareGenerate()
  }

  const closeGenerateModal = () => {
    if (generating) return
    setGenerateModalOpen(false)
    setPromoteMsg(null)
    clearGeneratePreflight()
    clearGeneration()
  }

  const toggleGenerateCategory = (categoryId: GeneratePreflightCategoryId) => {
    const category = generatePreflight?.categories?.find((item) => item.id === categoryId)
    if (category?.required) return
    setSelectedCategoryIds((current) => (
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId]
    ))
  }

  const selectedGenerateCount = generatePreflight?.categories
    ?.filter((category) => selectedCategoryIds.includes(category.id))
    .reduce((sum, category) => sum + category.count, 0) ?? 0
  const requiredGenerateCategoriesSelected = generatePreflight?.categories
    ?.filter((category) => category.required)
    .every((category) => selectedCategoryIds.includes(category.id)) ?? false

  const runGenerateFromPreflight = () => {
    void generate(selectedGenerateEngine, selectedCategoryIds)
  }

  return (
    <div className="app-layout" style={appLayoutStyle}>
      {/* Update button — fixed at the top-right of the window */}
      <button
        disabled={upd.running}
        onClick={runUpdate}
        title="git pull + pnpm install"
        style={{ position: 'fixed', top: 6, right: 8, zIndex: 60 }}
      >
        {upd.running ? 'Updating…' : '⭳ Update'}
      </button>

      <aside className={`app-layout__sidebar${sidebarCollapsed ? ' app-layout__sidebar--rail' : ''}`}>
        <ProjectSidebar
          projects={projects}
          selectedProjectId={selectedProjectId}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          onSelect={selectProject}
          onAdd={addProject}
          onUpdate={updateProject}
          onDelete={deleteProject}
        />
      </aside>

      {/* draggable sidebar/main divider — only when expanded (rail width is fixed) */}
      {!sidebarCollapsed && (
        <div
          onMouseDown={startSidebarDrag}
          title="드래그하여 사이드바 크기 조정"
          style={{ position: 'fixed', top: 0, left: sidebarW - 2, width: 5, height: '100vh', cursor: 'col-resize', zIndex: 50 }}
        />
      )}

      <main className="app-layout__main">
        <header className="app-layout__toolbar">
          <button disabled={ingesting} onClick={() => ingest()}>
            {ingesting ? 'Ingesting...' : 'Ingest now'}
          </button>
          <button disabled={preflighting || generating || !selectedProjectId} onClick={openGeneratePreflight} title="문서/소스 범위 확인 후 current.md 제안 생성">
            {preflighting ? 'Scanning…' : generating ? 'Generating…' : '✨ Generate'}
          </button>
          <button onClick={() => setSearchOpen(true)} title="검색 (Ctrl+K)">🔎 Search</button>
          {lastIngest && <span>ingested {lastIngest.sessions} session(s)</span>}
          <span style={{ marginLeft: 'auto', fontSize: '0.72rem', opacity: 0.55 }}>
            Ctrl+1..9 project · Shift+1/2/3 agent
          </span>
        </header>
        {dashboard ? (
          <MainPanel
            tab={mainTab}
            onTab={setMainTab}
            dashboard={dashboard}
            profiles={profiles}
            onSelectProfile={handleSelectProfile}
          />
        ) : (
          <div className="app-layout__placeholder">
            {selectedProjectId ? 'Loading...' : 'Select a project or add one'}
          </div>
        )}
      </main>

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

      {generateModalOpen && (
        <div className="add-project-overlay" onClick={closeGenerateModal}>
          <div className="add-project-dialog generate-preflight" onClick={(e) => e.stopPropagation()}>
            <div className="generate-preflight__header">
              <div>
                <h2>Generate preflight</h2>
                <p>{generatePreflight?.projectName ? `${generatePreflight.projectName} source scan` : 'Scan project sources before generation.'}</p>
              </div>
              <span className="generate-preflight__badge">
                {generating ? 'Generating' : preflighting ? 'Scanning' : `${selectedGenerateCount} selected`}
              </span>
            </div>

            {preflighting && <div className="generate-preflight__status">Scanning documents, tasks, runs, and local LLM CLI sources…</div>}

            {!preflighting && generatePreflight && !generatePreflight.ok && (
              <div className="generate-preflight__status generate-preflight__status--error">
                {generatePreflight.reason ?? 'Preflight failed.'}
              </div>
            )}

            {!preflighting && generatePreflight?.ok && !generation && (
              <>
                <div className="generate-preflight__summary">
                  <span>Total found: {generatePreflight.totalCount ?? 0}</span>
                  <span>{generatePreflight.status}</span>
                </div>
                <div className="generate-preflight__grid">
                  {generatePreflight.categories?.map((category) => {
                    const checked = selectedCategoryIds.includes(category.id)
                    return (
                      <label key={category.id} className={`generate-preflight__card${checked ? ' selected' : ''}${category.required ? ' required' : ''}`}>
                        <span className="generate-preflight__card-top">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={generating || category.required}
                            onChange={() => toggleGenerateCategory(category.id)}
                          />
                          <span>{category.label}</span>
                          <b>{category.count}</b>
                        </span>
                        <small>{category.description}</small>
                        {category.required && <em>Required for the current session-based generator</em>}
                      </label>
                    )
                  })}
                </div>

                <div className="generate-preflight__confirm">
                  <label>
                    Engine
                    <select value={selectedGenerateEngine} disabled={generating} onChange={(e) => setSelectedGenerateEngine(e.target.value as AgentType)}>
                      {AGENTS.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                  <p>진행하시겠습니까? 정확한 퍼센트 대신 현재 단계와 결과를 표시합니다.</p>
                </div>
              </>
            )}

            {generating && (
              <div className="generate-preflight__status">
                Generating with {selectedGenerateEngine}. The app is summarizing the latest matching LLM CLI session and writing a proposal…
              </div>
            )}

            {generation && (
              generation.ok ? (
              <>
                <h2>Generated ✓</h2>
                <p style={{ fontSize: '0.85rem' }}><b>Summary:</b> {generation.generation?.workSummary}</p>
                {!!generation.generation?.filesTouched.length && (
                  <p style={{ fontSize: '0.8rem' }}><b>Files:</b> {generation.generation.filesTouched.join(', ')}</p>
                )}
                {!!generation.generation?.openProblems.length && (
                  <p style={{ fontSize: '0.8rem' }}><b>Open problems:</b> {generation.generation.openProblems.join('; ')}</p>
                )}
                {!!generation.generation?.nextTasks.length && (
                  <div style={{ fontSize: '0.8rem' }}>
                    <b>Next tasks:</b>
                    <ul style={{ marginLeft: 16 }}>
                      {generation.generation.nextTasks.map((t, i) => <li key={i}>{t.title}</li>)}
                    </ul>
                  </div>
                )}
                <p style={{ fontSize: '0.8rem', marginTop: 6 }}><b>current.md proposal:</b></p>
                <pre style={{ background: '#111', color: '#cfc', padding: 10, borderRadius: 6, maxHeight: 240, overflow: 'auto', fontSize: '0.78rem', whiteSpace: 'pre-wrap', margin: 0 }}>
                  {generation.generation?.currentProposalMarkdown || '(no proposal)'}
                </pre>
                {promoteMsg && <p style={{ fontSize: '0.8rem', color: '#9cf' }}>{promoteMsg}</p>}
                <div className="add-project-dialog__actions">
                  <button type="button" onClick={closeGenerateModal}>Close</button>
                  <button type="button" disabled={!generation.proposalPath} onClick={handlePromote} style={{ background: '#2a4a2a', borderColor: '#4a8a4a' }}>
                    Promote current
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2>Generate ✗</h2>
                <p style={{ fontSize: '0.85rem' }}>{generation.reason ?? 'failed'}</p>
              </>
              )
            )}

            {!generation && (
              <div className="add-project-dialog__actions">
                <button type="button" disabled={generating} onClick={closeGenerateModal}>Cancel</button>
                <button
                  type="button"
                  disabled={preflighting || generating || !generatePreflight?.ok || selectedCategoryIds.length === 0 || !requiredGenerateCategoriesSelected}
                  onClick={runGenerateFromPreflight}
                  style={{ background: '#2a4a2a', borderColor: '#4a8a4a' }}
                >
                  {generating ? 'Generating…' : 'Proceed'}
                </button>
              </div>
            )}

            {generation && !generation.ok && (
              <div className="add-project-dialog__actions">
                <button type="button" onClick={closeGenerateModal}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} onSelectProject={(id) => void selectProject(id)} />

      {error && (
        <div className="error-toast" onClick={clearError}>
          {error} (click to dismiss)
        </div>
      )}
    </div>
  )
}
