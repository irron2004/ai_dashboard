# Wiki Graph Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ai_dashboard 그래프 뷰어가 4개 프로젝트(autosci-core, coin, calculate_math, ai_dashboard)의 실제 위키를 찾아서 시각화할 수 있게 한다.

**Architecture:** 그래프 뷰어의 위키 리더(`read-wiki.ts`)는 현재 `<repo>/wiki` → `<repo>/.apc-wiki`만 탐색하고, edges.jsonl의 커널 형식 ref(`type:slug`, 콜론)를 노드 ref(`type/slug`, 슬래시)에 매핑하지 못한다. (1) edges.jsonl ref를 노드 별칭 테이블로 해석하고, (2) registry의 `vaultPaths`를 직접 위키 루트로 읽도록 배선하고, (3) 양쪽 DB(WSL/Windows)에 4개 프로젝트를 올바른 경로로 등록하고, (4) coin의 `wiki-kernel.yaml` 드리프트를 해소한다.

**Tech Stack:** TypeScript (pnpm 모노레포, vitest), node:sqlite(Electron 앱 DB는 Python sqlite3로 직접 조작), YAML(coin 설정).

## Global Constraints

- 작업 브랜치: ai_dashboard-main의 `feat/wiki-graph-visibility` (main에서 분기). coin 수정은 coin 저장소의 `chore/wiki-kernel-drift` 브랜치.
- **ai_dashboard-main 작업 트리에 이 기능과 무관한 미커밋 변경이 있다. 다음 파일은 절대 스테이징/커밋/수정 금지:** `.npmrc`, `apps/desktop/package.json`, `apps/desktop/src/main/index.ts`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `apps/desktop/electron-builder.yml`. 항상 명시적 경로로 `git add`할 것 — `git add -A`/`-u`/`.` 금지.
- 타입 검사의 권위는 repo 루트의 `pnpm typecheck`. IDE 진단은 오경보가 잦으므로 무시.
- 테스트: repo 루트에서 `npx vitest run <경로>`. **apps/desktop 테스트는 반드시 `apps/desktop` 디렉터리에서 `npx vitest run`으로 실행** (루트 vitest workspace만으로는 커버 안 되는 회귀 이력 있음).
- 커밋 컨벤션: Conventional Commits (`feat(graph-view): …`, `chore(wiki): …`).
- `read-wiki.ts`의 기존 계약 유지: **어떤 입력에도 throw하지 않는다** — 실패 시 `{ available: false }`.
- IPC 계약(ipc-contract.ts)·preload·renderer api는 수정하지 않는다 (이번 변경은 main process 내부와 graph-view 패키지에 국한 — `readProjectWiki`의 IPC 요청/응답 형태는 그대로).
- edges.jsonl ref 해석 실패 시 원본 ref를 그대로 유지한다 (다운스트림 `buildWikiGraphData.ensure()`가 유령 노드로 표시 — 기존 동작 보존).

## 배경 (구현자가 알아야 할 사실)

- `packages/graph-view/src/node/read-wiki.ts`의 `readWikiRoot()`는 md 파일을 걷어 노드를 만들고(`ref = 디렉터리/slug`), `<root>/graph/edges.jsonl`을 읽고, `[[위키링크]]`로 엣지를 합성한다. `targetToRef` 별칭 맵은 현재 위키링크 해석에만 쓰인다.
- autosci 커널 위키(autosci-core/research/wiki, coin data/hypotheses/wiki)의 edges.jsonl은 `{"from": "pipelines:attnembed-forecasting", "to": "modules:attention-embedding", ...}` 처럼 **콜론 구분 ref**를 쓴다.
- coin의 live 위키 문서는 `node_id` frontmatter가 없고 `type: company_graph_node` + 파일명(`company_graph/000660.KS.md`)으로만 식별된다. 즉 엣지 ref의 타입 접두사(`company_graph_node`)가 **디렉터리명(`company_graph`)과 다르다** — frontmatter `type`으로만 매칭 가능.
- 파일 미리보기는 `api.fsReadDoc({ projectId, relPath })`로 열리며 relPath는 프로젝트 repo 기준 상대경로다. 따라서 vaultPath가 repoPath 내부에 있으면 relPrefix는 repo-상대여야 미리보기가 동작한다.
- 앱 DB는 두 개다 (같은 스키마): WSL `/home/hskim/.config/@apc/desktop/apc.db`, Windows `/mnt/c/Users/irron/AppData/Roaming/@apc/desktop/apc.db`. `projects` 테이블 스키마: `id, name, status, goal, current_focus, start_date, target_date, project_type, repo_paths(JSON), vault_paths(JSON), source_paths(JSON), domain`.

---

### Task 1: 상속받은 read-wiki 개선 커밋 + 커널 콜론 ref 해석

**Files:**
- Modify: `packages/graph-view/src/node/read-wiki.ts`
- Test: `packages/graph-view/src/node/read-wiki.test.ts`
- Commit (docs): `docs/superpowers/plans/2026-07-06-wiki-graph-visibility.md` (이 계획서)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `readWikiRoot`가 콜론 ref(`type:slug`, `frontmatterType:slug`)를 노드 ref로 해석한 edges를 반환. `nodeTypeAndRef`는 `{ type, ref, slug }`를 반환하도록 확장.

- [ ] **Step 1: 브랜치 생성 및 상속 작업 커밋**

작업 트리에는 이전 세션이 남긴 미커밋 read-wiki 개선(전체 트리 걷기, `[[위키링크]]` 엣지 합성, `.apc-wiki` 폴백 + 테스트 2개)이 이미 있다. 이것이 이 플랜의 기반이므로 먼저 그대로 커밋한다.

```bash
cd /mnt/c/Users/irron/Desktop/my/ruahverce/ai_dashboard-main
git branch --show-current   # 예상: main
git checkout -b feat/wiki-graph-visibility
npx vitest run packages/graph-view/src/node/read-wiki.test.ts   # 예상: 전부 PASS (5 tests)
git add packages/graph-view/src/node/read-wiki.ts packages/graph-view/src/node/read-wiki.test.ts
git commit -m "feat(graph-view): walk full wiki tree, derive wiki-link edges, fall back to .apc-wiki"
git add docs/superpowers/plans/2026-07-06-wiki-graph-visibility.md
git commit -m "docs(plan): wiki graph visibility plan"
```

- [ ] **Step 2: 실패하는 테스트 작성**

`read-wiki.test.ts`의 `describe('readProjectWiki', ...)` 블록 안에 추가:

```ts
test('resolves kernel-style colon refs in edges.jsonl to file nodes', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pw-colon-'))
  const wiki = join(repo, 'wiki')
  mkdirSync(join(wiki, 'modules'), { recursive: true })
  mkdirSync(join(wiki, 'pipelines'), { recursive: true })
  mkdirSync(join(wiki, 'graph'), { recursive: true })
  writeFileSync(join(wiki, 'modules', 'attention-embedding.md'), '---\ntitle: AE\nslug: attention-embedding\n---\n')
  writeFileSync(join(wiki, 'pipelines', 'p1.md'), '---\ntitle: P1\n---\n')
  writeFileSync(join(wiki, 'graph', 'edges.jsonl'),
    JSON.stringify({ from: 'pipelines:p1', to: 'modules:attention-embedding', type: 'uses_module' }) + '\n' +
    JSON.stringify({ from: 'pipelines:p1', to: 'papers:unknown', type: 'pipeline_from_paper' }) + '\n')

  const res = readProjectWiki([repo])
  expect(res.available).toBe(true)
  if (!res.available) return
  expect(res.edges).toContainEqual(expect.objectContaining({ from: 'pipelines/p1', to: 'modules/attention-embedding', type: 'uses_module' }))
  // 해석 실패한 ref는 원본 유지 → 다운스트림에서 유령 노드로 표시
  expect(res.edges).toContainEqual(expect.objectContaining({ from: 'pipelines/p1', to: 'papers:unknown' }))
})

test('resolves colon refs whose type prefix comes from frontmatter type (coin company_graph style)', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pw-fmtype-'))
  const wiki = join(repo, 'wiki')
  mkdirSync(join(wiki, 'company_graph'), { recursive: true })
  mkdirSync(join(wiki, 'graph'), { recursive: true })
  writeFileSync(join(wiki, 'company_graph', '000660.KS.md'), '---\ntype: company_graph_node\nticker: "000660.KS"\n---\n')
  writeFileSync(join(wiki, 'company_graph', '005930.KS.md'), '---\ntype: company_graph_node\n---\n')
  writeFileSync(join(wiki, 'graph', 'edges.jsonl'),
    JSON.stringify({ from: 'company_graph_node:000660.KS', to: 'company_graph_node:005930.KS', type: 'candidate_comention' }) + '\n')

  const res = readProjectWiki([repo])
  expect(res.available).toBe(true)
  if (!res.available) return
  expect(res.edges).toContainEqual(expect.objectContaining({ from: 'company_graph/000660.KS', to: 'company_graph/005930.KS', type: 'candidate_comention' }))
})
```

- [ ] **Step 3: 실패 확인**

```bash
npx vitest run packages/graph-view/src/node/read-wiki.test.ts
```
예상: 새 테스트 2개 FAIL (`from: 'pipelines:p1'`이 그대로 남아 있어서), 기존 5개 PASS.

- [ ] **Step 4: 구현**

`read-wiki.ts` — `nodeTypeAndRef`가 slug도 반환하도록 변경:

```ts
function nodeTypeAndRef(rootRel: string, body: string): { type: string; ref: string; slug: string } {
  const withoutExt = rootRel.replace(/\.(md|mdx)$/i, '')
  const parts = withoutExt.split('/').filter(Boolean)
  const slug = FRONT(body, 'slug') ?? parts.at(-1) ?? withoutExt
  if (parts.length >= 2) return { type: parts[0], ref: `${parts[0]}/${slug}`, slug }
  return { type: 'document', ref: `document/${slug}`, slug }
}
```

`readWikiRoot`의 노드 루프에서 콜론 별칭 2종 추가 (기존 `addAlias` 호출들 뒤에):

```ts
const { type, ref, slug } = nodeTypeAndRef(rel, body)
// ... 기존 nodes.push / bodies.set / addAlias 호출들 유지 ...
addAlias(targetToRef, `${type}:${slug}`, ref)
const fmType = FRONT(body, 'type')
if (fmType && fmType !== type) addAlias(targetToRef, `${fmType}:${slug}`, ref)
```

edges.jsonl ref를 별칭 테이블로 해석 (기존 `const edges = readEdges(...)` 라인 교체 — 노드 루프 이후 위치 유지 필수):

```ts
const resolveRef = (value: string): string =>
  targetToRef.get(value.replace(/\\/g, '/').replace(/\.(md|mdx)$/i, '').trim()) ?? value
const edges = readEdges(join(root, 'graph', 'edges.jsonl'))
  .map((e) => ({ ...e, from: resolveRef(e.from), to: resolveRef(e.to) }))
```

- [ ] **Step 5: 통과 확인 + 전체 패키지 테스트 + 타입 검사**

```bash
npx vitest run packages/graph-view/src/node/read-wiki.test.ts   # 예상: 7 PASS
npx vitest run packages/graph-view                              # 예상: 전부 PASS
pnpm typecheck                                                  # 예상: 오류 0
```

- [ ] **Step 6: 커밋**

```bash
git add packages/graph-view/src/node/read-wiki.ts packages/graph-view/src/node/read-wiki.test.ts
git commit -m "feat(graph-view): resolve kernel colon refs in edges.jsonl to wiki file nodes"
```

---

### Task 2: registry vaultPaths를 직접 위키 루트로 읽기 + container 배선

**Files:**
- Modify: `packages/graph-view/src/node/read-wiki.ts` (readProjectWiki 시그니처)
- Modify: `apps/desktop/src/main/container.ts:413-416` (readProjectWikiQuery)
- Test: `packages/graph-view/src/node/read-wiki.test.ts`

**Interfaces:**
- Consumes: Task 1의 `readWikiRoot(root, relPrefix)`.
- Produces: `readProjectWiki(repoPaths: readonly string[], vaultPaths: readonly string[] = []): ReadWikiResult` — vaultPaths가 우선, 각 항목은 위키 루트 디렉터리를 직접 가리킴. 기존 1-인자 호출은 동작 불변(하위호환).

- [ ] **Step 1: 실패하는 테스트 작성**

`read-wiki.test.ts`에 추가:

```ts
test('vaultPaths are read directly as wiki roots with repo-relative relPath', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pw-vault-'))
  const vault = join(repo, 'research', 'wiki')
  mkdirSync(join(vault, 'modules'), { recursive: true })
  writeFileSync(join(vault, 'modules', 'm1.md'), '---\ntitle: M1\n---\n')

  const res = readProjectWiki([repo], [vault])
  expect(res.available).toBe(true)
  if (!res.available) return
  expect(res.nodes[0]).toMatchObject({ ref: 'modules/m1', relPath: 'research/wiki/modules/m1.md' })
})

test('vaultPaths take precedence over <repo>/wiki and tolerate ssh/missing entries', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pw-vault2-'))
  mkdirSync(join(repo, 'wiki', 'a'), { recursive: true })
  writeFileSync(join(repo, 'wiki', 'a', 'x.md'), '# X')
  const vault = join(repo, 'data', 'wiki')
  mkdirSync(join(vault, 'b'), { recursive: true })
  writeFileSync(join(vault, 'b', 'y.md'), '# Y')

  const res = readProjectWiki([repo], ['ssh://host/x', join(repo, 'no-such-dir'), vault])
  expect(res.available).toBe(true)
  if (!res.available) return
  expect(res.nodes.map((n) => n.ref)).toEqual(['b/y'])
})
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run packages/graph-view/src/node/read-wiki.test.ts
```
예상: 새 테스트 2개가 컴파일 오류 또는 FAIL (2번째 인자 미지원).

- [ ] **Step 3: 구현**

`read-wiki.ts` — import에 `isAbsolute` 추가:

```ts
import { basename, isAbsolute, join, relative, sep } from 'node:path'
```

`readProjectWiki` 교체:

```ts
/** vaultPath가 repoPath 내부면 repo-상대 prefix(파일 미리보기 fsReadDoc 호환), 아니면 디렉터리명. */
function vaultRelPrefix(repoPaths: readonly string[], vault: string): string {
  for (const repo of repoPaths) {
    if (!repo || repo.startsWith('ssh://')) continue
    const rel = relative(repo, vault)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/')
  }
  return basename(vault)
}

/** Read a project's wiki into graph data. Explicit registry vaultPaths (direct wiki roots) win;
 *  then the published `<repo>/wiki`; then internal generated docs in `<repo>/.apc-wiki`.
 *  Never throws — returns {available:false} on failure. */
export function readProjectWiki(repoPaths: readonly string[], vaultPaths: readonly string[] = []): ReadWikiResult {
  for (const vault of vaultPaths) {
    if (!vault || vault.startsWith('ssh://')) continue
    try {
      const direct = readWikiRoot(vault, vaultRelPrefix(repoPaths, vault))
      if (direct.available) return direct
    } catch { /* try next root */ }
  }
  for (const repo of repoPaths) {
    if (!repo || repo.startsWith('ssh://')) continue
    try {
      const published = readWikiRoot(join(repo, 'wiki'), 'wiki')
      if (published.available) return published
      const internal = readWikiRoot(join(repo, '.apc-wiki'), '.apc-wiki')
      if (internal.available) return internal
    } catch { return { available: false, reason: 'wiki read failed' } }
  }
  return { available: false }
}
```

`container.ts`의 `readProjectWikiQuery` 교체:

```ts
const readProjectWikiQuery = (req: ReadProjectWikiReq): ReadProjectWikiRes => {
  const project = registry.get(req.projectId)
  return readProjectWiki(project?.repoPaths ?? [], project?.vaultPaths ?? [])
}
```

- [ ] **Step 4: 통과 확인 + 데스크톱 테스트 + 타입 검사**

```bash
npx vitest run packages/graph-view/src/node/read-wiki.test.ts   # 예상: 9 PASS
npx vitest run packages/graph-view                              # 예상: 전부 PASS
pnpm typecheck                                                  # 예상: 오류 0
cd apps/desktop && npx vitest run && cd ../..                   # 예상: 전부 PASS (필수 — 루트 워크스페이스가 못 잡는 회귀 이력)
```

- [ ] **Step 5: 커밋**

```bash
git add packages/graph-view/src/node/read-wiki.ts packages/graph-view/src/node/read-wiki.test.ts apps/desktop/src/main/container.ts
git commit -m "feat(graph-view,desktop): read registry vaultPaths as direct wiki roots"
```

---

### Task 3: 프로젝트 등록 정리 (WSL+Windows DB) + 실데이터 스모크

**Files:**
- Modify (데이터): `/home/hskim/.config/@apc/desktop/apc.db`, `/mnt/c/Users/irron/AppData/Roaming/@apc/desktop/apc.db`
- Create (일회성, 커밋 금지): 스크래치 디렉터리에 `register-projects.py`, `smoke-readwiki.mts`

**Interfaces:**
- Consumes: Task 2의 `readProjectWiki(repoPaths, vaultPaths)`.
- Produces: 양쪽 DB의 projects 테이블에 4개 프로젝트가 올바른 경로로 등록됨. git 커밋 없음.

- [ ] **Step 1: DB 백업**

```bash
cp /home/hskim/.config/@apc/desktop/apc.db /home/hskim/.config/@apc/desktop/apc.db.bak-2026-07-06
cp /mnt/c/Users/irron/AppData/Roaming/@apc/desktop/apc.db /mnt/c/Users/irron/AppData/Roaming/@apc/desktop/apc.db.bak-2026-07-06
```

- [ ] **Step 2: 등록 스크립트 작성·실행**

스크래치 디렉터리에 `register-projects.py`로 저장 후 `python3 register-projects.py` 실행. **이름(name) 기준 upsert — 이미 있으면 경로만 갱신, 없으면 INSERT. 다른 행은 건드리지 않는다.**

```python
import sqlite3, json, time

def upsert(db, name, repo_paths, vault_paths):
    con = sqlite3.connect(db, timeout=3)
    try:
        row = con.execute("SELECT id FROM projects WHERE name=?", (name,)).fetchone()
        if row:
            con.execute("UPDATE projects SET repo_paths=?, vault_paths=? WHERE id=?",
                        (json.dumps(repo_paths), json.dumps(vault_paths), row[0]))
            print(f"{db} :: UPDATE {name} ({row[0]})")
        else:
            pid = f"proj-{int(time.time()*1000)}"
            con.execute(
                "INSERT INTO projects (id, name, status, project_type, repo_paths, vault_paths, source_paths, domain) "
                "VALUES (?, ?, 'active', 'git', ?, ?, '[]', 'project-docs')",
                (pid, name, json.dumps(repo_paths), json.dumps(vault_paths)))
            print(f"{db} :: INSERT {name} ({pid})")
            time.sleep(0.01)  # id 충돌 방지
        con.commit()
    finally:
        con.close()

WSL = "/home/hskim/.config/@apc/desktop/apc.db"
WIN = "/mnt/c/Users/irron/AppData/Roaming/@apc/desktop/apc.db"
L = "/mnt/c/Users/irron/Desktop/my/ruahverce"          # WSL 경로 기준
W = "C:\\Users\\irron\\Desktop\\my\\ruahverce"          # Windows 경로 기준

# WSL DB (WSL에서 실행하는 앱용 — /mnt/c 경로)
upsert(WSL, "ai_dash",        [f"{L}/ai_dashboard-main"], [])
upsert(WSL, "stock",          [f"{L}/coin"],              [f"{L}/coin/data/hypotheses/wiki"])
upsert(WSL, "autosci",        [f"{L}/autosci-core"],      [f"{L}/autosci-core/research/wiki"])
upsert(WSL, "calculate_math", [f"{L}/calculate_math"],    [f"{L}/calculate_math/02_데이터/curriculum_wiki"])

# Windows DB (Windows에서 실행하는 앱용 — C:\ 경로). stock은 기존 행 갱신.
upsert(WIN, "ai_dash",        [f"{W}\\ai_dashboard-main"], [])
upsert(WIN, "stock",          [f"{W}\\coin"],              [f"{W}\\coin\\data\\hypotheses\\wiki"])
upsert(WIN, "autosci",        [f"{W}\\autosci-core"],      [f"{W}\\autosci-core\\research\\wiki"])
upsert(WIN, "calculate_math", [f"{W}\\calculate_math"],    [f"{W}\\calculate_math\\02_데이터\\curriculum_wiki"])

for db in (WSL, WIN):
    print(f"--- {db} ---")
    for r in sqlite3.connect(db).execute("SELECT name, repo_paths, vault_paths FROM projects ORDER BY name"):
        print(r)
```

예상 출력: 각 DB에 UPDATE/INSERT 로그, 마지막 SELECT에서 4개 프로젝트(+Windows DB의 기존 papers, llm-agent-v3 유지) 확인.
`database is locked` 오류가 나면 데스크톱 앱이 실행 중인 것 — **중단하고 BLOCKED로 보고** (강제 진행 금지).

> ai_dash의 WSL 행은 기존에 `/mnt/c/Users/irron/Downloads/ai_dashboard-main/ai_dashboard-main`(낡은 복사본)을 가리키고 있었다 — 이 UPDATE가 그 교정이다.

- [ ] **Step 3: 실데이터 스모크 (WSL 경로 기준)**

스크래치 디렉터리에 `smoke-readwiki.mts`로 저장 후 ai_dashboard-main 루트에서 실행:

```ts
// Node 24 type-stripping으로 직접 실행
import { readProjectWiki } from '/mnt/c/Users/irron/Desktop/my/ruahverce/ai_dashboard-main/packages/graph-view/src/node/read-wiki.ts'

const L = '/mnt/c/Users/irron/Desktop/my/ruahverce'
const cases = [
  { name: 'autosci', repos: [`${L}/autosci-core`], vaults: [`${L}/autosci-core/research/wiki`], minNodes: 20 },
  { name: 'coin',    repos: [`${L}/coin`],         vaults: [`${L}/coin/data/hypotheses/wiki`],  minNodes: 3000 },
  { name: 'calc',    repos: [`${L}/calculate_math`], vaults: [`${L}/calculate_math/02_데이터/curriculum_wiki`], minNodes: 100 },
]
let fail = 0
for (const c of cases) {
  const res = readProjectWiki(c.repos, c.vaults)
  if (!res.available) { console.error(`FAIL ${c.name}: unavailable`); fail++; continue }
  const colonEdges = res.edges.filter((e) => e.from.includes(':') || e.to.includes(':')).length
  console.log(`${c.name}: nodes=${res.nodes.length} edges=${res.edges.length} unresolvedColonRefs=${colonEdges}`)
  if (res.nodes.length < c.minNodes) { console.error(`FAIL ${c.name}: nodes < ${c.minNodes}`); fail++ }
}
// autosci는 콜론 ref가 전부 해석되어야 한다(무결성 100% 확인된 위키)
process.exit(fail ? 1 : 0)
```

```bash
cd /mnt/c/Users/irron/Desktop/my/ruahverce/ai_dashboard-main
node <스크래치경로>/smoke-readwiki.mts
```

예상: autosci `unresolvedColonRefs=0`, nodes≥20 / coin nodes≥3000 (edges에 wiki 링크 다수) / calc nodes≥100, edges=0 (위키링크·edges.jsonl 없음 — 알려진 한계, 실패 아님). exit 0.
(Node가 .mts 실행을 거부하면 `npx tsx`로 재시도. 둘 다 안 되면 BLOCKED 보고.)

- [ ] **Step 4: 결과 기록**

스모크 출력 숫자(프로젝트별 nodes/edges/unresolvedColonRefs)를 보고서에 그대로 붙여넣는다. 커밋할 것 없음.

---

### Task 4: coin wiki-kernel.yaml 드리프트 해소 + 레거시 vault 표기

**Files:**
- Modify: `/mnt/c/Users/irron/Desktop/my/ruahverce/coin/wiki-kernel.yaml`
- Modify: `/mnt/c/Users/irron/Desktop/my/ruahverce/coin/vault/README.md` (배너 1줄 추가)

**Interfaces:**
- Consumes: 없음 (독립 태스크, coin 저장소에서 진행)
- Produces: `wiki_dir`가 활성 위키(`data/hypotheses/wiki`)를 가리킴. coin 저장소 커밋 1개.

**배경:** coin의 활성 위키는 `data/hypotheses/wiki`(문서 4,495개, 최근 활발)인데 `wiki-kernel.yaml`의 `wiki_dir: vault`는 2026-05-21 이후 정지한 옛 vault를 가리킨다. `contract_dir: runtime`에 해당하는 `runtime/` 디렉터리도 `data/hypotheses/wiki/runtime`에 존재한다(vault에는 없음) — 설정이 낡았다는 추가 증거.

- [ ] **Step 1: 브랜치 생성 + 소비처 확인**

```bash
cd /mnt/c/Users/irron/Desktop/my/ruahverce/coin
git status --short | head   # 기존 미커밋 변경 파악 — 건드리지 말 것
git checkout -b chore/wiki-kernel-drift
grep -rn "wiki-kernel" --include="*.py" --include="*.sh" --include="Makefile" --include="*.yaml" --include="*.toml" . 2>/dev/null | grep -v node_modules | grep -v __pycache__
grep -rn "wiki_dir" /mnt/c/Users/irron/Desktop/my/ruahverce/autosci-core/autosci_core /mnt/c/Users/irron/Desktop/my/ruahverce/autosci-core/kernel /mnt/c/Users/irron/Desktop/my/ruahverce/autosci-core/scripts 2>/dev/null | head
```

판정 규칙:
- 소비처가 발견되면: 그 코드가 `wiki_dir`를 어떻게 조인하는지 확인하고, 변경 후 해당 소비처의 스모크(예: 뷰어/린트 명령을 `--help` 또는 dry-run으로) 1회 실행.
- 소비처가 없으면: 값만 갱신 (죽은 설정이 낡은 경로를 가리키는 것 자체가 해악).

- [ ] **Step 2: wiki-kernel.yaml 갱신**

```yaml
# autosci-core wiki viewer / kernel 설정.
# wiki_dir: 위키 콘텐츠 루트 — 활성 위키는 data/hypotheses/wiki (vault/는 2026-05-21 이후 아카이브).
# contract_dir: (이행용) 커널 contract 위치 — edges.jsonl 로더 전환 시 사용.
wiki_dir: data/hypotheses/wiki
contract_dir: runtime
core_root: ../autosci-core
```

- [ ] **Step 3: vault README에 아카이브 배너 추가**

`vault/README.md` 맨 위(기존 내용 유지, 첫 줄로 삽입):

```markdown
> ⚠️ **아카이브** — 이 vault는 2026-05-21 이후 갱신되지 않습니다. 활성 위키는 `data/hypotheses/wiki/` 입니다.
```

- [ ] **Step 4: 커밋**

```bash
git add wiki-kernel.yaml vault/README.md
git commit -m "chore(wiki): point wiki-kernel at live wiki, mark legacy vault archived"
```

Step 1에서 소비처를 발견해 스모크를 돌렸다면 그 결과를 보고서에 포함.

---

## 후속 (이 플랜 범위 밖 — 별도 계획 필요)

- calculate_math: `curriculum_math_2022_enriched.json` + `graph_patch_proposal/*.json` → `curriculum_wiki/graph/edges.jsonl` 컨버터 (DomainPack 방향)
- 노드 ID 규약 문서화: autosci 계약(`type:slug` + `node_id` frontmatter)을 4개 프로젝트 공통 규약으로
- ai_dashboard 자체 위키: HarnessService 파이프라인으로 승격 페이지 생성
- feat 브랜치 머지 + 상위 저장소 submodule 포인터 갱신
