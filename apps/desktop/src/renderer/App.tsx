import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import type { AgentType } from '@apc/shared'
import { useStore } from './store.js'
import { api } from './api.js'
import { ProjectSidebar } from './components/ProjectSidebar.js'
import { MainPanel, type MainTab, type ProjectLoadState } from './components/MainPanel.js'
import {
  AgentWorkspaceDock,
  STATUS_COLOR as AGENT_STATUS_COLOR,
  type AgentResumeRequest,
} from './components/AgentWorkspaceDock.js'
import { SearchModal } from './components/SearchModal.js'
import { DiffPanel } from './components/DiffPanel.js'
import { GlobalMenu } from './components/GlobalMenu.js'
import { ResumeBanner } from './components/ResumeBanner.js'
import type { HistoryFocus } from './components/ConversationHistoryView.js'
import { clampDockHeight, DOCK_DEFAULT_H } from './layout-utils.js'
import type { ConversationHistoryReq } from '../shared/ipc-contract.js'
import './app.css'

// Keep this many recently-visited projects' agent terminals mounted (alive) so switching back and forth
// among them never reloads claude/codex/opencode. The oldest beyond this is unmounted (reloads on revisit).
const MAX_KEPT_DOCKS = 8

export const STATUS_COLOR = AGENT_STATUS_COLOR

export function App() {
  const {
    projects, selectedProjectId, dashboard, error,
    harnessLoading, workspaceOverview,
    resumeCard, resumeBannerOpen, loadResumeCard, openResumeBanner, dismissResumeBanner, addNextNote,
    loadProjects, addProject, updateProject, deleteProject, selectProject, clearError, loadWorkspaceOverview,
  } = useStore()
  const [agent, setAgent] = useState<AgentType>('claude')
  const [agentResumeRequest, setAgentResumeRequest] = useState<AgentResumeRequest | null>(null)
  // Projects whose agent terminals are kept mounted (insertion order; capped at MAX_KEPT_DOCKS).
  const [openedIds, setOpenedIds] = useState<string[]>([])
  const [mainTab, setMainTab] = useState<MainTab>(() => {
    try {
      const saved = localStorage.getItem('apc:mainTab')
      if (saved === 'workspace' || saved === 'home' || saved === 'documents' || saved === 'knowledge' || saved === 'wikigen' || saved === 'history' || saved === 'retro') return saved
    } catch { /* ignore */ }
    return 'workspace'
  })
  const [searchOpen, setSearchOpen] = useState(false)
  const [diffOpen, setDiffOpen] = useState(false)
  const [historyFocus, setHistoryFocus] = useState<HistoryFocus | null>(null)
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
  const [upd, setUpd] = useState<{ open: boolean; running: boolean; log: string; ok: boolean }>(
    { open: false, running: false, log: '', ok: false },
  )
  const dragRef = useRef<{ onMove: (e: MouseEvent) => void; onUp: (e: MouseEvent) => void } | null>(null)
  const effectiveSidebarW = sidebarCollapsed ? RAIL_W : sidebarW
  const appLayoutStyle: CSSProperties & Record<'--sidebar-width' | '--dock-height', string> = {
    '--sidebar-width': `${effectiveSidebarW}px`,
    '--dock-height': dockCollapsed ? '48px' : `${dockHeight}px`,
  }
  const toggleSidebar = () => setSidebarCollapsed((prev) => {
    const next = !prev
    try { localStorage.setItem('apc:sidebarCollapsed', next ? '1' : '0') } catch { /* ignore */ }
    return next
  })

  const handleMainTab = useCallback((t: MainTab) => {
    setMainTab(t)
    try { localStorage.setItem('apc:mainTab', t) } catch { /* ignore */ }
  }, [])

  // Selecting a project from the global overview enters its PM home. When the user is already
  // comparing the same project-specific surface (documents/knowledge/wiki), preserve that context.
  const openProject = useCallback((projectId: string, forceHome = false) => {
    void selectProject(projectId)
    if (forceHome || mainTab === 'workspace') handleMainTab('home')
  }, [handleMainTab, mainTab, selectProject])

  useEffect(() => {
    return () => {
      if (dragRef.current) {
        window.removeEventListener('mousemove', dragRef.current.onMove)
        window.removeEventListener('mouseup', dragRef.current.onUp)
      }
    }
  }, [])

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
    const off = api.onWorkspaceRestore((p) => {
      const state = useStore.getState()
      state.hydrateWorkspace(p)
      // Hydration restores the selected id and panes only. Load its dashboard explicitly, but do not
      // treat session restoration as an intentional navigation away from the global overview.
      if (p.selectedProjectId) void state.selectProject(p.selectedProjectId)
    })
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

  // Keyboard: Ctrl+1..9 → project by index. Dynamic agent shortcuts live in AgentWorkspaceDock.
  // Use e.code (Digit1..) because Shift turns e.key '1' into '!'. Capture phase + stopPropagation
  // so a focused terminal doesn't also receive the keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.code.startsWith('Digit')) return
      const n = Number(e.code.slice(5))
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && n >= 1 && n <= 9 && projects[n - 1]) {
        e.preventDefault(); e.stopPropagation()
        openProject(projects[n - 1].id)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [openProject, projects, toggleDock])

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === 'KeyD') {
        e.preventDefault()
        setDiffOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Keep the selected project's dock mounted (FIFO-capped). Its terminals were display:none while hidden,
  // so nudge a resize once it becomes visible to re-fit xterm.
  useEffect(() => {
    if (!selectedProjectId) return
    setOpenedIds((prev) => {
      const next = prev.includes(selectedProjectId) ? prev : [...prev, selectedProjectId].slice(-MAX_KEPT_DOCKS)
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

  // Stable identity so ConversationHistoryView's fetch effect doesn't re-fire on every App render.
  const fetchConversationHistory = useCallback((req: ConversationHistoryReq) => api.conversationHistory(req), [])

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
      <button onClick={() => setDiffOpen((value) => !value)} title="변경사항 (Ctrl+Shift+D)" aria-label="변경사항 (Ctrl+Shift+D)">±</button>
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
            if (selectedProjectId) {
              setAgentResumeRequest({ projectId: selectedProjectId, agent: t.agent, sessionId: t.sessionId, nonce: Date.now() })
            }
          }}
          onOpenHistory={() => {
            dismissResumeBanner()
            setHistoryFocus({ agent: resumeCard.lastQuestion?.agent ?? resumeCard.resumeTarget?.agent ?? agent })
            handleMainTab('history')
          }}
          onAddNote={(text) => void addNextNote(text)}
        />
      )}
      <aside className={`app-layout__sidebar${sidebarCollapsed ? ' app-layout__sidebar--rail' : ''}`}>
        <ProjectSidebar
          projects={projects}
          selectedProjectId={selectedProjectId}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          onSelect={openProject}
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
        <MainPanel
          tab={mainTab}
          onTab={handleMainTab}
          dashboard={dashboard}
          projectLoadState={(dashboard ? 'ready' : selectedProjectId ? 'loading' : 'unselected') satisfies ProjectLoadState}
          actions={toolbarActions}
          wikiGenRunning={harnessLoading}
          overview={workspaceOverview}
          onRefreshWorkspace={() => void loadWorkspaceOverview()}
          onOpenProject={(pid) => openProject(pid, true)}
          historyFocus={historyFocus}
          onHistoryFocusConsumed={() => setHistoryFocus(null)}
          fetchConversationHistory={fetchConversationHistory}
        />
      </main>

      {/* Agent workspaces — one tab per Git worktree, with user-configurable agent panes. */}
      <div className="app-layout__terminal" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative' }}>
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
        <AgentWorkspaceDock
          projects={projects}
          selectedProjectId={selectedProjectId}
          openedProjectIds={openedIds}
          collapsed={dockCollapsed}
          onToggleCollapsed={toggleDock}
          onActiveAgentChange={setAgent}
          resumeRequest={agentResumeRequest}
          onResumeHandled={() => setAgentResumeRequest(null)}
        />
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

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} onSelectProject={openProject} />
      <DiffPanel open={diffOpen} projectId={selectedProjectId} onClose={() => setDiffOpen(false)} />

      {error && (
        <div className="error-toast" onClick={clearError}>
          {error} (click to dismiss)
        </div>
      )}
    </div>
  )
}
