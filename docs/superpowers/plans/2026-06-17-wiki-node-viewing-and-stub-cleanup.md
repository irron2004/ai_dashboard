# Wiki 노드 뷰잉 + 잔재 stub 청소 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Knowledge 탭에서 현재 run이 생성한 진짜 노드 문서만 안정적으로 나열·열람하게 하고, 옛 stub 잔재를 docs 트리/카운트에서 숨긴다.

**Architecture:** main 프로세스에 "run의 vault-staging dir를 직접 나열하고 각 .md가 진짜 노드인지(`node_id:` frontmatter) 판별"하는 순수 함수 + IPC를 추가한다(A1). 렌더러 `KnowledgeView`는 추측 기반 파생 대신 이 IPC 결과를 쓰고, `isNode`인 문서만 docs 트리에 노출하며(B1), 그래프 클릭은 `node_id`와 `data.path` stem 두 키로 staged 문서를 해석한다. 그래프 캔버스 구조와 생성 파이프라인은 건드리지 않는다.

**Tech Stack:** TypeScript (ESM, `.js` import 확장자), Electron(main/preload/renderer), React, Zod(IPC 검증), Vitest + @testing-library/react. 모노레포 패키지: `@apc/app-services`, `@apc/knowledge-harness`, `apps/desktop`.

## Global Constraints

- 경로는 반드시 `resolveInside(base, rel)`로 staging dir 밖을 못 벗어나게 한다(보안 가드). escape 시 던지며, 호출측은 `[]`로 흡수한다.
- 생성 파이프라인(`make-drivers.ts`, `render-node-doc.ts`)은 **수정 금지**. 이번 작업은 뷰잉 전용.
- 트리 클릭과 그래프 클릭은 **동일한 해석 매핑**(`node_id→relPath`, `stem(data.path)→relPath`)을 쓴다.
- 그래프 캔버스(`buildHarnessGraphData`)는 구조를 바꾸지 않는다(run/report/evidence/file 노드 유지).
- IPC 계약 DTO `StagedDocDto`와 app-services의 `StagedDocEntry`는 **필드가 동일**해야 한다: `{ relPath: string; isNode: boolean; nodeId?: string; nodeType?: string; title?: string }`.
- 새 런타임 의존성 추가 금지. 줄바꿈 LF. 테스트는 Node 22에서 실행(`node -v` ≥ 22; nvm PATH).
- 단일 테스트 실행: `npx vitest run <path>`. 전체: `pnpm test`. 타입체크: `pnpm typecheck`.

---

## 검증 전략 (핵심 — 모킹된 테스트만으론 "완료"가 아니다)

그동안 "완료"라고 한 게 실제 앱에선 안 고쳐진 경우가 반복됐다. 원인은 명확하다: 컴포넌트 테스트가 `api.*`(IPC)를 **모킹**하므로, 모킹이 통과하면 초록불이 되지만 **실제 데이터·실제 경로 해석·실제 파일 읽기**는 전혀 검증되지 않는다. **초록불 ≠ 동작.** 그래서 검증을 세 겹으로 한다:

1. **순수 함수 단위 테스트(모킹 0):** 실제 의사결정 로직(`collectStagedDocs`, `parseStagedDoc`, `resolveStagedRel`)을 React/IPC 밖 순수 함수로 빼서 실데이터형 입력으로 검증.
2. **컴포넌트 테스트(모킹 有):** 배선/렌더 확인용. *보조*일 뿐 완료 근거가 아니다.
3. **실제 run 데이터 통합 스모크(Task 5, 모킹 0):** 사용자의 실제 `apc-harness-runs`를 가리켜 main 경로 그대로(`collectStagedDocs` → `resolveStagedRel` → 실제 `readStagedDoc` 파일 읽기)를 돌리고 **실제 숫자/본문을 출력**. **이 출력을 붙여넣기 전에는 누구도 "완료"라고 말하지 않는다.**

> 한계: Electron GUI 자체를 이 환경에서 클릭·스크린샷할 수 없다(디스플레이 없음 + 앱은 Windows 구동). 따라서 GUI 픽셀은 보증하지 못한다. 대신 **버그가 실재하는 데이터+해석 층을 실데이터로 증명**하고, 렌더러는 순수 함수에 위임해 얇게 유지한다. 진짜 GUI E2E가 필요하면: (a) 사용자가 한 줄 명령 출력 붙여넣기, 또는 (b) Playwright-Electron 셋업(별도 작업).

---

## Task 1: staged 문서 나열 순수 함수 (`collectStagedDocs`)

**Files:**
- Create: `packages/app-services/src/staged-docs.ts`
- Test: `packages/app-services/src/staged-docs.test.ts`
- Modify: `packages/app-services/src/index.ts` (모듈 재노출)

**Interfaces:**
- Produces:
  - `type StagedDocEntry = { relPath: string; isNode: boolean; nodeId?: string; nodeType?: string; title?: string }`
  - `function parseStagedDoc(text: string): { nodeId?: string; nodeType?: string; title?: string }`
  - `function collectStagedDocs(runsRoot: string, runId: string): StagedDocEntry[]`
- Consumes: `resolveInside` from `@apc/knowledge-harness` (이미 `harness-service.ts`가 동일 경로로 import).

- [ ] **Step 1: Write the failing test**

`packages/app-services/src/staged-docs.test.ts`:
```ts
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectStagedDocs, parseStagedDoc } from './staged-docs.js'

describe('parseStagedDoc', () => {
  test('extracts node_id/node_type from frontmatter and the first H1', () => {
    const out = parseStagedDoc('---\nnode_id: decision.real\nnode_type: DecisionNode\n---\n# Real Title\n\nbody')
    expect(out).toEqual({ nodeId: 'decision.real', nodeType: 'DecisionNode', title: 'Real Title' })
  })
  test('returns no nodeId for a stub one-liner (no frontmatter)', () => {
    expect(parseStagedDoc('DecisionNode markdown stub.').nodeId).toBeUndefined()
  })
})

describe('collectStagedDocs', () => {
  let runsRoot: string
  const runId = 'RUN-TEST'
  beforeEach(() => {
    runsRoot = mkdtempSync(join(tmpdir(), 'apc-staged-'))
    const nodes = join(runsRoot, runId, 'vault-staging', 'nodes')
    mkdirSync(nodes, { recursive: true })
    writeFileSync(join(nodes, 'decision.real.md'),
      '---\nnode_id: decision.real\nnode_type: DecisionNode\n---\n# Real Title\n\nbody')
    writeFileSync(join(nodes, 'old-stub.md'), 'DecisionNode markdown stub one-liner.')
    const raw = join(runsRoot, runId, 'vault-staging', 'raw', 'conversations')
    mkdirSync(raw, { recursive: true })
    writeFileSync(join(raw, 'ignore.md'), '# should be skipped')
  })
  afterEach(() => { rmSync(runsRoot, { recursive: true, force: true }) })

  test('lists md and flags real node vs stub', () => {
    const docs = collectStagedDocs(runsRoot, runId)
    expect(docs.find((d) => d.relPath === 'nodes/decision.real.md'))
      .toMatchObject({ isNode: true, nodeId: 'decision.real', nodeType: 'DecisionNode', title: 'Real Title' })
    expect(docs.find((d) => d.relPath === 'nodes/old-stub.md')).toMatchObject({ isNode: false })
  })
  test('skips the raw/ subtree', () => {
    expect(collectStagedDocs(runsRoot, runId).some((d) => d.relPath.startsWith('raw/'))).toBe(false)
  })
  test('returns [] when the staging dir is missing', () => {
    expect(collectStagedDocs(runsRoot, 'NO-SUCH-RUN')).toEqual([])
  })
  test('returns [] for a runId that escapes runsRoot', () => {
    expect(collectStagedDocs(runsRoot, '../../etc')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/app-services/src/staged-docs.test.ts`
Expected: FAIL — `Cannot find module './staged-docs.js'` (module not created yet).

- [ ] **Step 3: Write minimal implementation**

`packages/app-services/src/staged-docs.ts`:
```ts
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { resolveInside } from '@apc/knowledge-harness'

export type StagedDocEntry = {
  /** vault-staging-relative path, forward slashes (e.g. "nodes/decision.x.md"). */
  relPath: string
  /** true when leading frontmatter carries `node_id:` — a real rendered node, not a stub. */
  isNode: boolean
  nodeId?: string
  nodeType?: string
  title?: string
}

// Never node docs: raw sources, per-run logs, shared-promotion review drafts, VCS dirs.
const SKIP_DIRS = new Set(['raw', 'runs', 'reviews', '.git', 'node_modules'])
const MD = /\.md$/i
const DEPTH_LIMIT = 8
const LIST_LIMIT = 5000

/** Pull node_id/node_type from leading `--- ... ---` frontmatter and the first `# ` H1. */
export function parseStagedDoc(text: string): { nodeId?: string; nodeType?: string; title?: string } {
  const head = text.slice(0, 4096)
  let nodeId: string | undefined
  let nodeType: string | undefined
  if (head.startsWith('---')) {
    const end = head.indexOf('\n---', 3)
    const fm = end === -1 ? head : head.slice(0, end)
    const id = fm.match(/^node_id:\s*(.+)$/m)
    const type = fm.match(/^node_type:\s*(.+)$/m)
    if (id) nodeId = id[1].trim()
    if (type) nodeType = type[1].trim()
  }
  const h1 = head.match(/^#\s+(.+)$/m)
  return { nodeId, nodeType, title: h1?.[1]?.trim() }
}

/** List markdown docs in a run's vault-staging dir, flagging real nodes. Empty on missing/escaping dir. */
export function collectStagedDocs(runsRoot: string, runId: string): StagedDocEntry[] {
  let base: string
  try { base = resolveInside(runsRoot, join(runId, 'vault-staging')) } catch { return [] }
  const out: StagedDocEntry[] = []
  const visit = (dir: string, depth: number): void => {
    if (out.length >= LIST_LIMIT || depth > DEPTH_LIMIT) return
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) visit(full, depth + 1)
        continue
      }
      if (!e.isFile() || !MD.test(e.name)) continue
      let text: string
      try { text = readFileSync(full, 'utf8') } catch { continue }
      const { nodeId, nodeType, title } = parseStagedDoc(text)
      out.push({ relPath: relative(base, full).split(sep).join('/'), isNode: !!nodeId, nodeId, nodeType, title })
      if (out.length >= LIST_LIMIT) return
    }
  }
  visit(base, 0)
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath))
}
```

Then add to `packages/app-services/src/index.ts` (after the `harness-service.js` export line):
```ts
export * from './staged-docs.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/app-services/src/staged-docs.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/app-services/src/staged-docs.ts packages/app-services/src/staged-docs.test.ts packages/app-services/src/index.ts
git commit -m "feat(harness): list staged docs from disk + flag real nodes vs stubs"
```

---

## Task 2: IPC 배선 (`harnessListStagedDocs`)

`harnessReadStagedDoc`와 동일한 5계층 패턴을 미러링한다. 검증은 타입체크(타입드 IPC 배선의 정확성은 컴파일 속성) + 기존 스위트 그린.

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts` (채널 + DTO 타입)
- Modify: `packages/app-services/src/harness-service.ts` (import + `listStagedDocs` 메서드)
- Modify: `apps/desktop/src/main/ipc.ts` (핸들러)
- Modify: `apps/desktop/src/main/container.ts` (타입 import, 인터페이스, 구현, export)
- Modify: `apps/desktop/src/renderer/api.ts` (타입 import + 메서드)

**Interfaces:**
- Consumes: `collectStagedDocs`, `StagedDocEntry` (Task 1).
- Produces:
  - 계약: `StagedDocDto`, `type HarnessListStagedDocsReq = { runId: string }`, `type HarnessListStagedDocsRes = { docs: StagedDocDto[] }`, 채널 `CH.harnessListStagedDocs`.
  - HarnessService: `listStagedDocs(input: { runId: string }): { docs: StagedDocEntry[] }`.
  - 렌더러: `api.harnessListStagedDocs(req: HarnessListStagedDocsReq): Promise<HarnessListStagedDocsRes>`.

- [ ] **Step 1: 계약(채널 + 타입) 추가**

`apps/desktop/src/shared/ipc-contract.ts` — `CH` 객체에서 `harnessReadStagedDoc: 'c:harnessReadStagedDoc',` 바로 아래에 추가:
```ts
  harnessListStagedDocs: 'c:harnessListStagedDocs',
```
그리고 `HarnessReadStagedDocRes` 타입 정의 바로 아래에 추가:
```ts
// List a run's vault-staging .md docs, flagging which are real nodes (have node_id frontmatter).
export type StagedDocDto = { relPath: string; isNode: boolean; nodeId?: string; nodeType?: string; title?: string }
export type HarnessListStagedDocsReq = { runId: string }
export type HarnessListStagedDocsRes = { docs: StagedDocDto[] }
```

- [ ] **Step 2: HarnessService 메서드 추가**

`packages/app-services/src/harness-service.ts` — 상단 import 블록에 추가(다른 로컬 import들 근처, 예: `harness-promote-service.js` import 아래):
```ts
import { collectStagedDocs, type StagedDocEntry } from './staged-docs.js'
```
그리고 `readStagedDoc(...)` 메서드 정의 바로 아래에 추가:
```ts
  /** List the run's staged docs (deterministic node renders + stubs) so the renderer can show only
   * real nodes and resolve clicks against paths that actually exist on disk. */
  listStagedDocs(input: { runId: string }): { docs: StagedDocEntry[] } {
    return { docs: collectStagedDocs(this.deps.runsRoot, input.runId) }
  }
```

- [ ] **Step 3: ipc 핸들러 추가**

`apps/desktop/src/main/ipc.ts` — `[CH.harnessReadStagedDoc]` 핸들러 블록 바로 아래에 추가:
```ts
    [CH.harnessListStagedDocs]: async (payload: unknown) => {
      const req = z.object({ runId: z.string() }).strict().parse(payload)
      return container.harnessListStagedDocs(req)
    },
```

- [ ] **Step 4: container 배선**

`apps/desktop/src/main/container.ts`:
1. 타입 import에 `HarnessReadStagedDocReq, HarnessReadStagedDocRes,` 줄 뒤에 추가:
```ts
  HarnessListStagedDocsReq, HarnessListStagedDocsRes,
```
2. 컨테이너 인터페이스에서 `harnessReadStagedDoc: (req: HarnessReadStagedDocReq) => HarnessReadStagedDocRes` 줄 아래에 추가:
```ts
  harnessListStagedDocs: (req: HarnessListStagedDocsReq) => HarnessListStagedDocsRes
```
3. 구현부에서 `const harnessReadStagedDoc = (req: HarnessReadStagedDocReq): HarnessReadStagedDocRes => harness.readStagedDoc(req)` 줄 아래에 추가:
```ts
  const harnessListStagedDocs = (req: HarnessListStagedDocsReq): HarnessListStagedDocsRes => harness.listStagedDocs(req)
```
4. 반환 객체의 `harnessReadStagedDoc,`가 있는 줄에 `harnessListStagedDocs,`를 함께 추가.

- [ ] **Step 5: 렌더러 api 추가**

`apps/desktop/src/renderer/api.ts`:
1. 타입 import에 `HarnessReadStagedDocReq, HarnessReadStagedDocRes,` 줄 뒤에 추가:
```ts
  HarnessListStagedDocsReq, HarnessListStagedDocsRes,
```
2. `harnessReadStagedDoc(...)` 메서드 바로 아래에 추가:
```ts
  harnessListStagedDocs(req: HarnessListStagedDocsReq): Promise<HarnessListStagedDocsRes> {
    return window.apc.invoke(CH.harnessListStagedDocs, req) as Promise<HarnessListStagedDocsRes>
  },
```

- [ ] **Step 6: 타입체크 + 기존 스위트로 배선 검증**

Run: `pnpm typecheck`
Expected: PASS — 신규 채널이 계약→ipc→container→api 전 계층에서 타입이 일관(미스매치 시 tsc가 실패).

Run: `npx vitest run apps/desktop/src/main/ipc.test.ts packages/app-services/src/harness-service.test.ts`
Expected: PASS — 기존 핸들러/서비스 테스트가 깨지지 않음.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/shared/ipc-contract.ts packages/app-services/src/harness-service.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/container.ts apps/desktop/src/renderer/api.ts
git commit -m "feat(ipc): add harnessListStagedDocs channel across all layers"
```

---

## Task 3: KnowledgeView — docs 트리에 진짜 노드만 + 신뢰 배지

`stagedDocs`(applied-write-report/node-proposals 추측)를 `harnessListStagedDocs` 결과로 교체하고, docs 트리에는 `isNode`인 문서만 노출(B1), 헤더에 "진짜 노드 N개 · 상태" 배지를 단다(R4). 그래프 캔버스/클릭은 Task 4에서.

**Files:**
- Modify: `apps/desktop/src/renderer/components/KnowledgeView.tsx`
- Test: `apps/desktop/src/renderer/components/KnowledgeView.test.tsx`

**Interfaces:**
- Consumes: `api.harnessListStagedDocs` (Task 2), `StagedDocDto` (계약).
- Produces (KnowledgeView 내부 상태): `stagedEntries: StagedDocDto[]`, `nodeDocs = stagedEntries.filter(e => e.isNode)`.

- [ ] **Step 1: 테스트 목 보강 + 실패 테스트 작성**

`apps/desktop/src/renderer/components/KnowledgeView.test.tsx`:
1. 목 선언부(상단)에 staged 목록 목을 추가 — `harnessReadStagedDoc` 선언 아래:
```ts
const harnessListStagedDocs = vi.fn(async () => ({ docs: [] as Array<{ relPath: string; isNode: boolean; nodeId?: string; nodeType?: string; title?: string }> }))
```
2. `vi.mock('../api.js', ...)`의 Proxy `get`에 한 줄 추가 — `harnessReadStagedDoc` 분기 아래:
```ts
      if (prop === 'harnessListStagedDocs') return (...a: unknown[]) => harnessListStagedDocs(...a as [])
```
3. 새 테스트 추가(파일 하단 `describe` 안):
```ts
  test('docs tree shows only real nodes (stubs hidden) with a trust-count badge', async () => {
    harnessListStagedDocs.mockResolvedValueOnce({ docs: [
      { relPath: 'nodes/decision.real.md', isNode: true, nodeId: 'decision.real', nodeType: 'DecisionNode', title: 'Real Title' },
      { relPath: 'nodes/old-stub.md', isNode: false },
    ] } as never)
    render(<KnowledgeView />)
    expect(await screen.findByRole('button', { name: /Real Title/ })).toBeDefined()
    expect(screen.queryByRole('button', { name: /old-stub/ })).toBeNull()
    expect(screen.getByText(/진짜 노드 1개/)).toBeDefined()
  })

  test('clicking a real node loads it via harnessReadStagedDoc', async () => {
    harnessListStagedDocs.mockResolvedValueOnce({ docs: [
      { relPath: 'nodes/decision.real.md', isNode: true, nodeId: 'decision.real', nodeType: 'DecisionNode', title: 'Real Title' },
    ] } as never)
    harnessReadStagedDoc.mockResolvedValueOnce({ ok: true, content: '# Real Title\n\nbody' } as never)
    render(<KnowledgeView />)
    fireEvent.click(await screen.findByRole('button', { name: /Real Title/ }))
    await waitFor(() => expect(harnessReadStagedDoc).toHaveBeenCalledWith({ runId: 'RUN-w', relPath: 'nodes/decision.real.md' }))
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/desktop/src/renderer/components/KnowledgeView.test.tsx -t "real nodes"`
Expected: FAIL — 트리가 아직 `harnessListStagedDocs`를 쓰지 않아 'Real Title' 버튼/배지가 없음.

- [ ] **Step 3: Implement — stagedDocs 파생 교체 + 필터 + 배지**

`apps/desktop/src/renderer/components/KnowledgeView.tsx`:

(a) 상단 import에 계약 타입 추가(`MarkdownContent` import 아래 새 줄):
```ts
import type { StagedDocDto } from '../../shared/ipc-contract.js'
```

(b) 기존 `stagedDocs` useMemo 블록(주석 "The actual generated wiki nodes (staging md)..." 부터 `}, [run])` 까지)과 그 아래 `stagedById` useMemo를 **다음으로 교체**:
```tsx
  // The run's actual staged docs, listed straight from disk (no path guessing). Only `isNode` docs
  // (node_id frontmatter) are real generated nodes; stub leftovers from older runs are hidden.
  const [stagedEntries, setStagedEntries] = useState<StagedDocDto[]>([])
  useEffect(() => {
    if (!runId) { setStagedEntries([]); return }
    let stale = false
    void api.harnessListStagedDocs({ runId })
      .then((res) => { if (!stale) setStagedEntries(res.docs ?? []) })
      .catch(() => { if (!stale) setStagedEntries([]) })
    return () => { stale = true }
  }, [runId])
  const nodeDocs = useMemo(() => stagedEntries.filter((e) => e.isNode), [stagedEntries])
  // Two resolution maps shared by the tree, [[links]] and graph clicks (Task 4): by node_id and by filename stem.
  const byNodeId = useMemo(() => new Map(nodeDocs.filter((e) => e.nodeId).map((e) => [e.nodeId as string, e.relPath])), [nodeDocs])
  const byStem = useMemo(() => new Map(nodeDocs.map((e) => [nodeIdOf(e.relPath), e.relPath])), [nodeDocs])
```

(c) `openWikiLink`의 첫 줄(`const stagedRel = stagedById.get(target) ?? stagedById.get(nodeIdOf(target))`)을 교체:
```tsx
    const stagedRel = byNodeId.get(target) ?? byStem.get(target) ?? byStem.get(nodeIdOf(target))
```

(d) docs 트리의 노드 그룹 렌더(헤더 `🧩 노드 ...`와 `stagedDocs.map(...)` 부분)를 교체:
```tsx
            <div className="knowledge__tree-group">
              🧩 노드 (진짜 {nodeDocs.length}개{run?.runState.state === 'HUMAN_REVIEW_REQUIRED' ? ' · 검수중' : run ? ` · ${run.runState.state}` : ''})
            </div>
            {nodeDocs.length === 0 && <div className="knowledge__tree-empty">아직 노드 없음 — ⚙ Wiki Gen에서 생성</div>}
            {nodeDocs.map((e) => (
              <button key={e.relPath} type="button"
                className={selectedDoc?.kind === 'staged' && selectedDoc.relPath === e.relPath ? 'knowledge__tree-item knowledge__tree-item--on' : 'knowledge__tree-item'}
                onClick={() => setSelectedDoc({ kind: 'staged', relPath: e.relPath })}>
                {e.nodeType && <span className="knowledge__tree-type">{e.nodeType}</span>} {e.title ?? nodeIdOf(e.relPath)}
              </button>
            ))}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/desktop/src/renderer/components/KnowledgeView.test.tsx`
Expected: PASS — 신규 2개 통과, 기존 테스트도 그린(트리 노드 그룹이 비어도 Wiki Overview/projectDocs 단언은 유지).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/KnowledgeView.tsx apps/desktop/src/renderer/components/KnowledgeView.test.tsx
git commit -m "feat(ui): Knowledge docs tree lists only real nodes from disk + trust badge"
```

---

## Task 4: 그래프 클릭 해석 견고화 (node_id + data.path stem)

그래프 노드 클릭이 `task:<proposal_id>` 같은 id거나 `data.path`가 없어도, staged 목록에서 `node_id`/stem으로 실제 문서를 찾아 연다. 매핑에 안 걸리면 프로젝트 문서용 기존 `fsReadDoc` 폴백 유지(그래프 캔버스 구조는 불변). **핵심 해석 로직은 순수 함수 `resolveStagedRel`로 빼서 모킹 없이 테스트**한다(검증 전략 1).

**Files:**
- Modify: `apps/desktop/src/renderer/harness-utils.ts` (순수 리졸버 추가)
- Test: `apps/desktop/src/renderer/harness-utils.test.ts` (순수 단위 테스트, 모킹 0)
- Modify: `apps/desktop/src/renderer/components/KnowledgeView.tsx` (리졸버 호출)
- Test: `apps/desktop/src/renderer/components/KnowledgeView.test.tsx` (배선 확인, 보조)

**Interfaces:**
- Consumes: `nodeDocs: StagedDocDto[]` (Task 3), `GraphNodeRef` (harness-utils).
- Produces: `function resolveStagedRel(node: GraphNodeRef, entries: { relPath: string; nodeId?: string }[]): string | undefined`.

- [ ] **Step 1: 순수 리졸버 실패 테스트 작성 (모킹 0)**

`apps/desktop/src/renderer/harness-utils.test.ts`에 추가(없으면 생성):
```ts
import { describe, test, expect } from 'vitest'
import { resolveStagedRel } from './harness-utils.js'

describe('resolveStagedRel', () => {
  const entries = [
    { relPath: 'nodes/decision.real.md', nodeId: 'decision.real' },
    { relPath: 'nodes/concept_x.md', nodeId: 'concept.x' },
  ]
  test('task-style id + data.path=nodes/<node_id>.md resolves by path stem', () => {
    expect(resolveStagedRel({ id: 'task:prop-1', label: 'x', data: { path: 'nodes/decision.real.md' } }, entries))
      .toBe('nodes/decision.real.md')
  })
  test('node with NO data.path resolves by node_id', () => {
    expect(resolveStagedRel({ id: 'decision.real', label: 'x' }, entries)).toBe('nodes/decision.real.md')
  })
  test('leading vault-staging/ prefix is stripped before matching', () => {
    expect(resolveStagedRel({ id: 'n', data: { path: 'vault-staging/nodes/concept_x.md' } }, entries))
      .toBe('nodes/concept_x.md')
  })
  test('a non-node (project doc) returns undefined → caller uses disk fallback', () => {
    expect(resolveStagedRel({ id: 'document:plan', data: { path: 'docs/plan.md' } }, entries)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/desktop/src/renderer/harness-utils.test.ts -t resolveStagedRel`
Expected: FAIL — `resolveStagedRel` is not exported.

- [ ] **Step 3: Implement the pure resolver**

`apps/desktop/src/renderer/harness-utils.ts` — `pickNodeArtifact` 근처(같은 파일의 노드-해석 헬퍼들 옆)에 추가:
```ts
/** Resolve a clicked graph node to a real staged-doc relPath. Proposal nodes use id `task:<proposal_id>`
 *  and carry `data.path = nodes/<node_id>.md`; graph-update-plan nodes may carry only the node_id as id.
 *  Match by node_id AND by filename stem so either shape opens the right doc. Returns undefined for
 *  non-node targets (e.g. project docs) so the caller can fall back to a disk read. */
export function resolveStagedRel(
  node: GraphNodeRef,
  entries: ReadonlyArray<{ relPath: string; nodeId?: string }>,
): string | undefined {
  const stemOf = (s: string): string => s.replace(/^.*[\\/]/, '').replace(/\.md$/i, '')
  const byNodeId = new Map(entries.filter((e) => e.nodeId).map((e) => [e.nodeId as string, e.relPath]))
  const byStem = new Map(entries.map((e) => [stemOf(e.relPath), e.relPath]))
  const id = node.id.replace(/^(artifact|file|task|evidence|run|document):/, '')
  const p = (node.data as { path?: string } | undefined)?.path?.replace(/^vault-staging[\\/]/, '')
  return byNodeId.get(id)
    ?? (p ? (byStem.get(stemOf(p)) ?? byNodeId.get(stemOf(p))) : undefined)
    ?? byStem.get(id)
}
```

- [ ] **Step 4: Run the pure test to verify it passes**

Run: `npx vitest run apps/desktop/src/renderer/harness-utils.test.ts -t resolveStagedRel`
Expected: PASS (4 tests, no mocks).

- [ ] **Step 5: Wire the component + add a graph mock node + component test**

(a) `KnowledgeView.tsx` import 블록의 harness-utils import에 `resolveStagedRel`을 추가(기존 named import 목록에 끼워 넣기).

(b) `handleNodeClick` 안에서 `nodePath`를 만드는 줄
```tsx
    const nodePath = (node.data as { path?: string } | undefined)?.path?.replace(/^vault-staging[\\/]/, '')
```
을 다음으로 교체(staged 해석을 우선, 없으면 기존 data.path 폴백):
```tsx
    // Prefer a real staged node resolved from the on-disk list (robust to id/filename mismatches and
    // to nodes that carry no data.path); fall back to the raw op path for project-doc peeks.
    const nodePath = resolveStagedRel(node, nodeDocs) ?? (node.data as { path?: string } | undefined)?.path?.replace(/^vault-staging[\\/]/, '')
```

(c) `KnowledgeView.test.tsx`의 `vi.mock('./GraphVisualization.js', ...)`를 두 버튼으로 교체(기존 'GRAPH-STUB' 보존):
```tsx
vi.mock('./GraphVisualization.js', () => ({
  GraphVisualization: ({ onNodeClick }: { onNodeClick: (n: { id: string; label?: string; data?: unknown }) => void }) => (
    <>
      <button onClick={() => onNodeClick({ id: 'document:plan', label: 'plan', data: { path: 'docs/plan.md' } })}>GRAPH-STUB</button>
      <button onClick={() => onNodeClick({ id: 'decision.real', label: 'Real Title' })}>GRAPH-NODE</button>
    </>
  ),
}))
```
(d) 컴포넌트 배선 테스트 추가:
```ts
  test('graph: a node with no data.path opens its staged doc (wired through resolveStagedRel)', async () => {
    harnessListStagedDocs.mockResolvedValueOnce({ docs: [
      { relPath: 'nodes/decision.real.md', isNode: true, nodeId: 'decision.real', nodeType: 'DecisionNode', title: 'Real Title' },
    ] } as never)
    harnessReadStagedDoc.mockResolvedValueOnce({ ok: true, content: '# Real Title\n\nbody' } as never)
    render(<KnowledgeView />)
    fireEvent.click(screen.getByRole('button', { name: '그래프' }))
    fireEvent.click(await screen.findByText('GRAPH-NODE'))
    await waitFor(() => expect(harnessReadStagedDoc).toHaveBeenCalledWith({ runId: 'RUN-w', relPath: 'nodes/decision.real.md' }))
  })
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run apps/desktop/src/renderer/harness-utils.test.ts apps/desktop/src/renderer/components/KnowledgeView.test.tsx`
Expected: PASS — 순수 4개 + 컴포넌트 신규/기존 모두 그린(GRAPH-STUB는 resolveStagedRel undefined → data.path 'docs/plan.md' 폴백 유지).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/harness-utils.ts apps/desktop/src/renderer/harness-utils.test.ts apps/desktop/src/renderer/components/KnowledgeView.tsx apps/desktop/src/renderer/components/KnowledgeView.test.tsx
git commit -m "fix(ui): resolve graph node clicks to staged docs via node_id + path stem"
```

---

## Task 5: 실제 run 데이터 통합 스모크 (모킹 0 — "완료"의 진짜 근거)

Task 1·4가 끝난 뒤, 모킹 없이 **사용자의 실제 `apc-harness-runs`**를 가리켜 main 경로 그대로(`collectStagedDocs` → `resolveStagedRel` → 실제 파일 읽기)를 돌리고 실제 숫자/본문을 출력한다. 평소엔 `APC_REAL_RUNS` 미설정 시 skip(다른 머신/CI 안전).

**Files:**
- Test: `apps/desktop/src/main/staged-docs.integration.test.ts`

**Interfaces:**
- Consumes: `collectStagedDocs` (`@apc/app-services`), `resolveStagedRel` (`../renderer/harness-utils.js`), `resolveInside` (`@apc/knowledge-harness`).

- [ ] **Step 1: 통합 스모크 테스트 작성**

`apps/desktop/src/main/staged-docs.integration.test.ts`:
```ts
import { describe, test, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveInside } from '@apc/knowledge-harness'
import { collectStagedDocs } from '@apc/app-services'
import { resolveStagedRel } from '../renderer/harness-utils.js'

// Run against REAL data: APC_REAL_RUNS=<apc-harness-runs dir> npx vitest run <this file>
const REAL = process.env.APC_REAL_RUNS
const suite = REAL ? describe : describe.skip

suite('REAL run data smoke', () => {
  const runsRoot = REAL as string
  const latestRun = (): string =>
    readdirSync(runsRoot).filter((n) => n.startsWith('RUN-')).sort().at(-1) as string

  test('latest run: real nodes listed, stubs separable, a node opens by node_id with real content', () => {
    const runId = latestRun()
    const docs = collectStagedDocs(runsRoot, runId)
    const real = docs.filter((e) => e.isNode)
    const stubs = docs.filter((e) => !e.isNode && /(^|\/)nodes\//.test(e.relPath))
    console.log(`[smoke] run=${runId} total=${docs.length} realNodes=${real.length} stubsHidden=${stubs.length}`)
    expect(real.length).toBeGreaterThan(0)

    // Click resolution on a real node (by node_id, no data.path), then read via the SAME primitives readStagedDoc uses.
    const sample = real[0]
    const rel = resolveStagedRel({ id: sample.nodeId as string, label: sample.title }, real)
    expect(rel).toBe(sample.relPath)
    const stagingBase = resolveInside(runsRoot, join(runId, 'vault-staging'))
    const body = readFileSync(resolveInside(stagingBase, rel as string), 'utf8')
    console.log(`[smoke] opened ${rel} (${body.length}B) head:\n${body.slice(0, 200)}`)
    expect(body.startsWith('---')).toBe(true)     // real node frontmatter
    expect(body).toMatch(/^#\s+/m)                // H1 title

    const withEvidence = real.filter((e) =>
      readFileSync(resolveInside(stagingBase, e.relPath), 'utf8').includes('## 근거'))
    console.log(`[smoke] nodes with '## 근거': ${withEvidence.length}/${real.length}`)
    expect(withEvidence.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: skip 경로 확인(데이터 없이도 안전)**

Run: `npx vitest run apps/desktop/src/main/staged-docs.integration.test.ts`
Expected: PASS — `APC_REAL_RUNS` 미설정이므로 describe.skip(0 실행), 스위트가 빨간불을 만들지 않음.

- [ ] **Step 3: 실제 데이터로 실행하고 출력을 붙여넣기**

Run (Windows 데이터 기준):
```bash
APC_REAL_RUNS="/mnt/c/Users/irron/AppData/Roaming/@apc/desktop/apc-harness-runs" \
  npx vitest run apps/desktop/src/main/staged-docs.integration.test.ts
```
Expected: PASS + `[smoke]` 로그에 실제 숫자가 찍힌다(이번 데이터 기준 realNodes≈113, stubsHidden≈23, 그리고 연 문서의 본문 head + `## 근거` 보유 노드 수). **이 출력을 PR/완료 보고에 붙여넣기 전에는 "완료" 금지.**

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/staged-docs.integration.test.ts
git commit -m "test(harness): real-run-data smoke for staged-doc listing + click resolution"
```

---

## 마무리 검증 (전 태스크 후)

- [ ] `pnpm typecheck` PASS — 출력 붙여넣기
- [ ] `pnpm test` PASS (전체 스위트) — 출력 붙여넣기
- [ ] **Task 5 실제 데이터 스모크** `[smoke]` 로그 붙여넣기 (realNodes/stubsHidden 숫자 + 연 문서 head). **이게 "완료"의 1차 근거다.**
- [ ] (가능하면) 사용자가 앱에서 Knowledge 탭 → 노드 클릭 → 본문+근거 확인 1장 캡처. GUI 픽셀은 이 환경에서 보증 불가 — 이 한 단계만 사용자 협조 필요.

## 인수 기준 매핑 (스펙 §5)

- docs 트리에 진짜 노드만 + stub 숨김 → Task 3
- 트리/그래프 클릭으로 본문+주장+근거 열림(특히 `task:` 노드) → Task 3(트리) + Task 4(그래프)
- "진짜 노드 N개 · 상태" 배지 → Task 3
- 신규/수정 테스트 통과 → Task 1·3·4 + 마무리 검증
- **실제 데이터에서 동작 증명(모킹 0)** → Task 5 (`[smoke]` 출력)
