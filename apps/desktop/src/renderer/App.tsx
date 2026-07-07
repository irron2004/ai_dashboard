import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import type { AgentType } from '@apc/shared'
import { useStore, type AgentRunStatus } from './store.js'
import { api } from './api.js'
import { ProjectSidebar } from './components/ProjectSidebar.js'
import { MainPanel, type MainTab } from './components/MainPanel.js'
import { AgentTerminal } from './components/AgentTerminal.js'
import { AgentDockHeader } from './components/AgentDockHeader.js'
import { SearchModal } from './components/SearchModal.js'
import { GlobalMenu } from './components/GlobalMenu.js'
import { ResumeBanner } from './components/ResumeBanner.js'
import { QuestionHistory } from './components/QuestionHistory.js'
import { clampDockHeight, DOCK_DEFAULT_H } from './layout-utils.js'
import './app.css'

// Display/shortcut order: claude | opencode | codex
const AGENTS: AgentType[] = ['claude', 'opencode', 'codex']

// Keep this many recently-visited projects' agent terminals mounted (alive) so switching back and forth
// among them never reloads claude/codex/opencode. The oldest beyond this is unmounted (reloads on revisit).
const MAX_KEPT_DOCKS = 8

const STATUS_COLOR: Record<AgentRunStatus, string> = {
  idle: '#666',         // not started — grey
  running: '#4ade80',   // 동작중 — green
  attention: '#facc15', // 사용자 허가 필요 — yellow
  done: '#f87171',      // 완료 — red
}

export function App() {
  const {
    projects, selectedProjectId, dashboard, error, agentStatus, openPanes,
    harnessLoading, workspaceOverview,
    resumeCard, resumeBannerOpen, loadResumeCard, openResumeBanner, dismissResumeBanner, addNextNote,
    loadProjects, addProject, updateProject, deleteProject, selectProject, clearError, setAgentStatus, loadWorkspaceOverview,
  } = useStore()
  const restartAgent = useStore((s) => s.restartAgent)
  const resumeAgentSession = useStore((s) => s.resumeAgentSession)
  const stopAgent = useStore((s) => s.stopAgent)
  const restartNonce = useStore((s) => s.restartNonce)
  const [agent, setAgent] = useState<AgentType>('claude')
  // Projects whose agent terminals are kept mounted (insertion order; capped at MAX_KEPT_DOCKS).
  const [openedIds, setOpenedIds] = useState<string[]>([])
  const [mainTab, setMainTab] = useState<MainTab>(() => {
    try {
      const saved = localStorage.getItem('apc:mainTab')
      if (saved === 'home' || saved === 'knowledge' || saved === 'wikigen' || saved === 'workspace') return saved
    } catch { /* ignore */ }
    return 'home'
  })
  const [searchOpen, setSearchOpen] = useState(false)
  const [historyScope, setHistoryScope] = useState<{ open: boolean; scope: string | null }>({ open: false, scope: null })
  const [sizes, setSizes] = useState<number[]>([1, 1, 1]) // horizontal column flex per agent; drag to resize
  const [sidebarW, setSidebarW] = useState(220)            // projects sidebar width (grid track) when expanded
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('apc:sidebarCollapsed') === '1' } catch { return false }
  })
  const [dockCollapsed, setDockCollapsed] = useState(() => {
    try { return localStorage.getItem('apc:dockCollapsed') === '1' } catch { return false }
  })
  const [dockHeight, setDockHeight] = useState(() => {
    try { const v = Number(localStorage.getItem('apc:dockHeight')); return v > 0 ? v : DOCK_DEFAULT_H } catch { return DOCK_DEFAULT_H }
  })
  const toggleDock = useCallback((next?: boolean) => setDockCollapsed((prev) => {
    const v = next ?? !prev
    try { localStorage.setItem('apc:dockCollapsed', v ? '1' : '0') } catch { /* ignore */ }
    if (!v) setTimeout(() => window.dispatchEvent(new Event('resize')), 50) // Fix 3: only on expand
    return v
  }), [])
  const RAIL_W = 56                                        // collapsed icon-rail width
  const termRef = useRef<HTMLDivElement | null>(null)
  const [upd, setUpd] = useState<{ open: boolean; running: boolean; log: string; ok: boolean }>(
    { open: false, running: false, log: '', ok: false },
  )
  const dragRef = useRef<{ onMove: (e: MouseEvent) => void; onUp: (e: MouseEvent) => void } | null>(null)
  const effectiveSidebarW = sidebarCollapsed ? RAIL_W : sidebarW
  const appLayoutStyle: CSSProperties & Record<'--sidebar-width' | '--dock-height', string> = {
    '--sidebar-width': `${effectiveSidebarW}px`,
    '--dock-height': dockCollapsed ? '30px' : `${dockHeight}px`,
  }
  const toggleSidebar = () => setSidebarCollapsed((prev) => {
    const next = !prev
    try { localStorage.setItem('apc:sidebarCollapsed', next ? '1' : '0') } catch { /* ignore */ }
    return next
  })

  const handleMainTab = (t: MainTab) => {
    setMainTab(t)
    try { localStorage.setItem('apc:mainTab', t) } catch { /* ignore */ }
  }

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

  // Drag the dock's top edge up/down to resize the agent-terminal panel height. Dragging up (clientY
  // decreasing) makes the dock taller. Persist the final height; one window 'resize' on release lets the
  // xterm instances refit their rows (same mechanism toggleDock uses on expand).
  const startDockDrag = (e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()  // never let the grab toggle the dock-bar collapse
    if (dockCollapsed) return
    if (dragRef.current) {
      window.removeEventListener('mousemove', dragRef.current.onMove)
      window.removeEventListener('mouseup', dragRef.current.onUp)
    }
    const startY = e.clientY
    const startH = dockHeight
    const onMove = (ev: MouseEvent) => setDockHeight(clampDockHeight(startH - (ev.clientY - startY), window.innerHeight))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      dragRef.current = null
      setDockHeight((h) => { try { localStorage.setItem('apc:dockHeight', String(h)) } catch { /* ignore */ } return h })
      window.dispatchEvent(new Event('resize'))
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
  useEffect(() => api.onHarnessNodes((e) => useStore.getState().addHarnessLiveNodes(e)), [])

  // Workspace session persistence: hydrate panes from main on boot.
  useEffect(() => {
    const off = api.onWorkspaceRestore((p) => useStore.getState().hydrateWorkspace(p))
    return off
  }, [])

  useEffect(() => { loadProjects() }, [loadProjects])

  // Cross-project overview: fetch when the 전체 tab is opened (MVP — no polling/websocket; manual refresh in WorkspaceHome).
  useEffect(() => {
    if (mainTab === 'workspace') void loadWorkspaceOverview()
  }, [mainTab, loadWorkspaceOverview])

  const projectBadges = useMemo(() => {
    const m: Record<string, { running: number; review: number }> = {}
    for (const p of workspaceOverview?.projects ?? []) {
      m[p.project.id] = { running: p.runningRuns.length, review: p.reviewQueueCount }
    }
    return m
  }, [workspaceOverview])

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
        toggleDock(false)   // 접혀 있으면 펼치면서 해당 에이전트 포커스
        return
      }
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && n >= 1 && n <= 9 && projects[n - 1]) {
        e.preventDefault(); e.stopPropagation()
        selectProject(projects[n - 1].id)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [projects, selectProject, toggleDock])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyK') {
        e.preventDefault(); setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === 'KeyN') {
        e.preventDefault(); if (selectedProjectId) openResumeBanner()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedProjectId, openResumeBanner])

  // The active agent pane grows; the others shrink. Focus/typing in a pane makes it active.
  useEffect(() => {
    setSizes(AGENTS.map((a) => (a === agent ? 2 : 1)))
  }, [agent])

  // Keep the selected project's dock mounted (FIFO-capped). Its terminals were display:none while hidden,
  // so nudge a resize once it becomes visible to re-fit xterm.
  useEffect(() => {
    if (!selectedProjectId) return
    setOpenedIds((prev) => {
      const next = prev.includes(selectedProjectId) ? prev : [...prev, selectedProjectId].slice(-MAX_KEPT_DOCKS)
      // Report panes that are newly added (gained) and those that were evicted (lost).
      const gained = next.filter((id) => !prev.includes(id))
      const lost = prev.filter((id) => !next.includes(id))
      for (const pid of gained) for (const a of AGENTS) api.paneOpened({ projectId: pid, agent: a })
      for (const pid of lost) for (const a of AGENTS) api.paneClosed({ projectId: pid, agent: a })
      return next
    })
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 60)
    return () => clearTimeout(t)
  }, [selectedProjectId])

  // Report selected project to main for workspace persistence.
  useEffect(() => {
    if (selectedProjectId) api.selectProject(selectedProjectId)
  }, [selectedProjectId])

  // Resume banner trigger: fires only when the selected project actually CHANGES (not on every re-render).
  const prevProjectRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedProjectId) return
    if (prevProjectRef.current === selectedProjectId) return
    prevProjectRef.current = selectedProjectId
    void loadResumeCard(selectedProjectId)
  }, [selectedProjectId, loadResumeCard])

  const statusOf = (pid: string | null, a: AgentType): AgentRunStatus => agentStatus[`${pid}:${a}`] ?? 'idle'

  // Stable identity so QuestionHistory's fetch effect (deps include fetchLog) doesn't re-fire on every
  // App re-render while the panel is open.
  const fetchQuestionLog = useCallback((req: { projectId?: string; limit?: number }) => api.questionLog(req), [])

  const runUpdate = async () => {
    setUpd({ open: true, running: true, log: 'Running: git pull --ff-only && pnpm install …', ok: false })
    try {
      const res = await api.appUpdate()
      setUpd({ open: true, running: false, log: res.output || '(no output)', ok: res.ok })
    } catch (e) {
      setUpd({ open: true, running: false, log: String(e), ok: false })
    }
  }

  const toolbarActions = (
    <>
      <button onClick={() => setSearchOpen(true)} title="검색 (Ctrl+K)" aria-label="검색 (Ctrl+K)">🔎</button>
      <GlobalMenu items={[{ label: upd.running ? 'Updating…' : '⭳ Update (git pull + pnpm install)', onClick: runUpdate, disabled: upd.running }]} />
    </>
  )

  return (
    <div className="app-layout" style={appLayoutStyle}>
      {resumeBannerOpen && resumeCard && (
        <ResumeBanner
          card={resumeCard}
          onDismiss={dismissResumeBanner}
          onResume={(t) => {
            dismissResumeBanner()
            toggleDock(false)
            setAgent(t.agent)
            resumeAgentSession(`${selectedProjectId}:${t.agent}`, t.sessionId)
          }}
          onOpenHistory={() => { dismissResumeBanner(); setHistoryScope({ open: true, scope: selectedProjectId }) }}
          onAddNote={(text) => void addNextNote(text)}
        />
      )}
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
          badges={projectBadges}
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
        {dashboard ? (
          <MainPanel
            tab={mainTab}
            onTab={handleMainTab}
            dashboard={dashboard}
            actions={toolbarActions}
            wikiGenRunning={harnessLoading}
            overview={workspaceOverview}
            onRefreshWorkspace={() => void loadWorkspaceOverview()}
            onOpenProject={(pid) => { void selectProject(pid); handleMainTab('home') }}
          />
        ) : (
          <>
            <header className="app-layout__toolbar">{toolbarActions}</header>
            <div className="app-layout__placeholder">
              {selectedProjectId ? 'Loading...' : 'Select a project or add one'}
            </div>
          </>
        )}
      </main>

      {/* Agent Work Execution Panel — horizontal claude | opencode | codex; drag dividers to resize */}
      <div ref={termRef} className="app-layout__terminal" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
        {!dockCollapsed && (
          <div
            className="dock-resize"
            onMouseDown={startDockDrag}
            role="separator"
            aria-orientation="horizontal"
            aria-label="터미널 높이 조절"
            title="드래그해서 터미널 높이 조절"
          />
        )}
        <div
          className="dock-bar"
          onClick={() => toggleDock()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDock() } }}
          role="button"
          tabIndex={0}
          aria-expanded={!dockCollapsed}
          title={dockCollapsed ? '터미널 펼치기' : '터미널 접기'}
        >
          <span className="dock-bar__chev">{dockCollapsed ? '▲' : '▼'} agents</span>
          {AGENTS.map((a, i) => (
            <span
              key={a}
              className="dock-bar__agent"
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); toggleDock(false); setAgent(a) }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleDock(false); setAgent(a) } }}
              title={`Shift+${i + 1}`}
            >
              <span
                className={statusOf(selectedProjectId, a) === 'attention' ? 'dock-bar__dot dock-bar__dot--blink' : 'dock-bar__dot'}
                style={{ color: STATUS_COLOR[statusOf(selectedProjectId, a)] }}
              >●</span>
              {a}
            </span>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: dockCollapsed ? 'none' : 'block', position: 'relative' }}>
          {!selectedProjectId && (
            <div className="app-layout__placeholder">Select a project to open agent terminals</div>
          )}
          {/* One dock per recently-visited project, all kept MOUNTED — only the selected one is shown.
              Each AgentTerminal key is `${pid}:${a}` (stable per project) so switching projects never
              unmounts/remounts it → claude/codex/opencode stay alive (no reload). */}
          {openedIds.map((pid) => {
            const pcwd = projects.find((p) => p.id === pid)?.repoPaths[0] ?? '.'
            return (
              <div
                key={pid}
                style={{ display: pid === selectedProjectId ? 'flex' : 'none', flexDirection: 'row', height: '100%', minHeight: 0 }}
              >
                {AGENTS.map((a, i) => (
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
                      <AgentDockHeader
                        agent={a}
                        status={statusOf(pid, a)}
                        selected={a === agent}
                        shortcut={i + 1}
                        statusColor={STATUS_COLOR[statusOf(pid, a)]}
                        onStart={() => restartAgent(`${pid}:${a}`)}
                        onStop={() => stopAgent(`${pid}:${a}`)}
                        onSelect={() => setAgent(a)}
                      />
                      <div style={{ flex: 1, minHeight: 0 }}>
                        <AgentTerminal
                          key={`${pid}:${a}`}
                          sessionId={`${pid}:${a}`}
                          command={a}
                          args={[]}
                          cwd={pcwd}
                          agent={a}
                          restartNonce={restartNonce[`${pid}:${a}`] ?? 0}
                          resumeSessionId={openPanes[`${pid}:${a}`]?.sessionId}
                          onStatus={(s) => setAgentStatus(`${pid}:${a}`, s)}
                          onActivate={() => setAgent(a)}
                        />
                      </div>
                    </div>
                  </Fragment>
                ))}
              </div>
            )
          })}
        </div>
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

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} onSelectProject={(id) => void selectProject(id)} />

      <QuestionHistory
        open={historyScope.open}
        scope={historyScope.scope}
        fetchLog={fetchQuestionLog}
        onClose={() => setHistoryScope((s) => ({ ...s, open: false }))}
        onPick={(entry) => {
          setHistoryScope((s) => ({ ...s, open: false }))
          void selectProject(entry.projectId)
        }}
      />

      {error && (
        <div className="error-toast" onClick={clearError}>
          {error} (click to dismiss)
        </div>
      )}
    </div>
  )
}
