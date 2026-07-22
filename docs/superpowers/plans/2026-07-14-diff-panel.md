# Diff 패널 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 어느 탭에서든 Ctrl+Shift+D(또는 툴바 ± 버튼)로 우측 Diff 패널을 열어, 변경 파일 목록을 +N −N 스탯과 함께 보고 클릭으로 unified diff를 펼쳐 본다.

**Architecture:** 기존 `changesList`/`changesDiff` IPC 채널을 그대로 쓰되 응답만 확장한다(신규 채널 없음 → 4곳 배선 규칙 해당 없음). main의 `project-changes.ts`에 numstat 파싱·untracked 줄 수 계산·삭제 파일 diff를 추가하고, renderer에 `DiffPanel.tsx` 하나를 신설해 App.tsx에 배선한다. diff 렌더링은 기존 `parseUnifiedDiff` 재사용.

**Tech Stack:** Electron IPC, git CLI(`status --porcelain`, `diff --numstat`), React 상태 컴포넌트, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-14-diff-panel-design.md` · 목업: `docs/mockups/2026-07-14-diff-panel-mockup.svg`

## Global Constraints

- 신규 IPC 채널 금지 — 기존 `q:changesList` / `q:changesDiff` 응답 확장만 허용
- untracked 줄 수 계산 상한 **2MB**, NUL 바이트 발견 시 binary 취급
- 단축키는 **Ctrl+Shift+D** (기존 Ctrl+K, Ctrl+Shift+N과 충돌 금지)
- UI 문구는 한국어 (기존 관용구: `변경분 없음 — working tree clean` 재사용)
- 테스트 실행은 repo root에서 `npx vitest run <파일명>` (CLAUDE.md)
- 커밋 컨벤션: `feat(desktop): …` / `test(desktop): …`

---

### Task 1: `parseNumstat` — numstat 출력 파싱

**Files:**
- Modify: `apps/desktop/src/main/project-changes.ts` (기존 `parsePorcelain` 아래에 추가)
- Test: `apps/desktop/src/main/project-changes.test.ts`

**Interfaces:**
- Produces: `export type NumstatEntry = { additions: number | null; deletions: number | null }` — `null` = binary
- Produces: `export function parseNumstat(stdout: string): Map<string, NumstatEntry>` (Task 3이 사용)

- [ ] **Step 1: 실패하는 테스트 작성**

`project-changes.test.ts`의 `parsePorcelain` describe 아래에 추가:

```ts
import { countUntrackedAdditions, diffProjectFile, listProjectChanges, markUnreflected, parseNumstat, parsePorcelain } from './project-changes.js'

describe('parseNumstat', () => {
  test('일반 라인 → 증감 카운트', () => {
    const out = '12\t3\tsrc/app.ts\n0\t7\tdocs/gone.md\n'
    const m = parseNumstat(out)
    expect(m.get('src/app.ts')).toEqual({ additions: 12, deletions: 3 })
    expect(m.get('docs/gone.md')).toEqual({ additions: 0, deletions: 7 })
  })

  test('binary(-\\t-) → null 카운트', () => {
    const m = parseNumstat('-\t-\tassets/logo.png\n')
    expect(m.get('assets/logo.png')).toEqual({ additions: null, deletions: null })
  })

  test('rename 두 형태 모두 새 경로 기준', () => {
    const m = parseNumstat('5\t2\told.md => new.md\n1\t1\tpackages/{pm => pm2}/src/x.ts\n')
    expect(m.get('new.md')).toEqual({ additions: 5, deletions: 2 })
    expect(m.get('packages/pm2/src/x.ts')).toEqual({ additions: 1, deletions: 1 })
  })

  test('빈 출력 → 빈 Map', () => {
    expect(parseNumstat('').size).toBe(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run project-changes`
Expected: FAIL — `parseNumstat is not a function` (또는 export 없음)

- [ ] **Step 3: 최소 구현**

`project-changes.ts`의 `parsePorcelain` 아래에 추가:

```ts
export type NumstatEntry = { additions: number | null; deletions: number | null }

/** `git diff --numstat` 출력 파싱. binary는 "-\t-" → null. 리네임은 새 경로 기준. */
export function parseNumstat(stdout: string): Map<string, NumstatEntry> {
  const map = new Map<string, NumstatEntry>()
  for (const line of stdout.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (!m) continue
    let path = unquote(m[3])
    if (path.includes(' => ')) {
      // "pre/{old => new}/post" 또는 "old => new" — 새 경로만 남긴다
      path = path.includes('{')
        ? path.replace(/\{[^}]* => ([^}]*)\}/, '$1').replace(/\/\//g, '/')
        : path.slice(path.indexOf(' => ') + 4)
    }
    map.set(path, {
      additions: m[1] === '-' ? null : Number(m[1]),
      deletions: m[2] === '-' ? null : Number(m[2]),
    })
  }
  return map
}
```

주의: Step 1의 import에 `countUntrackedAdditions`가 이미 있으므로 Task 2 전까지 테스트 파일이 import 에러가 난다면, Task 2까지 구현 후 함께 통과시켜도 된다. 순서대로 진행한다면 Step 1 import에서 `countUntrackedAdditions`를 잠시 빼고 Task 2에서 추가할 것.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run project-changes`
Expected: parseNumstat 4개 테스트 PASS (기존 테스트도 전부 PASS)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/project-changes.ts apps/desktop/src/main/project-changes.test.ts
git commit -m "feat(desktop): git numstat 파싱 추가 (diff 패널 기반)"
```

---

### Task 2: `countUntrackedAdditions` — untracked 파일 줄 수

**Files:**
- Modify: `apps/desktop/src/main/project-changes.ts`
- Test: `apps/desktop/src/main/project-changes.test.ts`

**Interfaces:**
- Produces: `export function countUntrackedAdditions(absPath: string): number | null` — `null` = binary/대용량/읽기 실패 (Task 3이 사용)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs'  // 기존 import 그대로

describe('countUntrackedAdditions', () => {
  test('텍스트 파일 → 줄 수 (개행 없는 마지막 줄 포함)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-count-'))
    writeFileSync(join(dir, 'a.md'), 'one\ntwo\nthree')  // 마지막 개행 없음
    expect(countUntrackedAdditions(join(dir, 'a.md'))).toBe(3)
    rmSync(dir, { recursive: true, force: true })
  })

  test('빈 파일 → 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-count-'))
    writeFileSync(join(dir, 'empty.md'), '')
    expect(countUntrackedAdditions(join(dir, 'empty.md'))).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test('NUL 바이트 포함(binary) → null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-count-'))
    writeFileSync(join(dir, 'bin.dat'), Buffer.from([0x41, 0x00, 0x42]))
    expect(countUntrackedAdditions(join(dir, 'bin.dat'))).toBe(null)
    rmSync(dir, { recursive: true, force: true })
  })

  test('없는 파일 → null', () => {
    expect(countUntrackedAdditions(join(tmpdir(), 'apc-none', 'nope.md'))).toBe(null)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run project-changes`
Expected: FAIL — `countUntrackedAdditions is not a function`

- [ ] **Step 3: 최소 구현**

`project-changes.ts` 상단 import에 `readFileSync` 추가:

```ts
import { readFileSync, statSync } from 'node:fs'
```

`parseNumstat` 아래에 추가:

```ts
const MAX_COUNT_BYTES = 2 * 1024 * 1024

/** untracked 파일의 +줄 수. NUL 바이트(binary)·2MB 초과·읽기 실패 → null(집계 불가). */
export function countUntrackedAdditions(absPath: string): number | null {
  try {
    const size = statSync(absPath).size
    if (size === 0) return 0
    if (size > MAX_COUNT_BYTES) return null
    const buf = readFileSync(absPath)
    if (buf.includes(0)) return null
    let lines = 0
    for (const b of buf) if (b === 10) lines++
    if (buf[buf.length - 1] !== 10) lines++
    return lines
  } catch {
    return null
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run project-changes`
Expected: countUntrackedAdditions 4개 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/project-changes.ts apps/desktop/src/main/project-changes.test.ts
git commit -m "feat(desktop): untracked 파일 줄 수 계산 (diff 패널 기반)"
```

---

### Task 3: `listProjectChanges`에 증감량 병합 + 계약 확장

**Files:**
- Modify: `apps/desktop/src/main/project-changes.ts` (`ChangedFile` 타입, `listProjectChanges`)
- Modify: `apps/desktop/src/shared/ipc-contract.ts:239-244` (`ChangesListRes`)
- Test: `apps/desktop/src/main/project-changes.test.ts`

**Interfaces:**
- Consumes: Task 1 `parseNumstat`, Task 2 `countUntrackedAdditions`
- Produces: `ChangedFile`에 `additions?: number; deletions?: number; binary?: boolean` — Task 5(DiffPanel)가 소비

- [ ] **Step 1: 실패하는 테스트 작성**

`listProjectChanges (integration, real git)` describe에 추가:

```ts
  test('modified 파일에 +/− 카운트, untracked에 줄 수가 붙는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-numstat-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(join(dir, 'doc.md'), 'a\nb\nc\n')
    execFileSync('git', ['add', 'doc.md'], { cwd: dir })
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir })
    writeFileSync(join(dir, 'doc.md'), 'a\nX\nY\nc\n')          // 1줄 삭제, 2줄 추가
    writeFileSync(join(dir, 'fresh.md'), 'one\ntwo\n')          // untracked 2줄
    const res = listProjectChanges([dir], null)
    expect(res.ok).toBe(true)
    const mod = res.files?.find((f) => f.path === 'doc.md')
    expect(mod?.additions).toBe(2)
    expect(mod?.deletions).toBe(1)
    const fresh = res.files?.find((f) => f.path === 'fresh.md')
    expect(fresh?.additions).toBe(2)
    expect(fresh?.deletions).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  test('빈 repo(HEAD 없음)에서도 목록은 나온다 (카운트는 untracked 계산)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-nohead-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(join(dir, 'a.md'), 'x\n')
    const res = listProjectChanges([dir], null)
    expect(res.ok).toBe(true)
    expect(res.files?.find((f) => f.path === 'a.md')?.additions).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run project-changes`
Expected: FAIL — `additions`가 `undefined`

- [ ] **Step 3: 구현**

`ChangedFile` 타입 확장 (`project-changes.ts:6`):

```ts
export type ChangedFile = {
  path: string; status: ChangeStatus; isMarkdown: boolean; mtimeMs: number; unreflected?: boolean
  additions?: number; deletions?: number; binary?: boolean
}
```

`listProjectChanges` 본문 교체 (repo 루프 안):

```ts
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
    // tracked 변경(staged+unstaged, 삭제 포함)의 증감량. 빈 repo(HEAD 없음)면 카운트 없이 진행.
    let numstat = new Map<string, NumstatEntry>()
    try {
      numstat = parseNumstat(execFileSync('git', ['diff', 'HEAD', '--numstat', '--find-renames'], { cwd: repo, encoding: 'utf8', timeout: 15_000 }))
    } catch { /* HEAD 없음 등 — 목록은 계속 */ }
    for (const row of parsePorcelain(stdout)) {
      let mtimeMs = 0
      try { mtimeMs = statSync(join(repo, row.path)).mtimeMs } catch { /* 삭제된 파일 등 */ }
      const ns = numstat.get(row.path)
      let additions: number | undefined
      let deletions: number | undefined
      let binary: boolean | undefined
      if (ns) {
        if (ns.additions === null) binary = true
        else { additions = ns.additions; deletions = ns.deletions ?? 0 }
      } else if (row.status === 'new') {
        const counted = countUntrackedAdditions(join(repo, row.path))
        if (counted === null) binary = true
        else { additions = counted; deletions = 0 }
      }
      all.push({ ...row, isMarkdown: /\.mdx?$/i.test(row.path), mtimeMs, additions, deletions, binary })
    }
  }
  return { ok: true, files: markUnreflected(all, latestIngestAt) }
}
```

`ipc-contract.ts`의 `ChangesListRes` files 원소 확장:

```ts
export type ChangesListRes = {
  ok: boolean
  reason?: string
  files?: {
    path: string; status: 'new' | 'modified' | 'deleted'; isMarkdown: boolean; mtimeMs: number; unreflected?: boolean
    additions?: number; deletions?: number; binary?: boolean
  }[]
}
```

- [ ] **Step 4: 통과 확인 + 회귀**

Run: `npx vitest run project-changes ipc.test`
Expected: 전부 PASS (ipc.test의 changesList 계약 테스트는 additive 확장이라 영향 없음)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/project-changes.ts apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/project-changes.test.ts
git commit -m "feat(desktop): changesList 응답에 파일별 +/− 증감량 추가"
```

---

### Task 4: `diffProjectFile` 삭제 파일 지원

**Files:**
- Modify: `apps/desktop/src/main/project-changes.ts:68-87`
- Test: `apps/desktop/src/main/project-changes.test.ts`

**Interfaces:**
- Produces: 삭제된 tracked 파일도 `{ ok: true, patch }` 반환 (Task 5의 펼침이 소비)

- [ ] **Step 1: 실패하는 테스트 작성**

`diffProjectFile (integration, real git)` describe에 추가:

```ts
  test('삭제된 tracked 파일 → 전체 삭제 patch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apc-diff-deleted-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    writeFileSync(join(dir, 'gone.md'), 'bye\n')
    execFileSync('git', ['add', 'gone.md'], { cwd: dir })
    commit(dir, 'init')
    rmSync(join(dir, 'gone.md'))
    const res = diffProjectFile([dir], 'gone.md')
    expect(res.ok).toBe(true)
    expect(res.patch).toContain('-bye')
    rmSync(dir, { recursive: true, force: true })
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run project-changes`
Expected: FAIL — `ok: false, reason: 파일을 찾을 수 없음: gone.md`

- [ ] **Step 3: 구현 — tracked diff를 stat보다 먼저 시도**

`diffProjectFile` 교체:

```ts
export function diffProjectFile(repoPaths: readonly string[], relPath: string): DiffResult {
  for (const repo of repoPaths) {
    // tracked 변경(삭제 포함): HEAD 대비 — 파일이 디스크에 없어도 동작한다.
    try {
      const tracked = execFileSync('git', ['diff', 'HEAD', '--', relPath], { cwd: repo, encoding: 'utf8', timeout: 15_000 })
      if (tracked.trim()) return { ok: true, patch: tracked }
    } catch { /* HEAD 없음(빈 repo) 등 — untracked 경로로 폴백 */ }
    // untracked: 디스크에 실제로 있는 repo에서만 --no-index 비교
    try { statSync(join(repo, relPath)) } catch { continue }
    try {
      // Git for Windows maps the literal '/dev/null' to the NUL device internally, so this is portable.
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

- [ ] **Step 4: 통과 확인 (기존 3개 + 신규 1개)**

Run: `npx vitest run project-changes`
Expected: diffProjectFile 4개 전부 PASS — 특히 기존 `untracked`/`missing` 테스트가 그대로 통과해야 한다

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/project-changes.ts apps/desktop/src/main/project-changes.test.ts
git commit -m "fix(desktop): 삭제된 파일도 diff 조회 가능"
```

---

### Task 5: `DiffPanel` 컴포넌트

**Files:**
- Create: `apps/desktop/src/renderer/components/DiffPanel.tsx`
- Create: `apps/desktop/src/renderer/components/DiffPanel.test.tsx`
- Modify: `apps/desktop/src/renderer/app.css` (파일 끝에 `.diff-panel` 블록 추가)

**Interfaces:**
- Consumes: `api.changesList` / `api.changesDiff` (Task 3·4의 확장 응답), `parseUnifiedDiff` (`harness-utils.ts`)
- Produces: `export function DiffPanel(props: { open: boolean; projectId: string | null; onClose: () => void })` — Task 6이 App.tsx에서 사용

- [ ] **Step 1: 실패하는 테스트 작성** (`DiffPanel.test.tsx` — HomeView.test.tsx의 api Proxy mock 패턴)

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { DiffPanel } from './DiffPanel.js'

const changesList = vi.fn(async () => ({
  ok: true,
  files: [
    { path: 'src/x.ts', status: 'modified', isMarkdown: false, mtimeMs: 2, additions: 12, deletions: 3 },
    { path: 'docs/new.md', status: 'new', isMarkdown: true, mtimeMs: 2, additions: 5, deletions: 0 },
    { path: 'assets/logo.png', status: 'modified', isMarkdown: false, mtimeMs: 2, binary: true },
  ],
}))
const changesDiff = vi.fn(async () => ({
  ok: true,
  patch: 'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,2 +1,2 @@\n-old line\n+new line\n context\n',
}))
vi.mock('../api.js', () => ({
  api: new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'changesList') return (...a: unknown[]) => changesList(...a as [])
      if (prop === 'changesDiff') return (...a: unknown[]) => changesDiff(...a as [])
      return vi.fn(async () => ({ ok: true }))
    },
  }),
}))

beforeEach(() => vi.clearAllMocks())

describe('DiffPanel', () => {
  test('닫혀 있으면 아무것도 렌더하지 않는다', () => {
    render(<DiffPanel open={false} projectId="p1" onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(changesList).not.toHaveBeenCalled()
  })

  test('열면 파일 목록과 +/− 스탯, 총계를 보여준다', async () => {
    render(<DiffPanel open projectId="p1" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('src/x.ts')).toBeDefined())
    expect(screen.getByText('+12')).toBeDefined()
    expect(screen.getByText('−3')).toBeDefined()
    expect(screen.getByText('binary')).toBeDefined()
    expect(screen.getByText('+17')).toBeDefined()   // 총계 12+5
    expect(screen.getByText('−3', { selector: '.diff-panel__total-del' })).toBeDefined()
  })

  test('파일 클릭 → changesDiff 호출, unified 라인 렌더', async () => {
    render(<DiffPanel open projectId="p1" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('src/x.ts')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /src\/x\.ts/ }))
    await waitFor(() => expect(screen.getByText('new line')).toBeDefined())
    expect(changesDiff).toHaveBeenCalledWith({ projectId: 'p1', relPath: 'src/x.ts' })
    expect(screen.getByText('old line')).toBeDefined()
    // 재클릭 → 접힘
    fireEvent.click(screen.getByRole('button', { name: /src\/x\.ts/ }))
    expect(screen.queryByText('new line')).toBeNull()
  })

  test('Esc와 ✕ 버튼이 onClose를 부른다', async () => {
    const onClose = vi.fn()
    render(<DiffPanel open projectId="p1" onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('src/x.ts')).toBeDefined())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '변경사항 닫기' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  test('빈 변경분 → clean 메시지, 실패 → reason 표시', async () => {
    changesList.mockResolvedValueOnce({ ok: true, files: [] })
    const { unmount } = render(<DiffPanel open projectId="p1" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/working tree clean/)).toBeDefined())
    unmount()
    changesList.mockResolvedValueOnce({ ok: false, reason: 'git 실패' })
    render(<DiffPanel open projectId="p1" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText(/git 실패/)).toBeDefined())
  })

  test('projectId 없음 → 프로젝트 선택 안내', () => {
    render(<DiffPanel open projectId={null} onClose={() => {}} />)
    expect(screen.getByText('프로젝트를 선택하세요')).toBeDefined()
    expect(changesList).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run DiffPanel`
Expected: FAIL — `Cannot find module './DiffPanel.js'`

- [ ] **Step 3: 구현** (`DiffPanel.tsx`)

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangesListRes } from '../../shared/ipc-contract.js'
import { api } from '../api.js'
import { parseUnifiedDiff } from '../harness-utils.js'

type ChangedFile = NonNullable<ChangesListRes['files']>[number]
type PatchState = { patch?: string; error?: string }

type Props = { open: boolean; projectId: string | null; onClose: () => void }

const MARKER: Record<ChangedFile['status'], string> = { new: '+', modified: '±', deleted: '−' }

/** 우측 오버레이 Diff 패널 — 변경 파일 목록(+N −N)과 클릭 펼침 unified diff. */
export function DiffPanel({ open, projectId, onClose }: Props) {
  const [files, setFiles] = useState<ChangedFile[] | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [patches, setPatches] = useState<Record<string, PatchState>>({})

  const load = useCallback(() => {
    if (!projectId) return
    setFiles(null); setReason(null); setExpanded(null); setPatches({})
    void api.changesList({ projectId }).then((res) => {
      if (res.ok) setFiles(res.files ?? [])
      else setReason(res.reason ?? '변경분을 가져올 수 없습니다')
    })
  }, [projectId])

  useEffect(() => { if (open) load() }, [open, load])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const totals = useMemo(() => {
    let add = 0, del = 0
    for (const f of files ?? []) { add += f.additions ?? 0; del += f.deletions ?? 0 }
    return { add, del }
  }, [files])

  const toggle = (f: ChangedFile) => {
    const next = expanded === f.path ? null : f.path
    setExpanded(next)
    if (next && !patches[f.path] && projectId) {
      void api.changesDiff({ projectId, relPath: f.path }).then((res) => {
        setPatches((p) => ({ ...p, [f.path]: res.ok ? { patch: res.patch ?? '' } : { error: res.reason ?? 'diff 조회 실패' } }))
      })
    }
  }

  if (!open) return null

  return (
    <div className="diff-panel" role="dialog" aria-label="변경사항">
      <header className="diff-panel__header">
        <h2>변경사항</h2>
        {files && (
          <span className="diff-panel__totals">
            파일 {files.length} · <span className="diff-panel__total-add">+{totals.add}</span>{' '}
            <span className="diff-panel__total-del">−{totals.del}</span>
          </span>
        )}
        <button type="button" onClick={load} aria-label="변경사항 새로고침" disabled={!projectId}>⟳</button>
        <button type="button" onClick={onClose} aria-label="변경사항 닫기">✕</button>
      </header>
      <div className="diff-panel__list">
        {!projectId && <div className="diff-panel__empty">프로젝트를 선택하세요</div>}
        {projectId && reason && <div className="diff-panel__empty">⚠ {reason}</div>}
        {projectId && !reason && files === null && <div className="diff-panel__empty">불러오는 중…</div>}
        {projectId && files?.length === 0 && <div className="diff-panel__empty">변경분 없음 — working tree clean</div>}
        {files?.map((f) => (
          <div key={f.path} className="diff-panel__item">
            <button
              type="button"
              className="diff-panel__row"
              aria-expanded={expanded === f.path}
              onClick={() => toggle(f)}
            >
              <span className={`diff-panel__st diff-panel__st--${f.status}`}>{MARKER[f.status]}</span>
              <span className="diff-panel__path">{f.path}</span>
              {f.binary
                ? <span className="diff-panel__binary">binary</span>
                : (
                  <span className="diff-panel__stats">
                    {f.additions !== undefined && <span className="diff-panel__add">+{f.additions}</span>}
                    {f.deletions !== undefined && <span className="diff-panel__del">−{f.deletions}</span>}
                  </span>
                )}
            </button>
            {expanded === f.path && <ExpandedDiff state={patches[f.path]} />}
          </div>
        ))}
      </div>
    </div>
  )
}

function ExpandedDiff({ state }: { state: PatchState | undefined }) {
  if (!state) return <div className="diff-panel__empty">불러오는 중…</div>
  if (state.error) return <div className="diff-panel__empty">⚠ {state.error}</div>
  const parsed = parseUnifiedDiff(state.patch ?? '')
  if (parsed.length === 0) return <div className="diff-panel__empty">표시할 diff 없음</div>
  return (
    <div className="diff-panel__patch">
      {parsed.flatMap((file) => file.rows.map((row, i) => (
        <div key={`${file.path}:${i}`} className={`diff-panel__line diff-panel__line--${row.kind}`}>
          <span className="diff-panel__lineno">{row.leftNumber ?? ''}</span>
          <span className="diff-panel__lineno">{row.rightNumber ?? ''}</span>
          <code>{row.kind === 'delete' ? row.left : row.right}</code>
        </div>
      )))}
    </div>
  )
}
```

`app.css` 끝에 추가:

```css
/* ── Diff panel (우측 오버레이) ─────────────────────────── */
.diff-panel {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: min(560px, 92vw);
  background: var(--panel);
  border-left: 1px solid var(--line-strong);
  box-shadow: var(--shadow);
  z-index: 80;
  display: flex;
  flex-direction: column;
}
.diff-panel__header {
  display: flex; align-items: center; gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--line);
}
.diff-panel__header h2 { flex: 0 0 auto; }
.diff-panel__totals { flex: 1; font-size: 0.82rem; color: var(--muted); }
.diff-panel__total-add, .diff-panel__add { color: var(--success); }
.diff-panel__total-del, .diff-panel__del { color: var(--danger); }
.diff-panel__list { flex: 1; overflow-y: auto; padding: var(--space-2); }
.diff-panel__row {
  display: flex; align-items: center; gap: var(--space-2);
  width: 100%; text-align: left;
  border: none; border-radius: var(--radius-sm); background: none;
  padding: 6px 8px; box-shadow: none;
}
.diff-panel__row:hover:not(:disabled) { background: rgba(126, 152, 183, 0.08); transform: none; box-shadow: none; }
.diff-panel__st { width: 14px; text-align: center; font-weight: 700; }
.diff-panel__st--new { color: var(--success); }
.diff-panel__st--modified { color: var(--warning); }
.diff-panel__st--deleted { color: var(--danger); }
.diff-panel__path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85rem; }
.diff-panel__stats { display: flex; gap: 6px; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
.diff-panel__binary { font-size: 0.75rem; color: var(--subtle); }
.diff-panel__patch {
  margin: 0 8px var(--space-2) 22px;
  border: 1px solid var(--line); border-radius: var(--radius-sm);
  overflow-x: auto; font-size: 0.78rem;
}
.diff-panel__line { display: flex; gap: 8px; padding: 0 8px; white-space: pre; }
.diff-panel__line--add { background: rgba(74, 222, 128, 0.12); }
.diff-panel__line--delete { background: rgba(251, 113, 133, 0.12); }
.diff-panel__lineno { width: 34px; flex: 0 0 auto; text-align: right; color: var(--subtle); user-select: none; }
.diff-panel__empty { padding: var(--space-3); color: var(--muted); font-size: 0.85rem; }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run DiffPanel`
Expected: 6개 테스트 전부 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/DiffPanel.tsx apps/desktop/src/renderer/components/DiffPanel.test.tsx apps/desktop/src/renderer/app.css
git commit -m "feat(desktop): Diff 패널 컴포넌트 (파일별 증감량 + 펼침 diff)"
```

---

### Task 6: App 배선 — 툴바 버튼 + Ctrl+Shift+D

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx` (import, state, 단축키 effect, toolbarActions, 렌더)
- Test: `apps/desktop/src/renderer/App.test.tsx`

**Interfaces:**
- Consumes: Task 5 `DiffPanel`

- [ ] **Step 1: 실패하는 테스트 작성**

`App.test.tsx`에 추가 (기존 mock 구조 안에서 — `changesList`가 mock api Proxy에 없으면 기본 `{ ok: true }` 반환으로 충분):

```tsx
  test('Ctrl+Shift+D가 Diff 패널을 토글한다', async () => {
    render(<App />)
    fireEvent.keyDown(window, { code: 'KeyD', key: 'D', ctrlKey: true, shiftKey: true })
    expect(await screen.findByRole('dialog', { name: '변경사항' })).toBeDefined()
    fireEvent.keyDown(window, { code: 'KeyD', key: 'D', ctrlKey: true, shiftKey: true })
    expect(screen.queryByRole('dialog', { name: '변경사항' })).toBeNull()
  })

  test('툴바 ± 버튼으로 Diff 패널을 연다', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '변경사항 (Ctrl+Shift+D)' }))
    expect(await screen.findByRole('dialog', { name: '변경사항' })).toBeDefined()
  })
```

주의: App.test.tsx의 기존 렌더 셋업(projects/store mock)을 그대로 따른다. 기존 테스트가 `render(<App />)`에 별도 준비가 필요하면 그 패턴을 복사할 것.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run App.test`
Expected: FAIL — dialog 없음

- [ ] **Step 3: 구현** (App.tsx)

import 추가:

```tsx
import { DiffPanel } from './components/DiffPanel.js'
```

state 추가 (`searchOpen` 옆):

```tsx
const [diffOpen, setDiffOpen] = useState(false)
```

단축키 effect 추가 (기존 Ctrl+Shift+N effect 아래):

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === 'KeyD') {
      e.preventDefault(); setDiffOpen((v) => !v)
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [])
```

`toolbarActions`에 버튼 추가 (🔎 옆):

```tsx
const toolbarActions = (
  <>
    <button onClick={() => setSearchOpen(true)} title="검색 (Ctrl+K)" aria-label="검색 (Ctrl+K)">🔎</button>
    <button onClick={() => setDiffOpen((v) => !v)} title="변경사항 (Ctrl+Shift+D)" aria-label="변경사항 (Ctrl+Shift+D)">±</button>
    <GlobalMenu items={[{ label: upd.running ? 'Updating…' : '⭳ Update (git pull + pnpm install)', onClick: runUpdate, disabled: upd.running }]} />
  </>
)
```

렌더 추가 (`<SearchModal …/>` 옆):

```tsx
<DiffPanel open={diffOpen} projectId={selectedProjectId} onClose={() => setDiffOpen(false)} />
```

- [ ] **Step 4: 통과 확인 + 회귀**

Run: `npx vitest run App.test DiffPanel`
Expected: 전부 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/App.test.tsx
git commit -m "feat(desktop): 툴바·Ctrl+Shift+D로 Diff 패널 토글"
```

---

### Task 7: 최종 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 타입 검사**

Run: `pnpm typecheck`
Expected: exit 0 (IDE 진단 오경보는 무시 — CLAUDE.md)

- [ ] **Step 2: 전체 테스트**

Run: `pnpm test`
Expected: 전부 PASS (~2.5분)

- [ ] **Step 3: 수동 스모크 (dev 앱)**

Run: `pnpm --filter @apc/desktop dev`
확인 목록:
1. 아무 탭에서 Ctrl+Shift+D → 우측 패널 열림, 파일별 +N −N 표시
2. 파일 클릭 → diff 펼침 (추가=초록, 삭제=빨강), 재클릭 접힘
3. 삭제 파일 클릭 → 전체 `-` patch 표시
4. binary 파일에 `binary` 뱃지
5. Esc·✕ 닫기, ⟳ 새로고침
6. 프로젝트 미선택 상태에서 열면 안내 문구

- [ ] **Step 4: 스모크에서 발견된 문제 수정 후 재커밋** (있다면)

---

## Self-Review 체크 결과

- 스펙 §3(진입점/패널/행/펼침/빈·에러 상태/접근성) → Task 5·6. §4.1 → Task 1·2·3. §4.2 → Task 4. §4.3 → Task 3. §5 엣지(binary/rename/빈 repo/대용량/삭제) → Task 1~4 테스트에 각각 존재. §7 → 각 Task Step 1 + Task 7.
- placeholder 없음 — 모든 코드 스텝에 실제 코드 포함.
- 타입 일관성: `NumstatEntry`(T1) ↔ T3 사용, `ChangedFile` 확장(T3) ↔ `ChangesListRes`(T3) ↔ DiffPanel의 `NonNullable<ChangesListRes['files']>[number]`(T5) 일치. `DiffPanel` props(T5) ↔ App 배선(T6) 일치.
