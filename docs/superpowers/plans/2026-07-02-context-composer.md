# P2 — LLM 핸드오프: Context Package Composer + dev-run 가시성 (Implementation Plan)

> **For the implementing developer (Sonnet):** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) to implement this plan **task by task, in order**. Steps use checkbox (`- [ ]`) syntax for tracking. Follow TDD: write the failing test first, run it to confirm RED, implement the minimum to go GREEN, then commit. You see ONLY this plan — everything you need is here.

## Goal

PM이 task 하나를 골라 **컨텍스트 패키지**{제목 · 상위 요청 배경 · 수용 기준 · linkedWikiPages 발췌 · 직전 세션 요약}를 하나의 Markdown 프롬프트로 **결정론적으로 조립**하고, 이를 ① dock 에이전트 터미널(pty)에 주입하거나 ② 복사해서 넘길 수 있다. 부가로 dev-harness run이 **시작 즉시 runId를 ack**(`devHarness:started` 이벤트)하고, 완료된 dev-run의 **transcript를 모달로 열람**할 수 있다.

제품 근거: `docs/handoffs/2026-07-02-product-diagnosis-and-roadmap.md` §3-2, §4 P2.

## Architecture

- **순수 조립기** `composeContextPackage()` (신규 `packages/app-services/src/context-composer.ts`): `{task, allTasks, wikiExcerpts, sessionSummary?}` → Markdown 문자열. LLM/IO 없음 → 단위 테스트 가능.
- **메인 프로세스 수집기** `container.composeContext(req)`: `ProjectRegistry`+`TaskStore`+`AgentRunStore`+`vaultRoot`로 task/형제/위키 발췌(기존 `readProjectDoc`의 realpath 가드 재사용)/직전 세션 요약을 모아 순수 조립기에 넘긴다. IPC query `q:composeContext`로 노출.
- **started ack**: `DevHarnessService.run()`에 `onStarted?` 콜백 추가 → `runs.create` 직후 `{runId, taskId, projectId}` emit. `emitDevHarnessLog`가 배선된 방식(container opts → index `webContents.send` → preload `ipcRenderer.on` → api)을 그대로 미러링해 `devHarness:started` push 이벤트로 흘린다. 패널은 이 이벤트로 runId를 **즉시** 잡는다(기존 first-log-chunk 스크래핑은 방어용 fallback으로 강등).
- **transcript 뷰어**: IPC query `q:devHarnessReadTranscript` → `AgentRunStore.get(runId).transcriptPath`를 512KB 캡(초과 시 마지막 512KB tail)으로 읽어 반환. 렌더러는 `DevHarnessPanel`에서 현재 run + `recentRuns`(harness) 목록을 클릭 → `<pre>` 모달.
- **UI**: 기존 `DevHarnessPanel`(task select·Run harness·Cancel·live log 이미 있음)을 확장 — [📋 컨텍스트 조립] → 편집 가능한 `<textarea>` + [터미널에 주입 ▸ agent picker] + [복사], 그리고 transcript 모달. `PmHome`은 `DevHarnessPanel`에 `recentRuns` prop 한 줄만 추가.

## Tech Stack

TypeScript · Node `fs` · Electron IPC(`ipcMain.handle`/`webContents.send`/`contextBridge`) · React 18 + Zustand(터치 안 함) · Vitest 2(+ `@testing-library/react`, jsdom for `*.test.tsx`) · Zod(IPC 경계 검증).

## Global Constraints

- 변경은 **ai_dashboard 저장소 내부로만**. `langgraph-agent`·`autosci-core`·기타 서브모듈/레포 수정 금지.
- **`AgentKind` 건드리지 말 것.** 스키마(`schema.ts`)·`TaskBoard`·의존성 모델은 P1 소유 — 손대지 않는다.
- **P1(task-dependencies) 병합 겹침 주의.** P1은 `ipc-contract.ts`·`container.ts`·`PmHome.tsx`를 건드릴 수 있다. P2의 추가는 전부 **append 스타일 + 이름 구분**(`composeContext`, `devHarnessStarted`, `devHarnessReadTranscript`)으로만 넣고, 기존 줄 재정렬/삭제 금지. `PmHome.tsx` 편집은 기존 `<DevHarnessPanel>` 한 줄에 prop 추가로 한정.
- typecheck 권위 = 루트 `pnpm typecheck` (IDE/에디터 진단 오경보 무시).
- TDD. 테스트는 대상과 colocate. 개별 패턴 실행: `npx vitest run <pattern>` (루트에서). 전체: `pnpm test` (~2.5분).
- 각 Task 종료 시 커밋. Conventional Commits + 트레일러:
  ```
  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  ```
- IPC 배선 순서(레퍼런스 = `devHarnessRun`/`devHarnessLog`): `CH` 추가 in `apps/desktop/src/shared/ipc-contract.ts` → `handlers()` in `apps/desktop/src/main/ipc.ts` → `container` 메서드 in `apps/desktop/src/main/container.ts` → `api.ts`(`window.apc.invoke` 제네릭). **push 이벤트만** preload(`apps/desktop/src/preload/index.ts`)에 `ipcRenderer.on` 브리지 추가.
- 렌더러 컴포넌트 테스트는 `vi.mock('../api.js')` 패턴을 확장한다(`DevHarnessPanel.test.tsx` 참고). `PmHome`는 `DevHarnessPanel`을 `key={project.id}`로 렌더한다.

---

### Task 1: 순수 조립기 `composeContextPackage` (app-services)

**근거:** 프롬프트 조립을 LLM/IO에서 분리한 결정론적 순수 함수. 나중 단계(메인 수집기)가 이 함수를 호출한다.

**Files:**
- Create: `packages/app-services/src/context-composer.ts`
- Create: `packages/app-services/src/context-composer.test.ts`
- Modify: `packages/app-services/src/index.ts` (append export)

**Interfaces:**
- Produces:
  ```ts
  export type WikiExcerpt = { path: string; excerpt: string }
  export type ComposeContextInput = { task: Task; allTasks: Task[]; wikiExcerpts: WikiExcerpt[]; sessionSummary?: string }
  export function composeContextPackage(input: ComposeContextInput): string
  ```
- Consumes: `Task` from `@apc/shared`.

- [ ] **Step 1: 실패 테스트 작성**

```ts
// packages/app-services/src/context-composer.test.ts
import { test, expect } from 'vitest'
import type { Task } from '@apc/shared'
import { composeContextPackage } from './context-composer.js'

const mk = (over: Partial<Task>): Task => ({
  id: 't', projectId: 'p', title: 't', status: 'todo', assigneeType: 'agent',
  priority: 'medium', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [], ...over,
})

test('assembles title, parent background, acceptance criteria, wiki excerpts, session summary, and instruction', () => {
  const parent = mk({ id: 'req:p:s1', title: '결제 모듈 리팩터' })
  const task = mk({
    id: 'todo:p:s1:1', title: '토큰 만료 처리', parentTaskId: 'req:p:s1',
    acceptanceCriteria: ['만료 시 401 반환', '리프레시 플로우 테스트 green'],
    linkedWikiPages: ['docs/auth.md'],
  })
  const out = composeContextPackage({
    task, allTasks: [parent, task],
    wikiExcerpts: [{ path: 'docs/auth.md', excerpt: 'JWT는 15분 만료' }],
    sessionSummary: '직전 세션: 리프레시 엔드포인트 초안 작성',
  })
  expect(out).toContain('# 작업: 토큰 만료 처리')
  expect(out).toContain('결제 모듈 리팩터')          // 상위 요청 배경
  expect(out).toContain('- 만료 시 401 반환')         // 수용 기준 bullet
  expect(out).toContain('### docs/auth.md')          // 위키 발췌 헤더
  expect(out).toContain('JWT는 15분 만료')            // 위키 발췌 본문
  expect(out).toContain('직전 세션 요약')
  expect(out).toContain('리프레시 엔드포인트 초안')
  expect(out).toContain('## 지시')
})

test('omits optional sections and shows a placeholder when acceptance criteria are empty', () => {
  const task = mk({ id: 'todo:p:s1:2', title: '작은 작업' })
  const out = composeContextPackage({ task, allTasks: [task], wikiExcerpts: [] })
  expect(out).toContain('# 작업: 작은 작업')
  expect(out).toContain('- (명시된 수용 기준 없음)')
  expect(out).not.toContain('## 배경')               // parentTaskId 없음
  expect(out).not.toContain('## 관련 위키 발췌')      // 발췌 없음
  expect(out).not.toContain('## 직전 세션 요약')      // 요약 없음
  expect(out).toContain('## 지시')
})
```

- [ ] **Step 2: RED 확인** — `npx vitest run context-composer` → FAIL (`composeContextPackage` 미존재).

- [ ] **Step 3: 구현**

```ts
// packages/app-services/src/context-composer.ts
import type { Task } from '@apc/shared'

export type WikiExcerpt = { path: string; excerpt: string }
export type ComposeContextInput = {
  task: Task
  allTasks: Task[]
  wikiExcerpts: WikiExcerpt[]
  sessionSummary?: string
}

/**
 * Deterministic task → LLM-handoff prompt. Pure (no LLM, no IO) so it is fully unit-testable; the
 * main-process gatherer (container.composeContext) feeds it task/siblings/excerpts/summary.
 */
export function composeContextPackage(input: ComposeContextInput): string {
  const { task, allTasks, wikiExcerpts, sessionSummary } = input
  const parent = task.parentTaskId ? allTasks.find((t) => t.id === task.parentTaskId) : undefined
  const lines: string[] = []
  lines.push(`# 작업: ${task.title}`, '')
  if (parent) lines.push('## 배경 (상위 요청)', parent.title, '')
  lines.push('## 수용 기준')
  if (task.acceptanceCriteria.length === 0) lines.push('- (명시된 수용 기준 없음)')
  else for (const c of task.acceptanceCriteria) lines.push(`- ${c}`)
  lines.push('')
  if (wikiExcerpts.length > 0) {
    lines.push('## 관련 위키 발췌')
    for (const w of wikiExcerpts) lines.push(`### ${w.path}`, '```', w.excerpt, '```', '')
  }
  if (sessionSummary && sessionSummary.trim()) lines.push('## 직전 세션 요약', sessionSummary.trim(), '')
  lines.push('## 지시', '위 컨텍스트를 바탕으로 이 작업을 수행하라. 수용 기준을 모두 충족하고, 불명확한 점은 먼저 질문하라.', '')
  return lines.join('\n')
}
```

- [ ] **Step 4: export 추가** — `packages/app-services/src/index.ts` 끝에 append:

```ts
export { composeContextPackage, type ComposeContextInput, type WikiExcerpt } from './context-composer.js'
```

- [ ] **Step 5: GREEN 확인** — `npx vitest run context-composer` → 2 passed.

- [ ] **Step 6: typecheck** — `pnpm typecheck` → 통과.

- [ ] **Step 7: Commit**

```bash
git add packages/app-services/src/context-composer.ts packages/app-services/src/context-composer.test.ts packages/app-services/src/index.ts
git commit -m "feat(app-services): deterministic composeContextPackage for LLM handoff

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: `composeContext` IPC (contract + main 수집기 + handler + api)

**근거:** 순수 조립기에 넣을 재료(task/형제/위키 발췌/직전 세션 요약)를 메인에서 모아 렌더러에 프롬프트 문자열로 돌려준다.

**MVP 결정(명시):**
- 위키 발췌 = `task.linkedWikiPages`의 앞 6개 경로를 기존 `readProjectDoc`(realpath 탈출 가드 + 512KB 캡, md/mdx/txt만)로 읽어 각 파일당 512바이트로 캡. `readProjectDoc`가 md/mdx/txt만 열므로 **비-텍스트 링크 경로는 조용히 건너뛴다**(MVP; 코드 파일 발췌는 후속).
- 직전 세션 요약 = `runs.listByTask(task.id)`에서 `summaryPath`가 있는 **가장 최근 run**의 vault 문서(`<vaultRoot>/<summaryPath>`)를 읽어 frontmatter 제거 후 512바이트 캡. 그런 run/파일이 없으면 **요약 생략**(순수 조립기가 섹션을 뺀다). `task.contextPackage`(=sessionId) 기반 search-index 요약은 값싸게 도달 불가라 **의도적으로 생략**하고 후속으로 남긴다.

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts` (append `CH.composeContext` + req/res 타입)
- Modify: `apps/desktop/src/main/container.ts` (import + `composeContext` 메서드 + `Container` 타입)
- Modify: `apps/desktop/src/main/ipc.ts` (handler)
- Modify: `apps/desktop/src/renderer/api.ts` (`composeContext` 메서드)
- Modify: `apps/desktop/src/main/ipc.test.ts` (container-level 테스트 추가)

**Interfaces:**
- Produces: `CH.composeContext = 'q:composeContext'`; `ComposeContextReq = { projectId: string; taskId: string }`; `ComposeContextRes = { ok: boolean; prompt?: string; reason?: string }`; `container.composeContext(req: ComposeContextReq): ComposeContextRes`.
- Consumes: `composeContextPackage`, `WikiExcerpt` (@apc/app-services, Task 1); `readProjectDoc` (main/project-files.js); `registry`/`tasks`/`runs`/`opts.vaultRoot`.

- [ ] **Step 1: 실패 테스트 작성** — `apps/desktop/src/main/ipc.test.ts`의 `describe` 블록 안에 추가(파일 상단 import에 `mkdtempSync`, `mkdirSync`, `writeFileSync`, `join`, `tmpdir`가 이미 있음):

```ts
  test('q:composeContext assembles a prompt from task + parent + acceptance criteria + wiki excerpt', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const repo = mkdtempSync(join(tmpdir(), 'apc-cc-repo-'))
    mkdirSync(join(repo, 'docs'), { recursive: true })
    writeFileSync(join(repo, 'docs', 'spec.md'), '# Spec\nimportant detail here')
    container.registry.register({
      id: 'p2', name: 'X', status: 'active', projectType: 'git', domain: 'project-docs',
      repoPaths: [repo], vaultPaths: [], sourcePaths: [],
    })
    container.tasks.create({
      id: 'req:p2:s1', projectId: 'p2', title: '상위 요청', status: 'todo', assigneeType: 'agent',
      priority: 'medium', reviewStatus: 'none', acceptanceCriteria: [], linkedWikiPages: [],
    })
    container.tasks.create({
      id: 'todo:p2:s1:1', projectId: 'p2', title: '하위 작업', status: 'todo', assigneeType: 'agent',
      priority: 'medium', reviewStatus: 'none', parentTaskId: 'req:p2:s1',
      acceptanceCriteria: ['빌드 통과', '테스트 green'], linkedWikiPages: ['docs/spec.md'],
    })
    const h = handlers(container)
    const res = await h[CH.composeContext]({ projectId: 'p2', taskId: 'todo:p2:s1:1' }) as { ok: boolean; prompt?: string }
    expect(res.ok).toBe(true)
    expect(res.prompt).toContain('하위 작업')
    expect(res.prompt).toContain('상위 요청')
    expect(res.prompt).toContain('빌드 통과')
    expect(res.prompt).toContain('docs/spec.md')
    expect(res.prompt).toContain('important detail here')
  })

  test('q:composeContext returns ok:false for an unknown task', async () => {
    const h = handlers(container)
    const res = await h[CH.composeContext]({ projectId: 'p1', taskId: 'nope' }) as { ok: boolean }
    expect(res.ok).toBe(false)
  })
```

- [ ] **Step 2: contract 추가** — `apps/desktop/src/shared/ipc-contract.ts`.

`CH` 객체에서 `devHarnessCancel: 'c:devHarnessCancel',` **아래에** append:

```ts
  // context package composer (P2): task → LLM-handoff prompt (assembled in main).
  composeContext: 'q:composeContext',
```

파일 하단 `DevHarnessLogEvent` 타입 근처에 append:

```ts
// context package composer (P2)
export type ComposeContextReq = { projectId: string; taskId: string }
export type ComposeContextRes = { ok: boolean; prompt?: string; reason?: string }
```

- [ ] **Step 3: container 구현** — `apps/desktop/src/main/container.ts`.

파일 상단 import 조정:
- `import { readdirSync, statSync } from 'node:fs'` → `import { readdirSync, statSync, readFileSync } from 'node:fs'`
- `@apc/app-services` import 목록에 `composeContextPackage, type WikiExcerpt` 추가.
- `readProjectDoc` import 추가: `import { readProjectDoc } from './project-files.js'`
- 타입 import(`from '../shared/ipc-contract.js'`) 목록에 `ComposeContextReq, ComposeContextRes` 추가.

`nextId()` 아래(파일 상단부 유틸 근처)에 상수 + 헬퍼 추가:

```ts
const COMPOSE_WIKI_MAX_FILES = 6
const COMPOSE_EXCERPT_CAP = 512
/** Strip a leading YAML frontmatter block, then cap to COMPOSE_EXCERPT_CAP bytes. */
function capExcerpt(raw: string): string {
  const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '')
  return body.length > COMPOSE_EXCERPT_CAP ? body.slice(0, COMPOSE_EXCERPT_CAP) + '…' : body
}
```

`devHarnessCancel` 정의 아래에 메서드 추가:

```ts
  const composeContext = (req: ComposeContextReq): ComposeContextRes => {
    const project = registry.get(req.projectId)
    if (!project) return { ok: false, reason: 'project not found' }
    const task = tasks.get(req.taskId)
    if (!task || task.projectId !== req.projectId) return { ok: false, reason: 'task not found' }
    const allTasks = tasks.listByProject(project.id)
    // Wiki excerpts: reuse the realpath-guarded, size-capped reader (md/mdx/txt only; other links skipped).
    const roots = [join(opts.vaultRoot, 'projects', project.id), ...project.repoPaths, ...project.vaultPaths]
    const wikiExcerpts: WikiExcerpt[] = []
    for (const rel of task.linkedWikiPages.slice(0, COMPOSE_WIKI_MAX_FILES)) {
      const r = readProjectDoc(roots, rel)
      if (r.ok) wikiExcerpts.push({ path: rel, excerpt: capExcerpt(r.content) })
    }
    // MVP session summary: latest run for this task that has a stored summary doc (see plan notes).
    let sessionSummary: string | undefined
    const withSummary = runs.listByTask(task.id).find((run) => run.summaryPath)
    if (withSummary?.summaryPath) {
      try { sessionSummary = capExcerpt(readFileSync(join(opts.vaultRoot, withSummary.summaryPath), 'utf8')) }
      catch { /* summary unreadable → omit */ }
    }
    return { ok: true, prompt: composeContextPackage({ task, allTasks, wikiExcerpts, sessionSummary }) }
  }
```

`Container` 타입에 `devHarnessCancel: ...` 아래에 append:

```ts
  composeContext: (req: ComposeContextReq) => ComposeContextRes
```

`return { ... }` 객체에서 `devHarnessRun, devHarnessCancel,` 옆에 `composeContext,` 추가.

- [ ] **Step 4: handler 추가** — `apps/desktop/src/main/ipc.ts`의 `[CH.devHarnessCancel]` 아래:

```ts
    [CH.composeContext]: async (payload: unknown) => {
      const req = z.object({ projectId: z.string(), taskId: z.string() }).strict().parse(payload)
      return container.composeContext(req)
    },
```

- [ ] **Step 5: api 추가** — `apps/desktop/src/renderer/api.ts`.

타입 import 목록에 `ComposeContextReq, ComposeContextRes` 추가. `devHarnessCancel` 메서드 아래에:

```ts
  composeContext(req: ComposeContextReq): Promise<ComposeContextRes> {
    return window.apc.invoke(CH.composeContext, req) as Promise<ComposeContextRes>
  },
```

- [ ] **Step 6: GREEN 확인** — `npx vitest run apps/desktop/src/main/ipc.test.ts` → 신규 2개 포함 통과.

- [ ] **Step 7: typecheck** — `pnpm typecheck` → 통과.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/container.ts apps/desktop/src/main/ipc.ts apps/desktop/src/renderer/api.ts apps/desktop/src/main/ipc.test.ts
git commit -m "feat(desktop): composeContext IPC assembles task handoff prompt in main

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: dev-harness **started ack** (`devHarness:started` 이벤트)

**근거:** 현재 `run()` 프로미스는 완료 시에만 resolve → 패널이 첫 로그 청크에서 runId를 스크래핑한다. runId를 **시작 즉시** 얻도록 `runs.create` 직후 이벤트를 emit한다. `emitDevHarnessLog` 배선을 그대로 미러링.

**Files:**
- Modify: `packages/app-services/src/dev-harness-service.ts` (`onStarted?` 파라미터)
- Modify: `packages/app-services/src/dev-harness-service.test.ts` (테스트)
- Modify: `apps/desktop/src/shared/ipc-contract.ts` (`CH.devHarnessStarted` + 이벤트 타입)
- Modify: `apps/desktop/src/main/container.ts` (`emitDevHarnessStarted` opt + 3번째 인자)
- Modify: `apps/desktop/src/main/index.ts` (`webContents.send`)
- Modify: `apps/desktop/src/preload/index.ts` (`onDevHarnessStarted` 브리지)
- Modify: `apps/desktop/src/renderer/api.ts` (`onDevHarnessStarted` + Window 타입)

**Interfaces:**
- Produces: `DevHarnessService.run(input, onLog?, onStarted?)` — `onStarted?: (e: { runId: string; taskId: string; projectId: string }) => void`; `CH.devHarnessStarted = 'devHarness:started'`; `DevHarnessStartedEvent = { runId: string; taskId: string; projectId: string }`; `api.onDevHarnessStarted(cb): () => void`.

- [ ] **Step 1: 실패 테스트 작성** — `packages/app-services/src/dev-harness-service.test.ts` 끝에 추가(파일에 `fakeRuns`, `cliOf`, `okRegistry`, `runsRoot` 헬퍼가 이미 있음):

```ts
test('emits onStarted with runId/taskId/projectId right after recording the run', async () => {
  const { store } = fakeRuns()
  const cli = cliOf(async () => ({ exitCode: 0, stdout: '', stderr: '' }))
  const started: Array<{ runId: string; taskId: string; projectId: string }> = []
  const svc = new DevHarnessService({ cli, runs: store as never, registry: okRegistry, runsRoot: runsRoot() })
  const res = await svc.run({ projectId: 'P', taskId: 'req:P:s1' }, undefined, (e) => started.push(e))
  expect(started).toHaveLength(1)
  expect(started[0]).toMatchObject({ taskId: 'req:P:s1', projectId: 'P', runId: res.runId })
})
```

- [ ] **Step 2: RED 확인** — `npx vitest run dev-harness-service` → 신규 테스트 FAIL(onStarted 미호출).

- [ ] **Step 3: service 구현** — `packages/app-services/src/dev-harness-service.ts`.

`run` 시그니처를 확장:

```ts
  async run(
    input: DevHarnessRunInput,
    onLog?: (e: DevHarnessLogEvent) => void,
    onStarted?: (e: { runId: string; taskId: string; projectId: string }) => void,
  ): Promise<DevHarnessRunResult> {
```

`this.deps.runs.create({ ... })` 호출 **직후**(그 다음 줄)에 추가:

```ts
    onStarted?.({ runId, taskId: input.taskId, projectId: input.projectId })
```

- [ ] **Step 4: contract 추가** — `apps/desktop/src/shared/ipc-contract.ts`.

`CH` 객체의 `devHarnessLog: 'devHarness:log',` 아래에 append:

```ts
  devHarnessStarted: 'devHarness:started',
```

`DevHarnessLogEvent` 타입 아래에 append:

```ts
// dev-harness started ack (P2): fired right after the run is recorded, before any log chunk.
export type DevHarnessStartedEvent = { runId: string; taskId: string; projectId: string }
```

- [ ] **Step 5: container 배선** — `apps/desktop/src/main/container.ts`.

타입 import 목록에 `DevHarnessStartedEvent` 추가.

`buildContainer` opts 타입에 `emitDevHarnessLog?` 아래로 append:

```ts
  emitDevHarnessStarted?: (e: DevHarnessStartedEvent) => void
```

`devHarnessRun` 정의를 3번째 인자 포함으로 교체:

```ts
  const devHarnessRun = (req: DevHarnessRunReq): Promise<DevHarnessRunRes> =>
    devHarness.run(
      req,
      opts.emitDevHarnessLog ? (e) => opts.emitDevHarnessLog!(e) : undefined,
      opts.emitDevHarnessStarted ? (e) => opts.emitDevHarnessStarted!(e) : undefined,
    )
```

- [ ] **Step 6: index send** — `apps/desktop/src/main/index.ts`의 `emitDevHarnessLog: ...` 아래에:

```ts
    emitDevHarnessStarted: (e) => win.webContents.send(CH.devHarnessStarted, e),
```

- [ ] **Step 7: preload 브리지** — `apps/desktop/src/preload/index.ts`의 `onDevHarnessLog` 블록 아래에:

```ts
  onDevHarnessStarted: (cb: (e: { runId: string; taskId: string; projectId: string }) => void) => {
    const handler = (_e: unknown, ev: { runId: string; taskId: string; projectId: string }) => cb(ev)
    ipcRenderer.on(CH.devHarnessStarted, handler)
    return () => ipcRenderer.removeListener(CH.devHarnessStarted, handler)
  },
```

- [ ] **Step 8: api 추가** — `apps/desktop/src/renderer/api.ts`.

타입 import 목록에 `DevHarnessStartedEvent` 추가. `Window.apc` 인터페이스에서 `onDevHarnessLog(...)` 줄 아래에:

```ts
      onDevHarnessStarted(cb: (e: DevHarnessStartedEvent) => void): () => void
```

`api` 객체의 `onDevHarnessLog(...)` 아래에:

```ts
  onDevHarnessStarted(cb: (e: DevHarnessStartedEvent) => void): () => void {
    // Tolerate a missing preload bridge (component tests without a stubbed window.apc).
    return window.apc?.onDevHarnessStarted?.(cb) ?? (() => {})
  },
```

- [ ] **Step 9: GREEN + typecheck** — `npx vitest run dev-harness-service` → 통과. `pnpm typecheck` → 통과.

- [ ] **Step 10: Commit**

```bash
git add packages/app-services/src/dev-harness-service.ts packages/app-services/src/dev-harness-service.test.ts apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/container.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/api.ts
git commit -m "feat(desktop): dev-harness started ack event exposes runId immediately

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: `devHarnessReadTranscript` IPC (transcript 읽기)

**근거:** 완료된 dev-run의 transcript 파일을 렌더러가 열람하도록 `AgentRunStore.get(runId).transcriptPath`를 512KB 캡(초과 시 마지막 512KB tail)으로 읽어 준다.

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts` (`CH.devHarnessReadTranscript` + req/res)
- Modify: `apps/desktop/src/main/container.ts` (`devHarnessReadTranscript` 메서드 + `Container` 타입)
- Modify: `apps/desktop/src/main/ipc.ts` (handler)
- Modify: `apps/desktop/src/renderer/api.ts` (메서드)
- Modify: `apps/desktop/src/main/ipc.test.ts` (테스트)

**Interfaces:**
- Produces: `CH.devHarnessReadTranscript = 'q:devHarnessReadTranscript'`; `DevHarnessReadTranscriptReq = { runId: string }`; `DevHarnessReadTranscriptRes = { ok: boolean; content?: string; reason?: string }`; `container.devHarnessReadTranscript(req): DevHarnessReadTranscriptRes`.

- [ ] **Step 1: 실패 테스트 작성** — `apps/desktop/src/main/ipc.test.ts`에 추가:

```ts
  test('q:devHarnessReadTranscript returns transcript content for a recorded run', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const tp = join(mkdtempSync(join(tmpdir(), 'apc-tr-')), 'transcript.log')
    writeFileSync(tp, 'build log line')
    container.runs.create({
      id: 'RUN9', taskId: 'T1', agent: 'harness', repoPath: '/x',
      startedAt: '2026-06-01T00:00:00Z', status: 'completed', transcriptPath: tp,
    })
    const h = handlers(container)
    const res = await h[CH.devHarnessReadTranscript]({ runId: 'RUN9' }) as { ok: boolean; content?: string }
    expect(res.ok).toBe(true)
    expect(res.content).toContain('build log line')
  })

  test('q:devHarnessReadTranscript ok:false when the run or transcript is missing', async () => {
    const h = handlers(container)
    const res = await h[CH.devHarnessReadTranscript]({ runId: 'missing' }) as { ok: boolean }
    expect(res.ok).toBe(false)
  })
```

- [ ] **Step 2: contract 추가** — `apps/desktop/src/shared/ipc-contract.ts`.

`CH` 객체에서 (Task 2에서 넣은) `composeContext: 'q:composeContext',` 아래에:

```ts
  devHarnessReadTranscript: 'q:devHarnessReadTranscript',
```

타입 섹션(`ComposeContextRes` 근처)에:

```ts
// dev-harness transcript viewer (P2)
export type DevHarnessReadTranscriptReq = { runId: string }
export type DevHarnessReadTranscriptRes = { ok: boolean; content?: string; reason?: string }
```

- [ ] **Step 3: container 구현** — `apps/desktop/src/main/container.ts`.

상단 import에 `openSync, readSync, closeSync` 추가: `import { readdirSync, statSync, readFileSync, openSync, readSync, closeSync } from 'node:fs'`. 타입 import에 `DevHarnessReadTranscriptReq, DevHarnessReadTranscriptRes` 추가.

`capExcerpt` 근처에 상수 추가:

```ts
const TRANSCRIPT_CAP = 512 * 1024
```

`composeContext` 아래에 메서드 추가:

```ts
  const devHarnessReadTranscript = (req: DevHarnessReadTranscriptReq): DevHarnessReadTranscriptRes => {
    const run = runs.get(req.runId)
    if (!run?.transcriptPath) return { ok: false, reason: 'transcript not found' }
    try {
      const st = statSync(run.transcriptPath)
      if (!st.isFile()) return { ok: false, reason: 'transcript not found' }
      if (st.size <= TRANSCRIPT_CAP) return { ok: true, content: readFileSync(run.transcriptPath, 'utf8') }
      // Oversized transcript: show the last TRANSCRIPT_CAP bytes (most recent output).
      const fd = openSync(run.transcriptPath, 'r')
      try {
        const buf = Buffer.alloc(TRANSCRIPT_CAP)
        readSync(fd, buf, 0, TRANSCRIPT_CAP, st.size - TRANSCRIPT_CAP)
        return { ok: true, content: `…(잘림 · 마지막 ${TRANSCRIPT_CAP / 1024}KB)\n` + buf.toString('utf8') }
      } finally { closeSync(fd) }
    } catch { return { ok: false, reason: 'transcript not found' } }
  }
```

`Container` 타입에 append:

```ts
  devHarnessReadTranscript: (req: DevHarnessReadTranscriptReq) => DevHarnessReadTranscriptRes
```

`return { ... }`에 `devHarnessReadTranscript,` 추가(예: `composeContext,` 옆).

- [ ] **Step 4: handler 추가** — `apps/desktop/src/main/ipc.ts`의 `[CH.composeContext]` 아래:

```ts
    [CH.devHarnessReadTranscript]: async (payload: unknown) => {
      const req = z.object({ runId: z.string() }).strict().parse(payload)
      return container.devHarnessReadTranscript(req)
    },
```

- [ ] **Step 5: api 추가** — `apps/desktop/src/renderer/api.ts`.

타입 import에 `DevHarnessReadTranscriptReq, DevHarnessReadTranscriptRes` 추가. `composeContext` 아래:

```ts
  devHarnessReadTranscript(req: DevHarnessReadTranscriptReq): Promise<DevHarnessReadTranscriptRes> {
    return window.apc.invoke(CH.devHarnessReadTranscript, req) as Promise<DevHarnessReadTranscriptRes>
  },
```

- [ ] **Step 6: GREEN + typecheck** — `npx vitest run apps/desktop/src/main/ipc.test.ts` → 통과. `pnpm typecheck` → 통과.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/container.ts apps/desktop/src/main/ipc.ts apps/desktop/src/renderer/api.ts apps/desktop/src/main/ipc.test.ts
git commit -m "feat(desktop): devHarnessReadTranscript IPC reads capped run transcript

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: `DevHarnessPanel` — 컨텍스트 조립 UI + started ack 소비

**근거:** 패널에 [📋 컨텍스트 조립] → 편집 가능한 `<textarea>` + [터미널에 주입 ▸ agent picker] + [복사]를 추가하고, started 이벤트로 runId를 즉시 잡는다.

**주입 결정(정당화):** 선택 에이전트의 dock pty에 프롬프트를 **개행 없이(WITHOUT trailing newline)** write한다 — `App.tsx`에서 dock pty id는 `` `${projectId}:${agent}` `` (확인됨: `App.tsx` `sessionId={\`${pid}:${a}\`}`), dock 에이전트는 `['claude','opencode','codex']`(= `App.tsx` `AGENTS`, 확인됨). 개행을 붙이지 않는 이유: 사용자가 주입된 프롬프트를 **검토한 뒤 직접 Enter**를 치게 해 오발사를 막는다(더 안전). 주입은 해당 에이전트 탭이 **열려 있어야** 동작한다(`PtyManager.write`는 세션 없으면 no-op) — MVP는 자동 오픈하지 않고 상태 메시지로 안내(후속: 자동 오픈).

**Files:**
- Modify: `apps/desktop/src/renderer/components/DevHarnessPanel.tsx`
- Modify: `apps/desktop/src/renderer/components/DevHarnessPanel.test.tsx`

**Interfaces:**
- Consumes: `api.composeContext`, `api.onDevHarnessStarted`, `api.writePty` (Task 2·3 + 기존 pty).
- Produces: 편집 textarea(`data-testid="composer-prompt"`), agent picker(`aria-label="주입 대상 에이전트"`), 버튼 `📋 컨텍스트 조립`/`터미널에 주입`/`복사`.

- [ ] **Step 1: 실패 테스트 작성** — `apps/desktop/src/renderer/components/DevHarnessPanel.test.tsx`의 `vi.mock('../api.js', ...)`를 아래처럼 **확장**(기존 3개 메서드 유지 + 신규 추가). 파일 상단 mock 블록 교체:

```ts
const devHarnessRun = vi.fn()
const devHarnessCancel = vi.fn()
const composeContext = vi.fn()
const writePty = vi.fn()
const devHarnessReadTranscript = vi.fn()
type LogCb = (e: { runId: string; label: string; stream: 'stdout' | 'stderr'; chunk: string }) => void
type StartedCb = (e: { runId: string; taskId: string; projectId: string }) => void
let logCb: LogCb = () => {}
let startedCb: StartedCb = () => {}
vi.mock('../api.js', () => ({
  api: {
    devHarnessRun: (...a: unknown[]) => devHarnessRun(...a),
    devHarnessCancel: (...a: unknown[]) => devHarnessCancel(...a),
    composeContext: (...a: unknown[]) => composeContext(...a),
    devHarnessReadTranscript: (...a: unknown[]) => devHarnessReadTranscript(...a),
    writePty: (...a: unknown[]) => writePty(...a),
    onDevHarnessLog: (cb: LogCb) => { logCb = cb; return () => {} },
    onDevHarnessStarted: (cb: StartedCb) => { startedCb = cb; return () => {} },
  },
}))
```

`beforeEach`도 갱신: `beforeEach(() => { vi.clearAllMocks(); logCb = () => {}; startedCb = () => {} })`

그리고 신규 테스트 추가:

```ts
  it('captures runId from the started ack so cancel works before any log arrives', async () => {
    let resolveRun!: (v: unknown) => void
    devHarnessRun.mockImplementation(() => new Promise((r) => { resolveRun = r }))
    devHarnessCancel.mockResolvedValue({ ok: true })
    render(<DevHarnessPanel projectId="p1" tasks={[task('T1', 'do work')]} />)
    fireEvent.click(runBtn())
    act(() => startedCb({ runId: 'RUN-START', taskId: 'T1', projectId: 'p1' }))
    fireEvent.click(cancelBtn())
    expect(devHarnessCancel).toHaveBeenCalledWith({ runId: 'RUN-START' })
    await act(async () => { resolveRun({ ok: false, runId: 'RUN-START', reason: 'cancelled' }) })
  })

  it('composes a prompt into the editable textarea', async () => {
    composeContext.mockResolvedValue({ ok: true, prompt: '# 작업: do work\n## 지시\n수행하라' })
    render(<DevHarnessPanel projectId="p1" tasks={[task('T1', 'do work')]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /컨텍스트 조립/ })) })
    expect(composeContext).toHaveBeenCalledWith({ projectId: 'p1', taskId: 'T1' })
    expect((screen.getByTestId('composer-prompt') as HTMLTextAreaElement).value).toContain('# 작업: do work')
  })

  it('injects the composed prompt into the selected agent pty without a trailing newline', async () => {
    composeContext.mockResolvedValue({ ok: true, prompt: 'PROMPT-BODY' })
    render(<DevHarnessPanel projectId="p1" tasks={[task('T1', 'do work')]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /컨텍스트 조립/ })) })
    fireEvent.change(screen.getByLabelText('주입 대상 에이전트'), { target: { value: 'codex' } })
    fireEvent.click(screen.getByRole('button', { name: /터미널에 주입/ }))
    expect(writePty).toHaveBeenCalledWith({ id: 'p1:codex', data: 'PROMPT-BODY' })
  })
```

- [ ] **Step 2: RED 확인** — `npx vitest run DevHarnessPanel` → 신규 테스트 FAIL(버튼/필드 없음). 기존 4개는 유지.

- [ ] **Step 3: 구현** — `apps/desktop/src/renderer/components/DevHarnessPanel.tsx` 전체 교체:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { Task } from '@apc/shared'
import { api } from '../api.js'

type Props = { projectId: string; tasks: Task[] }

// dock pty keys are `${projectId}:${agent}` (App.tsx). Order matches App.tsx AGENTS.
const INJECT_AGENTS = ['claude', 'opencode', 'codex'] as const

/**
 * Drives the multi-agent dev harness (S3) for one task and composes an LLM-handoff prompt (P2).
 * runId is captured from the `devHarness:started` ack (primary) so Cancel works immediately; the
 * first-log-chunk capture is kept only as a defensive fallback. The composed prompt can be injected
 * into a dock agent's terminal (pty write, no trailing newline — the user reviews then hits Enter)
 * or copied.
 */
export function DevHarnessPanel({ projectId, tasks }: Props) {
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? '')
  const [runId, setRunId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const runIdRef = useRef<string | null>(null)
  // composer state
  const [prompt, setPrompt] = useState('')
  const [composing, setComposing] = useState(false)
  const [injectAgent, setInjectAgent] = useState<(typeof INJECT_AGENTS)[number]>('claude')
  const [status, setStatus] = useState('')

  useEffect(() => {
    // Primary runId source: the started ack (fires before any log chunk).
    const off = api.onDevHarnessStarted((e) => {
      if (e.projectId !== projectId) return
      runIdRef.current = e.runId
      setRunId(e.runId)
    })
    return typeof off === 'function' ? off : undefined
  }, [projectId])

  useEffect(() => {
    const off = api.onDevHarnessLog((e) => {
      // Fallback capture if the started ack has not arrived yet; then filter to the live run.
      if (!runIdRef.current) { runIdRef.current = e.runId; setRunId(e.runId) }
      if (e.runId !== runIdRef.current) return
      setLog((prev) => prev + e.chunk)
    })
    return typeof off === 'function' ? off : undefined
  }, [])

  async function start() {
    if (!taskId || running) return
    runIdRef.current = null
    setRunId(null); setLog(''); setRunning(true)
    try {
      const res = await api.devHarnessRun({ projectId, taskId })
      if (res.runId) { runIdRef.current = res.runId; setRunId(res.runId) }
      setLog((prev) => prev + `\n[${res.ok ? 'done' : 'failed'}${res.exitCode != null ? ` · exit ${res.exitCode}` : ''}${res.reason ? ` · ${res.reason}` : ''}]\n`)
    } finally {
      setRunning(false)
    }
  }

  function cancel() {
    if (runIdRef.current) void api.devHarnessCancel({ runId: runIdRef.current })
  }

  async function compose() {
    if (!taskId || composing) return
    setComposing(true); setStatus('')
    try {
      const res = await api.composeContext({ projectId, taskId })
      if (res.ok && res.prompt) { setPrompt(res.prompt); setStatus('조립 완료 — 검토 후 주입/복사') }
      else setStatus(`조립 실패: ${res.reason ?? 'unknown'}`)
    } finally {
      setComposing(false)
    }
  }

  function inject() {
    if (!prompt) return
    // No trailing newline: the user reviews in the terminal, then presses Enter (safer than auto-send).
    api.writePty({ id: `${projectId}:${injectAgent}`, data: prompt })
    setStatus(`${injectAgent} 터미널에 주입됨 — 해당 탭에서 Enter를 누르세요 (탭이 열려 있어야 함)`)
  }

  async function copy() {
    try { await navigator.clipboard.writeText(prompt); setStatus('클립보드에 복사됨') }
    catch { setStatus('복사 실패 (클립보드 차단)') }
  }

  return (
    <div className="dev-harness">
      <div className="dev-harness__controls">
        <select className="dev-harness__task" aria-label="harness task" value={taskId}
                onChange={(e) => setTaskId(e.target.value)} disabled={running || tasks.length === 0}>
          {tasks.length === 0
            ? <option value="">(no tasks)</option>
            : tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        <button className="dev-harness__run" onClick={() => void start()} disabled={running || !taskId}>▶ Run harness</button>
        <button className="dev-harness__cancel" onClick={cancel} disabled={!running || !runId}>⏹ Cancel</button>
        <button className="dev-harness__compose" onClick={() => void compose()} disabled={composing || !taskId}>📋 컨텍스트 조립</button>
      </div>

      {prompt && (
        <div className="dev-harness__composer">
          <textarea data-testid="composer-prompt" className="dev-harness__prompt" value={prompt}
                    onChange={(e) => setPrompt(e.target.value)} rows={12} />
          <div className="dev-harness__composer-actions">
            <select aria-label="주입 대상 에이전트" value={injectAgent}
                    onChange={(e) => setInjectAgent(e.target.value as (typeof INJECT_AGENTS)[number])}>
              {INJECT_AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <button className="dev-harness__inject" onClick={inject}>▸ 터미널에 주입</button>
            <button className="dev-harness__copy" onClick={() => void copy()}>복사</button>
          </div>
        </div>
      )}
      {status && <div className="dev-harness__status" role="status">{status}</div>}

      <pre className="dev-harness__log" data-testid="dev-harness-log">{log}</pre>
    </div>
  )
}
```

- [ ] **Step 4: GREEN 확인** — `npx vitest run DevHarnessPanel` → 기존 4 + 신규 3 = 7 passed.

- [ ] **Step 5: typecheck** — `pnpm typecheck` → 통과.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/DevHarnessPanel.tsx apps/desktop/src/renderer/components/DevHarnessPanel.test.tsx
git commit -m "feat(desktop): context composer UI in DevHarnessPanel with pty injection

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: `DevHarnessPanel` transcript 뷰어 + `PmHome` prop

**근거:** 완료된 dev-run(harness)의 transcript를 모달로 열람. 현재 run + `recentRuns`(harness) 목록에서 진입.

**Files:**
- Modify: `apps/desktop/src/renderer/components/DevHarnessPanel.tsx` (`recentRuns` prop + 모달)
- Modify: `apps/desktop/src/renderer/components/DevHarnessPanel.test.tsx` (테스트)
- Modify: `apps/desktop/src/renderer/components/PmHome.tsx` (prop 한 줄)

**Interfaces:**
- Consumes: `api.devHarnessReadTranscript` (Task 4); `AgentRun` from `@apc/shared`.
- Produces: `Props`에 `recentRuns?: AgentRun[]` (기본 `[]`); transcript 모달(`role="dialog"`, `data-testid="transcript-content"`).

- [ ] **Step 1: 실패 테스트 작성** — `apps/desktop/src/renderer/components/DevHarnessPanel.test.tsx`에 추가. 파일 상단에 헬퍼 추가:

```ts
import type { AgentRun } from '@apc/shared'
const run = (id: string): AgentRun => ({
  id, taskId: 'T1', agent: 'harness', repoPath: '/x', startedAt: '2026-06-01T00:00:00Z', status: 'completed',
})
```

신규 테스트:

```ts
  it('opens a transcript modal for a recent harness run', async () => {
    devHarnessReadTranscript.mockResolvedValue({ ok: true, content: 'transcript body here' })
    render(<DevHarnessPanel projectId="p1" tasks={[task('T1', 'do work')]} recentRuns={[run('RUN7')]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /RUN7/ })) })
    expect(devHarnessReadTranscript).toHaveBeenCalledWith({ runId: 'RUN7' })
    expect(screen.getByTestId('transcript-content').textContent).toContain('transcript body here')
  })
```

- [ ] **Step 2: RED 확인** — `npx vitest run DevHarnessPanel` → 신규 FAIL.

- [ ] **Step 3: 구현** — `apps/desktop/src/renderer/components/DevHarnessPanel.tsx`.

import: `import type { Task, AgentRun } from '@apc/shared'`

Props/시그니처 교체:

```tsx
type Props = { projectId: string; tasks: Task[]; recentRuns?: AgentRun[] }
```
```tsx
export function DevHarnessPanel({ projectId, tasks, recentRuns = [] }: Props) {
```

상태 추가(다른 `useState` 근처):

```tsx
  const [transcriptRunId, setTranscriptRunId] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
```

함수 추가(`copy` 근처):

```tsx
  async function openTranscript(id: string) {
    setTranscriptRunId(id); setTranscript('불러오는 중…')
    const res = await api.devHarnessReadTranscript({ runId: id })
    setTranscript(res.ok ? (res.content ?? '') : `읽기 실패: ${res.reason ?? 'unknown'}`)
  }
```

렌더: `<pre ... data-testid="dev-harness-log">` **위**에 dev-run 목록 + 모달 삽입. `recentRuns`에서 harness run만 노출:

```tsx
      {(() => {
        const devRuns = recentRuns.filter((r) => r.agent === 'harness')
        return devRuns.length > 0 && (
          <div className="dev-harness__runs">
            <span className="dev-harness__runs-label">dev-run 트랜스크립트:</span>
            {devRuns.map((r) => (
              <button key={r.id} className="dev-harness__run-link" onClick={() => void openTranscript(r.id)}>{r.id}</button>
            ))}
          </div>
        )
      })()}

      {transcriptRunId && (
        <div className="transcript-modal" role="dialog" aria-label="dev-run transcript"
             onClick={() => setTranscriptRunId(null)}>
          <div className="transcript-modal__body" onClick={(e) => e.stopPropagation()}>
            <div className="transcript-modal__head">
              <span>{transcriptRunId}</span>
              <button aria-label="닫기" onClick={() => setTranscriptRunId(null)}>✕</button>
            </div>
            <pre data-testid="transcript-content">{transcript}</pre>
          </div>
        </div>
      )}
```

- [ ] **Step 4: PmHome prop 추가** — `apps/desktop/src/renderer/components/PmHome.tsx`. `recentRuns`는 이미 destructure됨. `<DevHarnessPanel ...>` 한 줄 교체:

```tsx
        <DevHarnessPanel key={project.id} projectId={project.id} tasks={allTasks} recentRuns={recentRuns} />
```

- [ ] **Step 5: GREEN 확인** — `npx vitest run DevHarnessPanel` → 8 passed. `npx vitest run PmHome` → 통과(있다면).

- [ ] **Step 6: typecheck** — `pnpm typecheck` → 통과.

- [ ] **Step 7: 전체 스위트** — `pnpm test 2>&1 | tail -20` → 전체 green(회귀 없음).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/components/DevHarnessPanel.tsx apps/desktop/src/renderer/components/DevHarnessPanel.test.tsx apps/desktop/src/renderer/components/PmHome.tsx
git commit -m "feat(desktop): dev-run transcript modal in DevHarnessPanel

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

**Coverage vs 제품 목표(§4 P2):**
- ✅ task 선택 → 컨텍스트{제목, 수용기준, linkedWikiPages 발췌, 직전 세션 요약} 조립 → Task 1(순수 조립기) + Task 2(메인 수집기/IPC).
- ✅ ① dock 터미널 주입(pty write, 개행 없이) → Task 5. ② DevHarness run 전달 → 기존 `Run harness`(`DevHarnessCli`는 `task_id`만 받으므로 조립 프롬프트는 주입/복사 경로가 주 용도. 명시함).
- ✅ dev-run 시작 ack(runId 즉시 반환 이벤트) → Task 3(`devHarness:started`).
- ✅ dev-run transcript 열람 → Task 4(IPC) + Task 6(모달).

**Placeholders:** 없음. 모든 코드 블록은 실제 실행 코드. 각 Task에 실패 테스트 → 구현 → 실행 명령/기대 결과 → 커밋 포함.

**Type consistency:** 신규 IPC 타입 3쌍(`ComposeContext*`, `DevHarnessReadTranscript*`, `DevHarnessStartedEvent`)은 contract에서 정의 → container/handler/api가 동일 타입 참조. `DevHarnessService.run`의 `onStarted` 시그니처는 container opt(`emitDevHarnessStarted`)·index send·이벤트 타입과 필드 일치(`runId/taskId/projectId`). 패널 mock은 실제 `api` 메서드 시그니처와 일치(`composeContext`, `devHarnessReadTranscript`, `writePty`, `onDevHarnessStarted`).

**MVP 한계(의도적, 명시됨):**
- 직전 세션 요약은 `summaryPath` 있는 최근 run 문서에서만(없으면 섹션 생략); `contextPackage`(sessionId) 기반 search-index 요약은 후속.
- 위키 발췌는 md/mdx/txt만(비-텍스트 링크 경로 skip); 파일당 512B, 최대 6개 파일.
- 터미널 주입은 대상 에이전트 탭이 **열려 있어야** 동작(미개방 시 no-op + 안내 메시지); 자동 오픈은 후속.
- transcript 512KB 초과 시 마지막 512KB tail만.

**P1 병합 겹침 완화:** `ipc-contract.ts`(신규 `CH` 3개 + 타입은 dev-harness 블록에 append, 재정렬 없음), `container.ts`(신규 opt/메서드 append), `PmHome.tsx`(기존 `<DevHarnessPanel>` 한 줄에 prop만 추가) — 전부 append-style·이름 구분. 새 IPC 이름(`composeContext`/`devHarnessStarted`/`devHarnessReadTranscript`)은 P1(`blockedBy`류)과 충돌하지 않음.

**started ack "replace" 관련 편차(정당화):** 지시는 first-chunk 캡처를 "replace"하라고 했으나, 기존 테스트("appends streamed log chunks", "cancel sends captured runId")가 started 이벤트 없이 로그만 발사하므로 first-chunk 캡처를 **완전 제거하면 기존 테스트가 RED**가 된다. 따라서 started 이벤트를 **주(primary) 캡처**로 두고 first-chunk를 **방어용 fallback**으로 강등(주석 명시)했다 — 기존 테스트 유지 + 순서 뒤바뀜/이벤트 유실에도 견고. 신규 테스트가 "로그 이전 started로 runId 캡처 → Cancel 동작"을 검증한다.
