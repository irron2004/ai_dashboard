# 에이전트 실행 아이콘 (▶/⏹) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** desktop dock의 각 에이전트 헤더에 ▶(시작/재시작)·⏹(중지) 아이콘 버튼을 추가해 프로젝트 에이전트 세션을 한 클릭으로 제어한다.

**Architecture:** 신규 엔진 없음. 기존 PTY IPC(`startPty`/`killPty`)와 pty-manager의 same-id kill+respawn을 재사용. store에 세션별 `restartNonce`를 추가하고, `AgentTerminal`이 그 nonce를 spawn effect deps로 받아 재spawn한다. 새 프레젠테이션 컴포넌트 `AgentDockHeader`로 헤더를 추출(테스트 가능화)하고 App.tsx가 배선한다.

**Tech Stack:** React 18 + zustand(store) + xterm(터미널) + Electron IPC. 테스트 = vitest(jsdom) + @testing-library/react.

## Global Constraints

- 세션 키 규약 = `` `${projectId}:${agent}` `` (verbatim). PTY id == 이 키.
- TS 들여쓰기 = **2-space** (기존 파일 관례).
- 테스트는 `apps/desktop`에서 실행: `npx vitest run <파일경로>` (config가 `src/**/*.test.{ts,tsx}` 포함, `*.test.tsx`=jsdom, `globals:true`).
- **jest-dom 매처 금지** — 기존 테스트는 `expect(...).toBeDefined()`/`.toBeTruthy()` + `(el as HTMLButtonElement).disabled`만 사용.
- api 모킹 = `vi.mock('./api.js', () => ({ api: { ... } }))` (store 테스트) / `vi.mock('../api.js', ...)` (components 테스트, 상대경로 주의).
- typecheck = 레포 루트에서 `pnpm typecheck` (`tsc -p tsconfig.typecheck.json && tsc -p apps/desktop/tsconfig.json --noEmit`).
- ▶ 동작은 상태 무관 **항상 `restartNonce[key]++` 한 동작**(세션이 떠 있었으면 재시작, 아니면 시작). ⏹은 `running`/`attention`일 때만 활성.
- `resumeSessionId` 의미 유지: `null`=최신 resume, `undefined`=fresh. 본 작업은 resume 기본값을 바꾸지 않는다.

---

## File Structure

- `apps/desktop/src/renderer/store.ts` — `restartNonce` 상태 + `restartAgent`/`stopAgent` 액션.
- `apps/desktop/src/renderer/components/AgentTerminal.tsx` — `restartNonce?: number` prop을 spawn effect deps에 추가.
- `apps/desktop/src/renderer/components/AgentDockHeader.tsx` (NEW) — 헤더 프레젠테이션(▶/⏹/dot/name/shortcut).
- `apps/desktop/src/renderer/App.tsx` — 인라인 헤더(L369–381)를 `<AgentDockHeader>`로 교체 + AgentTerminal에 `restartNonce` 전달.

---

### Task 1: store — restartNonce + restartAgent/stopAgent

**Files:**
- Modify: `apps/desktop/src/renderer/store.ts` (타입 `ApcStore` ~L21–73, initial state `create<ApcStore>` ~L133, `setAgentStatus` 근처)
- Test: `apps/desktop/src/renderer/agent-run-controls.test.tsx` (Create)

**Interfaces:**
- Consumes: 기존 `api.killPty({ id })`, `agentStatus: Record<string, AgentRunStatus>`, `setAgentStatus`.
- Produces: state `restartNonce: Record<string, number>`; actions `restartAgent(key: string): void`, `stopAgent(key: string): void`.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/desktop/src/renderer/agent-run-controls.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./api.js', () => ({ api: { killPty: vi.fn() } }))
import { api } from './api.js'
import { useStore } from './store.js'

describe('agent run controls (store)', () => {
  beforeEach(() => {
    useStore.setState({ restartNonce: {}, agentStatus: {} })
    vi.clearAllMocks()
  })

  it('restartAgent increments the per-key nonce', () => {
    useStore.getState().restartAgent('p1:claude')
    expect(useStore.getState().restartNonce['p1:claude']).toBe(1)
    useStore.getState().restartAgent('p1:claude')
    expect(useStore.getState().restartNonce['p1:claude']).toBe(2)
  })

  it('stopAgent kills the pty by session key and sets status idle', () => {
    useStore.setState({ agentStatus: { 'p1:claude': 'running' } })
    useStore.getState().stopAgent('p1:claude')
    expect(api.killPty).toHaveBeenCalledWith({ id: 'p1:claude' })
    expect(useStore.getState().agentStatus['p1:claude']).toBe('idle')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run (in `apps/desktop`): `npx vitest run src/renderer/agent-run-controls.test.tsx`
Expected: FAIL — `restartNonce`/`restartAgent`/`stopAgent`가 `ApcStore`에 없음(타입/런타임 에러).

- [ ] **Step 3: 타입에 필드/액션 시그니처 추가**

`store.ts`의 `type ApcStore = {` 안, `setAgentStatus(...)` 선언 근처(~L73)에 추가:
```ts
  /** Per-session restart token keyed by `${projectId}:${agent}`. Bumping it re-spawns that agent's terminal. */
  restartNonce: Record<string, number>
  restartAgent(key: string): void
  stopAgent(key: string): void
```

- [ ] **Step 4: 초기 state + 액션 구현**

`create<ApcStore>((set, get) => ({` 초기 객체에서 `agentStatus: {},` 줄 아래에 추가:
```ts
  restartNonce: {},
```
그리고 `setAgentStatus(key, status) { ... },` 액션 아래에 추가:
```ts
  restartAgent(key) {
    set((s) => ({ restartNonce: { ...s.restartNonce, [key]: (s.restartNonce[key] ?? 0) + 1 } }))
  },
  stopAgent(key) {
    api.killPty({ id: key })
    set((s) => ({ agentStatus: { ...s.agentStatus, [key]: 'idle' } }))
  },
```
(`api`는 store.ts 상단에서 이미 `import { api } from './api.js'`로 임포트됨 — 추가 import 불필요.)

- [ ] **Step 5: 테스트 통과 확인**

Run (in `apps/desktop`): `npx vitest run src/renderer/agent-run-controls.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 6: 커밋**

```bash
git add apps/desktop/src/renderer/store.ts apps/desktop/src/renderer/agent-run-controls.test.tsx
git commit -m "feat(desktop): store restartNonce + restartAgent/stopAgent for agent sessions"
```

---

### Task 2: AgentTerminal — restartNonce prop → 재spawn

**Files:**
- Modify: `apps/desktop/src/renderer/components/AgentTerminal.tsx` (props 타입 L9–18, 시그니처 L34, effect deps L99)
- Test: `apps/desktop/src/renderer/components/AgentTerminal.test.tsx` (Create)

**Interfaces:**
- Consumes: 기존 `api.startPty/onPtyData/onPtyExit/writePty/resizePty/killPty`.
- Produces: `AgentTerminal`이 prop `restartNonce?: number`를 받고, 값이 바뀌면 effect cleanup(killPty+term.dispose) 후 재spawn(startPty 재호출).

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/desktop/src/renderer/components/AgentTerminal.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const startPty = vi.fn()
vi.mock('../api.js', () => ({
  api: {
    startPty: (req: unknown) => startPty(req),
    killPty: vi.fn(), writePty: vi.fn(), resizePty: vi.fn(),
    onPtyData: () => () => {},
    onPtyExit: () => () => {},
  },
}))
// xterm needs canvas/measureText (absent in jsdom) → mock to no-ops.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80; rows = 24
    loadAddon() {} open() {} write() {} dispose() {} getSelection() { return '' }
    attachCustomKeyEventHandler() {}
    onData() { return { dispose() {} } }
    onSelectionChange() { return { dispose() {} } }
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))

import { AgentTerminal } from './AgentTerminal.js'

beforeEach(() => {
  vi.clearAllMocks()
  // jsdom lacks ResizeObserver
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  }
})

describe('AgentTerminal restart', () => {
  it('re-spawns the pty (startPty) when restartNonce changes', () => {
    const props = { sessionId: 'p1:claude', command: 'claude', args: [] as string[], cwd: '/x', agent: 'claude' as const }
    const { rerender } = render(<AgentTerminal {...props} restartNonce={0} />)
    expect(startPty).toHaveBeenCalledTimes(1)
    rerender(<AgentTerminal {...props} restartNonce={1} />)
    expect(startPty).toHaveBeenCalledTimes(2)
    expect(startPty).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p1:claude' }))
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run (in `apps/desktop`): `npx vitest run src/renderer/components/AgentTerminal.test.tsx`
Expected: FAIL — `restartNonce`가 deps에 없어 두 번째 렌더에서 effect가 재실행되지 않음 → `startPty` 1회만 호출(`expected 2, got 1`).

- [ ] **Step 3: prop 추가 + deps 반영**

`AgentTerminalProps` 타입(L9–18)에 한 줄 추가(예: `resumeSessionId` 줄 아래):
```ts
  restartNonce?: number   // bump to force re-spawn (start/restart)
```
함수 시그니처(L34) destructure에 `restartNonce` 추가:
```ts
export function AgentTerminal({ sessionId, command, args, cwd, agent, resumeSessionId, restartNonce, onStatus, onActivate }: AgentTerminalProps) {
```
spawn effect의 deps 배열(L99)에 `restartNonce` 추가:
```ts
  }, [sessionId, command, cwd, args.join(' '), restartNonce])
```
(effect 본문·cleanup은 변경 없음 — cleanup이 이미 `api.killPty({ id: sessionId })` + `term.dispose()`를 하므로 nonce 변경 시 깨끗이 teardown 후 재spawn.)

- [ ] **Step 4: 테스트 통과 확인**

Run (in `apps/desktop`): `npx vitest run src/renderer/components/AgentTerminal.test.tsx`
Expected: PASS (1/1).

- [ ] **Step 5: 커밋**

```bash
git add apps/desktop/src/renderer/components/AgentTerminal.tsx apps/desktop/src/renderer/components/AgentTerminal.test.tsx
git commit -m "feat(desktop): AgentTerminal re-spawns on restartNonce bump"
```

---

### Task 3: AgentDockHeader — ▶/⏹ 헤더 컴포넌트 (NEW)

**Files:**
- Create: `apps/desktop/src/renderer/components/AgentDockHeader.tsx`
- Test: `apps/desktop/src/renderer/components/AgentDockHeader.test.tsx` (Create)

**Interfaces:**
- Consumes: `AgentType`(`@apc/shared`), `AgentRunStatus`(`../store.js`).
- Produces: `AgentDockHeader` 컴포넌트, props `{ agent: AgentType; status: AgentRunStatus; selected: boolean; shortcut: number; statusColor: string; onStart(): void; onStop(): void; onSelect(): void }`. ⏹은 status가 `running`/`attention`일 때만 enabled. ▶/⏹ 클릭은 헤더의 onSelect로 버블링되지 않음.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `apps/desktop/src/renderer/components/AgentDockHeader.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentDockHeader } from './AgentDockHeader.js'

function setup(status: 'idle' | 'running' | 'attention' | 'done' = 'idle') {
  const onStart = vi.fn(), onStop = vi.fn(), onSelect = vi.fn()
  render(
    <AgentDockHeader agent="claude" status={status} selected={false} shortcut={1}
      statusColor="#888" onStart={onStart} onStop={onStop} onSelect={onSelect} />,
  )
  return { onStart, onStop, onSelect }
}

describe('AgentDockHeader', () => {
  it('renders start/stop icon buttons and the agent name', () => {
    setup()
    expect(screen.getByLabelText('에이전트 시작/재시작')).toBeDefined()
    expect(screen.getByLabelText('에이전트 중지')).toBeDefined()
    expect(screen.getByText('claude')).toBeDefined()
  })

  it('start click calls onStart and does not bubble to onSelect', () => {
    const { onStart, onSelect } = setup('idle')
    fireEvent.click(screen.getByLabelText('에이전트 시작/재시작'))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('stop is disabled when idle, enabled+calls onStop when running', () => {
    setup('idle')
    expect((screen.getByLabelText('에이전트 중지') as HTMLButtonElement).disabled).toBe(true)
  })

  it('stop click calls onStop when running', () => {
    const { onStop } = setup('running')
    const stop = screen.getByLabelText('에이전트 중지') as HTMLButtonElement
    expect(stop.disabled).toBe(false)
    fireEvent.click(stop)
    expect(onStop).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run (in `apps/desktop`): `npx vitest run src/renderer/components/AgentDockHeader.test.tsx`
Expected: FAIL — 모듈 `./AgentDockHeader.js`가 없음(import 에러).

- [ ] **Step 3: 컴포넌트 구현**

Create `apps/desktop/src/renderer/components/AgentDockHeader.tsx`:
```tsx
import type { AgentType } from '@apc/shared'
import type { AgentRunStatus } from '../store.js'

type Props = {
  agent: AgentType
  status: AgentRunStatus
  selected: boolean
  shortcut: number
  statusColor: string
  onStart: () => void
  onStop: () => void
  onSelect: () => void
}

const STOPPABLE: AgentRunStatus[] = ['running', 'attention']

export function AgentDockHeader({ agent, status, selected, shortcut, statusColor, onStart, onStop, onSelect }: Props) {
  const stoppable = STOPPABLE.includes(status)
  return (
    <div
      onClick={onSelect}
      title={`Shift+${shortcut}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        padding: '3px 8px', fontSize: '0.8rem', flex: '0 0 auto',
        background: selected ? '#23311f' : '#161616',
      }}
    >
      <button
        type="button"
        aria-label="에이전트 시작/재시작"
        onClick={(e) => { e.stopPropagation(); onStart() }}
        style={{ background: 'none', border: 'none', color: '#7bdc7b', cursor: 'pointer', padding: 0, fontSize: '0.85rem', lineHeight: 1 }}
      >▶</button>
      <button
        type="button"
        aria-label="에이전트 중지"
        disabled={!stoppable}
        onClick={(e) => { e.stopPropagation(); onStop() }}
        style={{ background: 'none', border: 'none', color: stoppable ? '#dc7b7b' : '#555', cursor: stoppable ? 'pointer' : 'default', padding: 0, fontSize: '0.85rem', lineHeight: 1 }}
      >⏹</button>
      <span style={{ color: statusColor, fontSize: '0.9rem', lineHeight: 1 }}>●</span>
      <span style={{ fontWeight: selected ? 600 : 400 }}>{agent}</span>
      <span style={{ marginLeft: 'auto', fontSize: '0.65rem', opacity: 0.5 }}>⇧{shortcut}</span>
    </div>
  )
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run (in `apps/desktop`): `npx vitest run src/renderer/components/AgentDockHeader.test.tsx`
Expected: PASS (4/4).

- [ ] **Step 5: 커밋**

```bash
git add apps/desktop/src/renderer/components/AgentDockHeader.tsx apps/desktop/src/renderer/components/AgentDockHeader.test.tsx
git commit -m "feat(desktop): AgentDockHeader with start/restart/stop icon buttons"
```

---

### Task 4: App.tsx 배선 — 헤더 교체 + restartNonce 전달

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx` (import 추가 ~L7, store 액션 취득 ~L32, 인라인 헤더 L369–381 교체, AgentTerminal에 prop 추가 L383–393)

**Interfaces:**
- Consumes: Task 1 `restartAgent`/`stopAgent`/`restartNonce`(store), Task 2 `AgentTerminal restartNonce` prop, Task 3 `AgentDockHeader`. 기존 `statusOf`, `STATUS_COLOR`, `setAgent`, `agent`.

- [ ] **Step 1: import + store 액션 취득 추가**

App.tsx 상단 import 블록(예: `import { AgentTerminal } from './components/AgentTerminal.js'` 근처, ~L7)에 추가:
```ts
import { AgentDockHeader } from './components/AgentDockHeader.js'
```
컴포넌트 함수 본문 상단, 기존 `} = useStore()` (~L32) 바로 아래에 추가:
```ts
  const restartAgent = useStore((s) => s.restartAgent)
  const stopAgent = useStore((s) => s.stopAgent)
  const restartNonce = useStore((s) => s.restartNonce)
```

- [ ] **Step 2: 인라인 헤더(L369–381)를 AgentDockHeader로 교체**

아래 기존 블록을:
```tsx
                      <div
                        onClick={() => setAgent(a)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                          padding: '3px 8px', fontSize: '0.8rem', flex: '0 0 auto',
                          background: a === agent ? '#23311f' : '#161616',
                        }}
                        title={`Shift+${i + 1}`}
                      >
                        <span style={{ color: STATUS_COLOR[statusOf(pid, a)], fontSize: '0.9rem', lineHeight: 1 }}>●</span>
                        <span style={{ fontWeight: a === agent ? 600 : 400 }}>{a}</span>
                        <span style={{ marginLeft: 'auto', fontSize: '0.65rem', opacity: 0.5 }}>⇧{i + 1}</span>
                      </div>
```
다음으로 교체:
```tsx
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
```

- [ ] **Step 3: AgentTerminal에 restartNonce 전달**

같은 dock 블록의 `<AgentTerminal ... />`(L383–393)에서 `agent={a}` 줄 아래에 prop 추가:
```tsx
                          restartNonce={restartNonce[`${pid}:${a}`] ?? 0}
```

- [ ] **Step 4: typecheck**

Run (레포 루트): `pnpm typecheck`
Expected: PASS (0 errors) — `AgentDockHeader` props·`restartNonce` 타입 정합.

- [ ] **Step 5: 전체 desktop 테스트 green(회귀 없음)**

Run (in `apps/desktop`): `npx vitest run`
Expected: PASS — 신규 3개 스위트 + 기존 전부. 기존 App/dock 관련 테스트 회귀 없음.

- [ ] **Step 6: 커밋**

```bash
git add apps/desktop/src/renderer/App.tsx
git commit -m "feat(desktop): wire agent dock header start/restart/stop + restartNonce"
```

---

## Self-Review (작성자 체크)

- **Spec coverage:** ▶/⏹ 헤더 버튼=Task 3+4 · `restartNonce`/`restartAgent`/`stopAgent`=Task 1 · AgentTerminal nonce 재spawn=Task 2 · ⏹ running/attention 게이트=Task 3 · 세션키 `${pid}:${a}`=전 태스크 일관 · resume 기본값 불변=Task 2(effect 본문 미변경) · 신규 IPC 없음(killPty 재사용)=Task 1. 비목표(SP1/SP2/사이드바 B/fresh 토글)는 미포함.
- **Placeholder scan:** TBD/TODO 없음. 모든 step에 실제 코드/명령/기대출력. App.tsx destructure는 selector 3줄 추가로 회피(기존 큰 destructure 비편집).
- **Type consistency:** `restartNonce: Record<string, number>`·`restartAgent(key:string)`·`stopAgent(key:string)`가 Task1 정의 → Task4 동일 사용. `AgentDockHeader` props가 Task3 정의 → Task4 동일 전달. `AgentRunStatus`('idle'|'running'|'attention'|'done')·`STOPPABLE=['running','attention']` 일관.
