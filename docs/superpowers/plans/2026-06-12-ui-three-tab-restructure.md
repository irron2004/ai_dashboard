# 3-탭 UI 재구성 (Home / Knowledge / Wiki Gen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 데스크톱 앱 화면을 3개 상단 탭(Home=current.md+git 변경분, Knowledge=문서/그래프 읽기 전용, Wiki Gen=생성·검수)으로 재구성하고, 접이식 터미널 독·노드 클릭→실제 md 열기·"보고 바로 Ingest" 동선을 구현한다.

**Architecture:** 렌더러 재배치가 중심. main 프로세스에는 읽기 전용 IPC 4개(`changes:list`, `changes:diff`, `fs:readDoc`, `fs:listDocs`)만 추가하고 파이프라인 로직은 불변. 기존 컴포넌트(WikiProgress, CoverageMatrix, QualityPanel, ProposalsPanel, TaskFlowView, DiffViewer, PmHome, MarkdownViewer 렌더부)를 새 탭 컴포넌트(HomeView/KnowledgeView/WikiGenDashboard)로 재조립한다.

**Tech Stack:** Electron + React 18 + zustand + vitest(@testing-library/react) + zod(IPC 파싱). 스펙: `docs/superpowers/specs/2026-06-12-ui-three-tab-restructure-design.md`.

---

## 실행 환경 (모든 태스크 공통 — 먼저 읽을 것)

이 레포는 `/mnt/c`(Windows FS)를 WSL에서 빌드한다. **모든 셸 명령 앞에 PATH 설정 필수**:

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
cd /mnt/c/Users/irron/Downloads/ai_dashboard-main/ai_dashboard-main
```

- **Node 22 필수** (`node:sqlite` builtin). Node 20에서는 desktop/app-services 테스트가 로드 단계에서 실패한다.
- **`pnpm install` 금지** — node_modules에 Windows용 네이티브 빌드가 들어 있어 재설치하면 Windows Electron 빌드가 깨진다.
- 데스크톱 테스트: `pnpm --filter @apc/desktop exec vitest run <src 상대경로>`
- 전체 typecheck: `pnpm run typecheck` (루트에서만 — 패키지별 tsc는 tsconfig가 없어 실패)
- 줄끝은 LF 고정(.gitattributes 있음).
- 렌더러 변경의 실물 확인은 HMR이 안 되므로 `pnpm --filter @apc/desktop dev` 재시작 필요. 라이브 확인은 Phase 5에서만 수행.

## 파일 구조 (전체 조감)

```
apps/desktop/src/
├─ shared/ipc-contract.ts            # [P3,P4 수정] CH 4개 + 요청/응답 타입 추가
├─ main/
│  ├─ project-files.ts               # [P3 신규] readProjectDoc / listProjectDocs (+ .test.ts)
│  ├─ project-changes.ts             # [P4 신규] parsePorcelain / markUnreflected / listProjectChanges / diffProjectFile (+ .test.ts)
│  ├─ container.ts                   # [P3 수정] vaultRoot 노출
│  └─ ipc.ts                         # [P3,P4 수정] 핸들러 4개 등록
└─ renderer/
   ├─ App.tsx                        # [P1 수정] 글로벌 ⋯메뉴, 접이식 독 / [P4 수정] Ingest·Generate 제거
   ├─ api.ts                         # [P3,P4 수정] api 4개 추가
   ├─ store.ts                       # [P2 수정] run mode 기록
   ├─ harness-utils.ts               # [P2 수정] bundle.mode, isRunResumable, stageForState / [P3 수정] pickNodeArtifact
   ├─ app.css                        # [각 Phase] 신규 클래스 추가, [P5] 죽은 클래스 제거
   └─ components/
      ├─ MainPanel.tsx               # [P1 수정] 3탭 + wikiGenRunning 배지
      ├─ GlobalMenu.tsx              # [P1 신규] ⋯ 오버플로우 메뉴 (Update 수용)
      ├─ HarnessRunList.tsx          # [P2 수정] 실행 이력 + ▶위키 생성▾ + 이어하기
      ├─ HarnessStructurePanel.tsx   # [P2 신규] 구조도=설정 슬라이드 패널 (+ .test.tsx)
      ├─ WikiGenDashboard.tsx        # [P2 신규] 생성·검수 탭 (+ .test.tsx)
      ├─ MarkdownContent.tsx         # [P3 신규] MarkdownViewer에서 렌더부 추출
      ├─ KnowledgeView.tsx           # [P3 신규] [문서|그래프] 읽기 전용 탭 (+ .test.tsx)
      ├─ GeneratePreflightModal.tsx  # [P4 신규] App.tsx에서 Generate 모달 추출
      ├─ HomeView.tsx                # [P4 신규] current.md + 변경분 + PM strip (+ .test.tsx)
      ├─ HarnessDashboard.tsx        # [P5 삭제]
      ├─ AgentConfigPanel.tsx        # [P5 삭제]
      └─ AgentConfigEditorPanel.tsx  # [P5 삭제] (.test.tsx 포함)
```

각 Phase 끝에는 항상 앱이 동작한다: P1(셸만 교체, 기존 화면 그대로 매달림) → P2(Wiki Gen 분리) → P3(Knowledge 교체) → P4(Home 신설) → P5(구 컴포넌트 제거).

---

# Phase 1 — 셸: 3탭 + 글로벌 메뉴 + 접이식 터미널 독

### Task 1: MainPanel을 3탭으로 교체

**Files:**
- Modify: `apps/desktop/src/renderer/components/MainPanel.tsx` (전체 교체)
- Test: `apps/desktop/src/renderer/components/MainPanel.test.tsx` (전체 교체)

- [ ] **Step 1: 실패하는 테스트 작성** — `MainPanel.test.tsx` 전체를 다음으로 교체:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { MainPanel } from './MainPanel.js'

vi.mock('./HarnessDashboard.js', () => ({
  HarnessDashboard: () => <div>HARNESS-STUB</div>,
}))

const dashboard: ProjectDashboardRes = {
  project: { id: 'p1', name: 'APC', status: 'active', goal: 'ship MVP', projectType: 'git', repoPaths: [], vaultPaths: [], sourcePaths: [] },
  activeTasks: [], reviewQueue: [], recentRuns: [], allTasks: [],
}

describe('MainPanel', () => {
  test('shows three tabs: Home / Knowledge / Wiki Gen', () => {
    render(<MainPanel tab="home" onTab={vi.fn()} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Home/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /Knowledge/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /Wiki Gen/ })).toBeDefined()
  })

  test('home tab renders PmHome content', () => {
    render(<MainPanel tab="home" onTab={vi.fn()} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
    expect(screen.getByText('ship MVP')).toBeDefined()
    expect(screen.queryByText('HARNESS-STUB')).toBeNull()
  })

  test('knowledge tab renders HarnessDashboard (temporary until Phase 3)', () => {
    render(<MainPanel tab="knowledge" onTab={vi.fn()} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
    expect(screen.getByText('HARNESS-STUB')).toBeDefined()
  })

  test('wikigen tab renders placeholder (until Phase 2)', () => {
    render(<MainPanel tab="wikigen" onTab={vi.fn()} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
    expect(screen.getByText(/Wiki Gen/)).toBeDefined()
  })

  test('fires onTab with the new tab id', () => {
    const onTab = vi.fn()
    render(<MainPanel tab="home" onTab={onTab} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Knowledge/ }))
    expect(onTab).toHaveBeenCalledWith('knowledge')
  })

  test('wiki gen tab shows running badge when wikiGenRunning', () => {
    render(<MainPanel tab="home" onTab={vi.fn()} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} wikiGenRunning />)
    expect(screen.getByTestId('wikigen-running-dot')).toBeDefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/MainPanel.test.tsx
```

Expected: FAIL — `tab="home"`이 `MainTab` 타입에 없음 / 'Wiki Gen' 버튼 없음.

- [ ] **Step 3: MainPanel.tsx 구현** — 전체를 다음으로 교체:

```tsx
import type { ReactNode } from 'react'
import type { AgentProfile } from '@apc/shared'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { PmHome } from './PmHome.js'
import { HarnessDashboard } from './HarnessDashboard.js'

export type MainTab = 'home' | 'knowledge' | 'wikigen'

type Props = {
  tab: MainTab
  onTab: (tab: MainTab) => void
  dashboard: ProjectDashboardRes
  profiles: AgentProfile[]
  onSelectProfile: (profileId: string) => void
  /** Right-aligned toolbar actions rendered inline in the tab row (so they don't claim a whole row). */
  actions?: ReactNode
  /** True while a wiki generation run is in flight — shows a pulsing dot on the Wiki Gen tab. */
  wikiGenRunning?: boolean
}

const TABS: { id: MainTab; label: string }[] = [
  { id: 'home', label: '🏠 Home' },
  { id: 'knowledge', label: '📖 Knowledge' },
  { id: 'wikigen', label: '⚙ Wiki Gen' },
]

export function MainPanel({ tab, onTab, dashboard, profiles, onSelectProfile, actions, wikiGenRunning }: Props) {
  return (
    <div className="main-panel">
      <nav className="main-panel__tabs">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`main-panel__tab${tab === id ? ' main-panel__tab--active' : ''}`}
            aria-pressed={tab === id}
            onClick={() => onTab(id)}
          >
            {label}
            {id === 'wikigen' && wikiGenRunning && (
              <span className="main-panel__tab-dot" data-testid="wikigen-running-dot" aria-label="생성 진행 중" />
            )}
          </button>
        ))}
        {actions && <div className="main-panel__tab-actions">{actions}</div>}
      </nav>
      <div className="main-panel__content">
        {tab === 'home' && <PmHome dashboard={dashboard} />}
        {tab === 'knowledge' && <HarnessDashboard profiles={profiles} onSelectProfile={onSelectProfile} />}
        {tab === 'wikigen' && <div className="main-panel__placeholder">⚙ Wiki Gen — Phase 2에서 구현</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: App.tsx의 mainTab 기본값/타입 맞추기** — `App.tsx`에서 한 줄 수정 (이게 없으면 typecheck 실패):

```tsx
// 기존: const [mainTab, setMainTab] = useState<MainTab>('pm')
const [mainTab, setMainTab] = useState<MainTab>(() => {
  try {
    const saved = localStorage.getItem('apc:mainTab')
    if (saved === 'home' || saved === 'knowledge' || saved === 'wikigen') return saved
  } catch { /* ignore */ }
  return 'home'
})
```

그리고 `MainPanel`에 넘기는 `onTab`을 persist하도록 교체 (App.tsx의 `<MainPanel tab={mainTab} onTab={setMainTab} …>` 부분):

```tsx
<MainPanel
  tab={mainTab}
  onTab={(t) => { setMainTab(t); try { localStorage.setItem('apc:mainTab', t) } catch { /* ignore */ } }}
  dashboard={dashboard}
  profiles={profiles}
  onSelectProfile={handleSelectProfile}
  actions={toolbarActions}
  wikiGenRunning={useStore.getState().harnessLoading}
/>
```

주의: `wikiGenRunning`은 reactive해야 하므로 실제로는 App 상단의 useStore 구조분해에 `harnessLoading`을 추가하고 `wikiGenRunning={harnessLoading}`으로 쓸 것:

```tsx
const {
  projects, selectedProjectId, dashboard, profiles, ingesting, lastIngest, error, agentStatus,
  preflighting, generatePreflight, generating, generation, harnessLoading,
  loadProjects, addProject, updateProject, deleteProject, selectProject, loadProfiles, ingest, clearError, setAgentStatus,
  prepareGenerate, generate, clearGeneratePreflight, clearGeneration,
} = useStore()
```

- [ ] **Step 5: CSS 추가** — `app.css` 끝에 추가:

```css
/* 3-tab shell */
.main-panel__tab-dot {
  display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  background: #4ade80; margin-left: 6px; vertical-align: middle;
  animation: apc-pulse 1.2s ease-in-out infinite;
}
@keyframes apc-pulse { 50% { opacity: 0.25; } }
.main-panel__placeholder {
  display: flex; align-items: center; justify-content: center;
  height: 100%; color: #666; font-size: 0.9rem;
}
```

- [ ] **Step 6: 테스트·typecheck 통과 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/MainPanel.test.tsx
pnpm run typecheck
```

Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/components/MainPanel.tsx apps/desktop/src/renderer/components/MainPanel.test.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/app.css
git commit -m "feat(desktop): 3-tab shell — Home / Knowledge / Wiki Gen with running badge"
```

### Task 2: 글로벌 ⋯ 메뉴 (Update 이동) + 툴바 정리

**Files:**
- Create: `apps/desktop/src/renderer/components/GlobalMenu.tsx`
- Test: `apps/desktop/src/renderer/components/GlobalMenu.test.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` (toolbarActions)
- Modify: `apps/desktop/src/renderer/app.css`

주의: **Ingest now / ✨ Generate 버튼은 이 태스크에서 지우지 않는다.** Home 탭이 생기는 Phase 4 전까지는 탭 줄에 임시로 남겨야 기능 공백이 없다.

- [ ] **Step 1: 실패하는 테스트 작성** — `GlobalMenu.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { GlobalMenu } from './GlobalMenu.js'

describe('GlobalMenu', () => {
  test('menu is closed by default and opens on ⋯ click', () => {
    render(<GlobalMenu items={[{ label: '⭳ Update', onClick: vi.fn() }]} />)
    expect(screen.queryByText('⭳ Update')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '메뉴' }))
    expect(screen.getByText('⭳ Update')).toBeDefined()
  })

  test('clicking an item fires its handler and closes the menu', () => {
    const onClick = vi.fn()
    render(<GlobalMenu items={[{ label: '⭳ Update', onClick }]} />)
    fireEvent.click(screen.getByRole('button', { name: '메뉴' }))
    fireEvent.click(screen.getByText('⭳ Update'))
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.queryByText('⭳ Update')).toBeNull()
  })

  test('disabled item does not fire', () => {
    const onClick = vi.fn()
    render(<GlobalMenu items={[{ label: '⭳ Update', onClick, disabled: true }]} />)
    fireEvent.click(screen.getByRole('button', { name: '메뉴' }))
    fireEvent.click(screen.getByText('⭳ Update'))
    expect(onClick).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/GlobalMenu.test.tsx
```

Expected: FAIL — 모듈 없음.

- [ ] **Step 3: GlobalMenu.tsx 구현**

```tsx
import { useEffect, useRef, useState } from 'react'

export type GlobalMenuItem = { label: string; onClick: () => void; disabled?: boolean }

/** Top-right ⋯ overflow menu for rarely-used global actions (app update 등). */
export function GlobalMenu({ items }: { items: GlobalMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="global-menu" ref={ref}>
      <button type="button" aria-label="메뉴" onClick={() => setOpen((v) => !v)}>⋯</button>
      {open && (
        <div className="global-menu__list" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="global-menu__item"
              disabled={item.disabled}
              onClick={() => { if (!item.disabled) { item.onClick(); setOpen(false) } }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: App.tsx toolbarActions 교체** — 기존 `toolbarActions` 블록(`const toolbarActions = (…)`)을 다음으로 교체하고, 파일 상단에 `import { GlobalMenu } from './components/GlobalMenu.js'` 추가:

```tsx
// 임시(Phase 4까지): Ingest/Generate는 Home 탭이 생기면 그쪽으로 이사한다.
const toolbarActions = (
  <>
    <button disabled={ingesting} onClick={() => ingest()}>
      {ingesting ? 'Ingesting...' : 'Ingest now'}
    </button>
    <button disabled={preflighting || generating || !selectedProjectId} onClick={openGeneratePreflight} title="문서/소스 범위 확인 후 current.md 제안 생성">
      {preflighting ? 'Scanning…' : generating ? 'Generating…' : '✨ Generate'}
    </button>
    {lastIngest && <span className="app-layout__ingest-note">ingested {lastIngest.sessions} session(s)</span>}
    <button onClick={() => setSearchOpen(true)} title="검색 (Ctrl+K)">🔎</button>
    <GlobalMenu items={[{ label: upd.running ? 'Updating…' : '⭳ Update (git pull + pnpm install)', onClick: runUpdate, disabled: upd.running }]} />
  </>
)
```

- [ ] **Step 5: CSS 추가** — `app.css` 끝에:

```css
/* global ⋯ overflow menu */
.global-menu { position: relative; display: inline-block; }
.global-menu__list {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 60;
  background: #1c1f26; border: 1px solid #3a3f4a; border-radius: 6px;
  min-width: 220px; padding: 4px; display: flex; flex-direction: column;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
}
.global-menu__item {
  text-align: left; background: transparent; border: none; color: #c5c9d3;
  padding: 7px 10px; border-radius: 4px; cursor: pointer; font-size: 0.82rem;
}
.global-menu__item:hover:not(:disabled) { background: #2e3340; }
.global-menu__item:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 6: 테스트 통과 확인 + commit**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/GlobalMenu.test.tsx
pnpm run typecheck
git add apps/desktop/src/renderer/components/GlobalMenu.tsx apps/desktop/src/renderer/components/GlobalMenu.test.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/app.css
git commit -m "feat(desktop): global ⋯ overflow menu — Update moves out of the toolbar"
```

### Task 3: 접이식 터미널 독

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx` (terminal 영역)
- Modify: `apps/desktop/src/renderer/app.css` (`.app-layout` grid)

터미널 프로세스는 main의 pty라 렌더러에서 접어도 살아 있다. **AgentTerminal을 unmount하지 말고** 컨테이너를 `display:none`으로만 숨긴다(키 유지 → 세션 유지). 펼칠 때 xterm fit을 위해 `window.dispatchEvent(new Event('resize'))`를 쏜다.

- [ ] **Step 1: App.tsx에 dock 상태 추가** — `sidebarCollapsed` state 선언 근처에 추가:

```tsx
const [dockCollapsed, setDockCollapsed] = useState(() => {
  try { return localStorage.getItem('apc:dockCollapsed') === '1' } catch { return false }
})
const toggleDock = (next?: boolean) => setDockCollapsed((prev) => {
  const v = next ?? !prev
  try { localStorage.setItem('apc:dockCollapsed', v ? '1' : '0') } catch { /* ignore */ }
  // xterm fit-addon은 layout 변경을 모름 — 펼친 직후 리사이즈 이벤트로 강제 핏
  setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
  return v
})
```

- [ ] **Step 2: 그리드 행 높이를 CSS 변수로** — `appLayoutStyle`을 다음으로 교체:

```tsx
const appLayoutStyle: CSSProperties & Record<'--sidebar-width' | '--dock-height', string> = {
  '--sidebar-width': `${effectiveSidebarW}px`,
  '--dock-height': dockCollapsed ? '30px' : '280px',
}
```

`app.css`의 `.app-layout`에서 `grid-template-rows: minmax(0, 1fr) 280px;` →

```css
grid-template-rows: minmax(0, 1fr) var(--dock-height, 280px);
```

- [ ] **Step 3: 터미널 영역 JSX 교체** — 기존 `<div ref={termRef} className="app-layout__terminal" …>` 블록 전체를 다음으로 교체:

```tsx
<div ref={termRef} className="app-layout__terminal" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
  <div className="dock-bar" onClick={() => toggleDock()} title={dockCollapsed ? '터미널 펼치기' : '터미널 접기'}>
    <span className="dock-bar__chev">{dockCollapsed ? '▲' : '▼'} agents</span>
    {AGENTS.map((a, i) => (
      <span
        key={a}
        className="dock-bar__agent"
        onClick={(e) => { e.stopPropagation(); toggleDock(false); setAgent(a) }}
        title={`Shift+${i + 1}`}
      >
        <span
          className={agentStatus[a] === 'attention' ? 'dock-bar__dot dock-bar__dot--blink' : 'dock-bar__dot'}
          style={{ color: STATUS_COLOR[agentStatus[a]] }}
        >●</span>
        {a}
      </span>
    ))}
  </div>
  <div style={{ flex: 1, minHeight: 0, display: dockCollapsed ? 'none' : 'flex', flexDirection: 'row' }}>
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
</div>
```

- [ ] **Step 4: Shift+1/2/3가 접힌 독을 자동으로 펼치게** — 기존 키보드 핸들러의 agent 분기를 수정:

```tsx
if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && n >= 1 && n <= AGENTS.length) {
  e.preventDefault(); e.stopPropagation()
  setAgent(AGENTS[n - 1])
  toggleDock(false)   // 접혀 있으면 펼치면서 해당 에이전트 포커스
  return
}
```

(이 useEffect의 deps에 `toggleDock`은 안정 함수가 아니므로, 핸들러 안에서 직접 `setDockCollapsed` + localStorage를 호출해도 된다 — 간단히 하려면 `toggleDock`을 `useCallback`이 아닌 컴포넌트 스코프 일반 함수로 두고 deps는 기존 그대로 둔다. 기존 코드도 `selectProject`를 deps에 넣는 수준이므로 `[projects, selectProject]` 유지 + eslint 경고 없음 확인.)

- [ ] **Step 5: CSS 추가** — `app.css` 끝에:

```css
/* collapsible agent dock */
.dock-bar {
  display: flex; align-items: center; gap: 14px; padding: 4px 12px;
  background: #14161a; border: 1px solid #2c2f38; border-radius: 4px 4px 0 0;
  font-size: 0.78rem; color: #8a8f9a; cursor: pointer; flex: 0 0 auto; user-select: none;
}
.dock-bar__chev { color: #777; }
.dock-bar__agent { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.dock-bar__agent:hover { color: #ddd; }
.dock-bar__dot { font-size: 0.8rem; line-height: 1; }
.dock-bar__dot--blink { animation: apc-pulse 1s ease-in-out infinite; }
```

- [ ] **Step 6: 전체 데스크톱 테스트 + typecheck**

```bash
pnpm --filter @apc/desktop exec vitest run
pnpm run typecheck
```

Expected: 기존 테스트 전부 PASS(App.tsx는 테스트가 직접 마운트하지 않음), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/app.css
git commit -m "feat(desktop): collapsible agent terminal dock with status dots"
```

---

# Phase 2 — Wiki Gen 탭 (생성·검수 분리)

### Task 4: harness-utils — run mode·resumable·stage 매핑 헬퍼

**Files:**
- Modify: `apps/desktop/src/renderer/harness-utils.ts`
- Test: `apps/desktop/src/renderer/harness-utils.test.ts` (기존 파일에 추가)

- [ ] **Step 1: 실패하는 테스트 추가** — `harness-utils.test.ts` 끝에:

```ts
import { isRunResumable, runModeLabel, stageForState, STRUCTURE_STAGES } from './harness-utils.js'

describe('run mode / resumable / stage helpers', () => {
  test('isRunResumable: FAILED and mid-pipeline states are resumable', () => {
    expect(isRunResumable('FAILED')).toBe(true)
    expect(isRunResumable('STAGING_WRITTEN')).toBe(true)
    expect(isRunResumable('CREATED')).toBe(true)
  })

  test('isRunResumable: review-ready and merged runs are not', () => {
    expect(isRunResumable('HUMAN_REVIEW_REQUIRED')).toBe(false)
    expect(isRunResumable('MERGED')).toBe(false)
  })

  test('runModeLabel maps mode to Korean label', () => {
    expect(runModeLabel('full-docs')).toBe('전체 문서')
    expect(runModeLabel('recent-sessions')).toBe('최근 세션')
    expect(runModeLabel(undefined)).toBe('')
  })

  test('stageForState maps every pipeline state to a structure stage', () => {
    expect(stageForState('PROJECT_SCANNED')).toBe('projectDiscovery')
    expect(stageForState('SOURCES_EXTRACTED')).toBe('conversationHistory')
    expect(stageForState('DOCUMENTS_CLASSIFIED')).toBe('documentIntent')
    expect(stageForState('NODE_PROPOSALS_CREATED')).toBe('knowledgeNodeExtractor')
    expect(stageForState('LEAD_MERGED')).toBe('wikiGraphLead')
    expect(stageForState('WRITE_PLAN_CREATED')).toBe('wikiGraphLead')
    expect(stageForState('STAGING_WRITTEN')).toBe('policyGuard')
    expect(stageForState('VALIDATED')).toBe('policyGuard')
    expect(stageForState('HUMAN_REVIEW_REQUIRED')).toBe('humanReview')
    expect(stageForState('MERGED')).toBe('humanReview')
    expect(stageForState('CREATED')).toBe('materialize')
  })

  test('STRUCTURE_STAGES is ordered and includes the gate row', () => {
    expect(STRUCTURE_STAGES.map((s) => s.id)).toEqual([
      'materialize', 'projectDiscovery', 'conversationHistory', 'documentIntent',
      'knowledgeNodeExtractor', 'wikiGraphLead', 'policyGuard', 'humanReview',
    ])
    expect(STRUCTURE_STAGES.find((s) => s.id === 'policyGuard')?.kind).toBe('gate')
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/harness-utils.test.ts
```

Expected: FAIL — export 없음.

- [ ] **Step 3: harness-utils.ts에 구현 추가** — `HarnessRunBundle` 타입을 수정하고(아래), 파일 끝에 헬퍼들을 추가:

```ts
// HarnessRunBundle에 optional mode 추가 (기존 정의 교체).
// localStorage에 저장된 옛 run에는 mode가 없다 — 모든 소비처는 undefined를 허용해야 한다.
export type HarnessRunMode = 'full-docs' | 'recent-sessions'

export type HarnessRunBundle = {
  runState: RunState
  artifacts: HarnessRunArtifact[]
  /** 어떤 입력 모드로 시작된 run인지 (renderer가 시작 시점에 기록; resume·과거 run은 undefined). */
  mode?: HarnessRunMode
}
```

```ts
/** 이어하기(Resume) 버튼을 보여줄 상태: 실패했거나 파이프라인 중간에서 멈춘 run.
 *  리뷰 대기/병합 완료는 resume 대상이 아니다. */
export function isRunResumable(state: KhState): boolean {
  return state !== 'HUMAN_REVIEW_REQUIRED' && state !== 'MERGED'
}

export function runModeLabel(mode: HarnessRunMode | undefined): string {
  if (mode === 'full-docs') return '전체 문서'
  if (mode === 'recent-sessions') return '최근 세션'
  return ''
}

/** 구조도(=설정 패널)의 단계 정의. promptKey가 있으면 카드 클릭 시 그 프롬프트를 편집한다. */
export type StructureStageId =
  | 'materialize' | 'projectDiscovery' | 'conversationHistory' | 'documentIntent'
  | 'knowledgeNodeExtractor' | 'wikiGraphLead' | 'policyGuard' | 'humanReview'

export type StructureStage = {
  id: StructureStageId
  kind: 'builtin' | 'agent' | 'gate' | 'review'
  icon: string
  name: string
  desc: string
  promptKey?: HarnessAgentPromptKey
}

export const STRUCTURE_STAGES: StructureStage[] = [
  { id: 'materialize', kind: 'builtin', icon: '📥', name: '수집 (materialize)', desc: '프로젝트 md + 최근 세션 Q&A 수집' },
  { id: 'projectDiscovery', kind: 'agent', icon: '🔍', name: 'project-discovery', desc: 'canonical 문서 식별, vault 지도 요약', promptKey: 'projectDiscovery' },
  { id: 'conversationHistory', kind: 'agent', icon: '💬', name: 'conversation-history', desc: '세션에서 결정·파일·미해결 문제 추출', promptKey: 'conversationHistory' },
  { id: 'documentIntent', kind: 'agent', icon: '🏷', name: 'document-intent', desc: 'md를 canonical/reference/scratch로 분류', promptKey: 'documentIntent' },
  { id: 'knowledgeNodeExtractor', kind: 'agent', icon: '🧩', name: 'node-extractor', desc: '노드 제안·주장·근거 추출', promptKey: 'knowledgeNodeExtractor' },
  { id: 'wikiGraphLead', kind: 'agent', icon: '🕸', name: 'wiki-graph-lead', desc: '제안 병합 → 그래프 + 쓰기 계획', promptKey: 'wikiGraphLead' },
  { id: 'policyGuard', kind: 'gate', icon: '🛡', name: 'policy-guard', desc: 'secret scan · evidence · canonical 인간리뷰 게이트', promptKey: 'policyGuard' },
  { id: 'humanReview', kind: 'review', icon: '👤', name: '인간 리뷰 → Promote', desc: 'staging에만 자동 쓰기, 실 vault는 promote로만' },
]

/** 진행 상태(KhState) → 구조도 단계. 실행 중 현재 단계 하이라이트와 본문 스테퍼가 같은 매핑을 쓴다. */
export function stageForState(state: KhState): StructureStageId {
  switch (state) {
    case 'PROJECT_SCANNED': return 'projectDiscovery'
    case 'SOURCES_EXTRACTED': return 'conversationHistory'
    case 'DOCUMENTS_CLASSIFIED': return 'documentIntent'
    case 'NODE_PROPOSALS_CREATED': return 'knowledgeNodeExtractor'
    case 'LEAD_MERGED':
    case 'WRITE_PLAN_CREATED': return 'wikiGraphLead'
    case 'STAGING_WRITTEN':
    case 'VALIDATED': return 'policyGuard'
    case 'HUMAN_REVIEW_REQUIRED':
    case 'MERGED': return 'humanReview'
    case 'CREATED':
    case 'FAILED':
    default: return 'materialize'
  }
}
```

- [ ] **Step 4: 통과 확인 + commit**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/harness-utils.test.ts
pnpm run typecheck
git add apps/desktop/src/renderer/harness-utils.ts apps/desktop/src/renderer/harness-utils.test.ts
git commit -m "feat(desktop): run mode/resumable/pipeline-stage helpers for Wiki Gen tab"
```

### Task 5: store — run 시작 시 mode 기록

**Files:**
- Modify: `apps/desktop/src/renderer/store.ts` (`startHarnessRun`)
- Test: `apps/desktop/src/renderer/harness-store.test.tsx` (기존 파일에 추가)

- [ ] **Step 1: 실패하는 테스트 추가** — `harness-store.test.tsx`의 기존 패턴을 따라(파일 상단의 api mock 방식을 그대로 사용) 끝에 추가. 기존 테스트 파일을 먼저 읽고 mock 헬퍼를 재사용할 것. 핵심 단언:

```tsx
test('startHarnessRun(true) records mode full-docs on the bundle', async () => {
  // 기존 테스트의 api.harnessRun/harnessGetRun mock 셋업 재사용
  await useStore.getState().startHarnessRun(true)
  const bundle = useStore.getState().harnessRuns[0]
  expect(bundle.mode).toBe('full-docs')
})

test('startHarnessRun() records mode recent-sessions', async () => {
  await useStore.getState().startHarnessRun()
  expect(useStore.getState().harnessRuns[0].mode).toBe('recent-sessions')
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/harness-store.test.tsx
```

Expected: 새 테스트 2개 FAIL (`bundle.mode` undefined).

- [ ] **Step 3: store.ts 수정** — `startHarnessRun` 안에서 bundle 생성부 한 줄 변경:

```ts
// 기존: const bundle: HarnessRunBundle = { runState: shown.runState, artifacts: shown.artifacts ?? [] }
const bundle: HarnessRunBundle = {
  runState: shown.runState,
  artifacts: shown.artifacts ?? [],
  mode: materialize ? 'full-docs' : 'recent-sessions',
}
```

주의: `refreshHarnessRun`의 `upsertRun`이 새 bundle로 기존 항목을 교체하면서 mode를 잃는다. `upsertRun`을 mode 보존형으로 수정:

```ts
function upsertRun(runs: HarnessRunBundle[], bundle: HarnessRunBundle): HarnessRunBundle[] {
  const prev = runs.find((item) => item.runState.runId === bundle.runState.runId)
  const merged = { ...bundle, mode: bundle.mode ?? prev?.mode }
  const next = [merged, ...runs.filter((item) => item.runState.runId !== bundle.runState.runId)]
  return next.sort((a, b) => {
    const aAt = a.runState.history.at(-1)?.at ?? a.runState.history[0]?.at ?? ''
    const bAt = b.runState.history.at(-1)?.at ?? b.runState.history[0]?.at ?? ''
    return bAt.localeCompare(aAt)
  })
}
```

- [ ] **Step 4: 통과 확인 + commit**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/harness-store.test.tsx
git add apps/desktop/src/renderer/store.ts apps/desktop/src/renderer/harness-store.test.tsx
git commit -m "feat(desktop): record run input mode on harness run bundles"
```

### Task 6: HarnessRunList → "실행 이력" + ▶ 위키 생성 ▾ + 이어하기

**Files:**
- Modify: `apps/desktop/src/renderer/components/HarnessRunList.tsx`
- Test: `apps/desktop/src/renderer/components/HarnessRunList.test.tsx` (신규)
- Modify: `apps/desktop/src/renderer/app.css`

Props 변경: `onStartRun: () => void` → `onStartRun: (materialize: boolean) => void`, `onResumeRun: (runId: string) => void` 추가. 기존 호출처는 `HarnessDashboard.tsx` 한 곳 — 거기도 시그니처만 맞춘다(Phase 5에서 삭제될 파일이므로 최소 수정).

- [ ] **Step 1: 실패하는 테스트 작성** — `HarnessRunList.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { HarnessRunBundle } from '../harness-utils.js'
import { HarnessRunList } from './HarnessRunList.js'

function bundle(runId: string, state: string, mode?: 'full-docs' | 'recent-sessions'): HarnessRunBundle {
  return {
    runState: {
      runId, state, engine: 'claude', projectId: 'p1',
      history: [{ state: 'CREATED', at: '2026-06-12T01:00:00Z' }],
    } as unknown as HarnessRunBundle['runState'],
    artifacts: [],
    mode,
  }
}

const baseProps = {
  selectedRunId: null, loading: false, collapsed: false,
  onToggleCollapse: vi.fn(), onSelectRun: vi.fn(), onRefresh: vi.fn(),
}

describe('HarnessRunList (실행 이력)', () => {
  test('header reads 실행 이력 and has a single ▶ 위키 생성 dropdown button', () => {
    render(<HarnessRunList {...baseProps} runs={[]} onStartRun={vi.fn()} onResumeRun={vi.fn()} />)
    expect(screen.getByText('실행 이력')).toBeDefined()
    expect(screen.getByRole('button', { name: /위키 생성/ })).toBeDefined()
  })

  test('dropdown offers 전체 문서 / 최근 세션 and fires onStartRun with materialize flag', () => {
    const onStartRun = vi.fn()
    render(<HarnessRunList {...baseProps} runs={[]} onStartRun={onStartRun} onResumeRun={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /위키 생성/ }))
    fireEvent.click(screen.getByText('전체 문서'))
    expect(onStartRun).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: /위키 생성/ }))
    fireEvent.click(screen.getByText(/최근 세션/))
    expect(onStartRun).toHaveBeenCalledWith(false)
  })

  test('이어하기 shows only on resumable runs and fires onResumeRun', () => {
    const onResumeRun = vi.fn()
    render(
      <HarnessRunList
        {...baseProps}
        runs={[bundle('RUN-fail', 'FAILED'), bundle('RUN-review', 'HUMAN_REVIEW_REQUIRED')]}
        onStartRun={vi.fn()}
        onResumeRun={onResumeRun}
      />,
    )
    const resumeButtons = screen.getAllByRole('button', { name: /이어하기/ })
    expect(resumeButtons).toHaveLength(1)
    fireEvent.click(resumeButtons[0])
    expect(onResumeRun).toHaveBeenCalledWith('RUN-fail')
  })

  test('card shows mode label when bundle has mode', () => {
    render(<HarnessRunList {...baseProps} runs={[bundle('RUN-1', 'MERGED', 'full-docs')]} onStartRun={vi.fn()} onResumeRun={vi.fn()} />)
    expect(screen.getByText(/전체 문서/)).toBeDefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/HarnessRunList.test.tsx
```

Expected: FAIL — props 불일치 / '실행 이력' 없음.

- [ ] **Step 3: HarnessRunList.tsx 수정** — 변경 포인트만 정리(전체 구조는 유지):

```tsx
import { useState } from 'react'
import {
  HARNESS_STATE_ORDER, formatTimestamp, isRunResumable, runModeLabel, runStartedAt, runUpdatedAt,
  stateProgress, stateTone, type HarnessRunBundle,
} from '../harness-utils.js'

type Props = {
  runs: HarnessRunBundle[]
  selectedRunId: string | null
  loading: boolean
  collapsed: boolean
  onToggleCollapse: () => void
  onSelectRun: (runId: string) => void
  onRefresh: () => void
  onStartRun: (materialize: boolean) => void
  onResumeRun: (runId: string) => void
}
```

헤더 부분 교체 (`<h2>Runs</h2>` 블록 → ):

```tsx
<header className="panel__header harness-run-list__header">
  <div>
    <h2>실행 이력</h2>
    <p>이 프로젝트의 위키 생성 run</p>
  </div>
  <div className="harness-run-list__actions">
    <button type="button" className="harness-run-list__collapse-btn" onClick={onToggleCollapse} title="실행 이력 접기" aria-label="실행 이력 접기">◂</button>
    <button type="button" onClick={onRefresh} disabled={loading || !selectedRunId}>⟳</button>
    <StartRunDropdown loading={loading} onStartRun={onStartRun} />
  </div>
</header>
```

같은 파일에 드롭다운 컴포넌트 추가:

```tsx
function StartRunDropdown({ loading, onStartRun }: { loading: boolean; onStartRun: (materialize: boolean) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="start-run-dropdown">
      <button type="button" className="button button--accent" disabled={loading} onClick={() => setOpen((v) => !v)}>
        ▶ 위키 생성 ▾
      </button>
      {open && (
        <div className="start-run-dropdown__menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onStartRun(true) }}>
            전체 문서
            <small>프로젝트 md 전체 + 세션 Q&A로 위키 생성 (기본)</small>
          </button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onStartRun(false) }}>
            최근 세션
            <small>최근 에이전트 세션만으로 빠르게 실행</small>
          </button>
        </div>
      )}
    </div>
  )
}
```

run 카드의 메타 줄에 mode 라벨 + 이어하기 버튼 추가 — `harness-run-list__meta` 줄과 footer를 다음으로:

```tsx
<div className="harness-run-list__meta">
  {runModeLabel(bundle.mode) || runState.engine} · {startedAt}
</div>
```

```tsx
<div className="harness-run-list__footer">
  <span>{updatedAt}</span>
  <span>{bundle.artifacts.length} artifacts</span>
  {isRunResumable(runState.state) && (
    <button
      type="button"
      className="harness-run-list__resume"
      disabled={loading}
      onClick={(e) => { e.stopPropagation(); onResumeRun(runState.runId) }}
    >
      ↻ 이어하기
    </button>
  )}
</div>
```

주의: footer는 `<button className="harness-run-list__item">` **안에** 있어 button-in-button이 된다. 카드 자체를 `<button>` → `<div role="button" tabIndex={0} onClick=… onKeyDown(Enter)>`로 바꿔 중첩 버튼을 피한다(접근성 속성 유지). 접힌 레일(`collapsed`) 분기는 라벨 텍스트만 "실행 이력 펼치기"로 바꾸고 `+` 버튼은 `onStartRun(true)`를 호출하게 수정.

- [ ] **Step 4: HarnessDashboard.tsx 호출처 시그니처 맞추기** (임시 — P5에서 삭제됨):

```tsx
<HarnessRunList
  runs={harnessRuns}
  selectedRunId={selectedHarnessRunId}
  loading={harnessLoading}
  collapsed={runsCollapsed}
  onToggleCollapse={toggleRuns}
  onSelectRun={(runId) => selectHarnessRun(runId)}
  onRefresh={() => void refreshHarnessRun()}
  onStartRun={(materialize) => void startHarnessRun(materialize)}
  onResumeRun={(runId) => void resumeHarnessRun(runId)}
/>
```

- [ ] **Step 5: CSS 추가** — `app.css` 끝에:

```css
/* start-run dropdown + resume */
.start-run-dropdown { position: relative; display: inline-block; }
.start-run-dropdown__menu {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 60;
  background: #1c1f26; border: 1px solid #3a3f4a; border-radius: 6px;
  min-width: 240px; padding: 4px; display: flex; flex-direction: column;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
}
.start-run-dropdown__menu button {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  text-align: left; background: transparent; border: none; color: #c5c9d3;
  padding: 8px 10px; border-radius: 4px; cursor: pointer;
}
.start-run-dropdown__menu button:hover { background: #2e3340; }
.start-run-dropdown__menu small { color: #777; font-size: 0.7rem; }
.harness-run-list__resume {
  margin-left: auto; font-size: 0.7rem; padding: 1px 7px;
  background: #2a3a4a; border: 1px solid #3a5a7a; border-radius: 4px; color: #9cf;
}
```

- [ ] **Step 6: 통과 확인 + commit**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/HarnessRunList.test.tsx
pnpm --filter @apc/desktop exec vitest run
pnpm run typecheck
git add apps/desktop/src/renderer/components/HarnessRunList.tsx apps/desktop/src/renderer/components/HarnessRunList.test.tsx apps/desktop/src/renderer/components/HarnessDashboard.tsx apps/desktop/src/renderer/app.css
git commit -m "feat(desktop): run list → 실행 이력 with single start dropdown and contextual resume"
```

### Task 7: HarnessStructurePanel — 구조도 = 설정 슬라이드 패널

**Files:**
- Create: `apps/desktop/src/renderer/components/HarnessStructurePanel.tsx`
- Test: `apps/desktop/src/renderer/components/HarnessStructurePanel.test.tsx`
- Modify: `apps/desktop/src/renderer/app.css`

기존 AgentConfigPanel(우측 상시 패널) + AgentConfigEditorPanel(Config 탭)의 **설정 기능을 흡수**한다: 프롬프트 6종 편집(updateHarnessPrompt), 엔진 선택(updateHarnessModel), safety 2종(updateHarnessSafety), feature gates 표시(토글은 GATE_WIRING이 'honored'인 키만 — 기존 "honest UI" 정책 유지). Promote/Refresh 버튼은 가져오지 **않는다**(검수 영역으로 — Task 8).

- [ ] **Step 1: 실패하는 테스트 작성** — `HarnessStructurePanel.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { createDefaultHarnessConfig } from '../harness-utils.js'
import { HarnessStructurePanel } from './HarnessStructurePanel.js'

const noop = { onModelChange: vi.fn(), onSafetyChange: vi.fn(), onToggleGate: vi.fn(), onPromptChange: vi.fn(), onClose: vi.fn() }

describe('HarnessStructurePanel', () => {
  test('renders all pipeline stages in order', () => {
    render(<HarnessStructurePanel config={createDefaultHarnessConfig()} activeState={null} {...noop} />)
    for (const name of ['수집 (materialize)', 'project-discovery', 'conversation-history', 'document-intent', 'node-extractor', 'wiki-graph-lead', 'policy-guard', '인간 리뷰 → Promote']) {
      expect(screen.getByText(name)).toBeDefined()
    }
  })

  test('clicking an agent stage opens its prompt editor and edits flow to onPromptChange', () => {
    const onPromptChange = vi.fn()
    render(<HarnessStructurePanel config={createDefaultHarnessConfig()} activeState={null} {...noop} onPromptChange={onPromptChange} />)
    fireEvent.click(screen.getByText('node-extractor'))
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'new prompt' } })
    expect(onPromptChange).toHaveBeenCalledWith('knowledgeNodeExtractor', 'new prompt')
  })

  test('clicking the gate stage shows safety controls', () => {
    render(<HarnessStructurePanel config={createDefaultHarnessConfig()} activeState={null} {...noop} />)
    fireEvent.click(screen.getByText('policy-guard'))
    expect(screen.getByText(/secret scan/i)).toBeDefined()
    expect(screen.getByText(/evidence/i)).toBeDefined()
  })

  test('highlights the stage for the active run state', () => {
    render(<HarnessStructurePanel config={createDefaultHarnessConfig()} activeState="NODE_PROPOSALS_CREATED" {...noop} />)
    expect(screen.getByText('node-extractor').closest('.structure-panel__card')?.className).toContain('--now')
  })

  test('engine badge reflects config and changes flow to onModelChange', () => {
    const onModelChange = vi.fn()
    render(<HarnessStructurePanel config={createDefaultHarnessConfig()} activeState={null} {...noop} onModelChange={onModelChange} />)
    fireEvent.click(screen.getByText('project-discovery'))
    fireEvent.change(screen.getByLabelText('엔진'), { target: { value: 'codex' } })
    expect(onModelChange).toHaveBeenCalledWith({ engine: 'codex' })
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/HarnessStructurePanel.test.tsx
```

Expected: FAIL — 모듈 없음.

- [ ] **Step 3: HarnessStructurePanel.tsx 구현**

```tsx
import { useState } from 'react'
import type { AgentType } from '@apc/shared'
import {
  GATE_WIRING, GATE_WIRING_LABEL, HARNESS_FEATURE_GATES, STRUCTURE_STAGES, stageForState,
  type HarnessAgentPromptKey, type HarnessConfig, type HarnessFeatureGateKey, type StructureStageId,
} from '../harness-utils.js'

const ENGINES: AgentType[] = ['claude', 'opencode', 'codex']

type Props = {
  config: HarnessConfig
  /** 실행 중이면 현재 KhState (store.harnessProgress); 아니면 null. 해당 단계 카드를 하이라이트. */
  activeState: string | null
  onModelChange: (patch: Partial<HarnessConfig['model']>) => void
  onSafetyChange: (patch: Partial<HarnessConfig['safety']>) => void
  onToggleGate: (key: HarnessFeatureGateKey) => void
  onPromptChange: (key: HarnessAgentPromptKey, value: string) => void
  onClose: () => void
}

/** 하니스 구조도가 곧 설정 화면 — 파이프라인 단계를 실행 순서대로 보여주고,
 *  단계 카드를 클릭하면 그 단계의 프롬프트/모델(에이전트) 또는 safety/게이트(정책)를 편집한다. */
export function HarnessStructurePanel({ config, activeState, onModelChange, onSafetyChange, onToggleGate, onPromptChange, onClose }: Props) {
  const [selected, setSelected] = useState<StructureStageId | null>(null)
  const nowStage = activeState ? stageForState(activeState as Parameters<typeof stageForState>[0]) : null
  const stage = STRUCTURE_STAGES.find((s) => s.id === selected) ?? null

  return (
    <aside className="structure-panel panel">
      <header className="panel__header structure-panel__header">
        <h2>⚙ 에이전트 설정 — 하니스 구조</h2>
        <button type="button" onClick={onClose} aria-label="설정 닫기">✕</button>
      </header>

      <div className="structure-panel__pipe">
        {STRUCTURE_STAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={[
              'structure-panel__card',
              `structure-panel__card--${s.kind}`,
              selected === s.id ? 'structure-panel__card--selected' : '',
              nowStage === s.id ? 'structure-panel__card--now' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => setSelected(s.id)}
          >
            <span className="structure-panel__card-name">
              {s.icon} {s.name}
              {s.kind === 'agent' && <em className="structure-panel__engine">{config.model.engine}</em>}
            </span>
            <span className="structure-panel__card-desc">{s.desc}</span>
          </button>
        ))}
      </div>

      {stage?.kind === 'agent' && stage.promptKey && (
        <div className="structure-panel__edit">
          <b>{stage.icon} {stage.name} 편집</b>
          <label>
            엔진
            <select aria-label="엔진" value={config.model.engine} onChange={(e) => onModelChange({ engine: e.target.value as AgentType })}>
              {ENGINES.map((engine) => <option key={engine} value={engine}>{engine}</option>)}
            </select>
          </label>
          <label>
            프롬프트 오버라이드
            <textarea
              rows={4}
              value={config.prompts[stage.promptKey]}
              onChange={(e) => onPromptChange(stage.promptKey!, e.target.value)}
            />
          </label>
        </div>
      )}

      {stage?.kind === 'gate' && (
        <div className="structure-panel__edit">
          <b>🛡 정책 게이트</b>
          <label>
            secret scan 민감도
            <select value={config.safety.secretScanSensitivity} onChange={(e) => onSafetyChange({ secretScanSensitivity: e.target.value as HarnessConfig['safety']['secretScanSensitivity'] })}>
              <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
            </select>
          </label>
          <label>
            evidence 요구 수준
            <select value={config.safety.evidenceRequirement} onChange={(e) => onSafetyChange({ evidenceRequirement: e.target.value as HarnessConfig['safety']['evidenceRequirement'] })}>
              <option value="balanced">balanced</option><option value="strict">strict</option>
            </select>
          </label>
          <ul className="structure-panel__gates">
            {HARNESS_FEATURE_GATES.map(({ key, label, description }) => {
              const wiring = GATE_WIRING[key]
              const editable = wiring === 'honored'
              return (
                <li key={key} title={description}>
                  <label>
                    <input type="checkbox" checked={config.featureGates[key]} disabled={!editable} onChange={() => editable && onToggleGate(key)} />
                    {label}
                    <small>{GATE_WIRING_LABEL[wiring]}</small>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {stage?.kind === 'review' && (
        <div className="structure-panel__edit">
          <b>👤 인간 리뷰 / Promote</b>
          <p className="structure-panel__note">자동 쓰기는 staging vault까지만. 실제 vault 반영은 검수 화면의 Promote 버튼으로만 일어납니다.</p>
        </div>
      )}

      {stage?.kind === 'builtin' && (
        <div className="structure-panel__edit">
          <b>📥 수집 (materialize)</b>
          <p className="structure-panel__note">설정 없음 — 프로젝트 md와 최근 세션 Q&A를 모으는 내장 단계입니다. 모드(전체 문서/최근 세션)는 ▶ 위키 생성 드롭다운에서 고릅니다.</p>
        </div>
      )}
    </aside>
  )
}
```

- [ ] **Step 4: CSS 추가** — `app.css` 끝에:

```css
/* structure (settings) slide-over panel */
.structure-panel { display: flex; flex-direction: column; min-height: 0; border-left: 2px solid #6ea8fe; }
.structure-panel__header { display: flex; justify-content: space-between; align-items: center; }
.structure-panel__pipe { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; }
.structure-panel__card {
  display: flex; flex-direction: column; gap: 2px; text-align: left;
  background: #1c1f26; border: 1px solid #2c2f38; border-radius: 6px;
  padding: 7px 10px; cursor: pointer; color: #c5c9d3;
}
.structure-panel__card--gate { border-left: 3px solid #8a6a2a; }
.structure-panel__card--selected { border-color: #6ea8fe; background: #1e242e; }
.structure-panel__card--now { outline: 2px solid #4ade80; }
.structure-panel__card-name { color: #ddd; font-weight: 600; font-size: 0.82rem; display: flex; gap: 6px; align-items: center; }
.structure-panel__engine { margin-left: auto; font-style: normal; font-size: 0.65rem; padding: 1px 7px; border-radius: 8px; background: #2a3a4a; color: #9cf; font-weight: 400; }
.structure-panel__card-desc { color: #777; font-size: 0.72rem; }
.structure-panel__edit { border-top: 1px solid #2c2f38; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; font-size: 0.8rem; }
.structure-panel__edit label { display: flex; flex-direction: column; gap: 3px; color: #8a8f9a; }
.structure-panel__edit textarea { background: #0f1114; border: 1px solid #2c2f38; border-radius: 4px; color: #c5c9d3; font-family: monospace; font-size: 0.75rem; padding: 6px; }
.structure-panel__gates { list-style: none; margin: 0; padding: 0; max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; }
.structure-panel__gates label { flex-direction: row; align-items: center; gap: 6px; font-size: 0.74rem; }
.structure-panel__gates small { color: #666; margin-left: auto; }
.structure-panel__note { color: #8a8f9a; font-size: 0.76rem; margin: 0; }
```

- [ ] **Step 5: 통과 확인 + commit**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/HarnessStructurePanel.test.tsx
pnpm run typecheck
git add apps/desktop/src/renderer/components/HarnessStructurePanel.tsx apps/desktop/src/renderer/components/HarnessStructurePanel.test.tsx apps/desktop/src/renderer/app.css
git commit -m "feat(desktop): harness structure panel — pipeline map doubles as agent settings"
```

### Task 8: WikiGenDashboard 조립 + MainPanel 연결

**Files:**
- Create: `apps/desktop/src/renderer/components/WikiGenDashboard.tsx`
- Test: `apps/desktop/src/renderer/components/WikiGenDashboard.test.tsx`
- Modify: `apps/desktop/src/renderer/components/MainPanel.tsx` (wikigen → WikiGenDashboard)
- Modify: `apps/desktop/src/renderer/components/MainPanel.test.tsx` (placeholder 테스트 교체)
- Modify: `apps/desktop/src/renderer/app.css`

레이아웃: `[실행 이력 레일 | run 상세 | (열렸을 때) 구조 패널]`. run 상세 = 실행 중이면 WikiProgress+라이브 로그, 아니면 검수 서브탭(요약|Coverage|Quality|Proposals|Flow) + Promote 영역. hero 헤더 없음.

- [ ] **Step 1: 실패하는 테스트 작성** — `WikiGenDashboard.test.tsx`. store를 통째로 mock하지 말고 **zustand store를 직접 시드**한다(기존 `harness-store.test.tsx`와 같은 방식 — 파일을 먼저 읽고 api mock 셋업을 재사용):

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useStore } from '../store.js'
import type { HarnessRunBundle } from '../harness-utils.js'
import { WikiGenDashboard } from './WikiGenDashboard.js'

vi.mock('../api.js', () => ({ api: new Proxy({}, { get: () => vi.fn(async () => ({ ok: true })) }) }))

function reviewRun(): HarnessRunBundle {
  return {
    runState: {
      runId: 'RUN-r', state: 'HUMAN_REVIEW_REQUIRED', engine: 'claude', projectId: 'p1',
      history: [{ state: 'CREATED', at: '2026-06-12T01:00:00Z' }],
    } as unknown as HarnessRunBundle['runState'],
    artifacts: [
      { state: 'VALIDATED', name: 'eval-report', path: '/runs/RUN-r/eval.json', data: { scores: [] } },
    ],
    mode: 'full-docs',
  }
}

describe('WikiGenDashboard', () => {
  beforeEach(() => {
    useStore.setState({
      selectedProjectId: 'p1', harnessRuns: [reviewRun()], selectedHarnessRunId: 'RUN-r',
      harnessLoading: false, harnessProgress: null, harnessCanonicalProposals: [],
    })
  })

  test('renders 실행 이력 rail and review subtabs', () => {
    render(<WikiGenDashboard profiles={[]} />)
    expect(screen.getByText('실행 이력')).toBeDefined()
    for (const label of ['요약', 'Coverage', 'Quality', 'Proposals', 'Flow']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined()
    }
  })

  test('settings panel is hidden until ⚙ 버튼 click', () => {
    render(<WikiGenDashboard profiles={[]} />)
    expect(screen.queryByText(/하니스 구조/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /에이전트 설정/ }))
    expect(screen.getByText(/하니스 구조/)).toBeDefined()
  })

  test('shows progress view instead of subtabs while running', () => {
    useStore.setState({ harnessLoading: true, harnessProgress: 'NODE_PROPOSALS_CREATED' })
    render(<WikiGenDashboard profiles={[]} />)
    expect(screen.queryByRole('button', { name: 'Coverage' })).toBeNull()
  })

  test('promote button appears for HUMAN_REVIEW_REQUIRED run with canonical proposals', () => {
    useStore.setState({
      harnessCanonicalProposals: [{ proposalRelPath: 'staging/a.md', canonicalPath: 'wiki/a.md', currentHash: null }],
    })
    render(<WikiGenDashboard profiles={[]} />)
    expect(screen.getByRole('button', { name: /Promote/ })).toBeDefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/WikiGenDashboard.test.tsx
```

Expected: FAIL — 모듈 없음.

- [ ] **Step 3: WikiGenDashboard.tsx 구현** — HarnessDashboard에서 생성·검수 부분을 가져와 재조립:

```tsx
import { useEffect, useMemo, useState } from 'react'
import type { AgentProfile, KhCoverageReport, KhEvalReport, KhNodeProposal } from '@apc/shared'
import { useStore } from '../store.js'
import { createDefaultHarnessConfig, runModeLabel, type HarnessRunBundle } from '../harness-utils.js'
import { HarnessRunList } from './HarnessRunList.js'
import { HarnessStructurePanel } from './HarnessStructurePanel.js'
import { WikiProgress } from './WikiProgress.js'
import { CoverageMatrix } from './CoverageMatrix.js'
import { QualityPanel } from './QualityPanel.js'
import { ProposalsPanel } from './ProposalsPanel.js'
import { TaskFlowView } from './TaskFlowView.js'

type Props = { profiles: AgentProfile[] }

type ReviewTab = 'summary' | 'coverage' | 'quality' | 'proposals' | 'flow'

export function WikiGenDashboard({ profiles: _profiles }: Props) {
  const {
    selectedProjectId, harnessRuns, selectedHarnessRunId, harnessLoading, harnessMessage,
    harnessProgress, harnessLiveLabel, harnessLiveTail, harnessConfigs,
    harnessCanonicalProposals, harnessPromoteBlockedReason, harnessCanonicalBlock,
    hydrateHarnessProject, selectHarnessRun, startHarnessRun, refreshHarnessRun, resumeHarnessRun,
    promoteHarnessRun, promoteCanonicalDoc, updateHarnessModel, updateHarnessSafety, toggleHarnessGate, updateHarnessPrompt,
  } = useStore()

  const [reviewTab, setReviewTab] = useState<ReviewTab>('summary')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [runsCollapsed, setRunsCollapsed] = useState(() => {
    try { return localStorage.getItem('apc:runsCollapsed') === '1' } catch { return false }
  })
  const toggleRuns = () => setRunsCollapsed((prev) => {
    const next = !prev
    try { localStorage.setItem('apc:runsCollapsed', next ? '1' : '0') } catch { /* ignore */ }
    return next
  })

  useEffect(() => {
    if (selectedProjectId) hydrateHarnessProject(selectedProjectId)
  }, [hydrateHarnessProject, selectedProjectId])

  const currentRun: HarnessRunBundle | null = useMemo(
    () => harnessRuns.find((b) => b.runState.runId === selectedHarnessRunId) ?? harnessRuns[0] ?? null,
    [harnessRuns, selectedHarnessRunId],
  )
  const config = selectedProjectId ? harnessConfigs[selectedProjectId] ?? createDefaultHarnessConfig() : createDefaultHarnessConfig()
  const coverageData = currentRun?.artifacts.find((a) => a.name === 'coverage-report')?.data as KhCoverageReport | undefined
  const evalData = currentRun?.artifacts.find((a) => a.name === 'eval-report')?.data as KhEvalReport | undefined
  const proposalsData = (currentRun?.artifacts.find((a) => a.name === 'node-proposals')?.data as { proposals?: KhNodeProposal[] } | undefined)?.proposals
  const canPromote = currentRun?.runState.state === 'HUMAN_REVIEW_REQUIRED'

  const REVIEW_TABS: { id: ReviewTab; label: string }[] = [
    { id: 'summary', label: '요약' }, { id: 'coverage', label: 'Coverage' }, { id: 'quality', label: 'Quality' },
    { id: 'proposals', label: 'Proposals' }, { id: 'flow', label: 'Flow' },
  ]

  return (
    <section className="wikigen">
      <div className={`wikigen__grid${runsCollapsed ? ' wikigen__grid--runs-collapsed' : ''}${settingsOpen ? ' wikigen__grid--settings' : ''}`}>
        <HarnessRunList
          runs={harnessRuns}
          selectedRunId={selectedHarnessRunId}
          loading={harnessLoading}
          collapsed={runsCollapsed}
          onToggleCollapse={toggleRuns}
          onSelectRun={(runId) => selectHarnessRun(runId)}
          onRefresh={() => void refreshHarnessRun()}
          onStartRun={(materialize) => void startHarnessRun(materialize)}
          onResumeRun={(runId) => void resumeHarnessRun(runId)}
        />

        <main className="wikigen__main panel">
          <header className="panel__header wikigen__header">
            <div>
              <h2>{currentRun ? currentRun.runState.runId : 'Wiki Gen'}</h2>
              <p>
                {currentRun ? `${runModeLabel(currentRun.mode) || currentRun.runState.engine} · ${currentRun.runState.state.replace(/_/g, ' ')}` : 'run을 시작하세요'}
                {harnessMessage ? ` — ${harnessMessage}` : ''}
              </p>
            </div>
            <button type="button" onClick={() => setSettingsOpen((v) => !v)}>⚙ 에이전트 설정</button>
          </header>

          {harnessLoading ? (
            <WikiProgress state={harnessProgress} liveLabel={harnessLiveLabel} liveTail={harnessLiveTail} />
          ) : !currentRun ? (
            <div className="wikigen__placeholder">아직 run이 없습니다 — ▶ 위키 생성으로 시작하세요.</div>
          ) : (
            <>
              <nav className="wikigen__subtabs">
                {REVIEW_TABS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={reviewTab === id ? 'wikigen__subtab wikigen__subtab--active' : 'wikigen__subtab'}
                    onClick={() => setReviewTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </nav>

              <div className="wikigen__content">
                {reviewTab === 'summary' && (
                  <div className="wikigen__summary">
                    {currentRun.runState.state === 'FAILED' && (
                      <p className="wikigen__error">❌ 실패: {currentRun.runState.error ?? '원인 미상'} — 실행 이력에서 ↻ 이어하기</p>
                    )}
                    <p>
                      아티팩트 {currentRun.artifacts.length}개
                      {coverageData ? ` · 커버리지 리포트 있음` : ''}
                      {evalData ? ` · 품질 리포트 있음` : ''}
                      {proposalsData ? ` · 노드 제안 ${proposalsData.length}개` : ''}
                    </p>
                    <p className="wikigen__hint">생성된 위키 문서는 📖 Knowledge 탭에서 읽습니다.</p>
                  </div>
                )}
                {reviewTab === 'coverage' && (coverageData
                  ? <CoverageMatrix data={coverageData} onOpenSource={(p) => window.alert(p)} />
                  : <div className="wikigen__placeholder">커버리지 데이터 없음 — 전체 문서 모드로 실행하세요.</div>)}
                {reviewTab === 'quality' && (evalData
                  ? <QualityPanel data={evalData} />
                  : <div className="wikigen__placeholder">품질 데이터 없음.</div>)}
                {reviewTab === 'proposals' && (proposalsData
                  ? <ProposalsPanel proposals={proposalsData} />
                  : <div className="wikigen__placeholder">노드 제안 없음.</div>)}
                {reviewTab === 'flow' && <TaskFlowView run={currentRun} />}
              </div>

              <div className="wikigen__promote">
                <div className="wikigen__promote-run">
                  <button
                    type="button"
                    disabled={harnessLoading || !canPromote}
                    title={canPromote ? 'staging 결과를 vault로 반영' : '리뷰 대기(HUMAN_REVIEW_REQUIRED) 상태에서만 promote할 수 있습니다'}
                    onClick={() => void promoteHarnessRun()}
                  >
                    Promote run
                  </button>
                  {harnessPromoteBlockedReason && (
                    <button type="button" className="wikigen__force" title={harnessPromoteBlockedReason} onClick={() => void promoteHarnessRun(undefined, true)}>
                      ⚠ 검증 무시
                    </button>
                  )}
                </div>
                {harnessCanonicalProposals.length > 0 && (
                  <ul className="wikigen__canonical">
                    {harnessCanonicalProposals.map((p) => {
                      const blocked = harnessCanonicalBlock?.proposalRelPath === p.proposalRelPath
                      return (
                        <li key={p.proposalRelPath}>
                          <span>📄 {p.canonicalPath}{p.currentHash === null ? ' (new)' : ''}</span>
                          {blocked ? (
                            <button type="button" className="wikigen__force" disabled={harnessLoading} title={harnessCanonicalBlock?.reason}
                              onClick={() => void promoteCanonicalDoc(p.proposalRelPath, p.currentHash ?? '', true)}>
                              ⚠ 검증 무시하고 promote
                            </button>
                          ) : (
                            <button type="button" disabled={harnessLoading || !canPromote}
                              onClick={() => void promoteCanonicalDoc(p.proposalRelPath, p.currentHash ?? '')}>
                              Promote
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </main>

        {settingsOpen && (
          <HarnessStructurePanel
            config={config}
            activeState={harnessProgress}
            onModelChange={updateHarnessModel}
            onSafetyChange={updateHarnessSafety}
            onToggleGate={toggleHarnessGate}
            onPromptChange={updateHarnessPrompt}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: MainPanel wikigen 분기 교체 + 테스트 갱신**

MainPanel.tsx: `import { WikiGenDashboard } from './WikiGenDashboard.js'` 추가, placeholder 줄을:

```tsx
{tab === 'wikigen' && <WikiGenDashboard profiles={profiles} />}
```

MainPanel.test.tsx: `vi.mock('./WikiGenDashboard.js', () => ({ WikiGenDashboard: () => <div>WIKIGEN-STUB</div> }))` 추가, placeholder 테스트를:

```tsx
test('wikigen tab renders WikiGenDashboard', () => {
  render(<MainPanel tab="wikigen" onTab={vi.fn()} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
  expect(screen.getByText('WIKIGEN-STUB')).toBeDefined()
})
```

- [ ] **Step 5: CSS 추가** — `app.css` 끝에:

```css
/* wiki gen tab */
.wikigen { height: 100%; min-height: 0; display: flex; flex-direction: column; }
.wikigen__grid {
  flex: 1; min-height: 0; display: grid; gap: 10px;
  grid-template-columns: 300px minmax(0, 1fr);
}
.wikigen__grid--runs-collapsed { grid-template-columns: 52px minmax(0, 1fr); }
.wikigen__grid--settings { grid-template-columns: 300px minmax(0, 1fr) 340px; }
.wikigen__grid--runs-collapsed.wikigen__grid--settings { grid-template-columns: 52px minmax(0, 1fr) 340px; }
.wikigen__main { display: flex; flex-direction: column; min-height: 0; }
.wikigen__header { display: flex; justify-content: space-between; align-items: center; }
.wikigen__subtabs { display: flex; gap: 2px; padding: 6px 12px 0; border-bottom: 1px solid #2c2f38; flex: 0 0 auto; }
.wikigen__subtab { padding: 5px 12px; font-size: 0.8rem; border: none; background: transparent; color: #8a8f9a; border-radius: 5px 5px 0 0; cursor: pointer; }
.wikigen__subtab--active { background: #2e3340; color: #fff; }
.wikigen__content { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px; }
.wikigen__summary { font-size: 0.85rem; color: #c5c9d3; display: flex; flex-direction: column; gap: 6px; }
.wikigen__hint { color: #777; font-size: 0.78rem; }
.wikigen__error { color: #f87171; }
.wikigen__placeholder { display: flex; align-items: center; justify-content: center; min-height: 120px; color: #666; font-size: 0.85rem; }
.wikigen__promote { border-top: 1px solid #2c2f38; padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; flex: 0 0 auto; }
.wikigen__promote-run { display: flex; gap: 8px; }
.wikigen__canonical { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 0.8rem; }
.wikigen__canonical li { display: flex; align-items: center; gap: 10px; }
.wikigen__canonical li span { color: #c5c9d3; }
.wikigen__canonical li button { margin-left: auto; }
.wikigen__force { background: #4a3a1a; border: 1px solid #8a6a2a; color: #fd6; border-radius: 4px; }
```

- [ ] **Step 6: 통과 확인 + 전체 테스트 + commit**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/WikiGenDashboard.test.tsx
pnpm --filter @apc/desktop exec vitest run
pnpm run typecheck
git add apps/desktop/src/renderer/components/WikiGenDashboard.tsx apps/desktop/src/renderer/components/WikiGenDashboard.test.tsx apps/desktop/src/renderer/components/MainPanel.tsx apps/desktop/src/renderer/components/MainPanel.test.tsx apps/desktop/src/renderer/app.css
git commit -m "feat(desktop): Wiki Gen tab — run rail, review subtabs, promote area, settings slide-over"
```

---

# Phase 3 — Knowledge 탭 (읽기 전용 문서/그래프)

### Task 9: main — project-files.ts (fs:readDoc / fs:listDocs 코어)

**Files:**
- Create: `apps/desktop/src/main/project-files.ts`
- Test: `apps/desktop/src/main/project-files.test.ts`

경로 검증이 보안 경계다: `realpath(root)` prefix 밖이면 무조건 거부(traversal 차단), md/mdx/txt만, 512KB 상한.

- [ ] **Step 1: 실패하는 테스트 작성** — `project-files.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listProjectDocs, readProjectDoc } from './project-files.js'

describe('project-files', () => {
  let root: string
  let outside: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'apc-files-'))
    outside = mkdtempSync(join(tmpdir(), 'apc-outside-'))
    mkdirSync(join(root, 'docs'))
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(root, 'docs', 'plan.md'), '# plan')
    writeFileSync(join(root, 'README.md'), '# readme')
    writeFileSync(join(root, 'node_modules', 'pkg', 'x.md'), 'should not list')
    writeFileSync(join(root, 'app.ts'), 'code')
    writeFileSync(join(outside, 'secret.md'), 'secret')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  test('readProjectDoc reads a doc inside the first matching root', () => {
    const res = readProjectDoc([root], 'docs/plan.md')
    expect(res).toEqual({ ok: true, content: '# plan' })
  })

  test('rejects path traversal out of the root', () => {
    const res = readProjectDoc([root], `../${outside.split('/').pop()}/secret.md`)
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/허용되지 않는 경로|outside/i)
  })

  test('rejects absolute paths outside the roots', () => {
    const res = readProjectDoc([root], join(outside, 'secret.md'))
    expect(res.ok).toBe(false)
  })

  test('rejects symlink escaping the root', () => {
    try { symlinkSync(join(outside, 'secret.md'), join(root, 'link.md')) } catch { return /* symlink 권한 없으면 skip */ }
    const res = readProjectDoc([root], 'link.md')
    expect(res.ok).toBe(false)
  })

  test('rejects non-text extensions and oversized files', () => {
    expect(readProjectDoc([root], 'app.ts').ok).toBe(false)
    writeFileSync(join(root, 'big.md'), 'x'.repeat(513 * 1024))
    const res = readProjectDoc([root], 'big.md')
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/크기|size/i)
  })

  test('missing file returns ok:false (not throw)', () => {
    expect(readProjectDoc([root], 'docs/nope.md').ok).toBe(false)
  })

  test('listProjectDocs lists md files excluding node_modules/.git', () => {
    const docs = listProjectDocs([root])
    const paths = docs.map((d) => d.relPath).sort()
    expect(paths).toEqual(['README.md', 'docs/plan.md'])
    expect(docs[0].mtimeMs).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/main/project-files.test.ts
```

Expected: FAIL — 모듈 없음.

- [ ] **Step 3: project-files.ts 구현**

```ts
import { readdirSync, realpathSync, statSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const MAX_DOC_BYTES = 512 * 1024
const TEXT_EXT = /\.(md|mdx|txt)$/i
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.harness-runs'])
const LIST_LIMIT = 2_000
const DEPTH_LIMIT = 12

export type ReadDocResult = { ok: true; content: string } | { ok: false; reason: string }
export type ProjectDocEntry = { relPath: string; mtimeMs: number }

/** root의 realpath 내부로 확정된 절대 경로를 돌려주거나 null. 심링크 탈출도 realpath로 잡는다. */
function containedPath(root: string, relPath: string): string | null {
  let realRoot: string
  try { realRoot = realpathSync(root) } catch { return null }
  const candidate = isAbsolute(relPath) ? relPath : resolve(realRoot, relPath)
  let real: string
  try { real = realpathSync(candidate) } catch { return null }
  if (real !== realRoot && !real.startsWith(realRoot + sep)) return null
  return real
}

export function readProjectDoc(roots: readonly string[], relPath: string): ReadDocResult {
  if (!TEXT_EXT.test(relPath)) return { ok: false, reason: 'md/mdx/txt만 열 수 있습니다' }
  for (const root of roots) {
    const real = containedPath(root, relPath)
    if (!real) continue
    let st: import('node:fs').Stats
    try { st = statSync(real) } catch { continue }
    if (!st.isFile()) continue
    if (st.size > MAX_DOC_BYTES) return { ok: false, reason: `파일 크기 초과 (${Math.round(st.size / 1024)}KB > 512KB)` }
    try { return { ok: true, content: readFileSync(real, 'utf8') } } catch (e) { return { ok: false, reason: String(e) } }
  }
  return { ok: false, reason: '허용되지 않는 경로이거나 파일이 없습니다' }
}

export function listProjectDocs(roots: readonly string[]): ProjectDocEntry[] {
  const docs: ProjectDocEntry[] = []
  const visit = (dir: string, base: string, depth: number): void => {
    if (docs.length >= LIST_LIMIT || depth > DEPTH_LIMIT) return
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) visit(full, base, depth + 1)
        continue
      }
      if (!entry.isFile() || !TEXT_EXT.test(entry.name)) continue
      let st: import('node:fs').Stats
      try { st = statSync(full) } catch { continue }
      docs.push({ relPath: relative(base, full).split(sep).join('/'), mtimeMs: st.mtimeMs })
      if (docs.length >= LIST_LIMIT) return
    }
  }
  for (const root of roots) visit(root, root, 0)
  return docs.sort((a, b) => a.relPath.localeCompare(b.relPath))
}
```

주의: `listProjectDocs`는 `.md`/`.mdx`만이 아니라 `.txt`도 잡는다 — 트리에서 노이즈가 되면 KnowledgeView 쪽에서 거른다(테스트는 md만 만들었으므로 영향 없음). 숨김 디렉터리(`.`로 시작)는 통째로 건너뛴다 — `.superpowers`, `.claude` 등.

- [ ] **Step 4: 통과 확인 + commit**

```bash
pnpm --filter @apc/desktop exec vitest run src/main/project-files.test.ts
git add apps/desktop/src/main/project-files.ts apps/desktop/src/main/project-files.test.ts
git commit -m "feat(desktop): project-files — root-contained doc read/list for the renderer"
```

### Task 10: fs:readDoc / fs:listDocs IPC 배선

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts`
- Modify: `apps/desktop/src/main/container.ts` (vaultRoot 노출)
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/renderer/api.ts`
- Test: `apps/desktop/src/main/ipc.test.ts` (기존 파일에 추가)

- [ ] **Step 1: 실패하는 테스트 추가** — `ipc.test.ts`의 describe 안에 추가 (beforeEach가 `vaultDir`에 컨테이너를 만든다; 프로젝트 p1의 repoPaths는 `/work/apc`라서 실재하지 않음 — vault 쪽 루트로 검증한다):

```ts
test('q:fsReadDoc reads a doc under the project vault dir and rejects traversal', async () => {
  const h = handlers(container)
  const projDir = join(vaultDir, 'projects', 'p1')
  mkdirSync(projDir, { recursive: true })
  writeFileSync(join(projDir, 'current.md'), '# now')

  const ok = await h[CH.fsReadDoc]({ projectId: 'p1', relPath: 'current.md' })
  expect(ok).toEqual({ ok: true, content: '# now' })

  const bad = await h[CH.fsReadDoc]({ projectId: 'p1', relPath: '../../etc/passwd.md' })
  expect((bad as { ok: boolean }).ok).toBe(false)
})

test('q:fsListDocs lists docs from existing repo roots', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'apc-repo-'))
  writeFileSync(join(repo, 'notes.md'), 'n')
  container.registry.update({ ...container.registry.get('p1')!, repoPaths: [repo] })
  const h = handlers(container)
  const res = await h[CH.fsListDocs]({ projectId: 'p1' }) as { docs: { relPath: string }[] }
  expect(res.docs.map((d) => d.relPath)).toContain('notes.md')
  rmSync(repo, { recursive: true, force: true })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/main/ipc.test.ts
```

Expected: FAIL — `CH.fsReadDoc` 없음.

- [ ] **Step 3: ipc-contract.ts에 채널·타입 추가** — `CH`에:

```ts
  // read-only project file access (Knowledge/Home tabs)
  fsReadDoc: 'q:fsReadDoc',
  fsListDocs: 'q:fsListDocs',
```

타입 (파일 끝에):

```ts
export type FsReadDocReq = { projectId: string; relPath: string }
export type FsReadDocRes = { ok: boolean; content?: string; reason?: string }
export type FsListDocsReq = { projectId: string }
export type FsListDocsRes = { docs: { relPath: string; mtimeMs: number }[] }
```

- [ ] **Step 4: container.ts — vaultRoot 노출** — `Container` 타입에 `vaultRoot: string` 추가, return 객체에 `vaultRoot: opts.vaultRoot` 추가.

- [ ] **Step 5: ipc.ts 핸들러 추가** — import에 `import { listProjectDocs, readProjectDoc } from './project-files.js'`와 `import { join } from 'node:path'` 추가, handlers 객체에:

```ts
[CH.fsReadDoc]: async (payload: unknown) => {
  const req = z.object({ projectId: z.string(), relPath: z.string() }).strict().parse(payload)
  const project = container.registry.get(req.projectId)
  if (!project) return { ok: false, reason: 'project not found' }
  // vault의 프로젝트 영역(current.md 등) → repo들 → 등록된 vaultPaths 순으로 해석
  const roots = [join(container.vaultRoot, 'projects', project.id), ...project.repoPaths, ...project.vaultPaths]
  return readProjectDoc(roots, req.relPath)
},

[CH.fsListDocs]: async (payload: unknown) => {
  const req = z.object({ projectId: z.string() }).strict().parse(payload)
  const project = container.registry.get(req.projectId)
  if (!project) return { docs: [] }
  return { docs: listProjectDocs(project.repoPaths) }
},
```

- [ ] **Step 6: api.ts에 추가** — import 타입에 `FsReadDocReq, FsReadDocRes, FsListDocsReq, FsListDocsRes` 추가, api 객체에:

```ts
fsReadDoc(req: FsReadDocReq): Promise<FsReadDocRes> {
  return window.apc.invoke(CH.fsReadDoc, req) as Promise<FsReadDocRes>
},
fsListDocs(req: FsListDocsReq): Promise<FsListDocsRes> {
  return window.apc.invoke(CH.fsListDocs, req) as Promise<FsListDocsRes>
},
```

(preload는 generic `invoke`라 수정 불필요.)

- [ ] **Step 7: 통과 확인 + commit**

```bash
pnpm --filter @apc/desktop exec vitest run src/main/ipc.test.ts
pnpm run typecheck
git add apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/container.ts apps/desktop/src/main/ipc.ts apps/desktop/src/renderer/api.ts apps/desktop/src/main/ipc.test.ts
git commit -m "feat(desktop): fs:readDoc / fs:listDocs IPC — root-contained renderer file access"
```

### Task 11: MarkdownContent 추출 (md 문자열 렌더러)

**Files:**
- Create: `apps/desktop/src/renderer/components/MarkdownContent.tsx`
- Modify: `apps/desktop/src/renderer/components/MarkdownViewer.tsx`
- Test: `apps/desktop/src/renderer/components/MarkdownContent.test.tsx`

`MarkdownViewer.tsx`의 `parseBlocks` / `tokenizeInline` / `renderCode` / `renderBlocks`(1~200행 부근)를 **그대로 잘라** 새 파일로 옮기고, 얇은 컴포넌트를 export한다. MarkdownViewer는 그걸 import해 쓴다(동작 불변). 이렇게 해야 KnowledgeView/HomeView가 "아티팩트"가 아닌 **임의 md 문자열**을 렌더할 수 있다.

- [ ] **Step 1: 실패하는 테스트 작성** — `MarkdownContent.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { MarkdownContent } from './MarkdownContent.js'

describe('MarkdownContent', () => {
  test('renders headings, lists and code from a markdown string', () => {
    render(<MarkdownContent markdown={'# Title\n\n- one\n- two\n\n```ts\nconst x = 1\n```'} onOpenWikiLink={vi.fn()} />)
    expect(screen.getByText('Title')).toBeDefined()
    expect(screen.getByText('one')).toBeDefined()
  })

  test('wiki links fire onOpenWikiLink with the target', () => {
    const onOpen = vi.fn()
    render(<MarkdownContent markdown={'see [[아키텍처|arch]]'} onOpenWikiLink={onOpen} />)
    fireEvent.click(screen.getByText('arch'))
    expect(onOpen).toHaveBeenCalledWith('아키텍처')
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/MarkdownContent.test.tsx
```

- [ ] **Step 3: 추출 실행** — `MarkdownContent.tsx` = MarkdownViewer의 `Block` 타입 + `parseBlocks` + `tokenizeInline` + `renderCode` + `renderBlocks` 함수를 **문자 그대로 이동**시키고(수정 금지), 끝에 추가:

```tsx
export function MarkdownContent({ markdown, onOpenWikiLink }: { markdown: string; onOpenWikiLink: (target: string) => void }) {
  const blocks = useMemo(() => parseBlocks(markdown), [markdown])
  return <>{renderBlocks(blocks, onOpenWikiLink)}</>
}
```

(import도 함께 이동: `import { type ReactNode, createElement, useMemo } from 'react'`.)

`MarkdownViewer.tsx`는 이동한 함수들을 지우고 `import { MarkdownContent } from './MarkdownContent.js'` 후 본문 렌더를:

```tsx
<div className="markdown-viewer__body">
  {markdown ? <MarkdownContent markdown={markdown} onOpenWikiLink={onOpenWikiLink} /> : <div className="panel__empty"><p>Select an artifact to render.</p></div>}
</div>
```

단, footer의 `extractWikiLinks(markdown)` 사용은 그대로(harness-utils에서 오므로 영향 없음).

- [ ] **Step 4: 통과 확인 + 회귀 확인 + commit**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/MarkdownContent.test.tsx
pnpm --filter @apc/desktop exec vitest run
pnpm run typecheck
git add apps/desktop/src/renderer/components/MarkdownContent.tsx apps/desktop/src/renderer/components/MarkdownContent.test.tsx apps/desktop/src/renderer/components/MarkdownViewer.tsx
git commit -m "refactor(desktop): extract MarkdownContent — render arbitrary md strings"
```

### Task 12: pickNodeArtifact 추출 (그래프 노드 → 아티팩트 해석)

**Files:**
- Modify: `apps/desktop/src/renderer/harness-utils.ts`
- Modify: `apps/desktop/src/renderer/components/HarnessDashboard.tsx` (추출한 함수 사용)
- Test: `apps/desktop/src/renderer/harness-utils.test.ts` (추가)

`HarnessDashboard.tsx`의 `handleNodeClick` 내부 매칭 로직(직전 핸드오프에서 견고화한 것)과 모듈 상단의 `artifactMatchesTarget`을 harness-utils로 옮겨 KnowledgeView가 재사용할 수 있게 한다.

- [ ] **Step 1: 실패하는 테스트 추가** — `harness-utils.test.ts`에:

```ts
import { pickNodeArtifact } from './harness-utils.js'
import type { HarnessRunArtifact } from './harness-utils.js'

describe('pickNodeArtifact', () => {
  const arts: HarnessRunArtifact[] = [
    { state: 'STAGING_WRITTEN', name: 'wiki-architecture', path: '/runs/R1/staging/wiki/architecture.md', data: { markdown: '# arch' } },
    { state: 'VALIDATED', name: 'git-diff-report', path: '/runs/R1/git-diff.json', data: { patch: '' } },
  ]

  test('matches by exact node data.path', () => {
    const hit = pickNodeArtifact(arts, { id: 'file:x', data: { path: '/runs/R1/staging/wiki/architecture.md' } })
    expect(hit?.name).toBe('wiki-architecture')
  })

  test('matches by basename when paths differ', () => {
    const hit = pickNodeArtifact(arts, { id: 'doc:y', data: { path: 'vault/wiki/architecture.md' } })
    expect(hit?.name).toBe('wiki-architecture')
  })

  test('matches by label/file-stem', () => {
    const hit = pickNodeArtifact(arts, { id: 'document:architecture', label: 'architecture' })
    expect(hit?.name).toBe('wiki-architecture')
  })

  test('returns undefined when nothing matches', () => {
    expect(pickNodeArtifact(arts, { id: 'document:unknown', label: '없는문서' })).toBeUndefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/harness-utils.test.ts
```

- [ ] **Step 3: harness-utils.ts에 이동** — HarnessDashboard의 로직을 함수로 일반화해 추가 (viewable 우선 → 전체 폴백 포함):

```ts
export type GraphNodeRef = { id: string; label?: string; data?: unknown }

function artifactMatchesTarget(artifact: HarnessRunArtifact, target: string): boolean {
  const normalized = target.trim().toLowerCase()
  return artifact.path.toLowerCase().includes(normalized)
    || artifact.name.toLowerCase() === normalized
    || artifact.path.toLowerCase().endsWith(`/${normalized}`)
}

/** 그래프 노드를 run 아티팩트로 해석: data.path 정확일치 → endsWith → basename → id-target → label/stem.
 *  viewable(markdown/report) 아티팩트를 우선하고, 없으면 전체에서 찾는다. 못 찾으면 undefined —
 *  호출측은 fs:readDoc 폴백을 시도한다. */
export function pickNodeArtifact(arts: HarnessRunArtifact[], node: GraphNodeRef): HarnessRunArtifact | undefined {
  const viewable = arts.filter((a) => isMarkdownArtifact(a) || a.name === 'git-diff-report' || a.name === 'eval-report' || a.name === 'final-policy-report')
  const nodePath = (node.data as { path?: string } | undefined)?.path
  const base = (p: string) => p.split(/[\\/]/).pop() ?? p
  const idTarget = node.id.replace(/^(artifact|file|task|evidence|run|document):/, '')
  const label = (node.label ?? '').toLowerCase()
  const pick = (pool: HarnessRunArtifact[]): HarnessRunArtifact | undefined => {
    if (nodePath) {
      const np = nodePath.toLowerCase()
      const hit = pool.find((a) => a.path === nodePath)
        ?? pool.find((a) => a.path.toLowerCase().endsWith(np) || a.path.toLowerCase().endsWith(`/${np}`))
        ?? pool.find((a) => base(a.path).toLowerCase() === base(nodePath).toLowerCase())
      if (hit) return hit
    }
    return pool.find((a) => artifactMatchesTarget(a, idTarget))
      ?? (label ? pool.find((a) => artifactLabel(a.name).toLowerCase() === label || base(a.path).replace(/\.md$/i, '').toLowerCase() === label) : undefined)
  }
  return pick(viewable) ?? pick(arts)
}
```

주의: 기존 HarnessDashboard의 id 프리픽스 정규식에 `document:`가 없었다 — 그래프 노드 타입에 `document`가 있으므로 **여기서 추가**한다(테스트 3번째 케이스가 이를 검증).

- [ ] **Step 4: HarnessDashboard.handleNodeClick을 추출 함수 사용으로 교체** (P5에서 삭제될 파일이지만 그동안 동작 유지):

```tsx
const handleNodeClick = (node: { id: string; label?: string; data?: unknown }) => {
  if (!currentRun) return
  const candidate = pickNodeArtifact(currentRun.artifacts, node)
  if (candidate) { setSelectedArtifactPath(candidate.path); setTab('markdown') }
}
```

(모듈 상단의 로컬 `artifactMatchesTarget`/기존 매칭 코드는 삭제, import에 `pickNodeArtifact` 추가. `handleOpenWikiLink`도 로컬 `artifactMatchesTarget`을 쓰고 있으면 `pickNodeArtifact(currentRun.artifacts, { id: `document:${target}`, label: target })`로 교체.)

- [ ] **Step 5: 통과 확인 + commit**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/harness-utils.test.ts
pnpm --filter @apc/desktop exec vitest run
pnpm run typecheck
git add apps/desktop/src/renderer/harness-utils.ts apps/desktop/src/renderer/harness-utils.test.ts apps/desktop/src/renderer/components/HarnessDashboard.tsx
git commit -m "refactor(desktop): extract pickNodeArtifact with document: prefix support"
```

### Task 13: KnowledgeView — [문서|그래프] + peek + 디스크 폴백

**Files:**
- Create: `apps/desktop/src/renderer/components/KnowledgeView.tsx`
- Test: `apps/desktop/src/renderer/components/KnowledgeView.test.tsx`
- Modify: `apps/desktop/src/renderer/components/MainPanel.tsx` (knowledge → KnowledgeView)
- Modify: `apps/desktop/src/renderer/components/MainPanel.test.tsx`
- Modify: `apps/desktop/src/renderer/app.css`

"최신 위키" run = `harnessRuns` 중 첫 번째로 `MERGED`/`HUMAN_REVIEW_REQUIRED`/`VALIDATED`인 것(이미 최신순 정렬), 없으면 `harnessRuns[0]`.

- [ ] **Step 1: 실패하는 테스트 작성** — `KnowledgeView.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useStore } from '../store.js'
import type { HarnessRunBundle } from '../harness-utils.js'
import { KnowledgeView } from './KnowledgeView.js'

const fsReadDoc = vi.fn(async () => ({ ok: true, content: '# from disk' }))
const fsListDocs = vi.fn(async () => ({ docs: [{ relPath: 'docs/plan.md', mtimeMs: 1 }] }))
vi.mock('../api.js', () => ({
  api: new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'fsReadDoc') return (...a: unknown[]) => fsReadDoc(...a as [])
      if (prop === 'fsListDocs') return (...a: unknown[]) => fsListDocs(...a as [])
      return vi.fn(async () => ({ ok: true }))
    },
  }),
}))

vi.mock('./GraphVisualization.js', () => ({
  GraphVisualization: ({ onNodeClick }: { onNodeClick: (n: { id: string; label?: string; data?: unknown }) => void }) => (
    <button onClick={() => onNodeClick({ id: 'document:plan', label: 'plan', data: { path: 'docs/plan.md' } })}>GRAPH-STUB</button>
  ),
}))

function wikiRun(): HarnessRunBundle {
  return {
    runState: {
      runId: 'RUN-w', state: 'MERGED', engine: 'claude', projectId: 'p1',
      history: [{ state: 'CREATED', at: '2026-06-12T01:00:00Z' }],
    } as unknown as HarnessRunBundle['runState'],
    artifacts: [
      { state: 'STAGING_WRITTEN', name: 'wiki-overview', path: '/runs/RUN-w/wiki/overview.md', data: { markdown: '# 개요 본문' } },
    ],
  }
}

describe('KnowledgeView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.setState({ selectedProjectId: 'p1', harnessRuns: [wikiRun()], selectedHarnessRunId: 'RUN-w' })
  })

  test('문서 mode: tree shows wiki artifacts and project docs', async () => {
    render(<KnowledgeView />)
    expect(await screen.findByText(/overview/)).toBeDefined()
    expect(await screen.findByText('docs/plan.md')).toBeDefined()
  })

  test('clicking a project doc loads it via fs:readDoc', async () => {
    render(<KnowledgeView />)
    fireEvent.click(await screen.findByText('docs/plan.md'))
    await waitFor(() => expect(fsReadDoc).toHaveBeenCalledWith({ projectId: 'p1', relPath: 'docs/plan.md' }))
    expect(await screen.findByText('from disk')).toBeDefined()
  })

  test('그래프 mode: node click opens peek with disk fallback when no artifact matches', async () => {
    render(<KnowledgeView />)
    fireEvent.click(screen.getByRole('button', { name: '그래프' }))
    fireEvent.click(screen.getByText('GRAPH-STUB'))
    expect(await screen.findByText('from disk')).toBeDefined()  // peek 패널 내용
    expect(screen.getByRole('button', { name: /문서로 열기/ })).toBeDefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/KnowledgeView.test.tsx
```

- [ ] **Step 3: KnowledgeView.tsx 구현**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { useStore } from '../store.js'
import {
  artifactLabel, artifactToMarkdown, buildHarnessGraphData, isMarkdownArtifact, pickNodeArtifact,
  type GraphNodeRef, type HarnessRunBundle,
} from '../harness-utils.js'
import { GraphVisualization } from './GraphVisualization.js'
import { MarkdownContent } from './MarkdownContent.js'

type Mode = 'docs' | 'graph'
/** 트리/뷰어가 가리키는 문서: run 아티팩트이거나 디스크의 md. */
type DocRef = { kind: 'artifact'; path: string } | { kind: 'file'; relPath: string }

function latestWikiRun(runs: HarnessRunBundle[]): HarnessRunBundle | null {
  return runs.find((r) => ['MERGED', 'HUMAN_REVIEW_REQUIRED', 'VALIDATED'].includes(r.runState.state)) ?? runs[0] ?? null
}

export function KnowledgeView() {
  const { selectedProjectId, harnessRuns } = useStore()
  const [mode, setMode] = useState<Mode>('docs')
  const [selectedDoc, setSelectedDoc] = useState<DocRef | null>(null)
  const [fileContent, setFileContent] = useState<{ relPath: string; content: string } | { relPath: string; error: string } | null>(null)
  const [projectDocs, setProjectDocs] = useState<{ relPath: string; mtimeMs: number }[]>([])
  const [peek, setPeek] = useState<{ title: string; markdown?: string; error?: string } | null>(null)

  const run = useMemo(() => latestWikiRun(harnessRuns), [harnessRuns])
  const wikiArtifacts = useMemo(() => (run?.artifacts ?? []).filter(isMarkdownArtifact), [run])
  const graphData = useMemo(() => buildHarnessGraphData(run), [run])

  useEffect(() => {
    if (!selectedProjectId) return
    let stale = false
    void api.fsListDocs({ projectId: selectedProjectId }).then((res) => {
      if (!stale) setProjectDocs(res.docs.filter((d) => /\.mdx?$/i.test(d.relPath)))
    })
    return () => { stale = true }
  }, [selectedProjectId])

  // 디스크 문서 로드 (선택이 file일 때)
  useEffect(() => {
    if (!selectedProjectId || selectedDoc?.kind !== 'file') return
    const relPath = selectedDoc.relPath
    let stale = false
    void api.fsReadDoc({ projectId: selectedProjectId, relPath }).then((res) => {
      if (stale) return
      setFileContent(res.ok && res.content !== undefined ? { relPath, content: res.content } : { relPath, error: res.reason ?? '읽기 실패' })
    })
    return () => { stale = true }
  }, [selectedProjectId, selectedDoc])

  const selectedArtifact = selectedDoc?.kind === 'artifact'
    ? wikiArtifacts.find((a) => a.path === selectedDoc.path) ?? null
    : null
  const viewerMarkdown = selectedArtifact
    ? artifactToMarkdown(selectedArtifact)
    : (fileContent && 'content' in fileContent ? fileContent.content : null)
  const viewerTitle = selectedArtifact
    ? artifactLabel(selectedArtifact.name)
    : selectedDoc?.kind === 'file' ? selectedDoc.relPath : wikiArtifacts[0] ? artifactLabel(wikiArtifacts[0].name) : '문서를 선택하세요'
  const fallbackMarkdown = !selectedDoc && wikiArtifacts[0] ? artifactToMarkdown(wikiArtifacts[0]) : null

  const openWikiLink = (target: string) => {
    const hit = run ? pickNodeArtifact(run.artifacts, { id: `document:${target}`, label: target }) : undefined
    if (hit) setSelectedDoc({ kind: 'artifact', path: hit.path })
  }

  const handleNodeClick = (node: GraphNodeRef) => {
    const title = node.label ?? node.id
    const hit = run ? pickNodeArtifact(run.artifacts, node) : undefined
    if (hit && (isMarkdownArtifact(hit) || hit.name === 'git-diff-report' || hit.name === 'eval-report' || hit.name === 'final-policy-report')) {
      setPeek({ title, markdown: artifactToMarkdown(hit) })
      return
    }
    const nodePath = (node.data as { path?: string } | undefined)?.path
    if (nodePath && selectedProjectId && /\.(md|mdx|txt)$/i.test(nodePath)) {
      void api.fsReadDoc({ projectId: selectedProjectId, relPath: nodePath }).then((res) => {
        setPeek(res.ok && res.content !== undefined ? { title, markdown: res.content } : { title, error: `원문 없음: ${nodePath} (${res.reason ?? ''})` })
      })
      return
    }
    setPeek({ title, error: nodePath ? `원문 없음: ${nodePath}` : '연결된 문서가 없는 노드입니다' })
  }

  return (
    <section className="knowledge">
      <div className="knowledge__modebar">
        <div className="knowledge__seg" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'docs'} className={mode === 'docs' ? 'knowledge__seg-btn knowledge__seg-btn--on' : 'knowledge__seg-btn'} onClick={() => setMode('docs')}>문서</button>
          <button type="button" role="tab" aria-selected={mode === 'graph'} className={mode === 'graph' ? 'knowledge__seg-btn knowledge__seg-btn--on' : 'knowledge__seg-btn'} onClick={() => setMode('graph')}>그래프</button>
        </div>
      </div>

      {mode === 'docs' ? (
        <div className="knowledge__docs">
          <aside className="knowledge__tree panel">
            <div className="knowledge__tree-group">위키 (생성됨)</div>
            {wikiArtifacts.length === 0 && <div className="knowledge__tree-empty">아직 위키 없음 — ⚙ Wiki Gen에서 생성</div>}
            {wikiArtifacts.map((a) => (
              <button key={a.path} type="button"
                className={selectedDoc?.kind === 'artifact' && selectedDoc.path === a.path ? 'knowledge__tree-item knowledge__tree-item--on' : 'knowledge__tree-item'}
                onClick={() => setSelectedDoc({ kind: 'artifact', path: a.path })}>
                {artifactLabel(a.name)}
              </button>
            ))}
            <div className="knowledge__tree-group">프로젝트 문서</div>
            {projectDocs.map((d) => (
              <button key={d.relPath} type="button"
                className={selectedDoc?.kind === 'file' && selectedDoc.relPath === d.relPath ? 'knowledge__tree-item knowledge__tree-item--on' : 'knowledge__tree-item'}
                onClick={() => setSelectedDoc({ kind: 'file', relPath: d.relPath })}>
                {d.relPath}
              </button>
            ))}
          </aside>
          <main className="knowledge__viewer panel">
            <header className="panel__header"><h2>{viewerTitle}</h2></header>
            <div className="knowledge__viewer-body">
              {viewerMarkdown ?? fallbackMarkdown
                ? <MarkdownContent markdown={(viewerMarkdown ?? fallbackMarkdown)!} onOpenWikiLink={openWikiLink} />
                : fileContent && 'error' in fileContent
                  ? <div className="knowledge__error">⚠ {fileContent.error}</div>
                  : <div className="knowledge__empty">왼쪽에서 문서를 선택하세요.</div>}
            </div>
          </main>
        </div>
      ) : (
        <div className={peek ? 'knowledge__graph knowledge__graph--peek' : 'knowledge__graph'}>
          <div className="knowledge__graph-canvas panel">
            <GraphVisualization data={graphData} onNodeClick={handleNodeClick} />
          </div>
          {peek && (
            <aside className="knowledge__peek panel">
              <header className="panel__header knowledge__peek-header">
                <h2>{peek.title}</h2>
                <div>
                  {peek.markdown && (
                    <button type="button" onClick={() => {
                      // 문서 모드로 점프: 아티팩트면 그걸, 아니면 내용 그대로 보여줄 파일 선택
                      const hit = run ? pickNodeArtifact(run.artifacts, { id: `document:${peek.title}`, label: peek.title }) : undefined
                      setMode('docs')
                      if (hit) setSelectedDoc({ kind: 'artifact', path: hit.path })
                      setPeek(null)
                    }}>문서로 열기 ↗</button>
                  )}
                  <button type="button" onClick={() => setPeek(null)} aria-label="미리보기 닫기">✕</button>
                </div>
              </header>
              <div className="knowledge__peek-body">
                {peek.markdown
                  ? <MarkdownContent markdown={peek.markdown} onOpenWikiLink={openWikiLink} />
                  : <div className="knowledge__error">⚠ {peek.error}</div>}
              </div>
            </aside>
          )}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: MainPanel 연결** — knowledge 분기를 `<KnowledgeView />`로 교체하고 `HarnessDashboard` import를 유지한 채 wikigen만 WikiGenDashboard… 가 아니라 — 이 시점에 **HarnessDashboard는 MainPanel에서 완전히 빠진다**:

```tsx
{tab === 'knowledge' && <KnowledgeView />}
```

MainPanel.test.tsx: HarnessDashboard mock 제거, `vi.mock('./KnowledgeView.js', () => ({ KnowledgeView: () => <div>KNOWLEDGE-STUB</div> }))` 추가, knowledge 테스트의 기대 텍스트를 `KNOWLEDGE-STUB`으로.

- [ ] **Step 5: CSS 추가** — `app.css` 끝에:

```css
/* knowledge tab */
.knowledge { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.knowledge__modebar { flex: 0 0 auto; }
.knowledge__seg { display: inline-flex; border: 1px solid #3a3f4a; border-radius: 6px; overflow: hidden; }
.knowledge__seg-btn { padding: 5px 16px; font-size: 0.8rem; background: #1c1f26; color: #8a8f9a; border: none; cursor: pointer; }
.knowledge__seg-btn--on { background: #2e3340; color: #fff; }
.knowledge__docs { flex: 1; min-height: 0; display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 10px; }
.knowledge__tree { overflow-y: auto; padding: 8px 6px; display: flex; flex-direction: column; gap: 1px; }
.knowledge__tree-group { padding: 8px 10px 3px; color: #8a8f9a; font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.5px; }
.knowledge__tree-item { text-align: left; background: transparent; border: none; color: #c5c9d3; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; }
.knowledge__tree-item:hover { background: #20232b; }
.knowledge__tree-item--on { background: #232a36; color: #fff; }
.knowledge__tree-empty { padding: 4px 10px; color: #666; font-size: 0.74rem; }
.knowledge__viewer { display: flex; flex-direction: column; min-height: 0; }
.knowledge__viewer-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px; }
.knowledge__empty, .knowledge__error { color: #666; font-size: 0.85rem; padding: 16px; }
.knowledge__error { color: #f0a; color: #e8a0a0; }
.knowledge__graph { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.knowledge__graph--peek { grid-template-columns: minmax(0, 1.8fr) minmax(280px, 1fr); }
.knowledge__graph-canvas { min-height: 0; overflow: hidden; }
.knowledge__peek { display: flex; flex-direction: column; min-height: 0; border-left: 1px solid #2c2f38; }
.knowledge__peek-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.knowledge__peek-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 14px; }
```

- [ ] **Step 6: 통과 확인 + commit**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/KnowledgeView.test.tsx
pnpm --filter @apc/desktop exec vitest run
pnpm run typecheck
git add apps/desktop/src/renderer/components/KnowledgeView.tsx apps/desktop/src/renderer/components/KnowledgeView.test.tsx apps/desktop/src/renderer/components/MainPanel.tsx apps/desktop/src/renderer/components/MainPanel.test.tsx apps/desktop/src/renderer/app.css
git commit -m "feat(desktop): Knowledge tab — docs/graph modes, node peek with disk fallback"
```

---

# Phase 4 — Home 탭 (current.md + git 변경분)

### Task 14: main — project-changes.ts (git 변경분 코어)

**Files:**
- Create: `apps/desktop/src/main/project-changes.ts`
- Test: `apps/desktop/src/main/project-changes.test.ts`

git 실행은 `execFileSync('git', …)`. 파싱(`parsePorcelain`)과 미반영 계산(`markUnreflected`)은 순수 함수로 분리해 git 없이 테스트한다. 통합 케이스는 임시 git repo로 1개만.

- [ ] **Step 1: 실패하는 테스트 작성** — `project-changes.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listProjectChanges, markUnreflected, parsePorcelain } from './project-changes.js'

describe('parsePorcelain', () => {
  test('maps porcelain v1 statuses', () => {
    const out = [
      '?? docs/new.md',
      ' M src/store.ts',
      'M  staged.ts',
      ' D gone.md',
      'R  old.md -> renamed.md',
    ].join('\n')
    expect(parsePorcelain(out)).toEqual([
      { path: 'docs/new.md', status: 'new' },
      { path: 'src/store.ts', status: 'modified' },
      { path: 'staged.ts', status: 'modified' },
      { path: 'gone.md', status: 'deleted' },
      { path: 'renamed.md', status: 'new' },
    ])
  })

  test('handles quoted paths with spaces', () => {
    expect(parsePorcelain('?? "my doc.md"')).toEqual([{ path: 'my doc.md', status: 'new' }])
  })

  test('empty output → empty list', () => {
    expect(parsePorcelain('')).toEqual([])
  })
})

describe('markUnreflected', () => {
  const files = [
    { path: 'a.md', status: 'new' as const, isMarkdown: true, mtimeMs: 2_000_000 },
    { path: 'b.ts', status: 'modified' as const, isMarkdown: false, mtimeMs: 2_000_000 },
    { path: 'c.md', status: 'modified' as const, isMarkdown: true, mtimeMs: 500 },
  ]

  test('md newer than last ingest → unreflected; code never flagged', () => {
    // sqlite datetime('now') 포맷("YYYY-MM-DD HH:MM:SS", UTC)을 그대로 받는다
    const res = markUnreflected(files, '1970-01-01 00:00:01')
    expect(res.find((f) => f.path === 'a.md')?.unreflected).toBe(true)
    expect(res.find((f) => f.path === 'b.ts')?.unreflected).toBe(false)
    expect(res.find((f) => f.path === 'c.md')?.unreflected).toBe(false)
  })

  test('no ingest history → every md unreflected', () => {
    const res = markUnreflected(files, null)
    expect(res.find((f) => f.path === 'a.md')?.unreflected).toBe(true)
    expect(res.find((f) => f.path === 'c.md')?.unreflected).toBe(true)
  })
})

describe('listProjectChanges (integration, real git)', () => {
  test('non-git directory → ok:false with reason', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-nongit-'))
    const res = listProjectChanges([dir], null)
    expect(res.ok).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('lists untracked md with mtime in a real repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-git-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(join(dir, 'note.md'), '# n')
    utimesSync(join(dir, 'note.md'), new Date(), new Date())
    const res = listProjectChanges([dir], null)
    expect(res.ok).toBe(true)
    const f = res.files?.find((x) => x.path === 'note.md')
    expect(f?.status).toBe('new')
    expect(f?.isMarkdown).toBe(true)
    expect(f?.unreflected).toBe(true)
    expect(f?.mtimeMs).toBeGreaterThan(0)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/main/project-changes.test.ts
```

- [ ] **Step 3: project-changes.ts 구현**

```ts
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'

export type ChangeStatus = 'new' | 'modified' | 'deleted'
export type ChangedFile = { path: string; status: ChangeStatus; isMarkdown: boolean; mtimeMs: number; unreflected?: boolean }
export type ChangesResult = { ok: boolean; files?: ChangedFile[]; reason?: string }
export type DiffResult = { ok: boolean; patch?: string; reason?: string }

function unquote(p: string): string {
  return p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p
}

/** `git status --porcelain=v1` 출력 파싱. 렌네임은 새 경로를 new로 취급. */
export function parsePorcelain(stdout: string): { path: string; status: ChangeStatus }[] {
  const rows: { path: string; status: ChangeStatus }[] = []
  for (const line of stdout.split('\n')) {
    if (line.length < 4) continue
    const xy = line.slice(0, 2)
    let rest = line.slice(3)
    let status: ChangeStatus
    if (xy === '??' || xy.includes('A')) status = 'new'
    else if (xy.includes('D')) status = 'deleted'
    else status = 'modified'
    if (xy.includes('R') || xy.includes('C')) {
      const arrow = rest.indexOf(' -> ')
      if (arrow >= 0) rest = rest.slice(arrow + 4)
      status = 'new' // 렌네임/복사의 새 경로를 새 파일로 취급
    }
    rows.push({ path: unquote(rest), status })
  }
  return rows
}

/** sqlite `datetime('now')`는 "YYYY-MM-DD HH:MM:SS"(UTC, 타임존 표기 없음) — 그대로 Date.parse하면
 *  로컬 시간으로 읽혀 어긋난다. 'T'+'Z'를 붙여 UTC로 고정 파싱한다. */
function parseSqliteUtc(at: string): number {
  return Date.parse(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`)
}

export function markUnreflected<T extends { isMarkdown: boolean; mtimeMs: number }>(
  files: T[],
  latestIngestAt: string | null,
): (T & { unreflected: boolean })[] {
  const cutoff = latestIngestAt ? parseSqliteUtc(latestIngestAt) : null
  return files.map((f) => ({ ...f, unreflected: f.isMarkdown && (cutoff === null || f.mtimeMs > cutoff) }))
}

export function listProjectChanges(repoPaths: readonly string[], latestIngestAt: string | null): ChangesResult {
  if (repoPaths.length === 0) return { ok: false, reason: '등록된 repo 경로가 없습니다' }
  const all: ChangedFile[] = []
  for (const repo of repoPaths) {
    let stdout: string
    try {
      stdout = execFileSync('git', ['status', '--porcelain=v1'], { cwd: repo, encoding: 'utf8', timeout: 15_000 })
    } catch (e) {
      return { ok: false, reason: `git 실패 (${repo}): ${(e as { stderr?: string }).stderr?.toString().trim() || String(e)}` }
    }
    for (const row of parsePorcelain(stdout)) {
      let mtimeMs = 0
      try { mtimeMs = statSync(join(repo, row.path)).mtimeMs } catch { /* 삭제된 파일 등 */ }
      all.push({ ...row, isMarkdown: /\.mdx?$/i.test(row.path), mtimeMs })
    }
  }
  return { ok: true, files: markUnreflected(all, latestIngestAt) }
}

export function diffProjectFile(repoPaths: readonly string[], relPath: string): DiffResult {
  for (const repo of repoPaths) {
    try { statSync(join(repo, relPath)) } catch { continue }
    // tracked 변경: HEAD 대비. untracked: --no-index로 /dev/null과 비교(차이가 있으면 exit 1 — 정상).
    try {
      const tracked = execFileSync('git', ['diff', 'HEAD', '--', relPath], { cwd: repo, encoding: 'utf8', timeout: 15_000 })
      if (tracked.trim()) return { ok: true, patch: tracked }
    } catch { /* HEAD 없음(빈 repo) 등 — untracked 경로로 폴백 */ }
    try {
      execFileSync('git', ['diff', '--no-index', '--', '/dev/null', relPath], { cwd: repo, encoding: 'utf8', timeout: 15_000 })
      return { ok: true, patch: '' }  // exit 0 = 차이 없음(빈 파일)
    } catch (e) {
      const out = (e as { stdout?: string | Buffer }).stdout?.toString()
      if (out) return { ok: true, patch: out }  // exit 1 + stdout = 정상 diff
      return { ok: false, reason: String(e) }
    }
  }
  return { ok: false, reason: `파일을 찾을 수 없음: ${relPath}` }
}
```

- [ ] **Step 4: 통과 확인 + commit**

```bash
pnpm --filter @apc/desktop exec vitest run src/main/project-changes.test.ts
git add apps/desktop/src/main/project-changes.ts apps/desktop/src/main/project-changes.test.ts
git commit -m "feat(desktop): project-changes — git status feed with unreflected-md marking"
```

### Task 15: changes:list / changes:diff IPC 배선

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/renderer/api.ts`
- Test: `apps/desktop/src/main/ipc.test.ts` (추가)

- [ ] **Step 1: 실패하는 테스트 추가** — `ipc.test.ts`에:

```ts
test('q:changesList returns ok:false for a project whose repo is not a git dir', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'apc-nongit2-'))
  container.registry.update({ ...container.registry.get('p1')!, repoPaths: [dir] })
  const h = handlers(container)
  const res = await h[CH.changesList]({ projectId: 'p1' }) as { ok: boolean }
  expect(res.ok).toBe(false)
  rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/main/ipc.test.ts
```

- [ ] **Step 3: ipc-contract.ts 추가** — `CH`에:

```ts
  changesList: 'q:changesList',
  changesDiff: 'q:changesDiff',
```

타입:

```ts
export type ChangesListReq = { projectId: string }
export type ChangesListRes = {
  ok: boolean
  reason?: string
  files?: { path: string; status: 'new' | 'modified' | 'deleted'; isMarkdown: boolean; mtimeMs: number; unreflected?: boolean }[]
}
export type ChangesDiffReq = { projectId: string; relPath: string }
export type ChangesDiffRes = { ok: boolean; patch?: string; reason?: string }
```

- [ ] **Step 4: ipc.ts 핸들러 추가** — import에 `import { diffProjectFile, listProjectChanges } from './project-changes.js'` 추가:

```ts
[CH.changesList]: async (payload: unknown) => {
  const req = z.object({ projectId: z.string() }).strict().parse(payload)
  const project = container.registry.get(req.projectId)
  if (!project) return { ok: false, reason: 'project not found' }
  const row = container.db.prepare('SELECT MAX(updated_at) AS at FROM ingest_cursors').get() as { at: string | null } | undefined
  return listProjectChanges(project.repoPaths, row?.at ?? null)
},

[CH.changesDiff]: async (payload: unknown) => {
  const req = z.object({ projectId: z.string(), relPath: z.string() }).strict().parse(payload)
  const project = container.registry.get(req.projectId)
  if (!project) return { ok: false, reason: 'project not found' }
  return diffProjectFile(project.repoPaths, req.relPath)
},
```

- [ ] **Step 5: api.ts 추가**:

```ts
changesList(req: ChangesListReq): Promise<ChangesListRes> {
  return window.apc.invoke(CH.changesList, req) as Promise<ChangesListRes>
},
changesDiff(req: ChangesDiffReq): Promise<ChangesDiffRes> {
  return window.apc.invoke(CH.changesDiff, req) as Promise<ChangesDiffRes>
},
```

- [ ] **Step 6: 통과 확인 + commit**

```bash
pnpm --filter @apc/desktop exec vitest run src/main/ipc.test.ts
pnpm run typecheck
git add apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/ipc.ts apps/desktop/src/renderer/api.ts apps/desktop/src/main/ipc.test.ts
git commit -m "feat(desktop): changes:list / changes:diff IPC"
```

### Task 16: GeneratePreflightModal 추출

**Files:**
- Create: `apps/desktop/src/renderer/components/GeneratePreflightModal.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` (모달 JSX·관련 state 제거)
- Test: `apps/desktop/src/renderer/components/GeneratePreflightModal.test.tsx`

App.tsx의 `generateModalOpen && (…)` JSX 블록과 그 보조 상태/함수(`selectedGenerateEngine`, `selectedCategoryIds`, `promoteMsg`, `handlePromote`, `closeGenerateModal`, `toggleGenerateCategory`, `selectedGenerateCount`, `requiredGenerateCategoriesSelected`, `runGenerateFromPreflight`, preflight 카테고리 useEffect)를 **그대로 옮긴다**. 컴포넌트는 store에서 `preflighting/generatePreflight/generating/generation/selectedProjectId`와 액션을 직접 읽는다. props는 `{ open: boolean; onClose: () => void }` 둘뿐. 열기 트리거(`prepareGenerate()` 호출 + open=true)는 호출측 책임.

- [ ] **Step 1: 실패하는 테스트 작성** — `GeneratePreflightModal.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useStore } from '../store.js'
import { GeneratePreflightModal } from './GeneratePreflightModal.js'

vi.mock('../api.js', () => ({ api: new Proxy({}, { get: () => vi.fn(async () => ({ ok: true })) }) }))

describe('GeneratePreflightModal', () => {
  beforeEach(() => {
    useStore.setState({
      selectedProjectId: 'p1', preflighting: false, generating: false, generation: null,
      generatePreflight: {
        ok: true, projectId: 'p1', projectName: 'APC', totalCount: 3, status: 'scanned',
        categories: [{ id: 'agent-conversations', label: 'LLM CLI conversations', description: 'd', count: 3, selectedByDefault: true, required: true }],
      },
    })
  })

  test('renders nothing when closed', () => {
    render(<GeneratePreflightModal open={false} onClose={vi.fn()} />)
    expect(screen.queryByText('Generate preflight')).toBeNull()
  })

  test('open renders categories and Proceed', () => {
    render(<GeneratePreflightModal open onClose={vi.fn()} />)
    expect(screen.getByText('Generate preflight')).toBeDefined()
    expect(screen.getByText('LLM CLI conversations')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Proceed' })).toBeDefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/GeneratePreflightModal.test.tsx
```

- [ ] **Step 3: 추출 실행** — `GeneratePreflightModal.tsx` 골격(내부 JSX는 App.tsx의 기존 블록을 그대로 붙여넣기 — 변수명 동일):

```tsx
import { useEffect, useState } from 'react'
import type { AgentType } from '@apc/shared'
import type { GeneratePreflightCategoryId } from '../../shared/ipc-contract.js'
import { useStore } from '../store.js'
import { api } from '../api.js'

const AGENTS: AgentType[] = ['claude', 'opencode', 'codex']

export function GeneratePreflightModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    selectedProjectId, preflighting, generatePreflight, generating, generation,
    generate, clearGeneratePreflight, clearGeneration,
  } = useStore()
  const [selectedGenerateEngine, setSelectedGenerateEngine] = useState<AgentType>('claude')
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<GeneratePreflightCategoryId[]>([])
  const [promoteMsg, setPromoteMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!generatePreflight?.categories) return
    setSelectedCategoryIds(generatePreflight.categories.filter((c) => c.selectedByDefault).map((c) => c.id))
  }, [generatePreflight])

  if (!open) return null

  const closeModal = () => {
    if (generating) return
    setPromoteMsg(null)
    clearGeneratePreflight()
    clearGeneration()
    onClose()
  }

  const handlePromote = async () => { /* App.tsx의 handlePromote 본문 그대로 (selectedProjectId 사용) */ }
  const toggleGenerateCategory = (categoryId: GeneratePreflightCategoryId) => { /* App.tsx 본문 그대로 */ }
  const selectedGenerateCount = /* App.tsx 계산식 그대로 */ 0
  const requiredGenerateCategoriesSelected = /* App.tsx 계산식 그대로 */ false
  const runGenerateFromPreflight = () => { void generate(selectedGenerateEngine, selectedCategoryIds) }

  return (
    /* App.tsx의 <div className="add-project-overlay" onClick={closeGenerateModal}> … 블록 전체를
       여기로 이동 — closeGenerateModal → closeModal 로만 치환 */
    <div className="add-project-overlay" onClick={closeModal}>
      {/* …기존 JSX 그대로… */}
    </div>
  )
}
```

> 위 주석 표시(`본문 그대로`) 부분은 **App.tsx 372~499행의 기존 코드를 문자 그대로 이동**하라는 뜻이다. 새로 작성하지 말 것 — 동작 검증된 코드다.

App.tsx에서는: 모달 JSX 블록·보조 상태/함수·preflight useEffect 삭제, 대신 (임시 — Task 17에서 Home으로 이동):

```tsx
const [generateModalOpen, setGenerateModalOpen] = useState(false)
const openGeneratePreflight = () => { setGenerateModalOpen(true); clearGeneration(); void prepareGenerate() }
// JSX:
<GeneratePreflightModal open={generateModalOpen} onClose={() => setGenerateModalOpen(false)} />
```

- [ ] **Step 4: 통과 확인 + commit**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/GeneratePreflightModal.test.tsx
pnpm --filter @apc/desktop exec vitest run
pnpm run typecheck
git add apps/desktop/src/renderer/components/GeneratePreflightModal.tsx apps/desktop/src/renderer/components/GeneratePreflightModal.test.tsx apps/desktop/src/renderer/App.tsx
git commit -m "refactor(desktop): extract GeneratePreflightModal from App"
```

### Task 17: HomeView — 문서 뷰어 + 변경분 피드 + PM strip

**Files:**
- Create: `apps/desktop/src/renderer/components/HomeView.tsx`
- Test: `apps/desktop/src/renderer/components/HomeView.test.tsx`
- Modify: `apps/desktop/src/renderer/components/MainPanel.tsx` (home → HomeView)
- Modify: `apps/desktop/src/renderer/components/MainPanel.test.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` (임시 Ingest/Generate/모달을 toolbar에서 제거)
- Modify: `apps/desktop/src/renderer/app.css`

- [ ] **Step 1: 실패하는 테스트 작성** — `HomeView.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useStore } from '../store.js'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { HomeView } from './HomeView.js'

const fsReadDoc = vi.fn(async ({ relPath }: { relPath: string }) =>
  relPath === 'current.md' ? { ok: true, content: '# 현재 상태' } : { ok: true, content: '# 새 문서' })
const changesList = vi.fn(async () => ({
  ok: true,
  files: [
    { path: 'docs/new.md', status: 'new', isMarkdown: true, mtimeMs: 2, unreflected: true },
    { path: 'src/x.ts', status: 'modified', isMarkdown: false, mtimeMs: 2, unreflected: false },
  ],
}))
const changesDiff = vi.fn(async () => ({ ok: true, patch: 'diff --git a/src/x.ts b/src/x.ts\n+x' }))
vi.mock('../api.js', () => ({
  api: new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'fsReadDoc') return (...a: unknown[]) => fsReadDoc(...a as [never])
      if (prop === 'changesList') return (...a: unknown[]) => changesList(...a as [])
      if (prop === 'changesDiff') return (...a: unknown[]) => changesDiff(...a as [])
      return vi.fn(async () => ({ ok: true, sources: 0, sessions: 0, documents: 0 }))
    },
  }),
}))

const dashboard: ProjectDashboardRes = {
  project: { id: 'p1', name: 'APC', status: 'active', goal: 'ship MVP', projectType: 'git', repoPaths: ['/r'], vaultPaths: [], sourcePaths: [] },
  activeTasks: [], reviewQueue: [], recentRuns: [],
  allTasks: [{ id: 'T1', projectId: 'p1', title: 't', status: 'done', assigneeType: 'agent', priority: 'high', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [] }],
}

describe('HomeView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.setState({ selectedProjectId: 'p1', dashboard, ingesting: false })
  })

  test('loads current.md and the changes feed on mount', async () => {
    render(<HomeView dashboard={dashboard} />)
    expect(await screen.findByText('현재 상태')).toBeDefined()
    expect(await screen.findByText('docs/new.md')).toBeDefined()
    expect(screen.getByText(/미반영/)).toBeDefined()
  })

  test('clicking an unreflected md opens it with an Ingest now header button', async () => {
    render(<HomeView dashboard={dashboard} />)
    fireEvent.click(await screen.findByText('docs/new.md'))
    expect(await screen.findByText('새 문서')).toBeDefined()
    expect(screen.getAllByRole('button', { name: /Ingest now/ }).length).toBeGreaterThanOrEqual(2) // 피드 헤더 + 문서 헤더
    expect(screen.getByRole('button', { name: /current\.md/ })).toBeDefined() // ↩ 복귀
  })

  test('clicking a code file fetches its diff', async () => {
    render(<HomeView dashboard={dashboard} />)
    fireEvent.click(await screen.findByText('src/x.ts'))
    await waitFor(() => expect(changesDiff).toHaveBeenCalledWith({ projectId: 'p1', relPath: 'src/x.ts' }))
  })

  test('PM strip shows goal and expands details', async () => {
    render(<HomeView dashboard={dashboard} />)
    expect(screen.getByText(/ship MVP/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /자세히/ }))
    expect(screen.getByText('Task Board')).toBeDefined()
  })
})
```

- [ ] **Step 2: 실패 확인**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/HomeView.test.tsx
```

- [ ] **Step 3: HomeView.tsx 구현**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { api } from '../api.js'
import { useStore } from '../store.js'
import { MarkdownContent } from './MarkdownContent.js'
import { DiffViewer } from './DiffViewer.js'
import { PmHome } from './PmHome.js'
import { GeneratePreflightModal } from './GeneratePreflightModal.js'

type ChangedFile = { path: string; status: 'new' | 'modified' | 'deleted'; isMarkdown: boolean; mtimeMs: number; unreflected?: boolean }
type Viewer =
  | { kind: 'current'; content?: string; error?: string }
  | { kind: 'doc'; file: ChangedFile; content?: string; error?: string }
  | { kind: 'code'; file: ChangedFile; patch?: string | null; error?: string }
  | { kind: 'deleted'; file: ChangedFile }

function relTime(ms: number): string {
  if (!ms) return ''
  const d = Date.now() - ms
  if (d < 60_000) return '방금'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}분 전`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}시간 전`
  return `${Math.floor(d / 86_400_000)}일 전`
}

export function HomeView({ dashboard }: { dashboard: ProjectDashboardRes }) {
  const { selectedProjectId, ingesting, ingest, lastIngest, prepareGenerate, clearGeneration } = useStore()
  const [viewer, setViewer] = useState<Viewer>({ kind: 'current' })
  const [changes, setChanges] = useState<{ files?: ChangedFile[]; reason?: string } | null>(null)
  const [pmOpen, setPmOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)

  const loadCurrent = useCallback(() => {
    if (!selectedProjectId) return
    void api.fsReadDoc({ projectId: selectedProjectId, relPath: 'current.md' }).then((res) => {
      setViewer((v) => (v.kind === 'current' ? (res.ok ? { kind: 'current', content: res.content } : { kind: 'current', error: res.reason }) : v))
    })
  }, [selectedProjectId])

  const loadChanges = useCallback(() => {
    if (!selectedProjectId) return
    void api.changesList({ projectId: selectedProjectId }).then((res) => {
      setChanges(res.ok ? { files: res.files ?? [] } : { reason: res.reason ?? 'git 변경분을 가져올 수 없습니다' })
    })
  }, [selectedProjectId])

  useEffect(() => { loadCurrent(); loadChanges() }, [loadCurrent, loadChanges])

  const openFile = (file: ChangedFile) => {
    if (!selectedProjectId) return
    if (file.status === 'deleted') { setViewer({ kind: 'deleted', file }); return }
    if (file.isMarkdown) {
      setViewer({ kind: 'doc', file })
      void api.fsReadDoc({ projectId: selectedProjectId, relPath: file.path }).then((res) => {
        setViewer((v) => (v.kind === 'doc' && v.file.path === file.path
          ? (res.ok ? { kind: 'doc', file, content: res.content } : { kind: 'doc', file, error: res.reason })
          : v))
      })
      return
    }
    setViewer({ kind: 'code', file })
    void api.changesDiff({ projectId: selectedProjectId, relPath: file.path }).then((res) => {
      setViewer((v) => (v.kind === 'code' && v.file.path === file.path
        ? (res.ok ? { kind: 'code', file, patch: res.patch ?? '' } : { kind: 'code', file, error: res.reason })
        : v))
    })
  }

  const runIngest = async () => { await ingest(); loadChanges() }

  const groups = useMemo(() => {
    const files = changes?.files ?? []
    return {
      newDocs: files.filter((f) => f.isMarkdown && f.status === 'new'),
      modDocs: files.filter((f) => f.isMarkdown && f.status !== 'new'),
      code: files.filter((f) => !f.isMarkdown),
    }
  }, [changes])

  const doneCount = dashboard.allTasks.filter((t) => t.status === 'done').length

  const feedRow = (f: ChangedFile) => (
    <button key={f.path} type="button" className="home-feed__row" onClick={() => openFile(f)}>
      <span className={`home-feed__st home-feed__st--${f.status}`}>{f.status === 'new' ? '+' : f.status === 'deleted' ? '−' : '±'}</span>
      <span className="home-feed__path">{f.path}</span>
      {f.unreflected && <span className="home-feed__badge">미반영</span>}
      <span className="home-feed__when">{relTime(f.mtimeMs)}</span>
    </button>
  )

  return (
    <div className="home">
      <div className="home__panes">
        <main className="home-viewer panel">
          <header className="panel__header home-viewer__header">
            {viewer.kind === 'current' ? (
              <>
                <h2>current.md</h2>
                <button type="button" onClick={() => { setGenerateOpen(true); clearGeneration(); void prepareGenerate() }}>✨ 갱신 제안</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { setViewer({ kind: 'current' }); loadCurrent() }}>↩ current.md</button>
                <h2>{'file' in viewer ? viewer.file.path : ''}</h2>
                {'file' in viewer && viewer.file.unreflected && (
                  <button type="button" className="home-viewer__ingest" disabled={ingesting} onClick={() => void runIngest()}>
                    {ingesting ? 'Ingesting…' : 'Ingest now'}
                  </button>
                )}
              </>
            )}
          </header>
          <div className="home-viewer__body">
            {viewer.kind === 'current' && (viewer.content
              ? <MarkdownContent markdown={viewer.content} onOpenWikiLink={() => { /* current.md 내 위키링크는 Knowledge에서 */ }} />
              : <div className="home-viewer__empty">{viewer.error ? `current.md 없음 — ${viewer.error}` : '불러오는 중…'}<br />✨ 갱신 제안으로 첫 current.md를 만드세요.</div>)}
            {viewer.kind === 'doc' && (viewer.content
              ? <MarkdownContent markdown={viewer.content} onOpenWikiLink={() => { /* noop */ }} />
              : <div className="home-viewer__empty">{viewer.error ?? '불러오는 중…'}</div>)}
            {viewer.kind === 'code' && (viewer.error
              ? <div className="home-viewer__empty">⚠ {viewer.error}</div>
              : <DiffViewer patch={viewer.patch ?? null} />)}
            {viewer.kind === 'deleted' && <div className="home-viewer__empty">삭제된 파일입니다: {viewer.file.path}</div>}
          </div>
        </main>

        <aside className="home-feed panel">
          <header className="panel__header home-feed__header">
            <h2>변경분</h2>
            <span className="home-feed__meta">git · {changes?.files?.length ?? 0} files{lastIngest ? ` · ingested ${lastIngest.sessions} session(s)` : ''}</span>
            <button type="button" className="home-feed__ingest" disabled={ingesting} onClick={() => void runIngest()}>
              {ingesting ? 'Ingesting…' : 'Ingest now'}
            </button>
            <button type="button" onClick={loadChanges} aria-label="변경분 새로고침">⟳</button>
          </header>
          <div className="home-feed__list">
            {changes?.reason && <div className="home-feed__error">⚠ {changes.reason}</div>}
            {groups.newDocs.length > 0 && <div className="home-feed__group">새 문서 ({groups.newDocs.length})</div>}
            {groups.newDocs.map(feedRow)}
            {groups.modDocs.length > 0 && <div className="home-feed__group">수정된 문서 ({groups.modDocs.length})</div>}
            {groups.modDocs.map(feedRow)}
            {groups.code.length > 0 && <div className="home-feed__group">코드 ({groups.code.length})</div>}
            {groups.code.map(feedRow)}
            {changes && !changes.reason && (changes.files?.length ?? 0) === 0 && <div className="home-feed__empty">변경분 없음 — working tree clean</div>}
          </div>
        </aside>
      </div>

      <footer className="home-strip">
        <span>🎯 <b>{dashboard.project.goal ?? '(목표 없음)'}</b></span>
        <span className="home-strip__bar"><i style={{ width: `${dashboard.allTasks.length ? Math.round((doneCount / dashboard.allTasks.length) * 100) : 0}%` }} /></span>
        <span>{doneCount}/{dashboard.allTasks.length} tasks</span>
        <span>리뷰 대기 <b className="home-strip__warn">{dashboard.reviewQueue.length}</b></span>
        <button type="button" onClick={() => setPmOpen((v) => !v)}>{pmOpen ? '접기 ▴' : '자세히 ▾'}</button>
      </footer>
      {pmOpen && <div className="home-strip__detail"><PmHome dashboard={dashboard} /></div>}

      <GeneratePreflightModal open={generateOpen} onClose={() => setGenerateOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 4: MainPanel·App 연결**
- MainPanel: `{tab === 'home' && <HomeView dashboard={dashboard} />}` (PmHome 직접 렌더 제거, import 교체). MainPanel.test.tsx: HomeView를 mock하고 home 테스트 기대를 `HOME-STUB`으로.
- App.tsx: toolbarActions에서 Ingest/Generate 버튼·`app-layout__ingest-note`·`<GeneratePreflightModal …>`·`generateModalOpen`/`openGeneratePreflight` 제거 → 남는 것은 `🔎` + `<GlobalMenu …>` 뿐. 이제 안 쓰는 store 값(`ingesting, lastIngest, preflighting, generatePreflight, generating, generation, prepareGenerate, generate, clearGeneratePreflight, clearGeneration, ingest`)을 구조분해에서 제거(typecheck가 잡아준다).

- [ ] **Step 5: CSS 추가** — `app.css` 끝에:

```css
/* home tab */
.home { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.home__panes { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(280px, 1fr); gap: 10px; }
.home-viewer { display: flex; flex-direction: column; min-height: 0; }
.home-viewer__header { display: flex; align-items: center; gap: 10px; }
.home-viewer__header h2 { margin-right: auto; }
.home-viewer__ingest, .home-feed__ingest { background: #2a4a2a; border: 1px solid #4a8a4a; color: #cfc; border-radius: 5px; }
.home-viewer__body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px; }
.home-viewer__empty { color: #666; font-size: 0.85rem; padding: 16px; line-height: 1.8; }
.home-feed { display: flex; flex-direction: column; min-height: 0; }
.home-feed__header { display: flex; align-items: center; gap: 8px; }
.home-feed__header h2 { margin-right: 0; }
.home-feed__meta { color: #666; font-size: 0.72rem; margin-right: auto; }
.home-feed__list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 6px; display: flex; flex-direction: column; }
.home-feed__group { padding: 8px 8px 3px; color: #8a8f9a; font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.5px; }
.home-feed__row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border: none; background: transparent; color: #c5c9d3; border-radius: 4px; cursor: pointer; font-size: 0.8rem; text-align: left; }
.home-feed__row:hover { background: #20232b; }
.home-feed__st { width: 16px; text-align: center; font-weight: 700; }
.home-feed__st--new { color: #4ade80; } .home-feed__st--modified { color: #facc15; } .home-feed__st--deleted { color: #f87171; }
.home-feed__path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-feed__badge { font-size: 0.62rem; padding: 1px 6px; border-radius: 8px; background: #2a3a4a; color: #9cf; flex: 0 0 auto; }
.home-feed__when { margin-left: auto; color: #5a5f6a; font-size: 0.68rem; flex: 0 0 auto; }
.home-feed__error, .home-feed__empty { padding: 12px; color: #8a8f9a; font-size: 0.78rem; }
.home-strip { flex: 0 0 auto; display: flex; align-items: center; gap: 16px; padding: 7px 14px; background: #1c1f26; border: 1px solid #2c2f38; border-radius: 6px; font-size: 0.8rem; color: #aaa; }
.home-strip b { color: #ddd; }
.home-strip__bar { flex: 0 0 120px; height: 6px; background: #2a2e38; border-radius: 3px; overflow: hidden; }
.home-strip__bar i { display: block; height: 100%; background: #4a8a4a; }
.home-strip__warn { color: #facc15; }
.home-strip button { margin-left: auto; }
.home-strip__detail { flex: 0 0 auto; max-height: 45%; overflow-y: auto; }
```

- [ ] **Step 6: 통과 확인 + commit**

```bash
pnpm --filter @apc/desktop exec vitest run src/renderer/components/HomeView.test.tsx
pnpm --filter @apc/desktop exec vitest run
pnpm run typecheck
git add apps/desktop/src/renderer/components/HomeView.tsx apps/desktop/src/renderer/components/HomeView.test.tsx apps/desktop/src/renderer/components/MainPanel.tsx apps/desktop/src/renderer/components/MainPanel.test.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/app.css
git commit -m "feat(desktop): Home tab — current.md viewer, git changes feed, ingest-in-context, PM strip"
```

---

# Phase 5 — 구 컴포넌트 제거 + 최종 검증

### Task 18: HarnessDashboard / AgentConfigPanel / AgentConfigEditorPanel 제거

**Files:**
- Delete: `apps/desktop/src/renderer/components/HarnessDashboard.tsx`
- Delete: `apps/desktop/src/renderer/components/AgentConfigPanel.tsx`
- Delete: `apps/desktop/src/renderer/components/AgentConfigEditorPanel.tsx`, `AgentConfigEditorPanel.test.tsx`
- Maybe-Delete: `HarnessPanel.tsx`, `HarnessPanel.test.tsx`, `ModelPicker.tsx`, `ModelPicker.test.tsx` (사용처 확인 후)
- Modify: `apps/desktop/src/renderer/app.css` (죽은 클래스 제거)

- [ ] **Step 1: 사용처 0 확인** — 각 파일에 대해:

```bash
grep -rn "HarnessDashboard\|AgentConfigPanel\|AgentConfigEditorPanel\|HarnessPanel\|ModelPicker" apps/desktop/src --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | grep -v 'components/HarnessDashboard.tsx\|components/AgentConfigPanel.tsx\|components/AgentConfigEditorPanel.tsx\|components/HarnessPanel.tsx\|components/ModelPicker.tsx'
```

Expected: 출력 없음(= 외부 사용처 없음). **출력이 있으면 그 사용처를 먼저 정리**하고 다시 실행. `HarnessPanel`/`ModelPicker`는 P2~P4 작업과 무관하게 원래 사용 중일 수 있다 — 사용처가 있으면 **삭제하지 말 것**.

- [ ] **Step 2: 삭제 + 관련 테스트 삭제**

```bash
git rm apps/desktop/src/renderer/components/HarnessDashboard.tsx \
       apps/desktop/src/renderer/components/AgentConfigPanel.tsx \
       apps/desktop/src/renderer/components/AgentConfigEditorPanel.tsx \
       apps/desktop/src/renderer/components/AgentConfigEditorPanel.test.tsx
```

(HarnessPanel/ModelPicker는 Step 1 결과에 따라.) `harness-config-honesty.test.ts`·`config-diff-integration.test.ts` 등이 삭제 대상 컴포넌트를 import하면 — 테스트가 검증하는 대상이 **컴포넌트가 아니라 harness-utils 정책**이면 import만 교체, 컴포넌트 전용이면 해당 단언을 HarnessStructurePanel.test.tsx로 옮긴 뒤 삭제.

- [ ] **Step 3: 죽은 CSS 제거** — `app.css`에서 `harness-dashboard__hero`, `agent-config-panel`(접두 클래스 전부), `harness-dashboard__canonical`, `harness-dashboard__tabs` 등 grep으로 더 이상 참조되지 않는 클래스 블록 삭제:

```bash
for cls in harness-dashboard agent-config-panel; do grep -rn "$cls" apps/desktop/src --include='*.tsx' | head -3; done
```

참조 0인 접두만 삭제. `.panel`, `.harness-run-list__*` 등 공유 클래스는 유지.

- [ ] **Step 4: 전체 검증 + commit**

```bash
pnpm --filter @apc/desktop exec vitest run
pnpm run typecheck
git add -A apps/desktop/src/renderer
git commit -m "chore(desktop): remove HarnessDashboard/AgentConfig panels superseded by 3-tab UI"
```

### Task 19: 실물 Electron 검증 (CDP) + 핸드오프

**Files:**
- Create: `docs/handoffs/2026-06-12-ui-three-tab-restructure-impl.md` (검증 결과 기록)

- [ ] **Step 1: 앱 기동** — WSL에서 (네이티브 모듈이 linux/Electron용으로 리빌드되어 있어야 함 — 안 되어 있으면 메모리 `dev-env-node-pnpm.md`의 electron-rebuild 절차):

```bash
pnpm --filter @apc/desktop dev -- --remote-debugging-port=9222
```

- [ ] **Step 2: CDP 스크린샷으로 확인** (기존 검증 방식 — `node_modules/ws`로 `Page.captureScreenshot`). 체크리스트:
  1. 상단 탭 3개(Home/Knowledge/Wiki Gen) 표시, 탭 전환 동작, 재시작 후 탭 복원(localStorage).
  2. Home: current.md(또는 empty state) + 변경분 피드 그룹/미반영 배지, 새 md 클릭 → 뷰어 전환 + 헤더 Ingest now, 코드 클릭 → diff.
  3. Knowledge: 문서 트리(위키/프로젝트 문서) → 클릭 렌더, 그래프 모드 → 노드 클릭 → peek 표시(아티팩트 미스매치 노드에서 디스크 폴백 확인).
  4. Wiki Gen: ▶ 위키 생성 ▾ 드롭다운 2모드, 실행 중 진행 화면 + Wiki Gen 탭 배지, 실패 run 카드에 ↻ 이어하기, ⚙ 설정 → 구조도 표시·단계 클릭 편집.
  5. 터미널 독: 접기/펼치기, 접힌 상태 dot, Shift+2로 자동 펼침+포커스.
  6. 글로벌: 🔎 Ctrl+K, ⋯ 메뉴 → Update 다이얼로그.

- [ ] **Step 3: 발견된 문제 수정 + 핸드오프 작성** — 각 수정은 개별 커밋. 마지막으로 검증 체크리스트 결과·남은 이슈를 핸드오프 문서로:

```bash
git add docs/handoffs/2026-06-12-ui-three-tab-restructure-impl.md
git commit -m "docs: handoff — 3-tab UI restructure implementation + live verification"
```

---

## Self-Review 결과 반영 메모 (플랜 작성자 → 실행자)

- **스펙 §3 "미반영 배지 = ingest_cursors.updated_at 최댓값"**: Task 15에서 `SELECT MAX(updated_at)`으로 구현 — 프로젝트별이 아니라 전역 max다. ingest가 전역(`ingestAll`)이므로 현재 정확하다. 프로젝트별 ingest가 생기면 source_id 필터를 추가할 것.
- **스펙 §4 "최신 성공 run 자동 선택"**: KnowledgeView의 `latestWikiRun`이 담당. run 선택 UI는 Knowledge에 없음(스펙 일치).
- **스펙 §5 Refresh 버튼**: 실행 이력 헤더의 `⟳`로 유지(Task 6).
- **테스트 셋업 의존**: Task 5·8·13·16·17의 store 시드 방식은 기존 `harness-store.test.tsx`의 api mock 패턴을 따른다 — 구현 전에 그 파일을 반드시 읽을 것.
- **RunState 타입 캐스팅**: 테스트 픽스처의 `as unknown as HarnessRunBundle['runState']`는 RunState의 전체 필드를 모르기 때문 — 실제 타입이 더 요구하면 `@apc/shared`의 RunState 정의를 보고 픽스처를 보강할 것 (기존 HarnessPanel.test.tsx에 이미 픽스처가 있다면 그걸 복사하는 편이 낫다).
- **스펙 §4 "코드 파일 노드 → 경로 + 연결된 문서 목록"**: Task 13의 `handleNodeClick` 마지막 분기(`setPeek({ title, error: … })`)를 다음으로 확장해 구현할 것 — 그래프 링크에서 인접 문서 노드를 모아 peek에 나열:

  ```tsx
  const neighbors = graphData.links
    .filter((l) => l.source === node.id || l.target === node.id)
    .map((l) => (l.source === node.id ? l.target : l.source))
    .map((id) => graphData.nodes.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => !!n && n.type === 'document')
  setPeek({
    title,
    markdown: [
      `**경로**: \`${nodePath ?? '(없음)'}\``,
      '',
      neighbors.length ? '**연결된 문서**' : '_연결된 문서 없음_',
      ...neighbors.map((n) => `- [[${n.label}]]`),
    ].join('\n'),
  })
  ```

  (`[[…]]` 위키링크 클릭 → `openWikiLink`로 해당 문서가 열린다. `buildHarnessGraphData`의 link `source`/`target`이 문자열 id임을 전제 — d3 변환 후 객체일 수 있으니 `typeof l.source === 'string' ? l.source : (l.source as { id: string }).id`로 방어.)
- **스펙 §7과의 의도적 차이 1**: 스펙은 `fs:readDoc`을 "repoPath 내부"로 제한한다고 썼지만, Home의 current.md는 **vault의 프로젝트 영역**에 있다. Task 10은 허용 루트를 `[vault/projects/<id>, ...repoPaths, ...vaultPaths]`로 잡는다 — 여전히 읽기 전용·루트 격리이므로 스펙 의도(경로 탈출 차단)는 유지된다.
- **스펙 §9 테스트 4번(탭/독 persist·Shift 자동 펼침)**: App.tsx에는 기존에도 컴포넌트 테스트가 없어 단위 테스트를 추가하지 않았다. Task 19의 실물 CDP 검증 체크리스트 1·5번이 이를 커버한다.

