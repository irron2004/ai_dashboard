# Learning Gate M0~M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 데일리 회고(Learning Gate)의 MVP — ActiveWorkspace 단일화, commit/push 분리, Review Receipt 스토어, pre-push hook 게이트, 회고 탭(수동 teach-back) — 를 구현한다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-07-20-daily-review-gate-design.md`의 M0+M1. 회고 탭에서 프로젝트별 증거(커밋·diff stat)를 보고 critical 질문 5개에 답하면 repo별 Review Receipt(HEAD SHA 바인딩)가 발급되고, receipt가 repo의 `.git`(common dir)의 `apc-gate-reviewed` 파일에 기록되어 pre-push hook이 "리뷰된 SHA의 조상이 아닌 커밋" push를 차단한다. LLM 없음 — 전부 결정론적.

**Tech Stack:** TypeScript 5.5, Electron 31, React 18.3, Zustand 4.5, node:sqlite(Zod 스키마), vitest 2. 테스트는 실제 git 임시 repo 사용.

**Implementation status (2026-07-20): M0~M1 complete.** 구현 커밋은 `7e7dead`~`e65947f`이며, 최종 무결성 계약은 아래 Corrections와 스펙 §10.1을 따른다. 이하의 미체크 박스와 코드 블록은 실행 레시피를 보존한 것이며 현재 구현 상태를 나타내지 않는다.

## 2026-07-20 Implementation Corrections (이하 기존 코드 블록보다 우선)

구현 전 무결성 리뷰에서 발견된 아래 교정을 M0~M1의 최종 계약으로 삼는다.

1. **서버 보유 snapshot:** `retroPrepare`가 `RetroTarget { id, retroId, projectId, repoPath, branch, preparedHeadSha, preparedAt }`를 DB에 저장한다. `receiptIssue`는 렌더러가 보낸 `expectedHeadSha`를 신뢰하지 않고 `targetId`만 받아 저장된 SHA와 현재 HEAD를 비교한다. HEAD drift 시 대상 질문·검증 근거를 초기화하고 재리뷰한다.
2. **대상별 teach-back:** 고정 critical 5문은 각 RetroTarget에 귀속한다. 마감 2문만 하루 전체 질문이다. Receipt는 대상 질문 ID와 답변·검증 근거 snapshot hash를 보존한다.
3. **Receipt 조건:** 대상 critical 5문 응답 + 검증 근거 1개 이상 + 위험·미확인 사항의 명시적 입력 + prepared/current HEAD 동일이 모두 필요하다. M2의 AI 요약·동적 질문은 M1 조건에 포함하지 않는다.
4. **완료 불변식:** `retroComplete`는 질문 응답뿐 아니라 준비된 모든 target이 현재 HEAD와 일치하는 Receipt를 가졌는지 서버에서 확인한다. target 없는 날은 마감 질문만으로 완료할 수 있다.
5. **push 순서:** 앱 push는 `fetch → 필요 시 rebase → 최종 HEAD gate 검증 → git push` 순서다. IPC에서 rebase 전에 한 번 검사하는 방식은 금지한다.
6. **gate 활성 상태:** 미관리 repo만 fail-open이다. hook 설치 또는 첫 receipt 발급 후에는 gate가 enabled이며 reviewed SHA 0개도 fail-closed다. 로컬 hook은 `core.hooksPath`를 존중하고 기존 pre-push hook을 보존·체인한다. `--no-verify`를 막는 원격 enforcement는 후속임을 UI에 명시한다.
7. **일관성:** gate 파일은 atomic write하고, gate 기록 실패 시 DB receipt를 보상 삭제한다. skip drain은 rename 방식으로 concurrent append를 잃지 않는다.
8. **계획 누락 파일:** `gitCommitPush` 제거 시 `apps/desktop/src/renderer/qa/fixture-bridge.ts`, `HomeView.test.tsx`를 함께 변경한다. 회고 탭 추가 시 `MainPanel.test.tsx`의 탭 순서·키보드 기대값도 변경한다.
9. **테스트 보강:** 임의/nonexistent retro target 발급 거부, receipt 없는 회고 완료 거부, rebase 뒤 SHA 변경 차단, 최초 활성화 fail-closed, `core.hooksPath`, 기존 hook 체인, linked worktree 공통 gate, skip 부채 UI를 실제 Git 저장소 테스트에 포함한다.

M1의 제품 강제선은 **push**다. 로컬 commit 및 PR 원격 강제는 이번 범위 밖이며, UI와 문서에서 이를 숨기지 않는다.

## Global Constraints

- 모든 명령은 repo root(`ai_dashboard-main/`)에서 실행: `pnpm typecheck`(권위), `npx vitest run <pattern>`, `pnpm test`(전체 ~2.5분)
- IDE 진단 오경보 무시: `@xterm/…`, `node:sqlite not found`, `node-pty` (CLAUDE.md)
- invoke형 IPC 채널 추가는 3파일: `apps/desktop/src/shared/ipc-contract.ts` → `apps/desktop/src/renderer/api.ts` → `apps/desktop/src/main/ipc.ts` (preload는 generic `invoke`가 있어 event 채널일 때만 수정 — 이번 계획엔 event 채널 없음)
- DB: `CREATE TABLE IF NOT EXISTS` + `addColumnIfMissing()` 멱등 패턴, 컬럼 snake_case ↔ TS camelCase, Zod 스키마는 `packages/shared/src/schema.ts`
- 커밋: Conventional Commits (`feat(pm)`, `feat(desktop)`, `feat(app-services)`, `test(…)`)
- 게이트 판정에 LLM·시각(clock) 사용 금지 — SHA ancestry만. `Date.now()` 사용은 UI 표시용만
- hook/게이트 파일은 repo의 `git rev-parse --git-common-dir` 안에 둔다(작업트리 밖 → diff 오염 없음, WSL/Windows 양쪽에서 동일 경로)

---

### Task 1: ActiveWorktree 전역 상태 (M0)

활성 worktree가 AgentWorkspaceDock 로컬 상태(`projectDocks[].activePath` + `localStorage apc:active-worktree:*`)에만 있다. Zustand store로 승격해 GitSync/회고가 같은 경로를 보게 한다.

**Files:**
- Modify: `apps/desktop/src/renderer/store.ts` (state 필드 ~27행 부근, create() 구현부)
- Modify: `apps/desktop/src/renderer/components/AgentWorkspaceDock.tsx:216-241` (loadWorktrees 내 activePath 확정 지점 2곳), `:307-320` (selectWorktree)
- Test: `apps/desktop/src/renderer/active-worktree.test.ts` (신규)

**Interfaces:**
- Produces: `useStore` state `activeWorktrees: Record<string, string | null>` (projectId → worktree 절대경로), action `setActiveWorktree(projectId: string, worktreePath: string | null): void`. Task 2·8이 소비.

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/renderer/active-worktree.test.ts
import { describe, expect, test, vi } from 'vitest'

vi.mock('./api.js', () => ({ api: {} }))

import { useStore } from './store.js'

describe('activeWorktrees', () => {
  test('setActiveWorktree stores per-project path and allows clearing', () => {
    useStore.getState().setActiveWorktree('p1', '/repo/wt-feature')
    useStore.getState().setActiveWorktree('p2', '/other/main')
    expect(useStore.getState().activeWorktrees['p1']).toBe('/repo/wt-feature')
    expect(useStore.getState().activeWorktrees['p2']).toBe('/other/main')
    useStore.getState().setActiveWorktree('p1', null)
    expect(useStore.getState().activeWorktrees['p1']).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/desktop/src/renderer/active-worktree.test.ts`
Expected: FAIL — `setActiveWorktree is not a function` (또는 타입 에러)

- [ ] **Step 3: Implement store slice**

`apps/desktop/src/renderer/store.ts`의 `type ApcStore = {` 블록에서 `selectedProjectId: string | null` 아래에 추가:

```ts
  /** Active worktree per project (AgentWorkspaceDock tab selection). null/absent → repoPaths[0]. */
  activeWorktrees: Record<string, string | null>
  setActiveWorktree(projectId: string, worktreePath: string | null): void
```

`create<ApcStore>()` 구현부에서 `selectedProjectId: null,` 근처에 추가:

```ts
  activeWorktrees: {},
  setActiveWorktree: (projectId, worktreePath) =>
    set((s) => ({ activeWorktrees: { ...s.activeWorktrees, [projectId]: worktreePath } })),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/desktop/src/renderer/active-worktree.test.ts`
Expected: PASS

- [ ] **Step 5: Wire the dock**

`AgentWorkspaceDock.tsx` 컴포넌트 상단(`const stopAgent = useStore(...)` 아래)에:

```ts
  const setActiveWorktree = useStore((state) => state.setActiveWorktree)
```

세 지점에서 activePath가 확정될 때마다 호출:

1. `loadWorktrees` 성공 경로 — `activePathRef.current[projectId] = activePath` (216행 부근) 바로 다음 줄에 `setActiveWorktree(projectId, activePath)`
2. `loadWorktrees` catch 경로 — `activePathRef.current[projectId] = activePath` (234행 부근) 바로 다음 줄에 동일 호출
3. `selectWorktree` (307행) — `activePathRef.current[projectId] = worktreePath` 다음 줄에 `setActiveWorktree(projectId, worktreePath)`

`loadWorktrees`의 `useCallback` 의존성 배열에 `setActiveWorktree` 추가.

- [ ] **Step 6: Verify & commit**

Run: `pnpm typecheck && npx vitest run apps/desktop/src/renderer`
Expected: 타입 에러 0, 기존 renderer 테스트 전부 PASS

```bash
git add apps/desktop/src/renderer/store.ts apps/desktop/src/renderer/components/AgentWorkspaceDock.tsx apps/desktop/src/renderer/active-worktree.test.ts
git commit -m "feat(desktop): active worktree를 전역 store로 승격"
```

---

### Task 2: git IPC의 worktree 라우팅 (M0)

git 핸들러들이 `project.repoPaths[0]` 고정 대신, 렌더러가 보낸 활성 worktree를 검증 후 사용한다.

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts:305-320` (GitStatusReq/GitFetchReq/GitPullReq)
- Modify: `apps/desktop/src/main/ipc.ts:346-379` (git 핸들러들) — 헬퍼 `resolveGitRepoPath` 추가 및 export
- Modify: `apps/desktop/src/renderer/components/GitSyncPanel.tsx` (활성 worktree 전달·표시)
- Test: `apps/desktop/src/main/resolve-git-repo-path.test.ts` (신규)

**Interfaces:**
- Consumes: Task 1의 `useStore().activeWorktrees`
- Produces: `resolveGitRepoPath(container, projectId, worktreePath?) → Promise<{ ok: true; repoPath: string } | { ok: false; reason: string }>` (ipc.ts에서 export — Task 7의 게이트 핸들러도 재사용). Req 타입들에 `worktreePath?: string` 추가.

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/main/resolve-git-repo-path.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { buildContainer } from './container.js'
import { resolveGitRepoPath } from './ipc.js'

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV })
}

/** repo + a second worktree, so the resolver has a real `git worktree list` to validate against. */
function makeRepoWithWorktree(): { base: string; repo: string; worktree: string } {
  const base = mkdtempSync(join(tmpdir(), 'apc-wt-'))
  const repo = join(base, 'repo')
  git(base, ['init', '-b', 'main', 'repo'])
  writeFileSync(join(repo, 'a.txt'), 'x\n')
  git(repo, ['add', '.']); git(repo, ['commit', '-m', 'c1'])
  const worktree = join(base, 'wt-feature')
  git(repo, ['worktree', 'add', '-b', 'feature', worktree])
  return { base, repo, worktree }
}

describe('resolveGitRepoPath', () => {
  let vaultDir: string
  let container: ReturnType<typeof buildContainer>
  let dirs: { base: string; repo: string; worktree: string }

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), 'apc-resolve-'))
    dirs = makeRepoWithWorktree()
    container = buildContainer({ dbFile: ':memory:', vaultRoot: vaultDir })
    container.registry.register({
      id: 'p1', name: 'APC', status: 'active', projectType: 'git', domain: 'project-docs',
      repoPaths: [dirs.repo], vaultPaths: [], sourcePaths: [],
    })
  })

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true })
    rmSync(dirs.base, { recursive: true, force: true })
  })

  test('without worktreePath falls back to repoPaths[0]; unknown project fails', async () => {
    expect(await resolveGitRepoPath(container, 'p1')).toEqual({ ok: true, repoPath: dirs.repo })
    expect((await resolveGitRepoPath(container, 'missing')).ok).toBe(false)
  })

  test('accepts a registered worktree, rejects an arbitrary path', async () => {
    expect(await resolveGitRepoPath(container, 'p1', dirs.worktree)).toEqual({ ok: true, repoPath: dirs.worktree })
    const rejected = await resolveGitRepoPath(container, 'p1', join(dirs.base, 'elsewhere'))
    expect(rejected.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/desktop/src/main/resolve-git-repo-path.test.ts`
Expected: FAIL — `resolveGitRepoPath`가 export되지 않음

- [ ] **Step 3: Implement resolver + handler rewiring**

`ipc-contract.ts` 305행 부근 세 타입에 `worktreePath?: string` 추가:

```ts
export type GitStatusReq = { projectId: string; fetch?: boolean; worktreePath?: string }
// …
export type GitFetchReq = { projectId: string; worktreePath?: string }
export type GitPullReq = { projectId: string; worktreePath?: string }
```

`ipc.ts` — `handlers()` 함수 위에 추가하고 export:

```ts
/** Resolve the repo path a git command should run in. A caller-supplied worktreePath is only
 * honored when `git worktree list` for the registered repo actually contains it. */
export async function resolveGitRepoPath(
  container: Container,
  projectId: string,
  worktreePath?: string,
): Promise<{ ok: true; repoPath: string } | { ok: false; reason: string }> {
  const project = container.registry.get(projectId)
  if (!project) return { ok: false, reason: 'project not found' }
  const base = project.repoPaths[0] ?? ''
  if (!worktreePath || worktreePath === base) return { ok: true, repoPath: base }
  const listed = await listGitWorktrees(base)
  if (listed.ok && listed.worktrees.some((w) => w.path === worktreePath)) return { ok: true, repoPath: worktreePath }
  return { ok: false, reason: `등록되지 않은 worktree 경로입니다: ${worktreePath}` }
}
```

git 핸들러 4곳(gitStatus/gitFetch/gitPull — gitCommitPush는 Task 3에서 대체) 수정. 예 — `gitStatus`:

```ts
    [CH.gitStatus]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string(), fetch: z.boolean().optional(), worktreePath: z.string().optional() }).strict().parse(payload) as GitStatusReq
      const resolved = await resolveGitRepoPath(container, req.projectId, req.worktreePath)
      if (!resolved.ok) return { ok: false, reason: resolved.reason, detached: false, ahead: 0, behind: 0, hasChanges: false, files: [], warnings: [] }
      return container.gitSync.status(resolved.repoPath, { fetch: req.fetch })
    },
```

`gitFetch`/`gitPull`도 동일 패턴(zod에 `worktreePath: z.string().optional()` 추가, 실패 시 `{ ok: false, reason: resolved.reason }`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/desktop/src/main/resolve-git-repo-path.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: GitSyncPanel이 활성 worktree를 전달·표시**

`GitSyncPanel.tsx`:

```ts
import { useStore } from '../store.js'
// 컴포넌트 안, useState들 위:
  const activeWorktree = useStore((s) => (projectId ? s.activeWorktrees[projectId] : null)) ?? null
```

- `loadStatus`의 호출을 `api.gitStatus({ projectId, fetch, worktreePath: activeWorktree ?? undefined })`로, `useCallback` 의존성에 `activeWorktree` 추가
- `runPull`을 `api.gitPull({ projectId, worktreePath: activeWorktree ?? undefined })`로
- 헤더의 `<p>{repoPath || '등록된 repo 경로 없음'}</p>`를 `<p>{activeWorktree ?? repoPath ?? '등록된 repo 경로 없음'}{activeWorktree ? ' (worktree)' : ''}</p>`로

- [ ] **Step 6: Verify & commit**

Run: `pnpm typecheck && npx vitest run apps/desktop/src/main apps/desktop/src/renderer`
Expected: PASS (기존 ipc.test.ts 포함 회귀 없음)

```bash
git add apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/resolve-git-repo-path.test.ts apps/desktop/src/renderer/components/GitSyncPanel.tsx
git commit -m "feat(desktop): git IPC가 활성 worktree를 검증 후 사용"
```

---

### Task 3: commit과 push 분리 (M0)

`GitSyncService.commitPush()` 한 호출(commit→fetch→rebase→push)을 `commit()`/`push()`로 분리한다. push가 별도 호출이어야 Task 9에서 receipt 재검증을 끼울 수 있다.

**Files:**
- Modify: `packages/shared/src/git-sync-schema.ts:32-38` (`committedSha` 추가)
- Modify: `packages/app-services/src/git-sync-service.ts:163-206` (commitPush → commit/push, `runGit` export)
- Modify: `apps/desktop/src/shared/ipc-contract.ts` (`gitCommitPush` 채널 → `gitCommit`+`gitPush`), `apps/desktop/src/renderer/api.ts`, `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/renderer/components/GitSyncPanel.tsx` (버튼 분리)
- Test: `packages/app-services/src/git-sync-split.test.ts` (신규)

**Interfaces:**
- Produces:
  - `GitSyncService.commit(repoPath: string, files: string[], message: string): Promise<GitSyncResult>` — push하지 않고 커밋만, 성공 시 `committedSha` 포함
  - `GitSyncService.push(repoPath: string): Promise<GitSyncResult>` — fetch → behind면 rebase(clean tree 필요) → push
  - `runGit(cwd: string, args: string[], timeoutMs?: number): Promise<{ code: number; stdout: string; stderr: string }>` — git-sync-service.ts에서 export (Task 5의 GateService가 재사용)
  - IPC: `CH.gitCommit`/`CH.gitPush`, `GitCommitReq = { projectId; files: string[]; message: string; worktreePath?: string }`, `GitPushReq = { projectId; worktreePath?: string }`, `api.gitCommit`/`api.gitPush`
- 소비처였던 `gitCommitPush`(GitSyncPanel 단독)는 이 태스크에서 함께 제거 — 하위호환 불필요

- [ ] **Step 1: Write the failing test**

```ts
// packages/app-services/src/git-sync-split.test.ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, test } from 'vitest'
import { GitSyncService } from './git-sync-service.js'

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_TERMINAL_PROMPT: '0' }
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV })
}

function makeRepoWithRemote(): { repo: string; remote: string } {
  const base = mkdtempSync(join(tmpdir(), 'apc-split-'))
  const remote = join(base, 'remote.git')
  const repo = join(base, 'repo')
  git(base, ['init', '--bare', 'remote.git'])
  git(base, ['init', '-b', 'main', 'repo'])
  git(repo, ['remote', 'add', 'origin', remote])
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, ['add', '.']); git(repo, ['commit', '-m', 'c1'])
  git(repo, ['push', '-u', 'origin', 'main'])
  return { repo, remote }
}

describe('GitSyncService commit/push split', () => {
  test('commit commits selected files WITHOUT pushing and returns committedSha', async () => {
    const { repo, remote } = makeRepoWithRemote()
    writeFileSync(join(repo, 'a.txt'), 'two\n')
    const svc = new GitSyncService()
    const result = await svc.commit(repo, ['a.txt'], 'feat: two')
    expect(result.ok).toBe(true)
    expect(result.committedSha).toMatch(/^[0-9a-f]{40}$/)
    expect(git(repo, ['rev-parse', 'HEAD']).trim()).toBe(result.committedSha)
    // remote must still be at c1 — nothing pushed
    expect(git(remote, ['rev-list', '--count', 'main']).trim()).toBe('1')
  })

  test('push pushes the commit; commit-level guards still apply', async () => {
    const { repo, remote } = makeRepoWithRemote()
    writeFileSync(join(repo, 'a.txt'), 'two\n')
    const svc = new GitSyncService()
    await svc.commit(repo, ['a.txt'], 'feat: two')
    const pushed = await svc.push(repo)
    expect(pushed.ok).toBe(true)
    expect(git(remote, ['rev-list', '--count', 'main']).trim()).toBe('2')
    // guard: empty selection refuses
    expect((await svc.commit(repo, [], 'x')).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/app-services/src/git-sync-split.test.ts`
Expected: FAIL — `svc.commit is not a function`

- [ ] **Step 3: Implement the split**

`packages/shared/src/git-sync-schema.ts`의 `GitSyncResultSchema`에 필드 추가:

```ts
export const GitSyncResultSchema = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
  output: z.string().optional(),
  status: GitSyncStatusSchema.optional(),
  committedSha: z.string().optional(),
})
```

`git-sync-service.ts` — 파일 상단의 `GIT_ENV`/`GitRun` 아래에 `runGit`을 추출·export하고, `GitSyncService.git`이 이를 사용하게:

```ts
export function runGit(cwd: string, args: string[], timeoutMs = 30_000): Promise<GitRun> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) { resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) }); return }
      const err = error as GitError
      resolve({
        code: typeof err.code === 'number' ? err.code : 1,
        stdout: err.stdout?.toString() ?? String(stdout ?? ''),
        stderr: err.stderr?.toString() ?? String(stderr ?? err.message),
      })
    })
  })
}
```

클래스 내부 `private git(cwd, args, timeoutMs = this.timeoutMs)`의 본문은 `return runGit(cwd, args, timeoutMs)`로 축소. `type GitRun`은 export로 변경(`export type GitRun = …`).

`commitPush` 메서드(163-206행)를 삭제하고 두 메서드로 대체:

```ts
  /** Stage the selected files and commit. Never pushes — pushing is a separate, gate-checked step. */
  async commit(repoPath: string, files: string[], message: string): Promise<GitSyncResult> {
    const selected = [...new Set(files)].filter(Boolean)
    if (selected.length === 0) return { ok: false, reason: '커밋할 파일을 선택하세요' }
    if (!message.trim()) return { ok: false, reason: '커밋 메시지를 입력하세요' }
    const unsafe = selected.find((file) => !safePath(file))
    if (unsafe) return { ok: false, reason: `허용되지 않는 경로입니다: ${unsafe}` }

    const before = await this.status(repoPath)
    if (!before.ok || !before.root) return { ok: false, reason: before.reason, status: before }
    if (before.files.some((file) => file.conflict)) return { ok: false, reason: '충돌 파일이 있어 커밋을 중단했습니다', status: before }
    const selectedSet = new Set(selected)
    const stagedElsewhere = before.files.find((file) => file.staged && !selectedSet.has(file.path))
    if (stagedElsewhere) return { ok: false, reason: `선택하지 않은 staged 파일이 있습니다: ${stagedElsewhere.path}`, status: before }

    const added = await this.git(before.root, ['add', '-A', '--', ...selected])
    if (added.code !== 0) return { ok: false, reason: commandFailed(['add', '-A', '--', ...selected], added), status: await this.status(before.root) }
    const staged = await this.git(before.root, ['diff', '--cached', '--name-only', '--', ...selected])
    if (staged.code !== 0) return { ok: false, reason: commandFailed(['diff', '--cached', '--name-only', '--', ...selected], staged), status: await this.status(before.root) }
    if (!staged.stdout.trim()) return { ok: false, reason: '선택한 파일에 staged 변경분이 없습니다', status: await this.status(before.root) }

    const committed = await this.git(before.root, ['commit', '-m', message.trim()], 120_000)
    if (committed.code !== 0) return { ok: false, reason: commandFailed(['commit', '-m', '<message>'], committed), output: compactOutput(committed), status: await this.status(before.root) }
    const head = await this.git(before.root, ['rev-parse', 'HEAD'])
    const next = await this.status(before.root)
    return { ok: true, output: compactOutput(committed), status: next, committedSha: head.code === 0 ? head.stdout.trim() : undefined }
  }

  /** fetch → (behind이면 clean-tree 조건으로 rebase) → push. detached/no-upstream 가드는 status가 판정. */
  async push(repoPath: string): Promise<GitSyncResult> {
    const before = await this.status(repoPath)
    if (!before.ok || !before.root) return { ok: false, reason: before.reason, status: before }
    if (before.detached) return { ok: false, reason: 'detached HEAD 상태에서는 자동 push를 막았습니다', status: before }
    if (!before.upstream) return { ok: false, reason: 'upstream branch가 없어 push할 수 없습니다. 먼저 git push -u origin <branch>를 설정하세요.', status: before }

    const fetched = await this.git(before.root, ['fetch', '--prune', '--no-tags'], 60_000)
    if (fetched.code !== 0) return { ok: false, reason: commandFailed(['fetch', '--prune', '--no-tags'], fetched), status: await this.status(before.root) }

    let current = await this.status(before.root)
    let output = ''
    if (current.behind > 0) {
      if (current.files.length > 0) return { ok: false, reason: '원격 변경이 있지만 working tree에 변경분이 있어 rebase를 중단했습니다. 정리 후 다시 Push 하세요.', status: current }
      const rebased = await this.git(before.root, ['pull', '--rebase'], 120_000)
      output = compactOutput(rebased)
      if (rebased.code !== 0) return { ok: false, reason: commandFailed(['pull', '--rebase'], rebased), output, status: await this.status(before.root) }
    }

    const pushed = await this.git(before.root, ['push'], 120_000)
    output = [output, compactOutput(pushed)].filter(Boolean).join('\n')
    const next = await this.status(before.root)
    return pushed.code === 0
      ? { ok: true, output, status: next }
      : { ok: false, reason: commandFailed(['push'], pushed), output, status: next }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/app-services/src/git-sync-split.test.ts packages/app-services/src/git-sync-service.test.ts`
Expected: PASS (신규 2 + 기존 파서 테스트)

- [ ] **Step 5: IPC·패널 배선 교체**

`ipc-contract.ts` — `CH`에서 `gitCommitPush: 'c:gitCommitPush',`를 다음으로 교체:

```ts
  gitCommit: 'c:gitCommit',
  gitPush: 'c:gitPush',
```

타입에서 `GitCommitPushReq`를 다음으로 교체:

```ts
export type GitCommitReq = { projectId: string; files: string[]; message: string; worktreePath?: string }
export type GitPushReq = { projectId: string; worktreePath?: string }
```

`api.ts` — `gitCommitPush`를 다음으로 교체 (import 타입도 `GitCommitReq, GitPushReq`로):

```ts
  gitCommit(req: GitCommitReq): Promise<GitSyncRes> {
    return window.apc.invoke(CH.gitCommit, req) as Promise<GitSyncRes>
  },
  gitPush(req: GitPushReq): Promise<GitSyncRes> {
    return window.apc.invoke(CH.gitPush, req) as Promise<GitSyncRes>
  },
```

`main/ipc.ts` — `gitCommitPush` 핸들러를 다음으로 교체 (import 타입 교체 포함):

```ts
    [CH.gitCommit]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string(), files: z.array(z.string()), message: z.string(), worktreePath: z.string().optional() }).strict().parse(payload) as GitCommitReq
      const resolved = await resolveGitRepoPath(container, req.projectId, req.worktreePath)
      if (!resolved.ok) return { ok: false, reason: resolved.reason }
      return container.gitSync.commit(resolved.repoPath, req.files, req.message)
    },

    [CH.gitPush]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string(), worktreePath: z.string().optional() }).strict().parse(payload) as GitPushReq
      const resolved = await resolveGitRepoPath(container, req.projectId, req.worktreePath)
      if (!resolved.ok) return { ok: false, reason: resolved.reason }
      return container.gitSync.push(resolved.repoPath)
    },
```

`GitSyncPanel.tsx` — `type Busy`에 `'commit' | 'push'`로 교체(기존 `'commitPush'` 제거), `runCommitPush`를 두 함수로 교체:

```ts
  const runCommit = async () => {
    if (!projectId) return
    setBusy('commit'); setNotice(null)
    const result = await api.gitCommit({ projectId, files: selected, message, worktreePath: activeWorktree ?? undefined })
    setStatus(result.status ?? status)
    setNotice({ ok: result.ok, text: result.ok ? `Commit 완료 (${result.committedSha?.slice(0, 7) ?? ''})` : (result.reason ?? 'Commit 실패') })
    if (result.ok) { setSelected([]); setMessage(''); onSynced?.() }
    setBusy(null)
  }

  const runPush = async () => {
    if (!projectId) return
    setBusy('push'); setNotice(null)
    const result = await api.gitPush({ projectId, worktreePath: activeWorktree ?? undefined })
    setStatus(result.status ?? status)
    setNotice({ ok: result.ok, text: result.ok ? 'Push 완료' : (result.reason ?? 'Push 실패') })
    if (result.ok) onSynced?.()
    setBusy(null)
  }
```

버튼 영역(`git-sync__commit-row`)을 교체:

```tsx
        <div className="git-sync__commit-row">
          <span>선택한 파일만 add/commit합니다. push는 별도 단계이며 회고 게이트의 검증을 받습니다.</span>
          <button type="button" disabled={!(status?.ok && selected.length > 0 && !!message.trim() && !busy)} onClick={() => void runCommit()}>
            {busy === 'commit' ? '커밋 중…' : 'Commit'}
          </button>
          <button type="button" className="button--accent" disabled={!(status?.ok && !status.detached && !!status.upstream && status.ahead > 0 && !busy)} onClick={() => void runPush()}>
            {busy === 'push' ? 'Push 중…' : `Push${status?.ok && status.ahead > 0 ? ` (↑${status.ahead})` : ''}`}
          </button>
        </div>
```

`canCommitPush` 변수는 삭제(사용처 없음).

- [ ] **Step 6: Verify & commit**

Run: `pnpm typecheck && npx vitest run packages/app-services apps/desktop`
Expected: PASS — `gitCommitPush` 잔존 참조가 있으면 typecheck가 잡는다 (`grep -rn "gitCommitPush" apps packages`로 0건 확인)

```bash
git add packages/shared/src/git-sync-schema.ts packages/app-services/src/git-sync-service.ts packages/app-services/src/git-sync-split.test.ts apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/renderer/api.ts apps/desktop/src/main/ipc.ts apps/desktop/src/renderer/components/GitSyncPanel.tsx
git commit -m "feat(app-services): commit과 push를 분리하고 committedSha 반환"
```

---

### Task 4: 스키마 + 마이그레이션 + ReceiptStore/RetroStore (M1)

**Files:**
- Modify: `packages/shared/src/schema.ts` (말미에 추가), `packages/pm/src/migrate.ts` (테이블 추가)
- Create: `packages/pm/src/receipt-store.ts`, `packages/pm/src/retro-store.ts`
- Modify: `packages/pm/src/index.ts` (export 추가 — 기존 export 나열 방식 그대로)
- Test: `packages/pm/src/receipt-store.test.ts`, `packages/pm/src/retro-store.test.ts`

**Interfaces:**
- Produces (Zod, @apc/shared):
  - `ReviewReceiptSchema` / `ReviewReceipt = { id, projectId, repoPath, branch?, reviewedHeadSha, diffHash?, retroId?, issuedAt }`
  - `RetroSchema` / `Retro = { id, date, startedAt, completedAt? }`
  - `RetroQuestionSchema` / `RetroQuestion = { id, retroId, projectId?, kind: 'template'|'dynamic'|'followup', critical, text, answer?, skipped, answeredAt? }`
  - `GateEventSchema` / `GateEvent = { id, repoPath, kind: 'skip', reason, ts }`
- Produces (@apc/pm):
  - `ReceiptStore`: `add(input: Omit<ReviewReceipt,'id'>): ReviewReceipt`, `latestForRepo(repoPath: string): ReviewReceipt | null`, `listByRetro(retroId: string): ReviewReceipt[]`
  - `RetroStore`: `openForDate(date: string, now?: string): Retro`(있으면 반환·없으면 생성), `getByDate(date: string): Retro | null`, `seedQuestions(retroId: string, questions: Array<{text: string; critical: boolean; kind?: 'template'|'dynamic'|'followup'; projectId?: string}>): RetroQuestion[]`(이미 있으면 기존 반환), `listQuestions(retroId: string): RetroQuestion[]`, `answer(questionId: string, answer: string | null, skipped: boolean, now?: string): void`, `unansweredCritical(retroId: string): number`, `complete(retroId: string, now?: string): { ok: boolean; reason?: string }`, `recordGateEvent(e: Omit<GateEvent,'id'>): GateEvent`, `listGateEvents(limit?: number): GateEvent[]`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/pm/src/receipt-store.test.ts
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migratePm } from './migrate.js'
import { ReceiptStore } from './receipt-store.js'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

describe('ReceiptStore', () => {
  let db: Db; let store: ReceiptStore
  beforeEach(() => { db = openDb(':memory:'); migrate(db); migratePm(db); store = new ReceiptStore(db) })

  test('add + latestForRepo returns the newest receipt for that repo only', () => {
    store.add({ projectId: 'p1', repoPath: '/r1', reviewedHeadSha: SHA_A, retroId: 'retro:2026-07-20', issuedAt: '2026-07-20T10:00:00Z' })
    store.add({ projectId: 'p1', repoPath: '/r1', reviewedHeadSha: SHA_B, retroId: 'retro:2026-07-20', issuedAt: '2026-07-20T12:00:00Z' })
    store.add({ projectId: 'p2', repoPath: '/r2', reviewedHeadSha: SHA_A, issuedAt: '2026-07-20T13:00:00Z' })
    expect(store.latestForRepo('/r1')?.reviewedHeadSha).toBe(SHA_B)
    expect(store.latestForRepo('/none')).toBeNull()
    expect(store.listByRetro('retro:2026-07-20')).toHaveLength(2)
  })
})
```

```ts
// packages/pm/src/retro-store.test.ts
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migratePm } from './migrate.js'
import { RetroStore } from './retro-store.js'

describe('RetroStore', () => {
  let db: Db; let store: RetroStore
  beforeEach(() => { db = openDb(':memory:'); migrate(db); migratePm(db); store = new RetroStore(db) })

  test('openForDate is idempotent; seedQuestions seeds once', () => {
    const a = store.openForDate('2026-07-20', '2026-07-20T09:00:00Z')
    const b = store.openForDate('2026-07-20', '2026-07-20T10:00:00Z')
    expect(b.id).toBe(a.id)
    const seeded = store.seedQuestions(a.id, [
      { text: '무엇이 달라졌나?', critical: true },
      { text: '오늘 배운 것 1가지는?', critical: false },
    ])
    const again = store.seedQuestions(a.id, [{ text: '중복이면 안 됨', critical: true }])
    expect(seeded).toHaveLength(2)
    expect(again).toHaveLength(2)
    expect(store.listQuestions(a.id).map((q) => q.text)).toEqual(['무엇이 달라졌나?', '오늘 배운 것 1가지는?'])
  })

  test('unansweredCritical counts, answer/skip updates, complete gates on remaining answers', () => {
    const retro = store.openForDate('2026-07-20', '2026-07-20T09:00:00Z')
    const [q1, q2] = store.seedQuestions(retro.id, [
      { text: 'critical Q', critical: true },
      { text: 'minor Q', critical: false },
    ])
    expect(store.unansweredCritical(retro.id)).toBe(1)
    expect(store.complete(retro.id, '2026-07-20T21:00:00Z').ok).toBe(false)

    store.answer(q2.id, null, true, '2026-07-20T20:00:00Z')       // minor는 '모르겠음' 허용
    store.answer(q1.id, '큐가 재시도를 지원하게 됐다', false, '2026-07-20T20:01:00Z')
    expect(store.unansweredCritical(retro.id)).toBe(0)
    const done = store.complete(retro.id, '2026-07-20T21:00:00Z')
    expect(done.ok).toBe(true)
    expect(store.getByDate('2026-07-20')?.completedAt).toBe('2026-07-20T21:00:00Z')
  })

  test('critical question cannot be skipped', () => {
    const retro = store.openForDate('2026-07-20')
    const [q1] = store.seedQuestions(retro.id, [{ text: 'critical Q', critical: true }])
    store.answer(q1.id, null, true)
    expect(store.unansweredCritical(retro.id)).toBe(1)   // skip이 무시되어 여전히 미응답
  })

  test('gate events record and list newest-first', () => {
    store.recordGateEvent({ repoPath: '/r1', kind: 'skip', reason: '핫픽스', ts: '2026-07-20T11:00:00Z' })
    store.recordGateEvent({ repoPath: '/r1', kind: 'skip', reason: '데모', ts: '2026-07-20T12:00:00Z' })
    expect(store.listGateEvents().map((e) => e.reason)).toEqual(['데모', '핫픽스'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/pm/src/receipt-store.test.ts packages/pm/src/retro-store.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: Implement schemas + migration + stores**

`packages/shared/src/schema.ts` 말미에 추가 (index.ts는 `export * from './schema.js'` 방식이므로 자동 노출 — 아니라면 index.ts에도 추가):

```ts
// Learning Gate (M1): a Review Receipt binds a completed review to a change snapshot (HEAD SHA),
// not to a date — pushing any commit not covered by a receipt is blocked by the pre-push hook.
export const ReviewReceiptSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  repoPath: z.string().min(1),
  branch: z.string().optional(),
  reviewedHeadSha: z.string().regex(/^[0-9a-f]{40}$/),
  diffHash: z.string().optional(),
  retroId: z.string().optional(),
  issuedAt: z.string(),
})
export type ReviewReceipt = z.infer<typeof ReviewReceiptSchema>

export const RetroSchema = z.object({
  id: z.string().min(1),          // `retro:${YYYY-MM-DD}`
  date: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
})
export type Retro = z.infer<typeof RetroSchema>

export const RetroQuestionKind = z.enum(['template', 'dynamic', 'followup'])
export const RetroQuestionSchema = z.object({
  id: z.string().min(1),
  retroId: z.string().min(1),
  projectId: z.string().optional(),
  kind: RetroQuestionKind,
  critical: z.boolean().default(false),
  text: z.string().min(1),
  answer: z.string().optional(),
  skipped: z.boolean().default(false),
  answeredAt: z.string().optional(),
})
export type RetroQuestion = z.infer<typeof RetroQuestionSchema>

export const GateEventSchema = z.object({
  id: z.string().min(1),
  repoPath: z.string().min(1),
  kind: z.enum(['skip']),
  reason: z.string(),
  ts: z.string(),
})
export type GateEvent = z.infer<typeof GateEventSchema>
```

`packages/pm/src/migrate.ts`의 `db.exec` SQL 블록에 테이블 추가 (question_log 다음):

```sql
    CREATE TABLE IF NOT EXISTS review_receipts (
      id                TEXT PRIMARY KEY,
      project_id        TEXT NOT NULL,
      repo_path         TEXT NOT NULL,
      branch            TEXT,
      reviewed_head_sha TEXT NOT NULL,
      diff_hash         TEXT,
      retro_id          TEXT,
      issued_at         TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS retros (
      id           TEXT PRIMARY KEY,
      date         TEXT NOT NULL UNIQUE,
      started_at   TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS retro_questions (
      id          TEXT PRIMARY KEY,
      retro_id    TEXT NOT NULL,
      project_id  TEXT,
      kind        TEXT NOT NULL,
      critical    INTEGER NOT NULL DEFAULT 0,
      text        TEXT NOT NULL,
      answer      TEXT,
      skipped     INTEGER NOT NULL DEFAULT 0,
      answered_at TEXT,
      seq         INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS gate_events (
      id        TEXT PRIMARY KEY,
      repo_path TEXT NOT NULL,
      kind      TEXT NOT NULL,
      reason    TEXT NOT NULL,
      ts        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_repo ON review_receipts(repo_path, issued_at);
    CREATE INDEX IF NOT EXISTS idx_receipts_retro ON review_receipts(retro_id);
    CREATE INDEX IF NOT EXISTS idx_retro_questions_retro ON retro_questions(retro_id, seq);
    CREATE INDEX IF NOT EXISTS idx_gate_events_ts ON gate_events(ts);
```

`packages/pm/src/receipt-store.ts` (NextNoteStore 패턴):

```ts
import { ReviewReceiptSchema, type ReviewReceipt } from '@apc/shared'
import type { Db } from '@apc/core'

type Row = {
  id: string; project_id: string; repo_path: string; branch: string | null
  reviewed_head_sha: string; diff_hash: string | null; retro_id: string | null; issued_at: string
}

function toReceipt(r: Row): ReviewReceipt {
  return ReviewReceiptSchema.parse({
    id: r.id, projectId: r.project_id, repoPath: r.repo_path, branch: r.branch ?? undefined,
    reviewedHeadSha: r.reviewed_head_sha, diffHash: r.diff_hash ?? undefined,
    retroId: r.retro_id ?? undefined, issuedAt: r.issued_at,
  })
}

export class ReceiptStore {
  constructor(private readonly db: Db) {}

  add(input: Omit<ReviewReceipt, 'id'>): ReviewReceipt {
    const id = `receipt:${input.repoPath}:${input.issuedAt}:${Math.random().toString(36).slice(2, 8)}`
    const receipt = ReviewReceiptSchema.parse({ ...input, id })
    this.db.prepare(
      'INSERT INTO review_receipts (id, project_id, repo_path, branch, reviewed_head_sha, diff_hash, retro_id, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(receipt.id, receipt.projectId, receipt.repoPath, receipt.branch ?? null,
      receipt.reviewedHeadSha, receipt.diffHash ?? null, receipt.retroId ?? null, receipt.issuedAt)
    return receipt
  }

  latestForRepo(repoPath: string): ReviewReceipt | null {
    const row = this.db.prepare(
      'SELECT * FROM review_receipts WHERE repo_path = ? ORDER BY issued_at DESC LIMIT 1',
    ).get(repoPath) as Row | undefined
    return row ? toReceipt(row) : null
  }

  listByRetro(retroId: string): ReviewReceipt[] {
    const rows = this.db.prepare('SELECT * FROM review_receipts WHERE retro_id = ? ORDER BY issued_at').all(retroId) as Row[]
    return rows.map(toReceipt)
  }
}
```

`packages/pm/src/retro-store.ts`:

```ts
import { RetroSchema, RetroQuestionSchema, GateEventSchema, type Retro, type RetroQuestion, type GateEvent } from '@apc/shared'
import type { Db } from '@apc/core'

type RetroRow = { id: string; date: string; started_at: string; completed_at: string | null }
type QuestionRow = {
  id: string; retro_id: string; project_id: string | null; kind: string; critical: number
  text: string; answer: string | null; skipped: number; answered_at: string | null; seq: number
}
type GateEventRow = { id: string; repo_path: string; kind: string; reason: string; ts: string }

function toRetro(r: RetroRow): Retro {
  return RetroSchema.parse({ id: r.id, date: r.date, startedAt: r.started_at, completedAt: r.completed_at ?? undefined })
}
function toQuestion(r: QuestionRow): RetroQuestion {
  return RetroQuestionSchema.parse({
    id: r.id, retroId: r.retro_id, projectId: r.project_id ?? undefined, kind: r.kind,
    critical: r.critical === 1, text: r.text, answer: r.answer ?? undefined,
    skipped: r.skipped === 1, answeredAt: r.answered_at ?? undefined,
  })
}

export class RetroStore {
  constructor(private readonly db: Db) {}

  openForDate(date: string, now = new Date().toISOString()): Retro {
    const existing = this.getByDate(date)
    if (existing) return existing
    const retro = RetroSchema.parse({ id: `retro:${date}`, date, startedAt: now })
    this.db.prepare('INSERT INTO retros (id, date, started_at) VALUES (?, ?, ?)').run(retro.id, retro.date, retro.startedAt)
    return retro
  }

  getByDate(date: string): Retro | null {
    const row = this.db.prepare('SELECT * FROM retros WHERE date = ?').get(date) as RetroRow | undefined
    return row ? toRetro(row) : null
  }

  /** Seed once per retro: if the retro already has questions, return them untouched. */
  seedQuestions(
    retroId: string,
    questions: Array<{ text: string; critical: boolean; kind?: 'template' | 'dynamic' | 'followup'; projectId?: string }>,
  ): RetroQuestion[] {
    const existing = this.listQuestions(retroId)
    if (existing.length > 0) return existing
    const insert = this.db.prepare(
      'INSERT INTO retro_questions (id, retro_id, project_id, kind, critical, text, seq) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    questions.forEach((q, seq) => {
      insert.run(`rq:${retroId}:${seq}`, retroId, q.projectId ?? null, q.kind ?? 'template', q.critical ? 1 : 0, q.text, seq)
    })
    return this.listQuestions(retroId)
  }

  listQuestions(retroId: string): RetroQuestion[] {
    const rows = this.db.prepare('SELECT * FROM retro_questions WHERE retro_id = ? ORDER BY seq').all(retroId) as QuestionRow[]
    return rows.map(toQuestion)
  }

  /** '모르겠음'(skipped)은 non-critical 질문에서만 유효 — critical은 답을 써야 한다. */
  answer(questionId: string, answer: string | null, skipped: boolean, now = new Date().toISOString()): void {
    const row = this.db.prepare('SELECT critical FROM retro_questions WHERE id = ?').get(questionId) as { critical: number } | undefined
    if (!row) return
    const allowSkip = skipped && row.critical !== 1
    const text = allowSkip ? null : (answer?.trim() || null)
    this.db.prepare('UPDATE retro_questions SET answer = ?, skipped = ?, answered_at = ? WHERE id = ?')
      .run(text, allowSkip ? 1 : 0, text || allowSkip ? now : null, questionId)
  }

  unansweredCritical(retroId: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS n FROM retro_questions WHERE retro_id = ? AND critical = 1 AND (answer IS NULL OR answer = '')",
    ).get(retroId) as { n: number }
    return row.n
  }

  complete(retroId: string, now = new Date().toISOString()): { ok: boolean; reason?: string } {
    const remaining = this.db.prepare(
      "SELECT COUNT(*) AS n FROM retro_questions WHERE retro_id = ? AND (answer IS NULL OR answer = '') AND skipped = 0",
    ).get(retroId) as { n: number }
    if (remaining.n > 0) return { ok: false, reason: `아직 응답하지 않은 질문이 ${remaining.n}개 있습니다` }
    this.db.prepare('UPDATE retros SET completed_at = ? WHERE id = ?').run(now, retroId)
    return { ok: true }
  }

  recordGateEvent(e: Omit<GateEvent, 'id'>): GateEvent {
    const event = GateEventSchema.parse({ ...e, id: `gate:${e.ts}:${Math.random().toString(36).slice(2, 8)}` })
    this.db.prepare('INSERT INTO gate_events (id, repo_path, kind, reason, ts) VALUES (?, ?, ?, ?, ?)')
      .run(event.id, event.repoPath, event.kind, event.reason, event.ts)
    return event
  }

  listGateEvents(limit = 50): GateEvent[] {
    const rows = this.db.prepare('SELECT * FROM gate_events ORDER BY ts DESC LIMIT ?').all(limit) as GateEventRow[]
    return rows.map((r) => GateEventSchema.parse({ id: r.id, repoPath: r.repo_path, kind: r.kind, reason: r.reason, ts: r.ts }))
  }
}
```

`packages/pm/src/index.ts`에 export 추가 (기존은 `export * from './xxx.js'` 방식이므로 동일하게):

```ts
export * from './receipt-store.js'
export * from './retro-store.js'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/pm packages/shared`
Expected: PASS (신규 6 + 기존 pm/shared 테스트 회귀 없음, migrate.test.ts 포함)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schema.ts packages/pm/src/migrate.ts packages/pm/src/receipt-store.ts packages/pm/src/retro-store.ts packages/pm/src/receipt-store.test.ts packages/pm/src/retro-store.test.ts packages/pm/src/index.ts
git commit -m "feat(pm): Review Receipt·Retro·GateEvent 스키마와 스토어"
```

---

### Task 5: GateService — pre-push hook과 게이트 파일 (M1)

repo의 git common dir에 hook(`hooks/pre-push`)·게이트 파일(`apc-gate-reviewed`)·우회 로그(`apc-gate-skips`)를 관리한다. hook은 push되는 각 ref tip이 리뷰된 SHA와 같거나 그 조상이면 통과시킨다(tip이 커버되면 그 조상 커밋 전부가 커버되므로 tip만 검사하면 충분).

**Files:**
- Create: `packages/app-services/src/gate-service.ts`
- Modify: `packages/app-services/src/index.ts` (export — 기존 방식대로)
- Test: `packages/app-services/src/gate-service.test.ts`

**Interfaces:**
- Consumes: Task 3의 `runGit` (git-sync-service.ts export)
- Produces:
  - `GateStatus = { ok: boolean; reason?: string; hookInstalled: boolean; headSha: string | null; headCovered: boolean; reviewedCount: number }`
  - `GateService`: `installHook(repoPath): Promise<{ ok: boolean; reason?: string }>`, `recordReviewedSha(repoPath, sha): Promise<{ ok: boolean; reason?: string }>`, `status(repoPath): Promise<GateStatus>`, `readAndClearSkips(repoPath): Promise<Array<{ ts: string; reason: string }>>`
  - 의미론: 게이트 파일이 없으면 `headCovered = true`(안전 기본값 — hook과 동일)

- [ ] **Step 1: Write the failing test**

```ts
// packages/app-services/src/gate-service.test.ts
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, test } from 'vitest'
import { GateService } from './gate-service.js'

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_TERMINAL_PROMPT: '0' }
function git(cwd: string, args: string[], extraEnv: Record<string, string> = {}): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...GIT_ENV, ...extraEnv } })
}

function makeRepoWithRemote(): { repo: string } {
  const base = mkdtempSync(join(tmpdir(), 'apc-gate-'))
  const remote = join(base, 'remote.git')
  const repo = join(base, 'repo')
  git(base, ['init', '--bare', 'remote.git'])
  git(base, ['init', '-b', 'main', 'repo'])
  git(repo, ['remote', 'add', 'origin', remote])
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, ['add', '.']); git(repo, ['commit', '-m', 'c1'])
  git(repo, ['push', '-u', 'origin', 'main'])
  return { repo }
}

describe('GateService', () => {
  test('installHook writes an executable marked hook; re-install is idempotent; foreign hook refused', async () => {
    const { repo } = makeRepoWithRemote()
    const svc = new GateService()
    expect((await svc.installHook(repo)).ok).toBe(true)
    const hookPath = join(repo, '.git', 'hooks', 'pre-push')
    expect(existsSync(hookPath)).toBe(true)
    expect(readFileSync(hookPath, 'utf8')).toContain('apc-learning-gate')
    expect((await svc.installHook(repo)).ok).toBe(true)   // idempotent

    writeFileSync(hookPath, '#!/bin/sh\nexit 0\n')        // 다른 hook이 이미 있으면 덮어쓰지 않음
    const refused = await svc.installHook(repo)
    expect(refused.ok).toBe(false)
  })

  test('push allowed with no gate file; blocked for unreviewed commits; allowed after recordReviewedSha', async () => {
    const { repo } = makeRepoWithRemote()
    const svc = new GateService()
    await svc.installHook(repo)

    writeFileSync(join(repo, 'a.txt'), 'two\n')
    git(repo, ['add', '.']); git(repo, ['commit', '-m', 'c2'])
    git(repo, ['push'])                                    // 게이트 파일 없음 → 통과

    writeFileSync(join(repo, 'a.txt'), 'three\n')
    git(repo, ['add', '.']); git(repo, ['commit', '-m', 'c3'])
    const c3 = git(repo, ['rev-parse', 'HEAD']).trim()
    await svc.recordReviewedSha(repo, c3)
    git(repo, ['push'])                                    // c3까지 receipt 커버 → 통과

    writeFileSync(join(repo, 'a.txt'), 'four\n')
    git(repo, ['add', '.']); git(repo, ['commit', '-m', 'c4'])
    expect(() => git(repo, ['push'])).toThrow()            // c4 미커버 → 차단

    const status = await svc.status(repo)
    expect(status).toMatchObject({ hookInstalled: true, headCovered: false, reviewedCount: 1 })
  })

  test('APC_GATE_SKIP bypasses and is logged; readAndClearSkips drains the log', async () => {
    const { repo } = makeRepoWithRemote()
    const svc = new GateService()
    await svc.installHook(repo)
    const head = git(repo, ['rev-parse', 'HEAD']).trim()
    await svc.recordReviewedSha(repo, head)

    writeFileSync(join(repo, 'a.txt'), 'hotfix\n')
    git(repo, ['add', '.']); git(repo, ['commit', '-m', 'hotfix'])
    git(repo, ['push'], { APC_GATE_SKIP: '긴급 핫픽스' })   // 우회 성공 + 기록

    const skips = await svc.readAndClearSkips(repo)
    expect(skips).toHaveLength(1)
    expect(skips[0].reason).toBe('긴급 핫픽스')
    expect(await svc.readAndClearSkips(repo)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/app-services/src/gate-service.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: Implement GateService**

```ts
// packages/app-services/src/gate-service.ts
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { runGit } from './git-sync-service.js'

export type GateStatus = {
  ok: boolean
  reason?: string
  hookInstalled: boolean
  headSha: string | null
  headCovered: boolean
  reviewedCount: number
}

const HOOK_MARKER = '# apc-learning-gate v1'
const MAX_REVIEWED_SHAS = 50

// tip이 리뷰된 SHA와 같거나 그 조상이면 그 아래 조상 커밋 전부가 커버되므로 ref당 tip 1회 검사로 충분.
const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER} — installed by agent-project-console. Reinstall from the app; do not edit.
COMMON_DIR="$(git rev-parse --git-common-dir)"
GATE_FILE="$COMMON_DIR/apc-gate-reviewed"
if [ -n "$APC_GATE_SKIP" ]; then
  printf '%s\\t%s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$APC_GATE_SKIP" >> "$COMMON_DIR/apc-gate-skips"
  echo "apc-gate: 우회가 기록되었습니다 — $APC_GATE_SKIP" >&2
  exit 0
fi
[ -f "$GATE_FILE" ] || exit 0
ZERO=0000000000000000000000000000000000000000
status=0
while read -r _local_ref local_sha _remote_ref _remote_sha; do
  [ "$local_sha" = "$ZERO" ] && continue
  covered=0
  while read -r reviewed; do
    [ -n "$reviewed" ] || continue
    if git merge-base --is-ancestor "$local_sha" "$reviewed" 2>/dev/null; then covered=1; break; fi
  done < "$GATE_FILE"
  if [ "$covered" -ne 1 ]; then
    echo "⛔ apc-gate: 리뷰되지 않은 커밋이 있습니다 ($local_sha)." >&2
    echo "   회고 탭에서 마감하거나 미니 리뷰로 receipt를 발급하세요." >&2
    echo "   긴급 우회: APC_GATE_SKIP=\\"사유\\" git push (기록됩니다)" >&2
    status=1
  fi
done
exit $status
`

export class GateService {
  private async commonDir(repoPath: string): Promise<string | null> {
    const r = await runGit(repoPath, ['rev-parse', '--git-common-dir'])
    if (r.code !== 0) return null
    const dir = r.stdout.trim()
    return isAbsolute(dir) ? dir : resolve(repoPath, dir)
  }

  async installHook(repoPath: string): Promise<{ ok: boolean; reason?: string }> {
    const common = await this.commonDir(repoPath)
    if (!common) return { ok: false, reason: 'git repo가 아닙니다' }
    const hooksDir = join(common, 'hooks')
    const hookPath = join(hooksDir, 'pre-push')
    if (existsSync(hookPath) && !readFileSync(hookPath, 'utf8').includes(HOOK_MARKER)) {
      return { ok: false, reason: `기존 pre-push hook이 있어 덮어쓰지 않았습니다: ${hookPath}` }
    }
    mkdirSync(hooksDir, { recursive: true })
    writeFileSync(hookPath, HOOK_SCRIPT, { encoding: 'utf8' })
    chmodSync(hookPath, 0o755)
    return { ok: true }
  }

  async recordReviewedSha(repoPath: string, sha: string): Promise<{ ok: boolean; reason?: string }> {
    if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, reason: `유효한 SHA가 아닙니다: ${sha}` }
    const common = await this.commonDir(repoPath)
    if (!common) return { ok: false, reason: 'git repo가 아닙니다' }
    const gateFile = join(common, 'apc-gate-reviewed')
    const lines = existsSync(gateFile) ? readFileSync(gateFile, 'utf8').split('\n').filter(Boolean) : []
    const next = [...lines.filter((line) => line !== sha), sha].slice(-MAX_REVIEWED_SHAS)
    writeFileSync(gateFile, next.join('\n') + '\n', { encoding: 'utf8' })
    return { ok: true }
  }

  async status(repoPath: string): Promise<GateStatus> {
    const common = await this.commonDir(repoPath)
    if (!common) return { ok: false, reason: 'git repo가 아닙니다', hookInstalled: false, headSha: null, headCovered: true, reviewedCount: 0 }
    const hookPath = join(common, 'hooks', 'pre-push')
    const hookInstalled = existsSync(hookPath) && readFileSync(hookPath, 'utf8').includes(HOOK_MARKER)
    const gateFile = join(common, 'apc-gate-reviewed')
    const reviewed = existsSync(gateFile) ? readFileSync(gateFile, 'utf8').split('\n').filter(Boolean) : []
    const headRun = await runGit(repoPath, ['rev-parse', 'HEAD'])
    const headSha = headRun.code === 0 ? headRun.stdout.trim() : null
    let headCovered = true                    // 게이트 파일 없음 → 기본 열림 (hook과 동일)
    if (reviewed.length > 0) {
      headCovered = false
      if (headSha) {
        for (const sha of reviewed) {
          const r = await runGit(repoPath, ['merge-base', '--is-ancestor', headSha, sha])
          if (r.code === 0) { headCovered = true; break }
        }
      }
    }
    return { ok: true, hookInstalled, headSha, headCovered, reviewedCount: reviewed.length }
  }

  async readAndClearSkips(repoPath: string): Promise<Array<{ ts: string; reason: string }>> {
    const common = await this.commonDir(repoPath)
    if (!common) return []
    const skipFile = join(common, 'apc-gate-skips')
    if (!existsSync(skipFile)) return []
    const entries = readFileSync(skipFile, 'utf8').split('\n').filter(Boolean).map((line) => {
      const [ts, ...rest] = line.split('\t')
      return { ts, reason: rest.join('\t') }
    })
    rmSync(skipFile)
    return entries
  }
}
```

`packages/app-services/src/index.ts`에 추가 (이 파일은 named export 나열 방식):

```ts
export { GateService, type GateStatus } from './gate-service.js'
```

같은 파일의 기존 줄 `export { GitSyncService, parseGitStatusPorcelainV2 } from './git-sync-service.js'`에 `runGit`도 더한다:

```ts
export { GitSyncService, parseGitStatusPorcelainV2, runGit } from './git-sync-service.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/app-services/src/gate-service.test.ts`
Expected: PASS (3 tests). 실패 시 hook이 실행 안 됐을 가능성 — hookPath 실행권한(755)과 sh 셸 존재 확인.

- [ ] **Step 5: Commit**

```bash
git add packages/app-services/src/gate-service.ts packages/app-services/src/gate-service.test.ts packages/app-services/src/index.ts packages/app-services/src/git-sync-service.ts
git commit -m "feat(app-services): pre-push learning gate 훅과 GateService"
```

---

### Task 6: RetroService — 증거 수집과 receipt 발급 (M1)

**Files:**
- Modify: `packages/app-services/src/git-sync-service.ts` (`headSha`/`logSince` 메서드 추가)
- Create: `packages/app-services/src/retro-service.ts`
- Modify: `packages/app-services/src/index.ts` (export)
- Test: `packages/app-services/src/retro-service.test.ts`

**Interfaces:**
- Consumes: Task 4 `ReceiptStore`/`RetroStore`, Task 5 `GateService`, `GitSyncService`
- Produces:
  - `GitSyncService.headSha(repoPath): Promise<string | null>`, `GitSyncService.logSince(repoPath, sinceSha: string | null, limit?): Promise<Array<{ sha: string; when: string; subject: string }>>`
  - `TEMPLATE_QUESTIONS: Array<{ text: string; critical: boolean }>` (export)
  - `RetroProjectEvidence = { projectId; name; repoPath; branch: string | null; headSha: string | null; headCovered: boolean; hookInstalled: boolean; lastReceiptSha: string | null; commits: Array<{sha; when; subject}>; workingTreeFiles: number }`
  - `RetroService(deps: { registry: { get(id: string): { id: string; name: string; repoPaths: string[] } | undefined }; gitSync: GitSyncService; gate: GateService; receipts: ReceiptStore; retros: RetroStore })`
    - `prepare(date: string, targets: Array<{ projectId: string; worktreePath?: string }>): Promise<{ retro: Retro; questions: RetroQuestion[]; projects: RetroProjectEvidence[]; skips: GateEvent[] }>`
    - `issueReceipt(req: { retroId: string; projectId: string; repoPath: string; expectedHeadSha: string }): Promise<{ ok: boolean; reason?: string; receipt?: ReviewReceipt }>` — 서버측 재검증: critical 질문 전부 응답 + HEAD 불변일 때만 발급, 발급 시 게이트 파일에도 기록
    - `complete(retroId: string): { ok: boolean; reason?: string }` (RetroStore.complete 위임)

- [ ] **Step 1: Write the failing test**

```ts
// packages/app-services/src/retro-service.test.ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migratePm, ReceiptStore, RetroStore } from '@apc/pm'
import { GitSyncService } from './git-sync-service.js'
import { GateService } from './gate-service.js'
import { RetroService, TEMPLATE_QUESTIONS } from './retro-service.js'

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV })
}

function makeRepo(): string {
  const base = mkdtempSync(join(tmpdir(), 'apc-retro-'))
  const repo = join(base, 'repo')
  git(base, ['init', '-b', 'main', 'repo'])
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, ['add', '.']); git(repo, ['commit', '-m', 'c1'])
  return repo
}

describe('RetroService', () => {
  let db: Db; let receipts: ReceiptStore; let retros: RetroStore; let repo: string; let svc: RetroService
  beforeEach(() => {
    db = openDb(':memory:'); migrate(db); migratePm(db)
    receipts = new ReceiptStore(db); retros = new RetroStore(db)
    repo = makeRepo()
    svc = new RetroService({
      registry: { get: (id) => (id === 'p1' ? { id: 'p1', name: '프로젝트1', repoPaths: [repo] } : undefined) },
      gitSync: new GitSyncService(), gate: new GateService(), receipts, retros,
    })
  })

  test('prepare seeds template questions once and collects per-project evidence', async () => {
    const first = await svc.prepare('2026-07-20', [{ projectId: 'p1' }])
    expect(first.questions).toHaveLength(TEMPLATE_QUESTIONS.length)
    expect(first.projects).toHaveLength(1)
    const p = first.projects[0]
    expect(p.name).toBe('프로젝트1')
    expect(p.headSha).toMatch(/^[0-9a-f]{40}$/)
    expect(p.lastReceiptSha).toBeNull()
    expect(p.commits.map((c) => c.subject)).toEqual(['c1'])

    const again = await svc.prepare('2026-07-20', [{ projectId: 'p1' }])
    expect(again.questions).toHaveLength(TEMPLATE_QUESTIONS.length)   // 중복 시드 없음
  })

  test('issueReceipt refuses until critical questions answered, refuses on HEAD drift, then issues', async () => {
    const prep = await svc.prepare('2026-07-20', [{ projectId: 'p1' }])
    const head = prep.projects[0].headSha as string

    const early = await svc.issueReceipt({ retroId: prep.retro.id, projectId: 'p1', repoPath: repo, expectedHeadSha: head })
    expect(early.ok).toBe(false)                                       // critical 미응답

    for (const q of prep.questions.filter((q) => q.critical)) retros.answer(q.id, '검증된 답', false)

    const drifted = await svc.issueReceipt({ retroId: prep.retro.id, projectId: 'p1', repoPath: repo, expectedHeadSha: 'f'.repeat(40) })
    expect(drifted.ok).toBe(false)                                     // 스냅샷 불일치

    const issued = await svc.issueReceipt({ retroId: prep.retro.id, projectId: 'p1', repoPath: repo, expectedHeadSha: head })
    expect(issued.ok).toBe(true)
    expect(issued.receipt?.reviewedHeadSha).toBe(head)
    expect(receipts.latestForRepo(repo)?.reviewedHeadSha).toBe(head)

    const gate = await new GateService().status(repo)                  // 게이트 파일에도 기록됨
    expect(gate.reviewedCount).toBe(1)
    expect(gate.headCovered).toBe(true)
  })

  test('prepare shows commits since the last receipt only', async () => {
    const prep = await svc.prepare('2026-07-20', [{ projectId: 'p1' }])
    for (const q of prep.questions.filter((q) => q.critical)) retros.answer(q.id, '답', false)
    const head = prep.projects[0].headSha as string
    await svc.issueReceipt({ retroId: prep.retro.id, projectId: 'p1', repoPath: repo, expectedHeadSha: head })

    writeFileSync(join(repo, 'a.txt'), 'two\n')
    git(repo, ['add', '.']); git(repo, ['commit', '-m', 'c2'])
    const next = await svc.prepare('2026-07-20', [{ projectId: 'p1' }])
    expect(next.projects[0].commits.map((c) => c.subject)).toEqual(['c2'])
    expect(next.projects[0].headCovered).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/app-services/src/retro-service.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: Implement**

`git-sync-service.ts`의 `GitSyncService`에 메서드 2개 추가:

```ts
  async headSha(repoPath: string): Promise<string | null> {
    const r = await this.git(repoPath, ['rev-parse', 'HEAD'])
    return r.code === 0 ? r.stdout.trim() : null
  }

  async logSince(repoPath: string, sinceSha: string | null, limit = 30): Promise<Array<{ sha: string; when: string; subject: string }>> {
    const range = sinceSha ? [`${sinceSha}..HEAD`] : ['-n', String(limit)]
    const r = await this.git(repoPath, ['log', '--pretty=format:%H%x09%cI%x09%s', ...range])
    if (r.code !== 0 || !r.stdout.trim()) return []
    return r.stdout.split('\n').filter(Boolean).map((line) => {
      const [sha, when, ...rest] = line.split('\t')
      return { sha, when, subject: rest.join('\t') }
    })
  }
```

```ts
// packages/app-services/src/retro-service.ts
import type { GateEvent, Retro, RetroQuestion, ReviewReceipt } from '@apc/shared'
import type { ReceiptStore, RetroStore } from '@apc/pm'
import type { GitSyncService } from './git-sync-service.js'
import type { GateService } from './gate-service.js'

/** Learning Gate 스펙 §4의 고정 teach-back 질문. 1~5 = critical(미응답 시 receipt 불발급),
 *  6~7 = 마감 롤업(모르겠음 허용, 회고 완료에만 필요). */
export const TEMPLATE_QUESTIONS: Array<{ text: string; critical: boolean }> = [
  { text: '이번 변경으로 이전 동작이 어떻게 달라졌는가?', critical: true },
  { text: '가장 중요한 실행 흐름을 시작점부터 결과까지 설명해보라.', critical: true },
  { text: '가장 깨지기 쉬운 지점과 이를 발견할 로그·증상은 무엇인가?', critical: true },
  { text: '어떤 테스트나 실행 결과가 결론을 뒷받침하는가?', critical: true },
  { text: 'agent가 내린 결론 중 직접 확인한 것과 아직 가정인 것은 무엇인가?', critical: true },
  { text: '오늘 배운 것 1가지는?', critical: false },
  { text: '내일 더 깊게 팔 것 1가지는?', critical: false },
]

export type RetroProjectEvidence = {
  projectId: string
  name: string
  repoPath: string
  branch: string | null
  headSha: string | null
  headCovered: boolean
  hookInstalled: boolean
  lastReceiptSha: string | null
  commits: Array<{ sha: string; when: string; subject: string }>
  workingTreeFiles: number
}

type RegistryLike = { get(id: string): { id: string; name: string; repoPaths: string[] } | undefined }

export class RetroService {
  constructor(private readonly deps: {
    registry: RegistryLike
    gitSync: GitSyncService
    gate: GateService
    receipts: ReceiptStore
    retros: RetroStore
  }) {}

  async prepare(date: string, targets: Array<{ projectId: string; worktreePath?: string }>): Promise<{
    retro: Retro; questions: RetroQuestion[]; projects: RetroProjectEvidence[]; skips: GateEvent[]
  }> {
    const { registry, gitSync, gate, receipts, retros } = this.deps
    const retro = retros.openForDate(date)
    const questions = retros.seedQuestions(retro.id, TEMPLATE_QUESTIONS)

    const projects: RetroProjectEvidence[] = []
    const skips: GateEvent[] = []
    for (const target of targets) {
      const project = registry.get(target.projectId)
      if (!project) continue
      const repoPath = target.worktreePath ?? project.repoPaths[0]
      if (!repoPath) continue

      const [status, gateStatus, headSha] = await Promise.all([
        gitSync.status(repoPath),
        gate.status(repoPath),
        gitSync.headSha(repoPath),
      ])
      const lastReceipt = receipts.latestForRepo(repoPath)
      const commits = await gitSync.logSince(repoPath, lastReceipt?.reviewedHeadSha ?? null)
      for (const skip of await gate.readAndClearSkips(repoPath)) {
        skips.push(retros.recordGateEvent({ repoPath, kind: 'skip', reason: skip.reason, ts: skip.ts }))
      }
      projects.push({
        projectId: project.id,
        name: project.name,
        repoPath,
        branch: status.ok ? status.branch ?? null : null,
        headSha,
        headCovered: gateStatus.headCovered,
        hookInstalled: gateStatus.hookInstalled,
        lastReceiptSha: lastReceipt?.reviewedHeadSha ?? null,
        commits,
        workingTreeFiles: status.ok ? status.files.length : 0,
      })
    }
    return { retro, questions, projects, skips: [...skips, ...this.deps.retros.listGateEvents(10)].slice(0, 10) }
  }

  /** 서버측 재검증 — 렌더러 상태를 신뢰하지 않는다: critical 응답 + HEAD 스냅샷 불변일 때만 발급. */
  async issueReceipt(req: { retroId: string; projectId: string; repoPath: string; expectedHeadSha: string }): Promise<{
    ok: boolean; reason?: string; receipt?: ReviewReceipt
  }> {
    const { gitSync, gate, receipts, retros } = this.deps
    const unanswered = retros.unansweredCritical(req.retroId)
    if (unanswered > 0) return { ok: false, reason: `critical 질문 ${unanswered}개가 미응답입니다` }
    const currentHead = await gitSync.headSha(req.repoPath)
    if (!currentHead) return { ok: false, reason: 'HEAD를 읽을 수 없습니다 (커밋 없는 repo?)' }
    if (currentHead !== req.expectedHeadSha) {
      return { ok: false, reason: 'HEAD가 리뷰 시작 이후 변경되었습니다 — 새로고침 후 변경분을 다시 확인하세요' }
    }
    const status = await gitSync.status(req.repoPath)
    const receipt = receipts.add({
      projectId: req.projectId,
      repoPath: req.repoPath,
      branch: status.ok ? status.branch : undefined,
      reviewedHeadSha: currentHead,
      retroId: req.retroId,
      issuedAt: new Date().toISOString(),
    })
    const recorded = await gate.recordReviewedSha(req.repoPath, currentHead)
    if (!recorded.ok) return { ok: false, reason: `receipt는 저장됐지만 게이트 파일 기록 실패: ${recorded.reason}` }
    return { ok: true, receipt }
  }

  complete(retroId: string): { ok: boolean; reason?: string } {
    return this.deps.retros.complete(retroId)
  }
}
```

`packages/app-services/src/index.ts`에 추가:

```ts
export { RetroService, TEMPLATE_QUESTIONS, type RetroProjectEvidence } from './retro-service.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/app-services/src/retro-service.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/app-services/src/retro-service.ts packages/app-services/src/retro-service.test.ts packages/app-services/src/git-sync-service.ts packages/app-services/src/index.ts
git commit -m "feat(app-services): RetroService 증거 수집·receipt 발급"
```

---

### Task 7: IPC 배선 + container 조립 (M1)

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts` (채널 6개 + DTO), `apps/desktop/src/renderer/api.ts`, `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/main/container.ts`
- Test: 기존 `apps/desktop/src/main/ipc.test.ts` 회귀로 검증 (핸들러 로직은 Task 6에서 이미 테스트됨 — 여기선 배선만)

**Interfaces:**
- Consumes: Task 6 `RetroService`, Task 5 `GateService`, Task 4 스토어, Task 2 `resolveGitRepoPath`
- Produces: `CH.retroPrepare('c:retroPrepare')`, `CH.retroAnswer('c:retroAnswer')`, `CH.retroComplete('c:retroComplete')`, `CH.receiptIssue('c:receiptIssue')`, `CH.gateStatus('q:gateStatus')`, `CH.gateInstall('c:gateInstall')` + `api.retroPrepare/retroAnswer/retroComplete/receiptIssue/gateStatus/gateInstall`. Container 필드: `receipts: ReceiptStore`, `retroStore: RetroStore`, `gate: GateService`, `retroService: RetroService`.

- [ ] **Step 1: Contract 타입 추가**

`ipc-contract.ts` — `CH`의 `nextNoteDelete` 아래에 채널 6개 추가(위 Produces의 문자열 그대로). 타입 섹션에 추가:

```ts
// Learning Gate (M1) — retro prepare/answer/complete + receipt/gate surface.
import type { Retro, RetroQuestion, ReviewReceipt, GateEvent } from '@apc/shared'   // 파일 상단 import에 병합

export type RetroProjectEvidenceDto = {
  projectId: string
  name: string
  repoPath: string
  branch: string | null
  headSha: string | null
  headCovered: boolean
  hookInstalled: boolean
  lastReceiptSha: string | null
  commits: Array<{ sha: string; when: string; subject: string }>
  workingTreeFiles: number
}
export type RetroPrepareReq = { date: string; targets: Array<{ projectId: string; worktreePath?: string }> }
export type RetroPrepareRes = { ok: boolean; reason?: string; retro?: Retro; questions?: RetroQuestion[]; projects?: RetroProjectEvidenceDto[]; skips?: GateEvent[] }
export type RetroAnswerReq = { questionId: string; answer?: string; skipped?: boolean }
export type RetroAnswerRes = { ok: boolean }
export type RetroCompleteReq = { retroId: string }
export type RetroCompleteRes = { ok: boolean; reason?: string }
export type ReceiptIssueReq = { retroId: string; projectId: string; repoPath: string; expectedHeadSha: string }
export type ReceiptIssueRes = { ok: boolean; reason?: string; receipt?: ReviewReceipt }
/** gateStatus·gateInstall 공용 요청 — 기존 GitStatusReq와 헷갈리지 않도록 이름을 분리했다. */
export type GateQueryReq = { projectId: string; worktreePath?: string }
export type GateStatusRes = { ok: boolean; reason?: string; hookInstalled: boolean; headSha: string | null; headCovered: boolean; reviewedCount: number }
export type GateInstallReq = GateQueryReq
export type GateInstallRes = { ok: boolean; reason?: string }
```

- [ ] **Step 2: api.ts 함수 추가**

```ts
  retroPrepare(req: RetroPrepareReq): Promise<RetroPrepareRes> {
    return window.apc.invoke(CH.retroPrepare, req) as Promise<RetroPrepareRes>
  },
  retroAnswer(req: RetroAnswerReq): Promise<RetroAnswerRes> {
    return window.apc.invoke(CH.retroAnswer, req) as Promise<RetroAnswerRes>
  },
  retroComplete(req: RetroCompleteReq): Promise<RetroCompleteRes> {
    return window.apc.invoke(CH.retroComplete, req) as Promise<RetroCompleteRes>
  },
  receiptIssue(req: ReceiptIssueReq): Promise<ReceiptIssueRes> {
    return window.apc.invoke(CH.receiptIssue, req) as Promise<ReceiptIssueRes>
  },
  gateStatus(req: GateQueryReq): Promise<GateStatusRes> {
    return window.apc.invoke(CH.gateStatus, req) as Promise<GateStatusRes>
  },
  gateInstall(req: GateInstallReq): Promise<GateInstallRes> {
    return window.apc.invoke(CH.gateInstall, req) as Promise<GateInstallRes>
  },
```

- [ ] **Step 3: container 조립**

`container.ts` — Container 타입(84행 부근, `gitSync: GitSyncService` 아래)에:

```ts
  receipts: ReceiptStore
  retroStore: RetroStore
  gate: GateService
  retroService: RetroService
```

factory(242행 부근 `const gitSync = new GitSyncService()` 아래 — 기존 pm 스토어들이 생성되는 곳과 같은 db 인스턴스 사용):

```ts
  const receipts = new ReceiptStore(db)
  const retroStore = new RetroStore(db)
  const gate = new GateService()
  const retroService = new RetroService({ registry, gitSync, gate, receipts, retros: retroStore })
```

반환 객체(460행 부근)에 `receipts, retroStore, gate, retroService,` 추가. import는 `@apc/pm`(ReceiptStore, RetroStore)·`@apc/app-services`(GateService, RetroService)에서.

- [ ] **Step 4: ipc.ts 핸들러 추가**

`handlers()` 맵 말미(gitPush 아래)에:

```ts
    [CH.retroPrepare]: async (payload: unknown) => {
      const req = z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        targets: z.array(z.object({ projectId: z.string(), worktreePath: z.string().optional() })),
      }).strict().parse(payload) as RetroPrepareReq
      const targets: Array<{ projectId: string; worktreePath?: string }> = []
      for (const t of req.targets) {
        const resolved = await resolveGitRepoPath(container, t.projectId, t.worktreePath)
        if (resolved.ok && resolved.repoPath) targets.push({ projectId: t.projectId, worktreePath: resolved.repoPath })
      }
      const prepared = await container.retroService.prepare(req.date, targets)
      return { ok: true, ...prepared }
    },

    [CH.retroAnswer]: async (payload: unknown) => {
      const req = z.object({ questionId: z.string(), answer: z.string().optional(), skipped: z.boolean().optional() }).strict().parse(payload) as RetroAnswerReq
      container.retroStore.answer(req.questionId, req.answer ?? null, req.skipped ?? false)
      return { ok: true }
    },

    [CH.retroComplete]: async (payload: unknown) => {
      const req = z.object({ retroId: z.string() }).strict().parse(payload) as RetroCompleteReq
      return container.retroService.complete(req.retroId)
    },

    [CH.receiptIssue]: async (payload: unknown) => {
      const req = z.object({ retroId: z.string(), projectId: z.string(), repoPath: z.string(), expectedHeadSha: z.string() }).strict().parse(payload) as ReceiptIssueReq
      // repoPath는 렌더러가 보낸 값이므로 재검증: 등록 repo 또는 그 worktree여야 한다.
      const resolved = await resolveGitRepoPath(container, req.projectId, req.repoPath)
      if (!resolved.ok) return { ok: false, reason: resolved.reason }
      return container.retroService.issueReceipt({ ...req, repoPath: resolved.repoPath })
    },

    [CH.gateStatus]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string(), worktreePath: z.string().optional() }).strict().parse(payload) as GateQueryReq
      const resolved = await resolveGitRepoPath(container, req.projectId, req.worktreePath)
      if (!resolved.ok) return { ok: false, reason: resolved.reason, hookInstalled: false, headSha: null, headCovered: true, reviewedCount: 0 }
      return container.gate.status(resolved.repoPath)
    },

    [CH.gateInstall]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string(), worktreePath: z.string().optional() }).strict().parse(payload) as GateInstallReq
      const resolved = await resolveGitRepoPath(container, req.projectId, req.worktreePath)
      if (!resolved.ok) return { ok: false, reason: resolved.reason }
      return container.gate.installHook(resolved.repoPath)
    },
```

import 타입 목록에 `RetroPrepareReq, RetroAnswerReq, RetroCompleteReq, ReceiptIssueReq, GateQueryReq, GateInstallReq` 추가.

- [ ] **Step 5: Verify & commit**

Run: `pnpm typecheck && npx vitest run apps/desktop/src/main`
Expected: PASS (ipc.test.ts 회귀 없음 — 핸들러 맵에 채널이 추가돼도 기존 테스트는 영향 없어야 함)

```bash
git add apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/renderer/api.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/container.ts
git commit -m "feat(desktop): Learning Gate IPC 채널과 container 조립"
```

---

### Task 8: 회고 탭 RetroView (M1)

**Files:**
- Create: `apps/desktop/src/renderer/components/RetroView.tsx`
- Modify: `apps/desktop/src/renderer/components/MainPanel.tsx:14,34-41,58,123-141` (MainTab·TABS·projectRequired·렌더)
- Modify: `apps/desktop/src/renderer/App.tsx:38-44` (localStorage 복원 화이트리스트)
- Modify: `apps/desktop/src/renderer/app.css` (말미에 retro 클래스 추가)
- Test: `apps/desktop/src/renderer/retro-view.test.tsx`

**Interfaces:**
- Consumes: `api.listProjects/retroPrepare/retroAnswer/receiptIssue/retroComplete/nextNoteAdd`, `useStore().activeWorktrees`
- Produces: `RetroView`(props 없음 — 자체 로드), MainTab `'retro'`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/desktop/src/renderer/retro-view.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

const SHA = 'c'.repeat(40)
const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(async () => [{ id: 'p1', name: '프로젝트1', repoPaths: ['/r1'] }]),
  retroPrepare: vi.fn(async () => ({
    ok: true,
    retro: { id: 'retro:2026-07-20', date: '2026-07-20', startedAt: '2026-07-20T09:00:00Z' },
    questions: [
      { id: 'rq:1', retroId: 'retro:2026-07-20', kind: 'template', critical: true, text: '이번 변경으로 이전 동작이 어떻게 달라졌는가?', skipped: false },
      { id: 'rq:2', retroId: 'retro:2026-07-20', kind: 'template', critical: false, text: '오늘 배운 것 1가지는?', skipped: false },
    ],
    projects: [{
      projectId: 'p1', name: '프로젝트1', repoPath: '/r1', branch: 'main', headSha: SHA,
      headCovered: false, hookInstalled: true, lastReceiptSha: null,
      commits: [{ sha: SHA, when: '2026-07-20T10:00:00+09:00', subject: 'feat: 큐 재시도' }], workingTreeFiles: 0,
    }],
    skips: [],
  })),
  retroAnswer: vi.fn(async () => ({ ok: true })),
  receiptIssue: vi.fn(async () => ({ ok: true, receipt: { id: 'r1', projectId: 'p1', repoPath: '/r1', reviewedHeadSha: SHA, issuedAt: '2026-07-20T21:00:00Z' } })),
  retroComplete: vi.fn(async () => ({ ok: true })),
  nextNoteAdd: vi.fn(async () => ({ ok: true })),
}))

vi.mock('./api.js', () => ({ api: mocks }))

import { RetroView } from './components/RetroView.js'

describe('RetroView', () => {
  test('loads evidence + questions, answers a question, issues a receipt', async () => {
    render(<RetroView />)
    await waitFor(() => expect(screen.getByText('프로젝트1')).toBeTruthy())
    expect(screen.getByText('feat: 큐 재시도')).toBeTruthy()

    const answerBoxes = screen.getAllByRole('textbox')
    fireEvent.change(answerBoxes[0], { target: { value: '재시도가 3회로 제한된다' } })
    fireEvent.blur(answerBoxes[0])
    await waitFor(() => expect(mocks.retroAnswer).toHaveBeenCalledWith({ questionId: 'rq:1', answer: '재시도가 3회로 제한된다', skipped: false }))

    fireEvent.click(screen.getByRole('button', { name: /receipt 발급/i }))
    await waitFor(() => expect(mocks.receiptIssue).toHaveBeenCalledWith({
      retroId: 'retro:2026-07-20', projectId: 'p1', repoPath: '/r1', expectedHeadSha: SHA,
    }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/desktop/src/renderer/retro-view.test.tsx`
Expected: FAIL — RetroView 모듈 없음

- [ ] **Step 3: Implement RetroView**

```tsx
// apps/desktop/src/renderer/components/RetroView.tsx
import { useCallback, useEffect, useState } from 'react'
import type { Retro, RetroQuestion } from '@apc/shared'
import type { RetroProjectEvidenceDto } from '../../shared/ipc-contract.js'
import { api } from '../api.js'
import { useStore } from '../store.js'

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function RetroView() {
  const activeWorktrees = useStore((s) => s.activeWorktrees)
  const [retro, setRetro] = useState<Retro | null>(null)
  const [questions, setQuestions] = useState<RetroQuestion[]>([])
  const [evidence, setEvidence] = useState<RetroProjectEvidenceDto[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [receiptedRepos, setReceiptedRepos] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    const projects = await api.listProjects()
    const targets = projects
      .filter((p) => p.repoPaths.length > 0)
      .map((p) => ({ projectId: p.id, worktreePath: activeWorktrees[p.id] ?? undefined }))
    const res = await api.retroPrepare({ date: todayLocal(), targets })
    if (!res.ok || !res.retro) { setNotice({ ok: false, text: res.reason ?? '회고를 준비할 수 없습니다' }); return }
    setRetro(res.retro)
    setQuestions(res.questions ?? [])
    setEvidence(res.projects ?? [])
    setDrafts(Object.fromEntries((res.questions ?? []).map((q) => [q.id, q.answer ?? ''])))
  }, [activeWorktrees])

  useEffect(() => { void load() }, [load])

  const saveAnswer = async (q: RetroQuestion, skipped: boolean) => {
    const answer = skipped ? undefined : drafts[q.id]?.trim()
    if (!skipped && !answer) return
    await api.retroAnswer({ questionId: q.id, answer, skipped })
    setQuestions((qs) => qs.map((item) => item.id === q.id
      ? { ...item, answer: skipped ? undefined : answer, skipped, answeredAt: new Date().toISOString() }
      : item))
  }

  const criticalRemaining = questions.filter((q) => q.critical && !q.answer).length
  const allDone = questions.every((q) => (q.answer && q.answer.length > 0) || q.skipped)

  const issueReceipt = async (p: RetroProjectEvidenceDto) => {
    if (!retro || !p.headSha) return
    const res = await api.receiptIssue({ retroId: retro.id, projectId: p.projectId, repoPath: p.repoPath, expectedHeadSha: p.headSha })
    setNotice({ ok: res.ok, text: res.ok ? `${p.name}: receipt 발급 — push 가능 🔓` : (res.reason ?? '발급 실패') })
    if (res.ok) setReceiptedRepos((prev) => new Set(prev).add(p.repoPath))
  }

  const completeRetro = async () => {
    if (!retro) return
    const res = await api.retroComplete({ retroId: retro.id })
    setNotice({ ok: res.ok, text: res.ok ? '오늘 회고 완료 ✅' : (res.reason ?? '완료 실패') })
    if (res.ok) {
      const dig = questions.find((q) => q.text.includes('깊게 팔 것'))
      const firstProject = evidence[0]
      if (dig?.answer && firstProject) void api.nextNoteAdd({ projectId: firstProject.projectId, text: `[회고] ${dig.answer}` })
      void load()
    }
  }

  return (
    <div className="retro" role="region" aria-label="데일리 회고">
      <header className="retro__header">
        <h2>회고 · {retro?.date ?? todayLocal()}</h2>
        {retro?.completedAt && <span className="retro__done-badge">완료됨</span>}
        {notice && <span className={notice.ok ? 'retro__notice--ok' : 'retro__notice--err'}>{notice.text}</span>}
      </header>

      <section className="retro__section panel" aria-label="오늘의 작업 증거">
        <h3>① 오늘의 작업 증거</h3>
        {evidence.length === 0 && <p className="retro__empty">repo가 등록된 프로젝트가 없습니다</p>}
        {evidence.map((p) => (
          <details key={p.repoPath} className="retro-project" open={!p.headCovered}>
            <summary>
              <strong>{p.name}</strong> · {p.branch ?? 'branch?'} · 미리뷰 커밋 {p.commits.length}개
              {p.headCovered || receiptedRepos.has(p.repoPath) ? ' ✅' : ' ⛔'}
              {!p.hookInstalled && <em className="retro-project__nohook"> (hook 미설치 — 문서 탭 Git 패널에서 설치)</em>}
            </summary>
            <ul className="retro-project__commits">
              {p.commits.map((c) => (
                <li key={c.sha}><code>{c.sha.slice(0, 7)}</code> {c.subject}</li>
              ))}
              {p.commits.length === 0 && <li>receipt 이후 새 커밋 없음</li>}
            </ul>
            {p.workingTreeFiles > 0 && <p className="retro-project__wt">working tree 변경 {p.workingTreeFiles}개 파일 (커밋 전 — receipt 범위 밖)</p>}
            <button
              type="button"
              disabled={criticalRemaining > 0 || !p.headSha || receiptedRepos.has(p.repoPath)}
              onClick={() => void issueReceipt(p)}
            >
              {receiptedRepos.has(p.repoPath) ? 'Receipt 발급됨' : criticalRemaining > 0 ? `Receipt 발급 (critical ${criticalRemaining}개 남음)` : 'Receipt 발급 🔓'}
            </button>
          </details>
        ))}
      </section>

      <section className="retro__section panel" aria-label="Teach-back 질문">
        <h3>② Teach-back {criticalRemaining > 0 ? `(critical ${criticalRemaining}개 남음)` : '✅'}</h3>
        {questions.map((q) => (
          <div key={q.id} className={`retro-question${q.critical ? ' retro-question--critical' : ''}`}>
            <label>
              {q.critical ? '★ ' : ''}{q.text}
              <textarea
                value={drafts[q.id] ?? ''}
                disabled={q.skipped}
                onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                onBlur={() => void saveAnswer(q, false)}
                rows={2}
              />
            </label>
            {!q.critical && (
              <button type="button" disabled={q.skipped} onClick={() => void saveAnswer(q, true)}>
                {q.skipped ? '모르겠음 (기록됨)' : '모르겠음'}
              </button>
            )}
            {q.answer && <span className="retro-question__saved">저장됨</span>}
          </div>
        ))}
      </section>

      <section className="retro__section panel" aria-label="회고 마감">
        <h3>③ 마감</h3>
        <p>critical 질문에 모두 답하면 repo별 Receipt를 발급할 수 있고, 전체 응답 후 회고를 완료합니다.</p>
        <button type="button" className="button--accent" disabled={!allDone || !!retro?.completedAt} onClick={() => void completeRetro()}>
          {retro?.completedAt ? '오늘 회고 완료됨' : '회고 완료'}
        </button>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: 탭 등록**

`MainPanel.tsx`:
- 14행: `export type MainTab = 'workspace' | 'home' | 'documents' | 'knowledge' | 'wikigen' | 'history' | 'retro'`
- `TABS` 배열 말미에 `{ id: 'retro', icon: '🧠', label: '회고' },`
- 58행: `const projectRequired = tab !== 'workspace' && tab !== 'retro' && projectLoadState !== 'ready'`
- import에 `import { RetroView } from './RetroView.js'`, 렌더 블록(workspace 위)에 `{tab === 'retro' && <RetroView />}`

`App.tsx` 41행 화이트리스트에 `|| saved === 'retro'` 추가:

```ts
      if (saved === 'workspace' || saved === 'home' || saved === 'documents' || saved === 'knowledge' || saved === 'wikigen' || saved === 'history' || saved === 'retro') return saved
```

`app.css` 말미에:

```css
/* Learning Gate — retro tab */
.retro { display: flex; flex-direction: column; gap: 12px; padding: 12px; overflow-y: auto; }
.retro__header { display: flex; align-items: baseline; gap: 12px; }
.retro__notice--ok { color: var(--ok, #2e7d32); }
.retro__notice--err { color: var(--err, #c62828); }
.retro__section { padding: 12px; }
.retro-project { margin: 8px 0; }
.retro-project__commits { margin: 6px 0 6px 16px; font-size: 12px; }
.retro-project__nohook { color: var(--err, #c62828); font-style: normal; }
.retro-project__wt { font-size: 12px; opacity: 0.7; }
.retro-question { margin: 10px 0; }
.retro-question--critical label { font-weight: 600; }
.retro-question textarea { display: block; width: 100%; margin-top: 4px; }
.retro-question__saved { font-size: 11px; opacity: 0.6; margin-left: 6px; }
.retro__empty { opacity: 0.6; }
.retro__done-badge { font-size: 12px; color: var(--ok, #2e7d32); }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run apps/desktop/src/renderer/retro-view.test.tsx && pnpm typecheck`
Expected: PASS. App.test.tsx 등 기존 renderer 테스트도 `npx vitest run apps/desktop/src/renderer`로 회귀 확인.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/RetroView.tsx apps/desktop/src/renderer/components/MainPanel.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/app.css apps/desktop/src/renderer/retro-view.test.tsx
git commit -m "feat(desktop): 회고 탭 — 증거·teach-back·receipt 발급"
```

---

### Task 9: push의 서버측 게이트 재검증 + GitSyncPanel 게이트 UI (M1)

hook은 터미널 push를 막고, 이 태스크는 앱 내 push 버튼도 같은 판정을 받게 한다(렌더러 상태 불신 — 스펙 §5).

**Files:**
- Modify: `apps/desktop/src/main/ipc.ts` (gitPush 핸들러에 게이트 검사)
- Modify: `apps/desktop/src/renderer/components/GitSyncPanel.tsx` (게이트 상태 표시 + hook 설치 버튼)
- Test: `apps/desktop/src/main/git-push-gate.test.ts`

**Interfaces:**
- Consumes: Task 5 `GateService.status`, Task 7 `api.gateStatus/gateInstall`
- Produces: gitPush 응답에 게이트 차단 사유(`reason`이 '⛔'로 시작) — GitSyncPanel이 표시

- [ ] **Step 1: Write the failing test**

```ts
// apps/desktop/src/main/git-push-gate.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { buildContainer } from './container.js'
import { handlers } from './ipc.js'
import { CH } from '../shared/ipc-contract.js'

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV })
}

function makeRepoWithRemote(): { base: string; repo: string } {
  const base = mkdtempSync(join(tmpdir(), 'apc-pushgate-'))
  git(base, ['init', '--bare', 'remote.git'])
  const repo = join(base, 'repo')
  git(base, ['init', '-b', 'main', 'repo'])
  git(repo, ['remote', 'add', 'origin', join(base, 'remote.git')])
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, ['add', '.']); git(repo, ['commit', '-m', 'c1'])
  git(repo, ['push', '-u', 'origin', 'main'])
  return { base, repo }
}

describe('gitPush handler gate re-verification', () => {
  let vaultDir: string
  let container: ReturnType<typeof buildContainer>
  let dirs: { base: string; repo: string }

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), 'apc-pushgate-vault-'))
    dirs = makeRepoWithRemote()
    container = buildContainer({ dbFile: ':memory:', vaultRoot: vaultDir })
    container.registry.register({
      id: 'p1', name: 'APC', status: 'active', projectType: 'git', domain: 'project-docs',
      repoPaths: [dirs.repo], vaultPaths: [], sourcePaths: [],
    })
  })

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true })
    rmSync(dirs.base, { recursive: true, force: true })
  })

  test('blocks app push when reviewed SHAs exist and HEAD is uncovered; allows after receipt', async () => {
    const head1 = git(dirs.repo, ['rev-parse', 'HEAD']).trim()
    await container.gate.recordReviewedSha(dirs.repo, head1)
    const h = handlers(container)

    writeFileSync(join(dirs.repo, 'a.txt'), 'two\n')
    git(dirs.repo, ['add', '.']); git(dirs.repo, ['commit', '-m', 'c2'])   // 미리뷰 커밋

    const blocked = await h[CH.gitPush]({ projectId: 'p1' }) as { ok: boolean; reason?: string }
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toContain('리뷰되지 않은')

    const head2 = git(dirs.repo, ['rev-parse', 'HEAD']).trim()
    await container.gate.recordReviewedSha(dirs.repo, head2)
    const allowed = await h[CH.gitPush]({ projectId: 'p1' }) as { ok: boolean }
    expect(allowed.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/desktop/src/main/git-push-gate.test.ts`
Expected: FAIL — blocked.ok가 true (게이트 검사 없음)

- [ ] **Step 3: gitPush 핸들러에 게이트 검사 추가**

Task 3에서 만든 `[CH.gitPush]` 핸들러의 `resolveGitRepoPath` 성공 뒤, `container.gitSync.push(...)` 앞에:

```ts
      const gateStatus = await container.gate.status(resolved.repoPath)
      if (gateStatus.ok && gateStatus.reviewedCount > 0 && !gateStatus.headCovered) {
        return { ok: false, reason: '⛔ 리뷰되지 않은 커밋이 있습니다 — 회고 탭에서 마감하거나 미니 리뷰로 receipt를 발급하세요.' }
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/desktop/src/main/git-push-gate.test.ts`
Expected: PASS

- [ ] **Step 5: GitSyncPanel 게이트 UI**

`GitSyncPanel.tsx`에 게이트 상태 로드·표시 추가:

```ts
import type { GateStatusRes } from '../../shared/ipc-contract.js'
// 컴포넌트 안:
  const [gate, setGate] = useState<GateStatusRes | null>(null)

  const loadGate = useCallback(async () => {
    if (!projectId) return
    try { setGate(await api.gateStatus({ projectId, worktreePath: activeWorktree ?? undefined })) } catch { setGate(null) }
  }, [projectId, activeWorktree])

  useEffect(() => { void loadGate() }, [loadGate])

  const installGate = async () => {
    if (!projectId) return
    const res = await api.gateInstall({ projectId, worktreePath: activeWorktree ?? undefined })
    setNotice({ ok: res.ok, text: res.ok ? 'Learning Gate hook 설치 완료' : (res.reason ?? '설치 실패') })
    void loadGate()
  }
```

`runCommit`/`runPush` 성공 시 `void loadGate()` 호출 추가. 헤더 요약 아래에 게이트 라인 렌더 (`git-sync__summary` p 태그 다음):

```tsx
          <p className="git-sync__gate">
            {gate === null ? null : !gate.hookInstalled ? (
              <button type="button" onClick={() => void installGate()}>🧠 Learning Gate 설치</button>
            ) : gate.reviewedCount === 0 ? (
              <span>🧠 게이트 설치됨 · 아직 receipt 없음</span>
            ) : gate.headCovered ? (
              <span>🧠 ✅ HEAD 리뷰 완료 — push 가능</span>
            ) : (
              <span>🧠 ⛔ 미리뷰 커밋 — 회고 탭에서 receipt를 발급하세요</span>
            )}
          </p>
```

`app.css`에 `.git-sync__gate { font-size: 12px; margin: 2px 0 0; }` 추가.

- [ ] **Step 6: Verify & commit**

Run: `pnpm typecheck && npx vitest run apps/desktop`
Expected: PASS

```bash
git add apps/desktop/src/main/ipc.ts apps/desktop/src/main/git-push-gate.test.ts apps/desktop/src/renderer/components/GitSyncPanel.tsx apps/desktop/src/renderer/app.css
git commit -m "feat(desktop): push 서버측 게이트 재검증과 GitSync 게이트 UI"
```

---

### Task 10: 전체 검증과 수동 스모크

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 테스트·타입 검사**

Run: `pnpm typecheck && pnpm test`
Expected: 전부 PASS (~2.5분). 실패 시 해당 태스크로 돌아가 수정 후 재실행.

- [ ] **Step 2: 수동 스모크 (Electron)**

Run: `pnpm --filter @apc/desktop dev`

체크리스트:
1. 문서 탭 Git 패널 — Commit과 Push 버튼이 분리되어 있고, worktree 경로가 헤더에 표시된다
2. Git 패널에서 [🧠 Learning Gate 설치] 클릭 → 대상 repo `.git/hooks/pre-push` 생성 확인
3. 회고 탭(🧠) — 프로젝트별 커밋 증거·질문 7개 렌더, critical 5개 답변 전에는 [Receipt 발급] 비활성
4. critical 5개 답변 → [Receipt 발급] → Git 패널이 `✅ HEAD 리뷰 완료`로 갱신, Push 성공
5. 터미널에서 새 커밋 후 `git push` → hook이 ⛔ 메시지로 차단, `APC_GATE_SKIP="테스트" git push` → 통과. 다음날 회고 prepare 시 skip이 부채로 노출되는지 확인
6. 앱 재시작 → 회고 탭 상태(답변·완료)가 DB에서 복원되는지 확인

- [ ] **Step 3: Commit (문서 갱신이 있었다면)**

수동 스모크에서 발견된 수정은 해당 파일과 함께 `fix(desktop): …`로 커밋.

---

## 스펙 대비 의도적 축소 (M1 범위 밖 — M2/M3 계획에서)

- 결정 인박스·decision-extractor·동적 질문·AI 요약(4분류): M2
- vault `projects/<id>/daily/*.md` 내보내기, 주간 스트립·확신도 대조·eval 후보 풀: M2/M3
- 회고 탭의 탭 아이콘 ⛔ 뱃지(미커버 repo 수): M2 (M1에서는 Git 패널의 게이트 라인이 신호)
- diff 패널과의 커밋 단위 diff 연결(현재는 커밋 목록 + 기존 Ctrl+Shift+D): M2
- "내일 깊게 팔 것" → next_notes 연동은 M1에서 첫 프로젝트로만 저장(프로젝트 선택 UI는 M2)
