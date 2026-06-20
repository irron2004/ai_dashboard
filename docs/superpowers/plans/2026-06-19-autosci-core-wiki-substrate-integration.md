# autosci-core Wiki Substrate Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ai_dashboard(TS 오케스트레이터)가 autosci-core(Python 코어)를 서브프로세스+계약+vault로 합성해, 논문 도메인에서 위키 빌드 이음매를 end-to-end로 증명한다.

**Architecture:** TS는 Python을 import하지 않고 `python -m kernel`/`python -m autosci_core.adapters`를 서브프로세스로 호출한다(claude/codex를 spawn하는 `cli-agent-runner.ts` 패턴). 공유 인터페이스 = autosci-core 계약(`runtime/schema|policy/*.yaml`) + vault 레이아웃(`wiki/`, `wiki/graph/edges.jsonl`, `index.md`) + CLI. 새 `@apc/wiki-substrate` 패키지가 Python 경계를 포트 뒤에 가둔다.

**Tech Stack:** TypeScript(ESM, NodeNext), pnpm workspace, vitest, zod(@apc/shared), Python 3 + `uv`(vendored autosci-core), git submodule.

## Global Constraints

- autosci-core 핀: **`core-v0.2.0`** (paper 계약의 `object`/`list_object` lint 필요). 리모트 `https://github.com/irron2004/autosci-core.git`.
- TS→Python은 **서브프로세스+파일만**. autosci-core를 import하거나 `vendor/autosci-core` 코어 코드를 직접 수정하지 않는다.
- `import kernel` / `python -m kernel {lint,rebuild-index}`는 autosci-core의 불변 계약 — 이름 가정 금지(rename하지 말 것).
- `kernel lint` 출력은 **사람용 텍스트**(`  - <issue>` 줄, issue 있으면 exit 1) — JSON 아님.
- 골든 fixture(`attnembed-e2e`)는 autosci-core `.scratch/`(gitignore·`core-v0.2.0` 태그 미포함)에 있으므로 **ai_dashboard로 freeze**해서 쓴다. 핀 태그/sibling 경로에 런타임 의존 금지.
- 기존 패턴 준수: leaf package.json은 `"type":"module"`, `"main":"./src/index.ts"`, deps는 `workspace:*`. 테스트는 vitest, `*.test.ts` 동거.
- 커밋은 Conventional Commits. 각 Task 끝에서 커밋.

**권위 스펙:** `docs/superpowers/specs/2026-06-19-autosci-core-wiki-substrate-integration-design.md` (특히 §4a).

---

## File Structure

**신규**
- `vendor/autosci-core/` — submodule(`core-v0.2.0`). 코어 코드. 수정 금지.
- `core.lock` — 핀 기록(JSON): `core_repo`/`core_version`/`core_commit`/`venv_python`.
- `scripts/bootstrap-substrate.mjs` — submodule init + `uv` venv + editable install + `core.lock` 작성.
- `scripts/bootstrap-substrate.test.ts` — 부트스트랩 산출물 검증(venv 없으면 skip).
- `wiki-domains/paper/runtime/schema/{entities,edges,conventions,xref}.yaml`, `wiki-domains/paper/runtime/policy/writers.yaml` — freeze된 paper 계약(overlay).
- `packages/wiki-substrate/package.json`, `tsconfig.json`, `src/index.ts`
  - `src/wiki-substrate.ts` — `WikiSubstrate` 포트 + `WikiVault` 타입.
  - `src/parse-lint-output.ts` — kernel lint 텍스트 → `KhKernelLintReport`(순수 함수).
  - `src/python-kernel-adapter.ts` — `PythonKernelAdapter`(서브프로세스).
  - `src/substrate-graph-adapter.ts` — vault → UI 모델(staged docs + node-proposals).
  - `src/*.test.ts`, `test/fixtures/paper-golden/` — freeze된 골든 vault + 샘플 PDF.
- `packages/knowledge-harness/src/runtime/paper-phase1-drivers.ts` — Phase-1 fixture/실제 driver 세트.

**수정**
- `packages/knowledge-harness/src/runtime/harness-runner.ts` — `DriverResult`에 `status`/`error`, `advance`가 실패 시 artifacts 보존 후 FAILED.
- `packages/shared/src/kh-schema.ts` — `KhKernelLintReportSchema` 추가.
- `packages/knowledge-harness/src/runtime/make-drivers.ts` — `ARTIFACTS.kernelLint` 추가.

---

## Task 1: 러너 실패 계약 (DriverResult.status + 실패 시 artifacts 보존)

VALIDATED가 lint 리포트를 보존하면서 run을 FAILED로 만들 수 있게 러너 계약을 확장한다. 현재 `advance`는 driver가 throw하면 artifacts를 잃는다(`harness-runner.ts:74-84`).

**Files:**
- Modify: `packages/knowledge-harness/src/runtime/harness-runner.ts`
- Test: `packages/knowledge-harness/src/runtime/harness-runner.test.ts`

**Interfaces:**
- Produces: `DriverResult = { artifacts: DriverArtifact[]; status?: 'ok' | 'failed'; error?: string }`. driver가 `status:'failed'`를 반환하면 러너가 그 단계 artifacts를 저장한 뒤 run을 `FAILED`로 전이하고 `error`를 기록한다.

- [ ] **Step 1: Write the failing test**

`packages/knowledge-harness/src/runtime/harness-runner.test.ts`의 `describe('HarnessRunner', …)` 안에 추가:

```ts
test('a driver returning status:failed persists its artifacts then fails the run', async () => {
  const drivers: Partial<Record<KhState, Driver>> = {
    PROJECT_SCANNED: async () => ({ artifacts: [{ name: 'out', data: { state: 'PROJECT_SCANNED' } }] }),
    SOURCES_EXTRACTED: async () => ({
      artifacts: [{ name: 'kernel-lint-report', data: { ok: false, exit_code: 1, issues: ['boom'] } }],
      status: 'failed',
      error: 'lint failed',
    }),
  }
  const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers, now })
  runner.createRun(store, { runId: 'RUN-1', projectId: 'p1', engine: 'claude' })
  const rs = await runner.advance(store)
  expect(rs.state).toBe('FAILED')
  expect(rs.error).toBe('lint failed')
  const paths = rs.artifacts['SOURCES_EXTRACTED']
  expect(paths).toHaveLength(1)
  expect(store.readArtifact(paths[0])).toEqual({ ok: false, exit_code: 1, issues: ['boom'] })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apc/knowledge-harness test -- harness-runner`
Expected: FAIL — 현재는 `status` 무시하고 SOURCES_EXTRACTED로 전진하므로 `rs.state`가 `'HUMAN_REVIEW_REQUIRED'`(또는 FAILED 아님).

- [ ] **Step 3: Extend the DriverResult type**

`harness-runner.ts`에서 교체:

```ts
export type DriverResult = { artifacts: DriverArtifact[]; status?: 'ok' | 'failed'; error?: string }
```

- [ ] **Step 4: Persist artifacts before deciding success/failure**

`harness-runner.ts`의 `try { … }` 블록(현재 line 61-73)을 교체:

```ts
        try {
          const result = (await this.deps.drivers[step.to]?.(ctx)) ?? { artifacts: [] }
          // 4a-1: 이 단계 artifacts를 항상 먼저 보존 — 실패한 검증 단계의 리포트도 살아남아야 한다.
          const paths = result.artifacts.map(a => store.writeArtifact(step.to, a.name, a.data))
          if (result.status === 'failed') {
            assertTransition(runState.state, 'FAILED')
            runState = {
              ...runState,
              state: 'FAILED',
              history: [...runState.history, { state: 'FAILED', at: this.deps.now() }],
              artifacts: { ...runState.artifacts, [step.to]: paths },
              error: result.error ?? `${step.to} reported failure`,
            }
            store.saveRunState(runState)
            onProgress?.(runState)
            return runState
          }
          assertTransition(runState.state, step.to)
          runState = {
            ...runState,
            state: step.to,
            history: [...runState.history, { state: step.to, at: this.deps.now() }],
            artifacts: { ...runState.artifacts, [step.to]: paths },
          }
          store.saveRunState(runState)
          ctx.runState = runState
          onProgress?.(runState)
        } catch (err) {
```

(아래 `catch (err) { … }` 블록은 그대로 둔다 — 예기치 못한 예외용.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @apc/knowledge-harness test -- harness-runner`
Expected: PASS (신규 테스트 + 기존 advance 테스트 전부 green — happy-path는 `status` 미설정이라 동작 불변).

- [ ] **Step 6: Commit**

```bash
git add packages/knowledge-harness/src/runtime/harness-runner.ts packages/knowledge-harness/src/runtime/harness-runner.test.ts
git commit -m "feat(harness): DriverResult.status — preserve artifacts then fail the run"
```

---

## Task 2: vendor autosci-core + venv 부트스트랩 + core.lock + 골든 fixture freeze

이음매가 의존할 Python 코어를 고정하고, 골든 fixture를 ai_dashboard 소유로 동결한다.

**Files:**
- Create: `scripts/bootstrap-substrate.mjs`, `scripts/bootstrap-substrate.test.ts`, `core.lock`
- Create(submodule): `vendor/autosci-core/`
- Create(freeze): `wiki-domains/paper/runtime/...`, `packages/wiki-substrate/test/fixtures/paper-golden/...`

**Interfaces:**
- Produces: `core.lock`(JSON: `core_repo`,`core_version`,`core_commit`,`venv_python`); `<repo>/.venv-substrate/`에 `import kernel` 가능한 venv; `wiki-domains/paper/runtime/`(계약); `packages/wiki-substrate/test/fixtures/paper-golden/{wiki,raw}`(골든 vault + PDF).

- [ ] **Step 1: Add the submodule pinned to core-v0.2.0**

```bash
git submodule add https://github.com/irron2004/autosci-core.git vendor/autosci-core
git -C vendor/autosci-core fetch --tags
git -C vendor/autosci-core checkout core-v0.2.0
git -C vendor/autosci-core rev-parse HEAD   # ← core_commit, 다음 스텝에서 사용
```

- [ ] **Step 2: Freeze the paper contract + golden vault + sample PDF into this repo**

골든 콘텐츠는 autosci-core 워킹트리(`../autosci-core/.scratch/attnembed-e2e/`)에서 **1회 캡처**한다(태그/sibling 경로에 런타임 의존하지 않도록 커밋).

```bash
mkdir -p wiki-domains/paper/runtime
cp -r ../autosci-core/.scratch/attnembed-e2e/runtime/schema  wiki-domains/paper/runtime/schema
cp -r ../autosci-core/.scratch/attnembed-e2e/runtime/policy  wiki-domains/paper/runtime/policy

mkdir -p packages/wiki-substrate/test/fixtures/paper-golden/raw/papers
cp -r ../autosci-core/.scratch/attnembed-e2e/wiki  packages/wiki-substrate/test/fixtures/paper-golden/wiki
cp ../autosci-core/2402.05370v1.pdf  packages/wiki-substrate/test/fixtures/paper-golden/raw/papers/attnembed-2402-05370.pdf
```

확인: `wiki-domains/paper/runtime/schema/entities.yaml`에 `papers:`/`modules:`/`pipelines:` 섹션이 있고, `paper-golden/wiki/papers/`·`wiki/modules/`·`wiki/graph/edges.jsonl`이 존재해야 한다.

- [ ] **Step 3: Pre-validate the frozen contract against the pinned kernel**

```bash
uv run --project vendor/autosci-core python -m kernel lint \
  --contract-dir wiki-domains/paper/runtime \
  --wiki-dir packages/wiki-substrate/test/fixtures/paper-golden/wiki
```
Expected: `lint: 0 issue(s)` + exit 0. issue가 나오면 `core-v0.2.0`이 paper 계약을 못 받치는 것 — 스펙 §8대로 코어에 이슈를 올리고 다음 stable 태그로 핀 변경 후 이 스텝 반복.

- [ ] **Step 4: Write the bootstrap script**

`scripts/bootstrap-substrate.mjs`:

```js
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const repo = process.cwd()
const vendor = 'vendor/autosci-core'
const venv = '.venv-substrate'
const isWin = process.platform === 'win32'
const venvPython = isWin ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python')

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', cwd: repo })

if (!existsSync(join(repo, vendor, 'pyproject.toml'))) {
  sh('git', ['submodule', 'update', '--init', vendor])
}
sh('uv', ['venv', venv])
sh('uv', ['pip', 'install', '--python', venvPython, '-e', `${vendor}[pdf]`])

const coreCommit = execFileSync('git', ['-C', vendor, 'rev-parse', 'HEAD'], { cwd: repo }).toString().trim()
writeFileSync(join(repo, 'core.lock'), JSON.stringify({
  core_repo: 'https://github.com/irron2004/autosci-core.git',
  core_version: 'core-v0.2.0',
  core_commit: coreCommit,
  venv_python: venvPython,
}, null, 2) + '\n')
console.log('substrate bootstrapped:', venvPython, '@', coreCommit)
```

- [ ] **Step 5: Run the bootstrap**

Run: `node scripts/bootstrap-substrate.mjs`
Expected: `substrate bootstrapped: .venv-substrate/... @ <sha>` + `core.lock` 생성.

- [ ] **Step 6: Write the bootstrap verification test**

`scripts/bootstrap-substrate.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const lockPath = 'core.lock'
const haveLock = existsSync(lockPath)
const d = haveLock ? describe : describe.skip

d('substrate bootstrap', () => {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))

  test('submodule HEAD matches core.lock.core_commit', () => {
    const head = execFileSync('git', ['-C', 'vendor/autosci-core', 'rev-parse', 'HEAD']).toString().trim()
    expect(head).toBe(lock.core_commit)
  })

  test('venv python resolves kernel under vendor/autosci-core', () => {
    const out = execFileSync(lock.venv_python, ['-c', 'import kernel; print(kernel.__file__)']).toString().trim()
    expect(out.replace(/\\/g, '/')).toContain('vendor/autosci-core')
  })
})
```

그리고 이 테스트가 발견되도록 vitest include를 확장한다. `vitest.config.ts`의 `test.include`를 교체:

```ts
    include: ['packages/**/*.test.ts', 'scripts/**/*.test.ts'],
```

- [ ] **Step 7: Run the verification test**

Run (레포 루트에서): `pnpm exec vitest run scripts/bootstrap-substrate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Ignore the venv, commit the rest**

`.gitignore`에 `.venv-substrate/` 추가. 그 다음:

```bash
git add .gitmodules vendor/autosci-core core.lock scripts/bootstrap-substrate.mjs scripts/bootstrap-substrate.test.ts .gitignore vitest.config.ts wiki-domains/ packages/wiki-substrate/test/fixtures/
git commit -m "chore(substrate): vendor autosci-core@core-v0.2.0, bootstrap + frozen paper fixture"
```

---

## Task 3: @apc/wiki-substrate 패키지 (포트 + lint 파서 + PythonKernelAdapter)

Python 경계를 포트 뒤에 가둔다. lint 텍스트 출력을 권위 리포트로 파싱한다.

**Files:**
- Modify: `packages/shared/src/kh-schema.ts`, `packages/shared/src/index.ts`(이미 `export *`면 불필요)
- Create: `packages/wiki-substrate/package.json`, `tsconfig.json`, `src/index.ts`, `src/wiki-substrate.ts`, `src/parse-lint-output.ts`, `src/python-kernel-adapter.ts`
- Test: `packages/wiki-substrate/src/parse-lint-output.test.ts`, `src/python-kernel-adapter.int.test.ts`

**Interfaces:**
- Consumes: `core.lock`(venv python 경로), 골든 fixture(Task 2).
- Produces:
  - `KhKernelLintReport = { generated_by: string; ok: boolean; exit_code: number; issues: string[] }`
  - `WikiVault = { contractDir: string; wikiDir: string }`
  - `interface WikiSubstrate { lint(v: WikiVault): Promise<KhKernelLintReport>; rebuildIndex(v: WikiVault): Promise<void>; checkSources(vaultRoot: string): Promise<{ ok: boolean; output: string }> }`
  - `parseLintOutput(stdout: string, exitCode: number): KhKernelLintReport`
  - `class PythonKernelAdapter implements WikiSubstrate { constructor(opts: { python: string; cwd?: string; timeoutMs?: number }) }`

- [ ] **Step 1: Add the KhKernelLintReport schema**

`packages/shared/src/kh-schema.ts`의 `KhMarkdownYamlValidationReportSchema` 블록 뒤에 추가:

```ts
export const KhKernelLintReportSchema = z.object({
  generated_by: z.string().default('kernel-lint'),
  ok: z.boolean().default(true),
  exit_code: z.number().default(0),
  issues: z.array(z.string()).default([]),
})
export type KhKernelLintReport = z.infer<typeof KhKernelLintReportSchema>
```

(`packages/shared/src/index.ts`가 `export * from './kh-schema.js'`인지 확인 — 맞으면 추가 작업 없음.)

- [ ] **Step 2: Scaffold the package**

`packages/wiki-substrate/package.json`:

```json
{
  "name": "@apc/wiki-substrate",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": { "@apc/shared": "workspace:*" }
}
```

`packages/wiki-substrate/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

그리고 cross-package import가 vitest에서 resolve되도록 `vitest.config.ts`의 `resolve.alias`에 한 줄 추가(다른 `@apc/*` 항목 옆):

```ts
      '@apc/wiki-substrate': `${root}packages/wiki-substrate/src/index.ts`,
```

Run: `pnpm install`  (workspace에 새 패키지 등록)
Expected: `@apc/wiki-substrate` 링크됨.

- [ ] **Step 3: Write the failing parser test**

`packages/wiki-substrate/src/parse-lint-output.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { parseLintOutput } from './parse-lint-output.js'

describe('parseLintOutput', () => {
  test('clean run (exit 0, no issue lines) is ok with no issues', () => {
    const r = parseLintOutput('INFO lint: 0 issue(s)\n', 0)
    expect(r.ok).toBe(true)
    expect(r.issues).toEqual([])
    expect(r.exit_code).toBe(0)
  })

  test('issue lines are parsed and mark the report not ok', () => {
    const stdout = [
      '  - [edge json] wiki/graph/edges.jsonl:3: Expecting value',
      '  - papers/x.md: missing required field "title"',
      'INFO lint: 2 issue(s)',
    ].join('\n')
    const r = parseLintOutput(stdout, 1)
    expect(r.ok).toBe(false)
    expect(r.exit_code).toBe(1)
    expect(r.issues).toEqual([
      '[edge json] wiki/graph/edges.jsonl:3: Expecting value',
      'papers/x.md: missing required field "title"',
    ])
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @apc/wiki-substrate test -- parse-lint-output`
Expected: FAIL — `parse-lint-output.js` 없음.

- [ ] **Step 5: Implement the parser**

`packages/wiki-substrate/src/parse-lint-output.ts`:

```ts
import { KhKernelLintReportSchema, type KhKernelLintReport } from '@apc/shared'

/** kernel CLI는 issue를 `  - <issue>` 줄로 출력하고 issue가 있으면 exit 1 (kernel/__main__.py). */
export function parseLintOutput(stdout: string, exitCode: number): KhKernelLintReport {
  const issues = stdout
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.*\S)\s*$/)?.[1])
    .filter((x): x is string => !!x)
  return KhKernelLintReportSchema.parse({
    ok: exitCode === 0 && issues.length === 0,
    exit_code: exitCode,
    issues,
  })
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm --filter @apc/wiki-substrate test -- parse-lint-output`
Expected: PASS.

- [ ] **Step 7: Define the port + adapter**

`packages/wiki-substrate/src/wiki-substrate.ts`:

```ts
import type { KhKernelLintReport } from '@apc/shared'

/** autosci-core vault 좌표: 계약 디렉터리 + 위키 디렉터리. */
export type WikiVault = { contractDir: string; wikiDir: string }

export interface WikiSubstrate {
  lint(vault: WikiVault): Promise<KhKernelLintReport>
  rebuildIndex(vault: WikiVault): Promise<void>
  /** `raw/` 문서가 어댑터로 파싱되는지 점검 (autosci-read). */
  checkSources(vaultRoot: string): Promise<{ ok: boolean; output: string }>
}
```

`packages/wiki-substrate/src/python-kernel-adapter.ts`:

```ts
import { spawn } from 'node:child_process'
import { parseLintOutput } from './parse-lint-output.js'
import type { WikiSubstrate, WikiVault } from './wiki-substrate.js'
import type { KhKernelLintReport } from '@apc/shared'

type RunOut = { stdout: string; stderr: string; code: number | null }

/** TS→Python 경계. autosci-core를 import하지 않고 서브프로세스로만 호출한다. */
export class PythonKernelAdapter implements WikiSubstrate {
  constructor(private readonly opts: { python: string; cwd?: string; timeoutMs?: number }) {}

  private run(args: string[]): Promise<RunOut> {
    return new Promise((resolve) => {
      const child = spawn(this.opts.python, args, {
        cwd: this.opts.cwd, stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      })
      let stdout = '', stderr = ''
      const timer = setTimeout(() => child.kill('SIGKILL'), this.opts.timeoutMs ?? 120_000)
      child.stdout.on('data', (d) => { stdout += String(d) })
      child.stderr.on('data', (d) => { stderr += String(d) })
      child.on('error', (e) => { clearTimeout(timer); resolve({ stdout, stderr: String(e), code: null }) })
      child.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, code }) })
    })
  }

  async lint(vault: WikiVault): Promise<KhKernelLintReport> {
    const { stdout, stderr, code } = await this.run([
      '-m', 'kernel', 'lint', '--contract-dir', vault.contractDir, '--wiki-dir', vault.wikiDir,
    ])
    // kernel은 issue를 stdout으로 print하지만 logging은 stderr로 갈 수 있어 둘 다 파싱한다.
    return parseLintOutput(`${stdout}\n${stderr}`, code ?? 1)
  }

  async rebuildIndex(vault: WikiVault): Promise<void> {
    await this.run(['-m', 'kernel', 'rebuild-index', '--contract-dir', vault.contractDir, '--wiki-dir', vault.wikiDir])
  }

  async checkSources(vaultRoot: string): Promise<{ ok: boolean; output: string }> {
    const { stdout, stderr, code } = await this.run(['-m', 'autosci_core.adapters', '--vault', vaultRoot])
    return { ok: code === 0, output: `${stdout}\n${stderr}` }
  }
}
```

`packages/wiki-substrate/src/index.ts`:

```ts
export * from './wiki-substrate.js'
export * from './parse-lint-output.js'
export * from './python-kernel-adapter.js'
```

- [ ] **Step 8: Write the integration test (gated on the venv)**

`packages/wiki-substrate/src/python-kernel-adapter.int.test.ts`:

```ts
import { describe, expect, test, beforeAll } from 'vitest'
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PythonKernelAdapter } from './python-kernel-adapter.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '../../..')
const lockPath = join(repoRoot, 'core.lock')
const haveVenv = existsSync(lockPath)
const d = haveVenv ? describe : describe.skip

d('PythonKernelAdapter (real kernel)', () => {
  let python: string
  const contractDir = join(repoRoot, 'wiki-domains/paper/runtime')
  const goldenWiki = resolve(here, '../test/fixtures/paper-golden/wiki')

  beforeAll(() => { python = join(repoRoot, JSON.parse(readFileSync(lockPath, 'utf8')).venv_python) })

  test('lint passes on the golden vault', async () => {
    const a = new PythonKernelAdapter({ python, cwd: repoRoot })
    const r = await a.lint({ contractDir, wikiDir: goldenWiki })
    expect(r.ok).toBe(true)
    expect(r.issues).toEqual([])
  })

  test('lint reports issues on a broken copy', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'paper-broken-'))
    cpSync(goldenWiki, join(tmp, 'wiki'), { recursive: true })
    // 한 노드의 frontmatter required 필드(title)를 지운다.
    const papersDir = join(tmp, 'wiki', 'papers')
    const f = join(papersDir, readdirSync(papersDir).find((n) => n.endsWith('.md'))!)
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^title:.*$/m, ''))
    const a = new PythonKernelAdapter({ python, cwd: repoRoot })
    const r = await a.lint({ contractDir, wikiDir: join(tmp, 'wiki') })
    expect(r.ok).toBe(false)
    expect(r.issues.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 9: Run the suite**

Run: `node scripts/bootstrap-substrate.mjs && pnpm --filter @apc/wiki-substrate test`
Expected: parser PASS, integration PASS(venv 있음). venv 없는 CI에선 integration은 skip.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/kh-schema.ts packages/wiki-substrate/ vitest.config.ts
git commit -m "feat(wiki-substrate): WikiSubstrate port + PythonKernelAdapter (kernel lint over subprocess)"
```

---

## Task 4: Phase-1 driver 세트 + VALIDATED 배선 + e2e/음성 테스트

새 상태 없이 주입형 driver로 골든 노드를 깔고, VALIDATED에서 실제 kernel lint를 권위 게이트로 건다. 음성 테스트로 게이트가 살아있음을 증명한다.

**Files:**
- Modify: `packages/knowledge-harness/src/runtime/make-drivers.ts` (`ARTIFACTS.kernelLint` 추가)
- Create: `packages/knowledge-harness/src/runtime/paper-phase1-drivers.ts`
- Test: `packages/knowledge-harness/src/runtime/paper-phase1.e2e.test.ts`

**Interfaces:**
- Consumes: `HarnessRunner`/`Driver`/`DriverResult`(Task 1), `WikiSubstrate`(Task 3), `ARTIFACTS`.
- Produces: `makePaperPhase1Drivers(deps: { substrate: WikiSubstrate; vaultRoot: string; goldenWikiDir: string; samplePdf: string; contractDir: string }): Partial<Record<KhState, Driver>>`. `VALIDATED`는 `kernel-lint-report` artifact를 내고 lint 실패 시 `status:'failed'`.

- [ ] **Step 1: Add the kernelLint artifact name**

`make-drivers.ts`의 `ARTIFACTS` 객체에 한 줄 추가(`secretScan` 줄 뒤):

```ts
  kernelLint: 'kernel-lint-report',
```

- [ ] **Step 2: Write the failing e2e test**

`packages/knowledge-harness/src/runtime/paper-phase1.e2e.test.ts`:

```ts
import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, cpSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RunArtifactStore } from './run-artifact-store.js'
import { FeatureGate } from './feature-gate.js'
import { HarnessRunner } from './harness-runner.js'
import { PythonKernelAdapter } from '@apc/wiki-substrate'
import { makePaperPhase1Drivers } from './paper-phase1-drivers.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '../../../..')
const lockPath = join(repoRoot, 'core.lock')
const haveVenv = existsSync(lockPath)
const d = haveVenv ? describe : describe.skip

const ALL_OPEN = {
  enable_conversation_history_reader: true, auto_classify_documents: true,
  auto_create_node_proposals: true, auto_create_write_plan: true, auto_write_to_staging: true,
}
const now = () => '2026-06-19T00:00:00Z'

d('paper-domain Phase 1 seam', () => {
  let dir: string, store: RunArtifactStore, python: string
  const contractDir = join(repoRoot, 'wiki-domains/paper/runtime')
  const goldenWikiDir = join(repoRoot, 'packages/wiki-substrate/test/fixtures/paper-golden/wiki')
  const samplePdf = join(repoRoot, 'packages/wiki-substrate/test/fixtures/paper-golden/raw/papers/attnembed-2402-05370.pdf')

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paper-phase1-'))
    store = new RunArtifactStore(join(dir, 'run'))
    python = join(repoRoot, JSON.parse(readFileSync(lockPath, 'utf8')).venv_python)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function drivers(goldenOverride?: string) {
    const substrate = new PythonKernelAdapter({ python, cwd: repoRoot })
    return makePaperPhase1Drivers({
      substrate, vaultRoot: join(dir, 'vault'),
      goldenWikiDir: goldenOverride ?? goldenWikiDir, samplePdf, contractDir,
    })
  }

  test('golden vault walks to HUMAN_REVIEW_REQUIRED with a green kernel-lint-report', async () => {
    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers: drivers(), now })
    runner.createRun(store, { runId: 'RUN-1', projectId: 'paper', engine: 'fixture' })
    const rs = await runner.advance(store)
    expect(rs.state).toBe('HUMAN_REVIEW_REQUIRED')
    const lint: any = store.readArtifact(rs.artifacts['VALIDATED'][0])
    expect(lint.ok).toBe(true)
    expect(existsSync(join(dir, 'vault', 'wiki', 'index.md'))).toBe(true)  // rebuild-index 산출 (스펙 §6 [4])
  })

  test('a broken node fails the run but preserves the kernel-lint-report', async () => {
    const broken = join(dir, 'broken-wiki')
    cpSync(goldenWikiDir, broken, { recursive: true })
    const papers = join(broken, 'papers')
    const f = join(papers, readdirSync(papers).find((n) => n.endsWith('.md'))!)
    writeFileSync(f, readFileSync(f, 'utf8').replace(/^title:.*$/m, ''))

    const runner = new HarnessRunner({ gates: new FeatureGate(ALL_OPEN), drivers: drivers(broken), now })
    runner.createRun(store, { runId: 'RUN-2', projectId: 'paper', engine: 'fixture' })
    const rs = await runner.advance(store)
    expect(rs.state).toBe('FAILED')
    const lint: any = store.readArtifact(rs.artifacts['VALIDATED'][0])
    expect(lint.ok).toBe(false)
    expect(lint.issues.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @apc/knowledge-harness test -- paper-phase1`
Expected: FAIL — `paper-phase1-drivers.js` 없음.

- [ ] **Step 4: Implement the Phase-1 drivers**

`packages/knowledge-harness/src/runtime/paper-phase1-drivers.ts`:

```ts
import { cpSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import type { KhState } from '@apc/shared'
import type { Driver, DriverResult } from './harness-runner.js'
import type { WikiSubstrate } from '@apc/wiki-substrate'
import { ARTIFACTS } from './make-drivers.js'

export type PaperPhase1Deps = {
  substrate: WikiSubstrate
  vaultRoot: string        // 이 run의 autosci-core vault (wiki/ + runtime/ 가 놓인다)
  goldenWikiDir: string    // freeze된 골든 wiki/
  samplePdf: string        // freeze된 샘플 PDF
  contractDir: string      // wiki-domains/paper/runtime
}

/** 새 상태를 넣지 않고 주입형 driver로 Phase-1 경로를 구성한다 (스펙 §4a-2).
 *  생성 단계 = fixture(골든 상수), SOURCES_EXTRACTED·VALIDATED = 실제 substrate. */
export function makePaperPhase1Drivers(deps: PaperPhase1Deps): Partial<Record<KhState, Driver>> {
  const wikiDir = join(deps.vaultRoot, 'wiki')
  const vaultContractDir = join(deps.vaultRoot, 'runtime')
  const rawPapers = join(deps.vaultRoot, 'raw', 'papers')

  // kernel WikiContract는 contractDir.parent를 vault root로 보고 entity/edge 경로(`dir: wiki/...`)를
  // 거기서 해석한다(--wiki-dir은 page 위치에 안 씀). 그래서 계약과 wiki를 vault 아래 *형제*로 둔다.
  const seedGolden = () => {
    mkdirSync(wikiDir, { recursive: true }); cpSync(deps.goldenWikiDir, wikiDir, { recursive: true })
    mkdirSync(vaultContractDir, { recursive: true }); cpSync(deps.contractDir, vaultContractDir, { recursive: true })
  }

  const drivers: Partial<Record<KhState, Driver>> = {
    PROJECT_SCANNED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.projectDiscovery, data: { domain: 'paper' } }] }),

    // 실제 ingest 점검: PDF를 raw/에 두고 autosci-read로 파싱되는지 확인.
    SOURCES_EXTRACTED: async (): Promise<DriverResult> => {
      mkdirSync(rawPapers, { recursive: true })
      copyFileSync(deps.samplePdf, join(rawPapers, 'attnembed-2402-05370.pdf'))
      const check = await deps.substrate.checkSources(deps.vaultRoot)
      return { artifacts: [{ name: ARTIFACTS.conversationHistory, data: check }] }
    },

    DOCUMENTS_CLASSIFIED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.documentIntent, data: { documents: [] } }] }),

    // fixture: 골든 노드 상수 배치 (LLM 생성 대체).
    NODE_PROPOSALS_CREATED: async (): Promise<DriverResult> => { seedGolden(); return { artifacts: [{ name: ARTIFACTS.nodeProposals, data: { proposals: [] } }] } },
    LEAD_MERGED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.graphUpdatePlan, data: { node_ops: [] } }] }),
    WRITE_PLAN_CREATED: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.writePlan, data: { ops: [] } }] }),
    STAGING_WRITTEN: async (): Promise<DriverResult> => ({ artifacts: [{ name: ARTIFACTS.appliedWriteReport, data: { applied: [], proposals: [], skipped: [] } }] }),

    // 실제 권위 게이트: kernel lint. 통과 시 index 재생성, 실패 시 리포트 보존 + run FAILED (§4a-1).
    // contractDir은 vault 안에 복사된 vaultContractDir(= <vault>/runtime) — wiki와 형제여야 kernel이 page를 찾는다.
    VALIDATED: async (): Promise<DriverResult> => {
      const report = await deps.substrate.lint({ contractDir: vaultContractDir, wikiDir })
      if (report.ok) await deps.substrate.rebuildIndex({ contractDir: vaultContractDir, wikiDir })
      return {
        artifacts: [{ name: ARTIFACTS.kernelLint, data: report }],
        status: report.ok ? 'ok' : 'failed',
        error: report.ok ? undefined : `kernel lint: ${report.issues.length} issue(s)`,
      }
    },
  }
  return drivers
}
```

- [ ] **Step 5: Add the workspace dep**

`packages/knowledge-harness/package.json`의 `dependencies`에 추가: `"@apc/wiki-substrate": "workspace:*"`. 그 다음 `pnpm install`.

- [ ] **Step 6: Run the e2e + negative test**

Run: `node scripts/bootstrap-substrate.mjs && pnpm --filter @apc/knowledge-harness test -- paper-phase1`
Expected: 2 PASS — golden→HUMAN_REVIEW_REQUIRED(green lint), broken→FAILED(lint not ok, 리포트 보존).

- [ ] **Step 7: Commit**

```bash
git add packages/knowledge-harness/src/runtime/make-drivers.ts packages/knowledge-harness/src/runtime/paper-phase1-drivers.ts packages/knowledge-harness/src/runtime/paper-phase1.e2e.test.ts packages/knowledge-harness/package.json
git commit -m "feat(harness): paper-domain Phase-1 drivers — real kernel lint as authoritative VALIDATED gate"
```

---

## Task 5: UI 그래프 어댑터 (vault → node-proposals + staged docs) + 뷰어 스모크

기존 UI는 `node-proposals` artifact + `node_id`/`node_type` frontmatter로 그래프를 만든다(`harness-utils.ts:776`, `staged-docs.ts:20`). autosci-core vault를 그 모델로 투영한다. lint 대상 vault는 순수 autosci 계약을 유지하고, UI 투영은 별도 산출물로 만든다(스펙 §4a-3).

**Files:**
- Create: `packages/wiki-substrate/src/substrate-graph-adapter.ts`
- Test: `packages/wiki-substrate/src/substrate-graph-adapter.test.ts`
- Modify: `packages/knowledge-harness/src/runtime/paper-phase1-drivers.ts` (NODE_PROPOSALS_CREATED·STAGING_WRITTEN가 어댑터 호출)

**Interfaces:**
- Consumes: 골든 vault(`wiki/{papers,modules,pipelines}/*.md` frontmatter + `wiki/graph/edges.jsonl`).
- Produces:
  - `vaultToNodeProposals(wikiDir: string): { proposals: Array<{ proposal_id: string; node: { id: string; title: string; type: string } }> }` — `buildHarnessGraphData`가 소비하는 `node-proposals` 형태.
  - `vaultToStagedDocs(wikiDir: string, stagingRoot: string): string[]` — 각 노드를 `node_id`/`node_type` frontmatter 마크다운으로 `stagingRoot`에 써서 `collectStagedDocs`가 인식하게 한다. 반환 = 쓴 상대경로들.

- [ ] **Step 1: Write the failing adapter test**

`packages/wiki-substrate/src/substrate-graph-adapter.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vaultToNodeProposals, vaultToStagedDocs } from './substrate-graph-adapter.js'

function tinyVault(): string {
  const root = mkdtempSync(join(tmpdir(), 'vault-'))
  const wiki = join(root, 'wiki')
  mkdirSync(join(wiki, 'papers'), { recursive: true })
  mkdirSync(join(wiki, 'modules'), { recursive: true })
  writeFileSync(join(wiki, 'papers', 'attn.md'), '---\ntitle: Attn Paper\nslug: attn\n---\n# Attn Paper\n')
  writeFileSync(join(wiki, 'modules', 'ema.md'), '---\ntitle: EMA Attention\nslug: ema\nkind: encoder\n---\n# EMA\n')
  return wiki
}

describe('substrate-graph-adapter', () => {
  test('vaultToNodeProposals derives node-proposals from frontmatter', () => {
    const out = vaultToNodeProposals(tinyVault())
    const byId = Object.fromEntries(out.proposals.map((p) => [p.node.id, p.node]))
    expect(byId['attn']).toEqual({ id: 'attn', title: 'Attn Paper', type: 'papers' })
    expect(byId['ema']).toEqual({ id: 'ema', title: 'EMA Attention', type: 'modules' })
  })

  test('vaultToStagedDocs writes node_id/node_type frontmatter docs', () => {
    const wiki = tinyVault()
    const staging = mkdtempSync(join(tmpdir(), 'staging-'))
    const written = vaultToStagedDocs(wiki, staging)
    expect(written.length).toBe(2)
    const doc = readFileSync(join(staging, written.find((w) => w.includes('attn'))!), 'utf8')
    expect(doc).toMatch(/^node_id:\s*attn$/m)
    expect(doc).toMatch(/^node_type:\s*papers$/m)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @apc/wiki-substrate test -- substrate-graph-adapter`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: Implement the adapter**

`packages/wiki-substrate/src/substrate-graph-adapter.ts`:

```ts
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename, relative } from 'node:path'

type Node = { id: string; title: string; type: string; relPath: string; body: string }

/** wiki/<type>/<slug>.md 의 frontmatter를 읽어 노드로 만든다. type = 디렉터리명(papers/modules/pipelines…). */
function readNodes(wikiDir: string): Node[] {
  const out: Node[] = []
  let types: string[]
  try { types = readdirSync(wikiDir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'graph').map((e) => e.name) }
  catch { return out }
  for (const type of types) {
    const dir = join(wikiDir, type)
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
      const body = readFileSync(join(dir, name), 'utf8')
      const fm = body.startsWith('---') ? body.slice(3, body.indexOf('\n---', 3)) : ''
      const slug = fm.match(/^slug:\s*(.+)$/m)?.[1]?.trim() ?? basename(name, '.md')
      const title = fm.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? slug
      out.push({ id: slug, title, type, relPath: `${type}/${name}`, body })
    }
  }
  return out
}

/** buildHarnessGraphData가 소비하는 node-proposals 형태로 투영. */
export function vaultToNodeProposals(wikiDir: string): { proposals: Array<{ proposal_id: string; node: { id: string; title: string; type: string } }> } {
  return { proposals: readNodes(wikiDir).map((n) => ({ proposal_id: n.id, node: { id: n.id, title: n.title, type: n.type } })) }
}

/** 각 노드를 node_id/node_type frontmatter 마크다운으로 staging에 써서 collectStagedDocs가 노드로 인식하게 한다. */
export function vaultToStagedDocs(wikiDir: string, stagingRoot: string): string[] {
  const written: string[] = []
  for (const n of readNodes(wikiDir)) {
    const rel = join('nodes', `${n.id}.md`)
    const abs = join(stagingRoot, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, `---\nnode_id: ${n.id}\nnode_type: ${n.type}\ntitle: ${n.title}\n---\n\n# ${n.title}\n`)
    written.push(rel.replace(/\\/g, '/'))
  }
  return written
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @apc/wiki-substrate test -- substrate-graph-adapter`
Expected: PASS.

- [ ] **Step 5: Wire the adapter into the Phase-1 drivers**

`paper-phase1-drivers.ts` 상단 import에 추가: `import { vaultToNodeProposals, vaultToStagedDocs } from '@apc/wiki-substrate'`.
그리고 두 driver를 교체:

```ts
    NODE_PROPOSALS_CREATED: async (): Promise<DriverResult> => {
      seedGolden()
      return { artifacts: [{ name: ARTIFACTS.nodeProposals, data: vaultToNodeProposals(wikiDir) }] }
    },
```

```ts
    STAGING_WRITTEN: async (): Promise<DriverResult> => {
      const proposals = vaultToStagedDocs(wikiDir, join(deps.vaultRoot, 'vault-staging'))
      return { artifacts: [{ name: ARTIFACTS.appliedWriteReport, data: { applied: [], proposals, skipped: [] } }] }
    },
```

- [ ] **Step 6: Add a viewer smoke assertion to the e2e**

`paper-phase1.e2e.test.ts`의 golden 테스트 끝에 추가(같은 `rs` 사용):

```ts
    const props: any = store.readArtifact(rs.artifacts['NODE_PROPOSALS_CREATED'][0])
    const types = new Set(props.proposals.map((p: any) => p.node.type))
    expect(types.has('papers')).toBe(true)
    expect(types.has('modules')).toBe(true)
    expect(props.proposals.length).toBeGreaterThan(3)
```

- [ ] **Step 7: Run the full suite**

Run: `node scripts/bootstrap-substrate.mjs && pnpm --filter @apc/wiki-substrate test && pnpm --filter @apc/knowledge-harness test -- paper-phase1`
Expected: 전부 PASS — 어댑터 단위 + golden(노드 투영 포함) + 음성.

- [ ] **Step 8: Commit**

```bash
git add packages/wiki-substrate/src/substrate-graph-adapter.ts packages/wiki-substrate/src/substrate-graph-adapter.test.ts packages/knowledge-harness/src/runtime/paper-phase1-drivers.ts packages/knowledge-harness/src/runtime/paper-phase1.e2e.test.ts
git commit -m "feat(wiki-substrate): vault→UI graph adapter (node-proposals + staged docs projection)"
```

---

## 검증 (전체 Task 완료 후)

스펙 §10 성공 기준에 1:1 대응:

1. 핀/lock — Task 2 (`core.lock` + `submodule HEAD==commit` + `kernel.__file__` under vendor) ✅ bootstrap test
2. freeze — Task 2 (`wiki-domains/paper/` + `paper-golden/`) ✅
3. 어댑터 정상/깨짐 — Task 3 integration test ✅
4. 골든 vault e2e [1]~[4] — Task 4 golden test ✅
5. 음성(FAILED + 리포트 보존) — Task 1 unit + Task 4 broken test ✅
6. UI 투영 — Task 5 어댑터 + 뷰어 스모크 ✅

전체: `node scripts/bootstrap-substrate.mjs && pnpm -r test`
