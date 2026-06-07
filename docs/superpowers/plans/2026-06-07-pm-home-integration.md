# PM Home Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `PmHome` into the desktop app as the default landing tab and fill its missing sections (current focus, lightweight timeline, read-only kanban) so PRD acceptance criterion #2 is met.

**Architecture:** Additive contract change — `getProjectDashboard` returns the already-computed full task list as `allTasks`; no new IPC channel, no DB migration. The renderer gains two new pure presentational components (`TimelineStrip`, `TaskBoard`), a rewritten composing `PmHome`, and a controlled `MainPanel` tab container that switches between `PmHome` and the existing `HarnessDashboard`.

**Tech Stack:** TypeScript, React, Zustand, Vitest + @testing-library/react (jsdom), Zod schemas in `@apc/shared`, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-06-07-pm-home-integration-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/dashboard-api/src/project-dashboard.ts` | Modify | Add `allTasks: Task[]` to type + return value |
| `packages/dashboard-api/src/project-dashboard.test.ts` | Modify | Assert `allTasks` returns every task |
| `apps/desktop/src/shared/ipc-contract.ts` | Modify | Add `allTasks: Task[]` to `ProjectDashboardRes` |
| `apps/desktop/src/renderer/components/TaskBoard.tsx` | Create | Read-only kanban grouping tasks by status |
| `apps/desktop/src/renderer/components/TaskBoard.test.tsx` | Create | Grouping + card fields + empty column |
| `apps/desktop/src/renderer/components/TimelineStrip.tsx` | Create | Lightweight date-derived timeline + axis helpers |
| `apps/desktop/src/renderer/components/TimelineStrip.test.tsx` | Create | Axis math, marker placement, empty state |
| `apps/desktop/src/renderer/components/PmHome.tsx` | Modify | Compose 5 sections |
| `apps/desktop/src/renderer/components/PmHome.test.tsx` | Modify | Render all 5 sections |
| `apps/desktop/src/renderer/components/MainPanel.tsx` | Create | Controlled tab bar: PM Home / Knowledge Harness |
| `apps/desktop/src/renderer/components/MainPanel.test.tsx` | Create | Tab switch + onTab callback |
| `apps/desktop/src/renderer/App.tsx` | Modify | Hold `mainTab` state, render `MainPanel` |
| `apps/desktop/src/renderer/app.css` | Modify | `.pm-home` / `.pm-board` / `.pm-timeline` styles |

**Verification commands (used throughout):**
- Package unit test: `pnpm --filter @apc/dashboard-api test`
- Desktop tests: `cd apps/desktop && npx vitest run`
- Repo typecheck: `pnpm typecheck`

---

## Task 1: Extend dashboard contract with `allTasks`

**Files:**
- Modify: `packages/dashboard-api/src/project-dashboard.ts`
- Modify: `packages/dashboard-api/src/project-dashboard.test.ts`
- Modify: `apps/desktop/src/shared/ipc-contract.ts:46`
- Modify: `apps/desktop/src/renderer/components/PmHome.test.tsx:5-10` (keep existing fixture compiling)

- [ ] **Step 1: Write the failing test**

In `packages/dashboard-api/src/project-dashboard.test.ts`, add inside the `describe('getProjectDashboard', …)` block (the `beforeEach` already creates T1=in_progress, T2=review, T3=done):

```ts
  test('allTasks includes every task regardless of status', () => {
    const dash = getProjectDashboard({ registry, tasks, runs }, 'p1')
    expect(dash.allTasks.map((t) => t.id).sort()).toEqual(['T1', 'T2', 'T3'])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apc/dashboard-api test`
Expected: FAIL — `dash.allTasks` is `undefined` (TS error or `Cannot read properties of undefined`).

- [ ] **Step 3: Add `allTasks` to the type and return value**

In `packages/dashboard-api/src/project-dashboard.ts`, update the type and the return:

```ts
export type ProjectDashboard = {
  project: Project; activeTasks: Task[]; reviewQueue: Task[]; recentRuns: AgentRun[]; allTasks: Task[]
}

export function getProjectDashboard(deps: DashboardDeps, projectId: string): ProjectDashboard {
  const project = deps.registry.get(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  const all = deps.tasks.listByProject(projectId)
  const activeTasks = all.filter((t) => t.status === 'todo' || t.status === 'in_progress')
  const reviewQueue = all.filter((t) => t.status === 'review')
  const recentRuns = all
    .flatMap((t) => deps.runs.listByTask(t.id))
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, 10)
  return { project, activeTasks, reviewQueue, recentRuns, allTasks: all }
}
```

- [ ] **Step 4: Mirror the field on the renderer contract**

In `apps/desktop/src/shared/ipc-contract.ts`, replace line 46:

```ts
export type ProjectDashboardRes = { project: Project; activeTasks: Task[]; reviewQueue: Task[]; recentRuns: AgentRun[]; allTasks: Task[] }
```

- [ ] **Step 5: Keep the existing PmHome fixture compiling**

In `apps/desktop/src/renderer/components/PmHome.test.tsx`, add `allTasks` to the `dashboard` fixture object (after `recentRuns`, before the closing `}`):

```ts
  allTasks: [
    { id: 'T1', projectId: 'p1', title: 'do work', status: 'in_progress' as const, assigneeType: 'agent' as const, priority: 'high' as const, reviewStatus: 'none' as const, acceptanceCriteria: [], linkedWikiPages: [] },
    { id: 'T2', projectId: 'p1', title: 'needs review', status: 'review' as const, assigneeType: 'agent' as const, priority: 'medium' as const, reviewStatus: 'pending' as const, acceptanceCriteria: [], linkedWikiPages: [] },
  ],
```

- [ ] **Step 6: Run tests + typecheck to verify they pass**

Run: `pnpm --filter @apc/dashboard-api test && pnpm typecheck`
Expected: PASS. `allTasks` test green; typecheck clean (the `(res as any)` cast in `apps/desktop/src/main/ipc.test.ts` means the IPC test is unaffected).

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard-api/src/project-dashboard.ts packages/dashboard-api/src/project-dashboard.test.ts apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/renderer/components/PmHome.test.tsx
git commit -m "feat(dashboard-api): return allTasks for PM Home board/timeline"
```

---

## Task 2: `TaskBoard` read-only kanban component

**Files:**
- Create: `apps/desktop/src/renderer/components/TaskBoard.tsx`
- Create: `apps/desktop/src/renderer/components/TaskBoard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/renderer/components/TaskBoard.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { Task } from '@apc/shared'
import { TaskBoard } from './TaskBoard.js'

const t = (id: string, status: Task['status'], title: string, extra: Partial<Task> = {}): Task => ({
  id, projectId: 'p1', title, status, assigneeType: 'agent', priority: 'medium',
  reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], ...extra,
})

describe('TaskBoard', () => {
  const tasks: Task[] = [
    t('T1', 'todo', 'plan it'),
    t('T2', 'in_progress', 'build it', { priority: 'high', dueDate: '2026-06-10' }),
    t('T3', 'review', 'check it'),
    t('T4', 'done', 'ship it'),
    t('T5', 'rejected', 'scrapped'),
  ]

  test('groups each task under its status column', () => {
    render(<TaskBoard tasks={tasks} />)
    expect(within(screen.getByTestId('col-todo')).getByText('plan it')).toBeDefined()
    expect(within(screen.getByTestId('col-in_progress')).getByText('build it')).toBeDefined()
    expect(within(screen.getByTestId('col-review')).getByText('check it')).toBeDefined()
    expect(within(screen.getByTestId('col-done')).getByText('ship it')).toBeDefined()
  })

  test('renders card priority and dueDate', () => {
    render(<TaskBoard tasks={tasks} />)
    const card = within(screen.getByTestId('col-in_progress')).getByText('build it').closest('.pm-board__card')!
    expect(within(card as HTMLElement).getByText('high')).toBeDefined()
    expect(within(card as HTMLElement).getByText('2026-06-10')).toBeDefined()
  })

  test('does not render a rejected column and shows — for empty columns', () => {
    render(<TaskBoard tasks={[t('T1', 'todo', 'only todo')]} />)
    expect(screen.queryByTestId('col-rejected')).toBeNull()
    expect(within(screen.getByTestId('col-done')).getByText('—')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/renderer/components/TaskBoard.test.tsx`
Expected: FAIL — `Cannot find module './TaskBoard.js'`.

- [ ] **Step 3: Write the component**

Create `apps/desktop/src/renderer/components/TaskBoard.tsx`:

```tsx
import type { Task, TaskStatus } from '@apc/shared'

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To Do' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'review', label: 'Review' },
  { status: 'done', label: 'Done' },
]

type Props = { tasks: Task[] }

export function TaskBoard({ tasks }: Props) {
  return (
    <div className="pm-board">
      {COLUMNS.map(({ status, label }) => {
        const items = tasks.filter((t) => t.status === status)
        return (
          <div key={status} className="pm-board__col" data-testid={`col-${status}`}>
            <h3 className="pm-board__col-title">{label} <span className="pm-board__count">{items.length}</span></h3>
            {items.length === 0 ? (
              <p className="pm-board__empty">—</p>
            ) : (
              items.map((task) => (
                <div key={task.id} className="pm-board__card">
                  <span className="pm-board__card-title">{task.title}</span>
                  <span className="pm-board__card-meta">
                    <span className={`pm-board__priority pm-board__priority--${task.priority}`}>{task.priority}</span>
                    {task.dueDate && <span className="pm-board__due">{task.dueDate}</span>}
                  </span>
                </div>
              ))
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/renderer/components/TaskBoard.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/TaskBoard.tsx apps/desktop/src/renderer/components/TaskBoard.test.tsx
git commit -m "feat(desktop): read-only TaskBoard kanban component"
```

---

## Task 3: `TimelineStrip` component + axis helpers

**Files:**
- Create: `apps/desktop/src/renderer/components/TimelineStrip.tsx`
- Create: `apps/desktop/src/renderer/components/TimelineStrip.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/renderer/components/TimelineStrip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { Task } from '@apc/shared'
import { TimelineStrip, timelineAxis, datePct } from './TimelineStrip.js'

const t = (id: string, dueDate?: string): Task => ({
  id, projectId: 'p1', title: `task ${id}`, status: 'todo', assigneeType: 'agent',
  priority: 'medium', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], dueDate,
})

describe('timelineAxis', () => {
  test('uses start and target when both present', () => {
    expect(timelineAxis('2026-06-01', '2026-06-11', [])).toEqual({
      min: Date.parse('2026-06-01'), max: Date.parse('2026-06-11'),
    })
  })

  test('falls back to min/max of dueDates when range is absent', () => {
    const axis = timelineAxis(undefined, undefined, ['2026-06-05', '2026-06-01', '2026-06-09'])
    expect(axis).toEqual({ min: Date.parse('2026-06-01'), max: Date.parse('2026-06-09') })
  })

  test('returns null when fewer than two distinct dates exist', () => {
    expect(timelineAxis(undefined, undefined, [])).toBeNull()
    expect(timelineAxis('2026-06-01', undefined, ['2026-06-01'])).toBeNull()
  })
})

describe('datePct', () => {
  test('maps a midpoint date to 50%', () => {
    const axis = { min: Date.parse('2026-06-01'), max: Date.parse('2026-06-11') }
    expect(datePct('2026-06-06', axis)).toBe(50)
  })

  test('clamps out-of-range dates to 0 and 100', () => {
    const axis = { min: Date.parse('2026-06-01'), max: Date.parse('2026-06-11') }
    expect(datePct('2026-05-01', axis)).toBe(0)
    expect(datePct('2026-07-01', axis)).toBe(100)
  })
})

describe('TimelineStrip', () => {
  test('renders a marker per task with a dueDate', () => {
    render(<TimelineStrip start="2026-06-01" target="2026-06-11" tasks={[t('A', '2026-06-06'), t('B')]} />)
    expect(screen.getByTitle('task A')).toBeDefined()
    expect(screen.queryByTitle('task B')).toBeNull() // no dueDate → no marker
  })

  test('shows an empty state when no axis can be derived', () => {
    render(<TimelineStrip start={undefined} target={undefined} tasks={[t('A')]} />)
    expect(screen.getByText('일정 정보 없음')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/renderer/components/TimelineStrip.test.tsx`
Expected: FAIL — `Cannot find module './TimelineStrip.js'`.

- [ ] **Step 3: Write the component + helpers**

Create `apps/desktop/src/renderer/components/TimelineStrip.tsx`:

```tsx
import type { Task } from '@apc/shared'

export type Axis = { min: number; max: number }

/** Build the timeline axis. Prefer [start, target]; otherwise span the dueDates.
 *  Returns null when fewer than two distinct millisecond values exist (no meaningful range). */
export function timelineAxis(start: string | undefined, target: string | undefined, dueDates: string[]): Axis | null {
  const points = [start, target, ...dueDates]
    .filter((d): d is string => !!d)
    .map((d) => Date.parse(d))
    .filter((ms) => !Number.isNaN(ms))
  const distinct = Array.from(new Set(points))
  if (distinct.length < 2) return null
  if (start && target) {
    const a = Date.parse(start); const b = Date.parse(target)
    if (!Number.isNaN(a) && !Number.isNaN(b) && a !== b) return { min: Math.min(a, b), max: Math.max(a, b) }
  }
  return { min: Math.min(...distinct), max: Math.max(...distinct) }
}

/** Position of a date on the axis as a clamped 0–100 percentage. */
export function datePct(date: string, axis: Axis): number {
  const ms = Date.parse(date)
  if (Number.isNaN(ms)) return 0
  const pct = ((ms - axis.min) / (axis.max - axis.min)) * 100
  return Math.max(0, Math.min(100, pct))
}

type Props = { start?: string; target?: string; tasks: Task[] }

export function TimelineStrip({ start, target, tasks }: Props) {
  const dued = tasks.filter((t) => !!t.dueDate)
  const axis = timelineAxis(start, target, dued.map((t) => t.dueDate as string))
  if (!axis) return <p className="pm-timeline__empty">일정 정보 없음</p>

  return (
    <div className="pm-timeline">
      <div className="pm-timeline__track">
        {dued.map((task) => (
          <span
            key={task.id}
            className="pm-timeline__marker"
            title={task.title}
            aria-label={`${task.title} due ${task.dueDate}`}
            style={{ left: `${datePct(task.dueDate as string, axis)}%` }}
          />
        ))}
      </div>
      <div className="pm-timeline__labels">
        {start && <span>{start}</span>}
        {target && <span style={{ marginLeft: 'auto' }}>{target}</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/renderer/components/TimelineStrip.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/TimelineStrip.tsx apps/desktop/src/renderer/components/TimelineStrip.test.tsx
git commit -m "feat(desktop): lightweight TimelineStrip derived from project/task dates"
```

---

## Task 4: Rewrite `PmHome` to compose all five sections

**Files:**
- Modify: `apps/desktop/src/renderer/components/PmHome.tsx`
- Modify: `apps/desktop/src/renderer/components/PmHome.test.tsx`

- [ ] **Step 1: Write the failing test**

Replace the whole body of `apps/desktop/src/renderer/components/PmHome.test.tsx` with:

```tsx
import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { PmHome } from './PmHome.js'

const dashboard: ProjectDashboardRes = {
  project: {
    id: 'p1', name: 'APC', status: 'active', goal: 'ship MVP', currentFocus: 'PM Home',
    startDate: '2026-06-01', targetDate: '2026-06-30', projectType: 'git', repoPaths: [], vaultPaths: [], sourcePaths: [],
  },
  activeTasks: [],
  reviewQueue: [
    { id: 'T2', projectId: 'p1', title: 'needs review', status: 'review', assigneeType: 'agent', priority: 'medium', reviewStatus: 'pending', acceptanceCriteria: [], linkedWikiPages: [] },
  ],
  recentRuns: [
    { id: 'R1', taskId: 'T1', agent: 'codex', repoPath: '/p1', startedAt: '2026-06-01T10:00:00Z', status: 'completed' },
  ],
  allTasks: [
    { id: 'T1', projectId: 'p1', title: 'do work', status: 'in_progress', assigneeType: 'agent', priority: 'high', dueDate: '2026-06-15', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [] },
    { id: 'T2', projectId: 'p1', title: 'needs review', status: 'review', assigneeType: 'agent', priority: 'medium', reviewStatus: 'pending', acceptanceCriteria: [], linkedWikiPages: [] },
  ],
}

describe('PmHome', () => {
  test('renders goal and current focus', () => {
    render(<PmHome dashboard={dashboard} />)
    expect(screen.getByText('ship MVP')).toBeDefined()
    expect(screen.getByText('PM Home')).toBeDefined()
  })

  test('renders the task board with cards in the right columns', () => {
    render(<PmHome dashboard={dashboard} />)
    expect(within(screen.getByTestId('col-in_progress')).getByText('do work')).toBeDefined()
    expect(within(screen.getByTestId('col-review')).getByText('needs review')).toBeDefined()
  })

  test('renders a timeline marker for the dated task', () => {
    render(<PmHome dashboard={dashboard} />)
    expect(screen.getByTitle('do work')).toBeDefined()
  })

  test('renders the review queue and recent runs', () => {
    render(<PmHome dashboard={dashboard} />)
    expect(screen.getByText(/R1/)).toBeDefined()
    expect(screen.getByText('completed')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/renderer/components/PmHome.test.tsx`
Expected: FAIL — current `PmHome` has no board/timeline/focus; `col-in_progress` testid and `getByTitle('do work')` are missing.

- [ ] **Step 3: Rewrite the component**

Replace the whole body of `apps/desktop/src/renderer/components/PmHome.tsx` with:

```tsx
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { TimelineStrip } from './TimelineStrip.js'
import { TaskBoard } from './TaskBoard.js'

type Props = { dashboard: ProjectDashboardRes }

export function PmHome({ dashboard }: Props) {
  const { project, reviewQueue, recentRuns, allTasks } = dashboard

  return (
    <div className="pm-home">
      <section className="pm-home__header">
        <div className="pm-home__goal">
          <h2>Current Goal</h2>
          <p>{project.goal ?? '(no goal set)'}</p>
        </div>
        {project.currentFocus && (
          <div className="pm-home__focus">
            <h2>Current Focus</h2>
            <p>{project.currentFocus}</p>
          </div>
        )}
        {(project.startDate || project.targetDate) && (
          <div className="pm-home__dates">
            <span>{project.startDate ?? '…'}</span>
            <span> → </span>
            <span>{project.targetDate ?? '…'}</span>
          </div>
        )}
      </section>

      <section className="pm-home__timeline">
        <h2>Timeline</h2>
        <TimelineStrip start={project.startDate} target={project.targetDate} tasks={allTasks} />
      </section>

      <section className="pm-home__board">
        <h2>Task Board</h2>
        <TaskBoard tasks={allTasks} />
      </section>

      <section className="pm-home__review-queue">
        <h2>Review Queue</h2>
        {reviewQueue.length === 0 ? (
          <p className="pm-home__empty">리뷰 대기 없음</p>
        ) : (
          <ul>
            {reviewQueue.map((t) => (
              <li key={t.id}>
                <span className="task-title">{t.title}</span>
                <span className="review-status"> [{t.reviewStatus}]</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="pm-home__recent-runs">
        <h2>Recent Runs</h2>
        {recentRuns.length === 0 ? (
          <p className="pm-home__empty">최근 실행 없음</p>
        ) : (
          <ul>
            {recentRuns.map((r) => (
              <li key={r.id}>
                {r.id} — {r.agent} — <span className="run-status">{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/renderer/components/PmHome.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/PmHome.tsx apps/desktop/src/renderer/components/PmHome.test.tsx
git commit -m "feat(desktop): PmHome composes focus, timeline, task board, review, runs"
```

---

## Task 5: `MainPanel` tab container + wire into `App`

**Files:**
- Create: `apps/desktop/src/renderer/components/MainPanel.tsx`
- Create: `apps/desktop/src/renderer/components/MainPanel.test.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` (import, state, render)

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/renderer/components/MainPanel.test.tsx` (the heavy `HarnessDashboard` is stubbed so the test stays isolated):

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
  test('shows PmHome when tab is pm', () => {
    render(<MainPanel tab="pm" onTab={vi.fn()} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
    expect(screen.getByText('ship MVP')).toBeDefined()
    expect(screen.queryByText('HARNESS-STUB')).toBeNull()
  })

  test('shows HarnessDashboard when tab is harness', () => {
    render(<MainPanel tab="harness" onTab={vi.fn()} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
    expect(screen.getByText('HARNESS-STUB')).toBeDefined()
    expect(screen.queryByText('ship MVP')).toBeNull()
  })

  test('fires onTab when a tab button is clicked', () => {
    const onTab = vi.fn()
    render(<MainPanel tab="pm" onTab={onTab} dashboard={dashboard} profiles={[]} onSelectProfile={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Knowledge Harness' }))
    expect(onTab).toHaveBeenCalledWith('harness')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/renderer/components/MainPanel.test.tsx`
Expected: FAIL — `Cannot find module './MainPanel.js'`.

- [ ] **Step 3: Write the component**

Create `apps/desktop/src/renderer/components/MainPanel.tsx`:

```tsx
import type { AgentProfile } from '@apc/shared'
import type { ProjectDashboardRes } from '../../shared/ipc-contract.js'
import { PmHome } from './PmHome.js'
import { HarnessDashboard } from './HarnessDashboard.js'

export type MainTab = 'pm' | 'harness'

type Props = {
  tab: MainTab
  onTab: (tab: MainTab) => void
  dashboard: ProjectDashboardRes
  profiles: AgentProfile[]
  onSelectProfile: (profileId: string) => void
}

const TABS: { id: MainTab; label: string }[] = [
  { id: 'pm', label: 'PM Home' },
  { id: 'harness', label: 'Knowledge Harness' },
]

export function MainPanel({ tab, onTab, dashboard, profiles, onSelectProfile }: Props) {
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
          </button>
        ))}
      </nav>
      <div className="main-panel__content">
        {tab === 'pm'
          ? <PmHome dashboard={dashboard} />
          : <HarnessDashboard profiles={profiles} onSelectProfile={onSelectProfile} />}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/renderer/components/MainPanel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire `MainPanel` into `App.tsx`**

In `apps/desktop/src/renderer/App.tsx`:

(a) Replace the `HarnessDashboard` import (line 7) with `MainPanel` + its tab type:

```tsx
import { MainPanel, type MainTab } from './components/MainPanel.js'
```

(b) Add tab state next to the other `useState` hooks (near line 28):

```tsx
  const [mainTab, setMainTab] = useState<MainTab>('pm')
```

(c) Replace the dashboard render block (currently lines 247-253) with:

```tsx
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
```

- [ ] **Step 6: Run desktop tests + typecheck**

Run: `cd apps/desktop && npx vitest run && cd ../.. && pnpm typecheck`
Expected: PASS. `HarnessDashboard` is no longer imported directly by `App.tsx` (no unused-import error); all desktop suites green.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/components/MainPanel.tsx apps/desktop/src/renderer/components/MainPanel.test.tsx apps/desktop/src/renderer/App.tsx
git commit -m "feat(desktop): MainPanel tabs — PM Home default landing, Harness as tab"
```

---

## Task 6: Styles for PM Home

**Files:**
- Modify: `apps/desktop/src/renderer/app.css`

- [ ] **Step 1: Append the styles**

Append to `apps/desktop/src/renderer/app.css` (CSS-class based — no inline grid, per spec §5):

```css
/* ── PM Home ─────────────────────────────────────────── */
.main-panel { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.main-panel__tabs { display: flex; gap: 4px; padding: 4px 6px 0; flex: 0 0 auto; }
.main-panel__tab { background: #161616; border: 1px solid #2c2c2c; border-bottom: none; border-radius: 4px 4px 0 0; padding: 4px 12px; font-size: 0.8rem; color: #ccc; cursor: pointer; }
.main-panel__tab--active { background: #23311f; border-color: #4a8a4a; color: #fff; }
.main-panel__content { flex: 1; min-height: 0; overflow: auto; border-top: 1px solid #2c2c2c; }

.pm-home { display: flex; flex-direction: column; gap: 14px; padding: 12px; }
.pm-home h2 { font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.6; margin: 0 0 6px; }
.pm-home__header { display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start; }
.pm-home__dates { margin-left: auto; font-size: 0.8rem; opacity: 0.7; }
.pm-home__empty { opacity: 0.5; font-size: 0.82rem; }

.pm-timeline { position: relative; }
.pm-timeline__track { position: relative; height: 28px; background: #161616; border: 1px solid #2c2c2c; border-radius: 4px; }
.pm-timeline__marker { position: absolute; top: 4px; width: 10px; height: 18px; margin-left: -5px; background: #4a8a4a; border-radius: 2px; }
.pm-timeline__labels { display: flex; font-size: 0.7rem; opacity: 0.55; margin-top: 2px; }
.pm-timeline__empty { opacity: 0.5; font-size: 0.82rem; }

.pm-board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.pm-board__col { background: #161616; border: 1px solid #2c2c2c; border-radius: 4px; padding: 6px; min-height: 60px; }
.pm-board__col-title { font-size: 0.74rem; text-transform: uppercase; opacity: 0.6; margin: 0 0 6px; display: flex; gap: 6px; }
.pm-board__count { opacity: 0.5; }
.pm-board__empty { opacity: 0.4; text-align: center; margin: 6px 0; }
.pm-board__card { background: #1d1d1d; border: 1px solid #2c2c2c; border-radius: 3px; padding: 5px 6px; margin-bottom: 5px; font-size: 0.8rem; }
.pm-board__card-meta { display: flex; gap: 6px; margin-top: 3px; font-size: 0.68rem; opacity: 0.75; }
.pm-board__priority--high { color: #f87171; }
.pm-board__priority--medium { color: #facc15; }
.pm-board__priority--low { color: #4ade80; }
```

- [ ] **Step 2: Verify the app still typechecks (CSS is not type-checked, this just guards the import)**

Run: `pnpm typecheck`
Expected: PASS (no change to TS; CSS is imported via `import './app.css'` already present in `App.tsx`).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/app.css
git commit -m "style(desktop): PM Home tabs, timeline, and kanban styling"
```

---

## Task 7: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full desktop test suite**

Run: `cd apps/desktop && npx vitest run`
Expected: PASS — all suites including new `TaskBoard`, `TimelineStrip`, `MainPanel`, and rewritten `PmHome`.

- [ ] **Step 2: Run the dashboard-api package tests**

Run: `pnpm --filter @apc/dashboard-api test`
Expected: PASS — including the `allTasks` test.

- [ ] **Step 3: Run the repo typecheck**

Run: `pnpm typecheck`
Expected: PASS — root + desktop typecheck clean.

- [ ] **Step 4: Confirm the acceptance criteria (spec §9) are met**

Manually confirm against `docs/superpowers/specs/2026-06-07-pm-home-integration-design.md` §9:
1. PM Home is the default main tab. ✔ (Task 5, `mainTab` defaults to `'pm'`)
2. goal · current focus · timeline · task board · review queue · recent runs all render. ✔ (Task 4)
3. Knowledge Harness tab reaches `HarnessDashboard` and back. ✔ (Task 5)
4. `getProjectDashboard` returns `allTasks`, existing fields unchanged. ✔ (Task 1)
5. New + existing desktop tests and `pnpm typecheck` pass. ✔ (Steps 1-3)
6. No inline grid (CSS classes only). ✔ (Task 6)

- [ ] **Step 5: Final commit (if any verification touch-ups were needed)**

```bash
git status   # if clean, nothing to commit
```

---

## Notes for the implementer

- **Do NOT commit the 10 pre-existing unstaged files** (`apps/desktop/src/main/*`, `renderer/App.tsx` unrelated lines, `generate-service.*`). They are separate in-flight work. Stage only the exact files listed in each task's commit. (`App.tsx` IS edited in Task 5 — stage it then, but review the diff to ensure you are not committing unrelated pre-existing changes in that file.)
- All new components are **pure/presentational** (props in, JSX out) — no store or IPC access — which is why they unit-test cleanly.
- The IPC handler (`apps/desktop/src/main/ipc.ts:55`) passes `getProjectDashboard`'s result straight through, so `allTasks` reaches the renderer with no handler change.
