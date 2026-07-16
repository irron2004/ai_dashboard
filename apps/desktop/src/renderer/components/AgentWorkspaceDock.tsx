import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import type { AgentType, Project } from '@apc/shared'
import type { GitWorktreeDto } from '../../shared/ipc-contract.js'
import { api } from '../api.js'
import { useStore, type AgentRunStatus } from '../store.js'
import { AgentDockHeader } from './AgentDockHeader.js'
import { AgentTerminal } from './AgentTerminal.js'

/** Available CLI kinds are a picker catalog, not the set of panes rendered on screen. */
export const AGENT_CATALOG: AgentType[] = ['claude', 'opencode', 'codex']

export const STATUS_COLOR: Record<AgentRunStatus, string> = {
  idle: '#666',
  running: '#4ade80',
  attention: '#facc15',
  done: '#378add',
}

const AGENT_LABEL: Record<AgentType, string> = {
  claude: 'Claude',
  opencode: 'OpenCode',
  codex: 'Codex',
}

const AGENT_DESCRIPTION: Record<AgentType, string> = {
  claude: 'Claude CLI 터미널',
  opencode: 'OpenCode CLI 터미널',
  codex: 'Codex CLI 터미널',
}

export type AgentSlot = { id: string; agent: AgentType }
export type AgentResumeRequest = { projectId: string; agent: AgentType; sessionId: string; nonce: number }

type ProjectDock = {
  worktrees: GitWorktreeDto[]
  activePath: string | null
  visitedPaths: string[]
  loading: boolean
  reason?: string
}

type Props = {
  projects: Project[]
  selectedProjectId: string | null
  openedProjectIds: string[]
  collapsed: boolean
  onToggleCollapsed: (next?: boolean) => void
  onActiveAgentChange: (agent: AgentType) => void
  resumeRequest?: AgentResumeRequest | null
  onResumeHandled?: () => void
}

// A new project/worktree starts empty. Agent kinds are only a picker catalog; a terminal is mounted
// after the user explicitly chooses one through + Agent (or explicitly resumes a saved session).
const DEFAULT_SLOTS: AgentSlot[] = []

function isAgentType(value: unknown): value is AgentType {
  return typeof value === 'string' && AGENT_CATALOG.includes(value as AgentType)
}

function pathHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function agentWorkspaceKey(projectId: string, worktreePath: string): string {
  return `${projectId}:${pathHash(worktreePath)}`
}

export function agentTerminalKey(projectId: string, worktreePath: string, slotId: string): string {
  return `${agentWorkspaceKey(projectId, worktreePath)}:${slotId}`
}

function slotsStorageKey(projectId: string, worktreePath: string): string {
  return `apc:agent-slots:${projectId}:${pathHash(worktreePath)}`
}

function activeWorktreeStorageKey(projectId: string): string {
  return `apc:active-worktree:${projectId}`
}

export function readAgentSlots(projectId: string, worktreePath: string): AgentSlot[] {
  try {
    const raw = localStorage.getItem(slotsStorageKey(projectId, worktreePath))
    if (!raw) return DEFAULT_SLOTS.map((slot) => ({ ...slot }))
    const parsed = JSON.parse(raw) as { path?: unknown; slots?: unknown }
    if (parsed.path !== worktreePath || !Array.isArray(parsed.slots)) return DEFAULT_SLOTS.map((slot) => ({ ...slot }))
    const seen = new Set<string>()
    const slots = parsed.slots.flatMap((candidate): AgentSlot[] => {
      if (!candidate || typeof candidate !== 'object') return []
      const id = 'id' in candidate ? candidate.id : null
      const agent = 'agent' in candidate ? candidate.agent : null
      if (typeof id !== 'string' || !id || seen.has(id) || !isAgentType(agent)) return []
      seen.add(id)
      return [{ id, agent }]
    })
    // An empty array is intentional: a user may want a worktree tab with no running agent yet.
    return slots
  } catch {
    return DEFAULT_SLOTS.map((slot) => ({ ...slot }))
  }
}

function persistAgentSlots(projectId: string, worktreePath: string, slots: AgentSlot[]): void {
  try {
    localStorage.setItem(slotsStorageKey(projectId, worktreePath), JSON.stringify({ path: worktreePath, slots }))
  } catch { /* localStorage can be unavailable in hardened renderers */ }
}

export function nextAgentSlot(slots: AgentSlot[], agent: AgentType): AgentSlot {
  let suffix = 1
  const ids = new Set(slots.map((slot) => slot.id))
  while (ids.has(`${agent}-${suffix}`)) suffix += 1
  return { id: `${agent}-${suffix}`, agent }
}

function pathBasename(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.at(-1) || path
}

function worktreeLabel(worktree: GitWorktreeDto): string {
  if (worktree.branch) return worktree.branch
  if (worktree.head) return `detached@${worktree.head.slice(0, 7)}`
  return pathBasename(worktree.path)
}

function fallbackWorktrees(project: Project | undefined): GitWorktreeDto[] {
  const path = project?.repoPaths[0]
  if (!path) return []
  return [{ path, branch: pathBasename(path), head: '', detached: false, isMain: true }]
}

function slotDisplayLabel(slots: AgentSlot[], slot: AgentSlot): string {
  const sameAgent = slots.filter((candidate) => candidate.agent === slot.agent)
  if (sameAgent.length < 2) return AGENT_LABEL[slot.agent]
  return `${AGENT_LABEL[slot.agent]} ${sameAgent.findIndex((candidate) => candidate.id === slot.id) + 1}`
}

export function AgentWorkspaceDock({
  projects,
  selectedProjectId,
  openedProjectIds,
  collapsed,
  onToggleCollapsed,
  onActiveAgentChange,
  resumeRequest,
  onResumeHandled,
}: Props) {
  const agentStatus = useStore((state) => state.agentStatus)
  const openPanes = useStore((state) => state.openPanes)
  const restartNonce = useStore((state) => state.restartNonce)
  const setAgentStatus = useStore((state) => state.setAgentStatus)
  const restartAgent = useStore((state) => state.restartAgent)
  const resumeAgentSession = useStore((state) => state.resumeAgentSession)
  const stopAgent = useStore((state) => state.stopAgent)

  const [projectDocks, setProjectDocks] = useState<Record<string, ProjectDock>>({})
  const [slotsByWorkspace, setSlotsByWorkspace] = useState<Record<string, AgentSlot[]>>({})
  const [selectedSlotByWorkspace, setSelectedSlotByWorkspace] = useState<Record<string, string | null>>({})
  const [widthsByWorkspace, setWidthsByWorkspace] = useState<Record<string, Record<string, number>>>({})
  const [pickerOpen, setPickerOpen] = useState(false)
  const loadedProjectsRef = useRef(new Set<string>())
  const loadingProjectsRef = useRef(new Set<string>())
  const activePathRef = useRef<Record<string, string | null>>({})
  const openedProjectsRef = useRef<string[]>([])
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const terminalBodyRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ onMove: (event: MouseEvent) => void; onUp: () => void } | null>(null)

  const ensureWorkspace = useCallback((projectId: string, worktreePath: string) => {
    const key = agentWorkspaceKey(projectId, worktreePath)
    const restored = readAgentSlots(projectId, worktreePath)
    setSlotsByWorkspace((previous) => key in previous ? previous : { ...previous, [key]: restored })
    setSelectedSlotByWorkspace((previous) => key in previous
      ? previous
      : { ...previous, [key]: restored[0]?.id ?? null })
    for (const agent of new Set(restored.map((slot) => slot.agent))) api.paneOpened({ projectId, agent })
  }, [])

  const loadWorktrees = useCallback(async (projectId: string, force = false) => {
    if ((!force && loadedProjectsRef.current.has(projectId)) || loadingProjectsRef.current.has(projectId)) return
    const project = projects.find((candidate) => candidate.id === projectId)
    if (!project) return
    loadingProjectsRef.current.add(projectId)
    setProjectDocks((previous) => ({
      ...previous,
      [projectId]: {
        worktrees: previous[projectId]?.worktrees ?? [],
        activePath: previous[projectId]?.activePath ?? null,
        visitedPaths: previous[projectId]?.visitedPaths ?? [],
        loading: true,
        reason: undefined,
      },
    }))

    try {
      const response = typeof api.gitWorktrees === 'function'
        ? await api.gitWorktrees({ projectId })
        : { ok: true, worktrees: fallbackWorktrees(project) }
      const worktrees = response.worktrees.length > 0 ? response.worktrees : fallbackWorktrees(project)
      let storedPath: string | null = null
      try { storedPath = localStorage.getItem(activeWorktreeStorageKey(projectId)) } catch { /* ignore */ }
      const preferredPath = activePathRef.current[projectId] ?? storedPath
      const activePath = worktrees.some((worktree) => worktree.path === preferredPath)
        ? preferredPath
        : (worktrees.find((worktree) => worktree.isMain)?.path ?? worktrees[0]?.path ?? null)
      activePathRef.current[projectId] = activePath
      if (activePath) ensureWorkspace(projectId, activePath)
      setProjectDocks((previous) => {
        const validPaths = new Set(worktrees.map((worktree) => worktree.path))
        const visitedPaths = (previous[projectId]?.visitedPaths ?? []).filter((path) => validPaths.has(path))
        if (activePath && !visitedPaths.includes(activePath)) visitedPaths.push(activePath)
        return {
          ...previous,
          [projectId]: { worktrees, activePath, visitedPaths, loading: false, reason: response.reason },
        }
      })
      loadedProjectsRef.current.add(projectId)
    } catch (error) {
      const worktrees = fallbackWorktrees(project)
      const activePath = worktrees[0]?.path ?? null
      activePathRef.current[projectId] = activePath
      if (activePath) ensureWorkspace(projectId, activePath)
      setProjectDocks((previous) => ({
        ...previous,
        [projectId]: {
          worktrees,
          activePath,
          visitedPaths: activePath ? [activePath] : [],
          loading: false,
          reason: error instanceof Error ? error.message : String(error),
        },
      }))
      loadedProjectsRef.current.add(projectId)
    } finally {
      loadingProjectsRef.current.delete(projectId)
    }
  }, [ensureWorkspace, projects])

  useEffect(() => {
    if (selectedProjectId) void loadWorktrees(selectedProjectId)
  }, [loadWorktrees, selectedProjectId])

  // A recently-used project's terminals stay mounted until App's FIFO evicts that project. Mirror
  // that lifecycle to the legacy session store at the agent-kind level (duplicate slots are one row).
  useEffect(() => {
    const lost = openedProjectsRef.current.filter((projectId) => !openedProjectIds.includes(projectId))
    for (const projectId of lost) {
      const agents = new Set<AgentType>()
      for (const [key, slots] of Object.entries(slotsByWorkspace)) {
        if (key.startsWith(`${projectId}:`)) for (const slot of slots) agents.add(slot.agent)
      }
      for (const agent of agents) api.paneClosed({ projectId, agent })
    }
    openedProjectsRef.current = openedProjectIds
  }, [openedProjectIds, slotsByWorkspace])

  useEffect(() => {
    if (!pickerOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setPickerOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [pickerOpen])

  useEffect(() => () => {
    if (!dragRef.current) return
    window.removeEventListener('mousemove', dragRef.current.onMove)
    window.removeEventListener('mouseup', dragRef.current.onUp)
  }, [])

  const selectedDock = selectedProjectId ? projectDocks[selectedProjectId] : undefined
  const activeWorktree = selectedDock?.worktrees.find((worktree) => worktree.path === selectedDock.activePath)
  const selectedWorkspaceKey = selectedProjectId && selectedDock?.activePath
    ? agentWorkspaceKey(selectedProjectId, selectedDock.activePath)
    : null
  const activeSlots = selectedWorkspaceKey ? slotsByWorkspace[selectedWorkspaceKey] ?? [] : []
  const activeSelectedSlotId = selectedWorkspaceKey ? selectedSlotByWorkspace[selectedWorkspaceKey] ?? null : null

  const activateSlot = useCallback((workspaceKey: string, slots: AgentSlot[], slot: AgentSlot) => {
    setSelectedSlotByWorkspace((previous) => ({ ...previous, [workspaceKey]: slot.id }))
    setWidthsByWorkspace((previous) => ({
      ...previous,
      [workspaceKey]: Object.fromEntries(slots.map((candidate) => [candidate.id, candidate.id === slot.id ? 2 : 1])),
    }))
    onActiveAgentChange(slot.agent)
  }, [onActiveAgentChange])

  const selectWorktree = (projectId: string, worktreePath: string) => {
    ensureWorkspace(projectId, worktreePath)
    activePathRef.current[projectId] = worktreePath
    try { localStorage.setItem(activeWorktreeStorageKey(projectId), worktreePath) } catch { /* ignore */ }
    setProjectDocks((previous) => {
      const dock = previous[projectId]
      if (!dock) return previous
      return {
        ...previous,
        [projectId]: {
          ...dock,
          activePath: worktreePath,
          visitedPaths: dock.visitedPaths.includes(worktreePath) ? dock.visitedPaths : [...dock.visitedPaths, worktreePath],
        },
      }
    })
    const key = agentWorkspaceKey(projectId, worktreePath)
    const slots = slotsByWorkspace[key] ?? readAgentSlots(projectId, worktreePath)
    const selectedId = selectedSlotByWorkspace[key] ?? slots[0]?.id
    const selected = slots.find((slot) => slot.id === selectedId) ?? slots[0]
    if (selected) onActiveAgentChange(selected.agent)
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
  }

  const addAgent = (agent: AgentType) => {
    if (!selectedProjectId || !selectedDock?.activePath || !selectedWorkspaceKey) return
    const current = slotsByWorkspace[selectedWorkspaceKey] ?? readAgentSlots(selectedProjectId, selectedDock.activePath)
    const slot = nextAgentSlot(current, agent)
    const next = [...current, slot]
    setSlotsByWorkspace((previous) => ({ ...previous, [selectedWorkspaceKey]: next }))
    persistAgentSlots(selectedProjectId, selectedDock.activePath, next)
    activateSlot(selectedWorkspaceKey, next, slot)
    api.paneOpened({ projectId: selectedProjectId, agent })
    setPickerOpen(false)
    onToggleCollapsed(false)
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
  }

  const removeAgent = (projectId: string, worktreePath: string, slot: AgentSlot) => {
    const key = agentWorkspaceKey(projectId, worktreePath)
    const terminalKey = agentTerminalKey(projectId, worktreePath, slot.id)
    const status = agentStatus[terminalKey] ?? 'idle'
    if ((status === 'running' || status === 'attention') && !window.confirm(`${AGENT_LABEL[slot.agent]} 터미널을 중지하고 닫을까요?`)) return
    if (status === 'running' || status === 'attention') stopAgent(terminalKey)
    const current = slotsByWorkspace[key] ?? []
    const next = current.filter((candidate) => candidate.id !== slot.id)
    setSlotsByWorkspace((previous) => ({ ...previous, [key]: next }))
    persistAgentSlots(projectId, worktreePath, next)
    setWidthsByWorkspace((previous) => {
      const widths = { ...(previous[key] ?? {}) }
      delete widths[slot.id]
      return { ...previous, [key]: widths }
    })
    if (selectedSlotByWorkspace[key] === slot.id) {
      const replacement = next[0] ?? null
      setSelectedSlotByWorkspace((previous) => ({ ...previous, [key]: replacement?.id ?? null }))
      if (replacement) onActiveAgentChange(replacement.agent)
    }
    const sameAgentStillOpen = Object.entries(slotsByWorkspace).some(([candidateKey, candidateSlots]) => {
      if (!candidateKey.startsWith(`${projectId}:`)) return false
      const consideredSlots = candidateKey === key ? next : candidateSlots
      return consideredSlots.some((candidate) => candidate.agent === slot.agent)
    })
    if (!sameAgentStillOpen) api.paneClosed({ projectId, agent: slot.agent })
  }

  const startColumnDrag = (workspaceKey: string, slots: AgentSlot[], index: number) => (event: ReactMouseEvent) => {
    event.preventDefault()
    if (dragRef.current) {
      window.removeEventListener('mousemove', dragRef.current.onMove)
      window.removeEventListener('mouseup', dragRef.current.onUp)
    }
    const left = slots[index]
    const right = slots[index + 1]
    if (!left || !right) return
    const startX = event.clientX
    const currentWidths = widthsByWorkspace[workspaceKey] ?? {}
    const leftStart = currentWidths[left.id] ?? (left.id === selectedSlotByWorkspace[workspaceKey] ? 2 : 1)
    const rightStart = currentWidths[right.id] ?? (right.id === selectedSlotByWorkspace[workspaceKey] ? 2 : 1)
    const bodyWidth = terminalBodyRef.current?.clientWidth ?? 1
    const totalWeight = slots.reduce((sum, slot) => sum + (currentWidths[slot.id] ?? 1), 0)
    const onMove = (moveEvent: MouseEvent) => {
      const delta = ((moveEvent.clientX - startX) / bodyWidth) * totalWeight
      setWidthsByWorkspace((previous) => ({
        ...previous,
        [workspaceKey]: {
          ...(previous[workspaceKey] ?? currentWidths),
          [left.id]: Math.max(0.25, leftStart + delta),
          [right.id]: Math.max(0.25, rightStart - delta),
        },
      }))
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

  // Shift+1..9 follows the visible, user-configured slot order in the active worktree.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.code.startsWith('Digit') || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
      const index = Number(event.code.slice(5)) - 1
      const slot = activeSlots[index]
      if (!slot || !selectedWorkspaceKey) return
      event.preventDefault()
      event.stopPropagation()
      onToggleCollapsed(false)
      activateSlot(selectedWorkspaceKey, activeSlots, slot)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activateSlot, activeSlots, onToggleCollapsed, selectedWorkspaceKey])

  // Resume-card actions target an agent kind. Reuse a matching visible slot, or create one in the
  // active worktree, then route the session id to that slot's unique PTY key.
  useEffect(() => {
    if (!resumeRequest || resumeRequest.projectId !== selectedProjectId || !selectedDock?.activePath || !selectedWorkspaceKey) return
    const current = slotsByWorkspace[selectedWorkspaceKey]
    if (!current) return
    const selectedMatch = current.find((slot) => slot.id === activeSelectedSlotId && slot.agent === resumeRequest.agent)
    let slot = selectedMatch ?? current.find((candidate) => candidate.agent === resumeRequest.agent)
    let next = current
    if (!slot) {
      slot = nextAgentSlot(current, resumeRequest.agent)
      next = [...current, slot]
      setSlotsByWorkspace((previous) => ({ ...previous, [selectedWorkspaceKey]: next }))
      persistAgentSlots(selectedProjectId, selectedDock.activePath, next)
      api.paneOpened({ projectId: selectedProjectId, agent: resumeRequest.agent })
    }
    activateSlot(selectedWorkspaceKey, next, slot)
    resumeAgentSession(
      agentTerminalKey(selectedProjectId, selectedDock.activePath, slot.id),
      resumeRequest.sessionId,
      resumeRequest.agent,
    )
    onResumeHandled?.()
  }, [
    activeSelectedSlotId,
    activateSlot,
    onResumeHandled,
    resumeAgentSession,
    resumeRequest,
    selectedDock?.activePath,
    selectedProjectId,
    selectedWorkspaceKey,
    slotsByWorkspace,
  ])

  const statusOf = (key: string): AgentRunStatus => agentStatus[key] ?? 'idle'

  const picker = (
    <div ref={pickerRef} className="agent-picker" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="agent-picker__trigger"
        aria-label="에이전트 추가"
        aria-expanded={pickerOpen}
        title="이 worktree에 에이전트 추가"
        disabled={!selectedProjectId || !selectedDock?.activePath}
        onClick={() => setPickerOpen((open) => !open)}
      >
        + <span>에이전트</span>
      </button>
      {pickerOpen && (
        <div className="agent-picker__menu" role="menu" aria-label="추가할 에이전트 선택">
          <div className="agent-picker__heading">에이전트 추가</div>
          {AGENT_CATALOG.map((candidate) => (
            <button key={candidate} type="button" role="menuitem" onClick={() => addAgent(candidate)}>
              <strong>{AGENT_LABEL[candidate]}</strong>
              <small>{AGENT_DESCRIPTION[candidate]}</small>
            </button>
          ))}
          <p>같은 에이전트를 여러 번 추가할 수도 있습니다.</p>
        </div>
      )}
    </div>
  )

  return (
    <div className="agent-workspace-dock">
      <div
        className="dock-bar"
        onClick={() => onToggleCollapsed()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggleCollapsed() }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        title={collapsed ? '터미널 펼치기' : '터미널 접기'}
      >
        <span className="dock-bar__chev">{collapsed ? '▲' : '▼'} agents</span>
        {activeWorktree && (
          <span className="dock-bar__worktree" title={activeWorktree.path}>
            <span aria-hidden="true">⑂</span> {worktreeLabel(activeWorktree)}
          </span>
        )}
        <div className="dock-bar__agents">
          {activeSlots.map((slot, index) => {
            const key = selectedProjectId && selectedDock?.activePath
              ? agentTerminalKey(selectedProjectId, selectedDock.activePath, slot.id)
              : slot.id
            const status = statusOf(key)
            return (
              <button
                key={slot.id}
                type="button"
                className={`dock-bar__agent${slot.id === activeSelectedSlotId ? ' dock-bar__agent--selected' : ''}`}
                onClick={(event) => {
                  event.stopPropagation()
                  if (!selectedWorkspaceKey) return
                  onToggleCollapsed(false)
                  activateSlot(selectedWorkspaceKey, activeSlots, slot)
                }}
                title={`Shift+${index + 1}`}
              >
                <span className={status === 'attention' ? 'dock-bar__dot dock-bar__dot--blink' : 'dock-bar__dot'} style={{ color: STATUS_COLOR[status] }}>●</span>
                {slotDisplayLabel(activeSlots, slot)}
              </button>
            )
          })}
        </div>
        {picker}
      </div>

      {!collapsed && selectedProjectId && (
        <div className="worktree-tabs">
          <span className="worktree-tabs__label">WORKTREES</span>
          <div className="worktree-tabs__scroll" role="tablist" aria-label="프로젝트 worktree">
            {(selectedDock?.worktrees ?? []).map((worktree) => (
              <button
                key={worktree.path}
                type="button"
                role="tab"
                aria-selected={worktree.path === selectedDock?.activePath}
                className={worktree.path === selectedDock?.activePath ? 'worktree-tabs__tab worktree-tabs__tab--active' : 'worktree-tabs__tab'}
                title={`${worktree.path}${worktree.locked ? `\n잠김: ${worktree.locked}` : ''}`}
                onClick={() => selectWorktree(selectedProjectId, worktree.path)}
              >
                <span className="worktree-tabs__branch">{worktreeLabel(worktree)}</span>
                {worktree.isMain && <span className="worktree-tabs__badge">기본</span>}
                {worktree.locked && <span className="worktree-tabs__lock" aria-label="잠김">●</span>}
              </button>
            ))}
          </div>
          {selectedDock?.reason && <span className="worktree-tabs__warning" title={selectedDock.reason}>!</span>}
          <button
            type="button"
            className="worktree-tabs__refresh"
            aria-label="worktree 새로고침"
            title="Git worktree 목록 새로고침"
            disabled={selectedDock?.loading}
            onClick={() => void loadWorktrees(selectedProjectId, true)}
          >
            {selectedDock?.loading ? '…' : '↻'}
          </button>
        </div>
      )}

      <div ref={terminalBodyRef} className="agent-workspace-dock__body" style={{ display: collapsed ? 'none' : 'block' }}>
        {!selectedProjectId && <div className="app-layout__placeholder">프로젝트를 선택하면 에이전트 터미널이 열립니다.</div>}
        {selectedProjectId && selectedDock?.loading && selectedDock.worktrees.length === 0 && (
          <div className="app-layout__placeholder">Git worktree를 불러오는 중…</div>
        )}
        {selectedProjectId && !selectedDock?.loading && (selectedDock?.worktrees.length ?? 0) === 0 && (
          <div className="app-layout__placeholder">등록된 저장소 경로가 없습니다.</div>
        )}

        {openedProjectIds.map((projectId) => {
          const dock = projectDocks[projectId]
          if (!dock) return null
          return dock.visitedPaths.map((worktreePath) => {
            const workspaceKey = agentWorkspaceKey(projectId, worktreePath)
            const slots = slotsByWorkspace[workspaceKey] ?? []
            const selectedSlotId = selectedSlotByWorkspace[workspaceKey]
            const widths = widthsByWorkspace[workspaceKey] ?? {}
            const worktree = dock.worktrees.find((candidate) => candidate.path === worktreePath)
            const visible = projectId === selectedProjectId && worktreePath === dock.activePath
            return (
              <div
                key={workspaceKey}
                className="agent-panes"
                data-worktree-path={worktreePath}
                style={{ display: visible ? 'flex' : 'none' }}
              >
                {slots.length === 0 && (
                  <div className="agent-panes__empty">
                    <span>이 worktree에는 아직 에이전트가 없습니다.</span>
                    <button type="button" onClick={() => setPickerOpen(true)}>+ 에이전트 추가</button>
                  </div>
                )}
                {slots.map((slot, index) => {
                  const terminalKey = agentTerminalKey(projectId, worktreePath, slot.id)
                  const status = statusOf(terminalKey)
                  const runtimePane = openPanes[terminalKey]
                  const legacyPane = worktree?.isMain && slot.id === `${slot.agent}-1`
                    ? openPanes[`${projectId}:${slot.agent}`]
                    : undefined
                  const resumeSessionId = runtimePane ? runtimePane.sessionId : legacyPane?.sessionId
                  return (
                    <Fragment key={slot.id}>
                      {index > 0 && (
                        <div
                          className="agent-panes__divider"
                          onMouseDown={startColumnDrag(workspaceKey, slots, index - 1)}
                          title="드래그하여 터미널 너비 조정"
                        />
                      )}
                      <section
                        className={`agent-pane${slot.id === selectedSlotId ? ' agent-pane--selected' : ''}`}
                        style={{ flexGrow: widths[slot.id] ?? (slot.id === selectedSlotId ? 2 : 1) }}
                        aria-label={`${slotDisplayLabel(slots, slot)} · ${worktree ? worktreeLabel(worktree) : pathBasename(worktreePath)}`}
                      >
                        <AgentDockHeader
                          agent={slot.agent}
                          label={slotDisplayLabel(slots, slot)}
                          status={status}
                          selected={slot.id === selectedSlotId}
                          shortcut={index + 1}
                          statusColor={STATUS_COLOR[status]}
                          onStart={() => restartAgent(terminalKey)}
                          onStop={() => stopAgent(terminalKey)}
                          onSelect={() => activateSlot(workspaceKey, slots, slot)}
                          onRemove={() => removeAgent(projectId, worktreePath, slot)}
                        />
                        <div className="agent-pane__terminal">
                          <AgentTerminal
                            key={terminalKey}
                            sessionId={terminalKey}
                            command={slot.agent}
                            args={[]}
                            cwd={worktreePath}
                            agent={slot.agent}
                            restartNonce={restartNonce[terminalKey] ?? 0}
                            resumeSessionId={resumeSessionId}
                            onStatus={(nextStatus) => setAgentStatus(terminalKey, nextStatus)}
                            onActivate={() => activateSlot(workspaceKey, slots, slot)}
                          />
                        </div>
                      </section>
                    </Fragment>
                  )
                })}
              </div>
            )
          })
        })}
      </div>
    </div>
  )
}
