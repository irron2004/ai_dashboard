# Harness Config Form Editor (diff/validate/apply) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user edit an OpenCode agent config via a form, preview the diff, validate it, and apply it with a snapshot backup + atomic write (and roll back) — closing PRD acceptance criterion #8.

**Architecture:** A pure-ish `AgentConfigEditor` (`@apc/harness`) serializes form edits back into the config text (markdown via gray-matter round-trip; jsonc via parse→re-stringify, comments reformatted), validates, diffs, and applies with snapshot+atomic-write. Three additive IPC commands (preview/apply/rollback) drive a new `AgentConfigEditorPanel` UI.

**Tech Stack:** TypeScript, gray-matter, Vitest, React, Electron IPC.

**Spec:** `docs/superpowers/specs/2026-06-08-harness-config-apply-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/shared/src/harness-schema.ts` | Modify | Add `ProfileEdits` type |
| `packages/harness/src/agent-config-editor.ts` | Create | `AgentConfigEditor`: serialize/validate/diff/apply/rollback |
| `packages/harness/src/agent-config-editor.test.ts` | Create | Unit tests |
| `packages/harness/src/index.ts` | Modify | Export the editor |
| `apps/desktop/src/shared/ipc-contract.ts` | Modify | Config IPC types + channels |
| `apps/desktop/src/main/ipc.ts` | Modify | configPreview/configApply/configRollback handlers |
| `apps/desktop/src/renderer/api.ts` | Modify | api wrappers |
| `apps/desktop/src/renderer/components/AgentConfigEditorPanel.tsx` | Create | Form editor UI |
| `apps/desktop/src/renderer/components/HarnessDashboard.tsx` | Modify | "Config" tab |

**Verification commands:**
- harness pkg: `npx vitest run packages/harness`
- desktop: `cd apps/desktop && npx vitest run`
- typecheck: `pnpm typecheck`

> NodeNext: relative imports use `.js`.

---

## Task 1: `ProfileEdits` + `serializeProfileEdit`

**Files:**
- Modify: `packages/shared/src/harness-schema.ts`
- Create: `packages/harness/src/agent-config-editor.ts`
- Create: `packages/harness/src/agent-config-editor.test.ts`
- Modify: `packages/harness/src/index.ts`

- [ ] **Step 1: Write the failing test.** Create `packages/harness/src/agent-config-editor.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import matter from 'gray-matter'
import { parseJsonc } from './jsonc.js'
import { AgentConfigEditor } from './agent-config-editor.js'

const ed = new AgentConfigEditor()

describe('serializeProfileEdit', () => {
  test('markdown: merges edits into frontmatter, keeps other keys, prompt → content', () => {
    const current = matter.stringify('old prompt', { model: 'gpt-4', mode: 'primary', description: 'd' })
    const out = ed.serializeProfileEdit(current, 'markdown', 'build', { model: 'gpt-5', prompt: 'new prompt' })
    const parsed = matter(out)
    expect(parsed.data.model).toBe('gpt-5')          // edited
    expect(parsed.data.mode).toBe('primary')          // preserved
    expect(parsed.data.description).toBe('d')          // preserved
    expect(parsed.content.trim()).toBe('new prompt')   // prompt → content
  })

  test('json: updates agent[name] fields, preserves other agents', () => {
    const current = JSON.stringify({ agent: { build: { model: 'gpt-4', mode: 'primary' }, plan: { model: 'x' } } }, null, 2)
    const out = ed.serializeProfileEdit(current, 'json', 'build', { model: 'gpt-5', permissions: { bash: 'deny' } })
    const obj = parseJsonc(out) as any
    expect(obj.agent.build.model).toBe('gpt-5')
    expect(obj.agent.build.mode).toBe('primary')       // preserved
    expect(obj.agent.build.permission.bash).toBe('deny')
    expect(obj.agent.plan.model).toBe('x')             // other agent preserved
  })
})
```

- [ ] **Step 2: Run, confirm FAIL** — `npx vitest run packages/harness/src/agent-config-editor.test.ts` (module not found).

- [ ] **Step 3: Add `ProfileEdits`** to `packages/shared/src/harness-schema.ts` (after `AgentProfile`):

```ts
export type ProfileEdits = {
  model?: string
  mode?: string
  permissions?: Partial<Record<'read' | 'edit' | 'bash' | 'web' | 'task', 'allow' | 'ask' | 'deny'>>
  tools?: string[]
  temperature?: number
  description?: string
  prompt?: string
}
```

- [ ] **Step 4: Create the editor with `serializeProfileEdit`.** Create `packages/harness/src/agent-config-editor.ts`:

```ts
import matter from 'gray-matter'
import type { ProfileEdits } from '@apc/shared'
import { parseJsonc } from './jsonc.js'

export type ConfigValidation = { ok: boolean; errors: string[] }

const VALID_MODES = new Set(['primary', 'subagent', 'reviewer', 'planner', 'builder', 'custom'])
const VALID_PERMS = new Set(['allow', 'ask', 'deny'])

/** Editor for OpenCode agent configs: serialize form edits back to text, validate, diff, apply (snapshot), rollback. */
export class AgentConfigEditor {
  /** Merge form edits into the current config text. Markdown round-trips via gray-matter; json re-stringifies
   *  (comments are reformatted — the caller shows the diff before applying). `undefined` edit fields are skipped. */
  serializeProfileEdit(currentText: string, rawFormat: 'json' | 'markdown', profileName: string, edits: ProfileEdits): string {
    if (rawFormat === 'markdown') {
      const parsed = matter(currentText)
      const data: Record<string, unknown> = { ...parsed.data }
      if (edits.model !== undefined) data.model = edits.model
      if (edits.mode !== undefined) data.mode = edits.mode
      if (edits.permissions !== undefined) data.permission = { ...((data.permission as object) ?? {}), ...edits.permissions }
      if (edits.tools !== undefined) data.tools = edits.tools
      if (edits.temperature !== undefined) data.temperature = edits.temperature
      if (edits.description !== undefined) data.description = edits.description
      const content = edits.prompt !== undefined ? edits.prompt : parsed.content
      return matter.stringify(content, data)
    }
    const obj = (parseJsonc(currentText) ?? {}) as Record<string, any>
    obj.agent = obj.agent ?? {}
    const a = (obj.agent[profileName] = obj.agent[profileName] ?? {})
    if (edits.model !== undefined) a.model = edits.model
    if (edits.mode !== undefined) a.mode = edits.mode
    if (edits.permissions !== undefined) a.permission = { ...(a.permission ?? {}), ...edits.permissions }
    if (edits.tools !== undefined) a.tools = edits.tools
    if (edits.temperature !== undefined) a.temperature = edits.temperature
    if (edits.description !== undefined) a.description = edits.description
    if (edits.prompt !== undefined) a.prompt = edits.prompt
    return JSON.stringify(obj, null, 2) + '\n'
  }
}
```

- [ ] **Step 5: Export it.** In `packages/harness/src/index.ts` add:

```ts
export * from './agent-config-editor.js'
```

- [ ] **Step 6: Run test + typecheck, confirm PASS** — `npx vitest run packages/harness/src/agent-config-editor.test.ts && pnpm typecheck` (2 tests green).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/harness-schema.ts packages/harness/src/agent-config-editor.ts packages/harness/src/agent-config-editor.test.ts packages/harness/src/index.ts
git commit -m "feat(harness): AgentConfigEditor.serializeProfileEdit + ProfileEdits type"
```

---

## Task 2: `validateConfigText` + `diffText`

**Files:**
- Modify: `packages/harness/src/agent-config-editor.ts`
- Modify: `packages/harness/src/agent-config-editor.test.ts`

- [ ] **Step 1: Write the failing tests.** Add to `agent-config-editor.test.ts`:

```ts
describe('validateConfigText', () => {
  test('ok for valid json + markdown', () => {
    expect(ed.validateConfigText('{ "agent": { "b": { "mode": "primary" } } }', 'json').ok).toBe(true)
    expect(ed.validateConfigText(matter.stringify('p', { mode: 'subagent' }), 'markdown').ok).toBe(true)
  })
  test('flags broken json and invalid mode/permission', () => {
    expect(ed.validateConfigText('{ not json', 'json').ok).toBe(false)
    const bad = ed.validateConfigText('{ "agent": { "b": { "mode": "wat", "permission": { "bash": "nope" } } } }', 'json')
    expect(bad.ok).toBe(false)
    expect(bad.errors.join(' ')).toMatch(/mode/)
    expect(bad.errors.join(' ')).toMatch(/permission|bash/)
  })
})

describe('diffText', () => {
  test('empty when identical, unified hunk on the changed region', () => {
    expect(ed.diffText('a\nb\nc', 'a\nb\nc', 'f')).toBe('')
    const d = ed.diffText('a\nb\nc', 'a\nB\nc', 'f')
    expect(d).toContain('--- a/f')
    expect(d).toContain('+++ b/f')
    expect(d).toContain('-b')
    expect(d).toContain('+B')
    expect(d).not.toContain('-a')   // common prefix not in the hunk
  })
})
```

- [ ] **Step 2: Run, confirm FAIL** — `validateConfigText`/`diffText` not defined.

- [ ] **Step 3: Implement.** Add these methods to the `AgentConfigEditor` class in `agent-config-editor.ts`:

```ts
  validateConfigText(text: string, rawFormat: 'json' | 'markdown'): ConfigValidation {
    const errors: string[] = []
    if (rawFormat === 'json') {
      let obj: any
      try { obj = parseJsonc(text) } catch (e) { return { ok: false, errors: [`JSON parse error: ${e instanceof Error ? e.message : String(e)}`] } }
      const agents = obj?.agent
      if (agents && typeof agents === 'object') {
        for (const [name, cfg] of Object.entries<any>(agents)) {
          if (cfg?.mode !== undefined && !VALID_MODES.has(cfg.mode)) errors.push(`agent ${name}: invalid mode "${cfg.mode}"`)
          const perm = cfg?.permission
          if (perm && typeof perm === 'object') {
            for (const [k, v] of Object.entries<any>(perm)) {
              if (!VALID_PERMS.has(v)) errors.push(`agent ${name}: invalid permission ${k}="${v}"`)
            }
          }
        }
      }
    } else {
      try { matter(text) } catch (e) { errors.push(`frontmatter parse error: ${e instanceof Error ? e.message : String(e)}`) }
    }
    return { ok: errors.length === 0, errors }
  }

  /** Unified diff of the changed region only (common prefix/suffix trimmed). Empty string if identical. */
  diffText(current: string, proposed: string, path: string): string {
    if (current === proposed) return ''
    const a = current.split('\n'), b = proposed.split('\n')
    let p = 0
    while (p < a.length && p < b.length && a[p] === b[p]) p++
    let sa = a.length, sb = b.length
    while (sa > p && sb > p && a[sa - 1] === b[sb - 1]) { sa--; sb-- }
    const removed = a.slice(p, sa), added = b.slice(p, sb)
    const start = p + 1
    const header = `--- a/${path}\n+++ b/${path}\n@@ -${start},${removed.length} +${start},${added.length} @@\n`
    const body = [...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)].join('\n') + '\n'
    return header + body
  }
```

- [ ] **Step 4: Run tests + typecheck, confirm PASS** — `npx vitest run packages/harness && pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/harness/src/agent-config-editor.ts packages/harness/src/agent-config-editor.test.ts
git commit -m "feat(harness): AgentConfigEditor validateConfigText + diffText"
```

---

## Task 3: `applyConfigText` + `rollbackConfig` + IO helpers (`previewEdit`/`applyEdit`)

**Files:**
- Modify: `packages/harness/src/agent-config-editor.ts`
- Modify: `packages/harness/src/agent-config-editor.test.ts`

- [ ] **Step 1: Write the failing tests.** Add to `agent-config-editor.test.ts` (top-level imports: add `import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'`, `import { tmpdir } from 'node:os'`, `import { join } from 'node:path'`):

```ts
describe('applyConfigText + rollbackConfig', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cfg-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('apply writes a snapshot then the new content; rollback restores it', () => {
    const path = join(dir, 'opencode.json')
    writeFileSync(path, '{ "agent": { "b": { "model": "old" } } }\n')
    const proposed = '{ "agent": { "b": { "model": "new" } } }\n'

    const res = ed.applyConfigText(path, proposed, 'json')
    expect(res.ok).toBe(true)
    expect(res.snapshotPath && existsSync(res.snapshotPath)).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe(proposed)               // applied
    expect(readFileSync(res.snapshotPath!, 'utf8')).toBe('{ "agent": { "b": { "model": "old" } } }\n')  // backup = old

    const rb = ed.rollbackConfig(path)
    expect(rb.ok).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('{ "agent": { "b": { "model": "old" } } }\n')  // restored
  })

  test('apply refuses invalid content (no write, no snapshot)', () => {
    const path = join(dir, 'opencode.json')
    writeFileSync(path, '{ "ok": true }\n')
    const res = ed.applyConfigText(path, '{ not json', 'json')
    expect(res.ok).toBe(false)
    expect(res.errors.length).toBeGreaterThan(0)
    expect(readFileSync(path, 'utf8')).toBe('{ "ok": true }\n')   // unchanged
  })

  test('rollback with no snapshot returns ok:false', () => {
    const path = join(dir, 'opencode.json')
    writeFileSync(path, '{}\n')
    expect(ed.rollbackConfig(path).ok).toBe(false)
  })

  test('previewEdit reads file + returns validation + diff without writing', () => {
    const path = join(dir, 'a.md')
    writeFileSync(path, matter.stringify('p', { model: 'gpt-4' }))
    const pv = ed.previewEdit(path, 'markdown', 'a', { model: 'gpt-5' })
    expect(pv.ok).toBe(true)
    expect(pv.diff).toContain('gpt-5')
    expect(readFileSync(path, 'utf8')).toContain('gpt-4')   // not written
  })
})
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement.** Add the fs import at the TOP of `agent-config-editor.ts`:

```ts
import { readFileSync, writeFileSync, copyFileSync, renameSync, readdirSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
```
And add these methods to the class:

```ts
  /** Validate, snapshot the current file, then atomically write the proposed text. No write if validation fails. */
  applyConfigText(path: string, proposedText: string, rawFormat: 'json' | 'markdown'): { ok: boolean; snapshotPath?: string; errors: string[] } {
    const v = this.validateConfigText(proposedText, rawFormat)
    if (!v.ok) return { ok: false, errors: v.errors }
    // snapshot first — copyFileSync throws if the original is missing, so we never write without a backup
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const snapshotPath = `${path}.bak-${stamp}`
    copyFileSync(path, snapshotPath)
    // atomic write: temp then rename
    const tmp = `${path}.tmp-${stamp}`
    writeFileSync(tmp, proposedText)
    renameSync(tmp, path)
    return { ok: true, snapshotPath, errors: [] }
  }

  /** Restore the most recent `<file>.bak-*` snapshot. */
  rollbackConfig(path: string): { ok: boolean; restoredFrom?: string; error?: string } {
    const dir = dirname(path), base = basename(path)
    let snaps: string[]
    try { snaps = readdirSync(dir).filter((f) => f.startsWith(`${base}.bak-`)) } catch { return { ok: false, error: 'cannot read directory' } }
    if (snaps.length === 0) return { ok: false, error: 'no snapshot to restore' }
    snaps.sort()  // ISO timestamps sort lexicographically = chronologically
    const latest = join(dir, snaps[snaps.length - 1])
    copyFileSync(latest, path)
    return { ok: true, restoredFrom: latest }
  }

  /** Read current file → serialize edits → validate + diff. No write. */
  previewEdit(path: string, rawFormat: 'json' | 'markdown', profileName: string, edits: ProfileEdits): { ok: boolean; errors: string[]; diff: string } {
    const current = readFileSync(path, 'utf8')
    const proposed = this.serializeProfileEdit(current, rawFormat, profileName, edits)
    const v = this.validateConfigText(proposed, rawFormat)
    return { ok: v.ok, errors: v.errors, diff: this.diffText(current, proposed, path) }
  }

  /** Read current file → serialize edits → applyConfigText (validate + snapshot + atomic write). */
  applyEdit(path: string, rawFormat: 'json' | 'markdown', profileName: string, edits: ProfileEdits): { ok: boolean; errors: string[]; snapshotPath?: string } {
    const current = readFileSync(path, 'utf8')
    const proposed = this.serializeProfileEdit(current, rawFormat, profileName, edits)
    return this.applyConfigText(path, proposed, rawFormat)
  }
```

(Also add `import { beforeEach, afterEach } from 'vitest'` to the test file's vitest import if not present.)

- [ ] **Step 4: Run tests + typecheck, confirm PASS** — `npx vitest run packages/harness && pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/harness/src/agent-config-editor.ts packages/harness/src/agent-config-editor.test.ts
git commit -m "feat(harness): AgentConfigEditor apply (snapshot+atomic) + rollback + preview/applyEdit"
```

---

## Task 4: IPC contract + handlers + api

**Files:**
- Modify: `apps/desktop/src/shared/ipc-contract.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/renderer/api.ts`

- [ ] **Step 1: ipc-contract.** In `CH` add:
```ts
  configPreview: 'c:configPreview',
  configApply: 'c:configApply',
  configRollback: 'c:configRollback',
```
And add types (import `ProfileEdits` from `@apc/shared` at the top of the file — it already imports from `@apc/shared`):
```ts
export type ConfigEditReq = { rawConfigPath: string; rawFormat: 'json' | 'markdown'; profileName: string; edits: ProfileEdits }
export type ConfigPreviewRes = { ok: boolean; errors: string[]; diff: string }
export type ConfigApplyRes = { ok: boolean; errors: string[]; snapshotPath?: string }
export type ConfigRollbackReq = { rawConfigPath: string }
export type ConfigRollbackRes = { ok: boolean; restoredFrom?: string; error?: string }
```

- [ ] **Step 2: ipc.ts handlers.** In `apps/desktop/src/main/ipc.ts`, in the handler object (next to the `[CH.listProfiles]` handler), add (mirror the `listProfiles` dynamic-import pattern):
```ts
    [CH.configPreview]: async (payload: unknown) => {
      const req = payload as ConfigEditReq
      const { AgentConfigEditor } = await import('@apc/harness')
      return new AgentConfigEditor().previewEdit(req.rawConfigPath, req.rawFormat, req.profileName, req.edits)
    },
    [CH.configApply]: async (payload: unknown) => {
      const req = payload as ConfigEditReq
      const { AgentConfigEditor } = await import('@apc/harness')
      return new AgentConfigEditor().applyEdit(req.rawConfigPath, req.rawFormat, req.profileName, req.edits)
    },
    [CH.configRollback]: async (payload: unknown) => {
      const req = payload as ConfigRollbackReq
      const { AgentConfigEditor } = await import('@apc/harness')
      return new AgentConfigEditor().rollbackConfig(req.rawConfigPath)
    },
```
Add `ConfigEditReq, ConfigRollbackReq` to the `import type { ... } from '../shared/ipc-contract.js'` list at the top of ipc.ts.

- [ ] **Step 3: api.ts.** Add to the exported `api` object (mirror the existing `search`/`listProfiles` wrappers):
```ts
  configPreview(req: ConfigEditReq): Promise<ConfigPreviewRes> {
    return window.apc.invoke(CH.configPreview, req) as Promise<ConfigPreviewRes>
  },
  configApply(req: ConfigEditReq): Promise<ConfigApplyRes> {
    return window.apc.invoke(CH.configApply, req) as Promise<ConfigApplyRes>
  },
  configRollback(req: ConfigRollbackReq): Promise<ConfigRollbackRes> {
    return window.apc.invoke(CH.configRollback, req) as Promise<ConfigRollbackRes>
  },
```
Add `ConfigEditReq, ConfigPreviewRes, ConfigApplyRes, ConfigRollbackReq, ConfigRollbackRes` to api.ts's `import type { ... } from '../shared/ipc-contract.js'`.

- [ ] **Step 4: Verify** — `cd apps/desktop && npx vitest run && cd ../.. && pnpm typecheck`. (Handlers use the generic `invoke`/`registerIpc` path; typecheck + suite gate them, same as `listProfiles`.)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/ipc-contract.ts apps/desktop/src/main/ipc.ts apps/desktop/src/renderer/api.ts
git commit -m "feat(desktop): config preview/apply/rollback IPC"
```

---

## Task 5: `AgentConfigEditorPanel` + Config tab

**Files:**
- Create: `apps/desktop/src/renderer/components/AgentConfigEditorPanel.tsx`
- Create: `apps/desktop/src/renderer/components/AgentConfigEditorPanel.test.tsx`
- Modify: `apps/desktop/src/renderer/components/HarnessDashboard.tsx`

- [ ] **Step 1: Write the failing test.** Create `apps/desktop/src/renderer/components/AgentConfigEditorPanel.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { AgentProfile } from '@apc/shared'
import { AgentConfigEditorPanel } from './AgentConfigEditorPanel.js'

vi.mock('../api.js', () => ({
  api: {
    configPreview: vi.fn().mockResolvedValue({ ok: true, errors: [], diff: '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-model: gpt-4\n+model: gpt-5\n' }),
    configApply: vi.fn().mockResolvedValue({ ok: true, errors: [], snapshotPath: '/x.bak-1' }),
    configRollback: vi.fn().mockResolvedValue({ ok: true, restoredFrom: '/x.bak-1' }),
  },
}))

const profiles: AgentProfile[] = [
  { id: 'opencode:md:build', provider: 'opencode', name: 'build', scope: 'project', mode: 'primary', model: 'gpt-4', rawConfigPath: '/p/.opencode/agent/build.md', rawFormat: 'markdown' },
]

describe('AgentConfigEditorPanel', () => {
  test('renders the selected profile fields and Validate/Apply buttons', () => {
    render(<AgentConfigEditorPanel profiles={profiles} />)
    expect((screen.getByLabelText('model') as HTMLInputElement).value).toBe('gpt-4')
    expect(screen.getByRole('button', { name: 'Validate' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDefined()
  })

  test('Apply calls api.configApply with the edited fields', async () => {
    const { api } = await import('../api.js')
    render(<AgentConfigEditorPanel profiles={profiles} />)
    fireEvent.change(screen.getByLabelText('model'), { target: { value: 'gpt-5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(api.configApply).toHaveBeenCalledWith(expect.objectContaining({
      rawConfigPath: '/p/.opencode/agent/build.md', rawFormat: 'markdown', profileName: 'build',
      edits: expect.objectContaining({ model: 'gpt-5' }),
    }))
  })
})
```

- [ ] **Step 2: Run, confirm FAIL** (module not found).

- [ ] **Step 3: Write the component.** Create `apps/desktop/src/renderer/components/AgentConfigEditorPanel.tsx`:

```tsx
import { useState } from 'react'
import type { AgentProfile, ProfileEdits } from '@apc/shared'
import { api } from '../api.js'
import { DiffViewer } from './DiffViewer.js'

const MODES = ['primary', 'subagent', 'reviewer', 'planner', 'builder', 'custom']
const PERMS = ['', 'allow', 'ask', 'deny']
const PERM_KEYS = ['read', 'edit', 'bash', 'web', 'task'] as const

type Props = { profiles: AgentProfile[] }

export function AgentConfigEditorPanel({ profiles }: Props) {
  const editable = profiles.filter((p) => p.rawFormat === 'json' || p.rawFormat === 'markdown')
  const [selId, setSelId] = useState<string>(editable[0]?.id ?? '')
  const sel = editable.find((p) => p.id === selId) ?? editable[0]
  const [edits, setEdits] = useState<ProfileEdits>({})
  const [errors, setErrors] = useState<string[]>([])
  const [diff, setDiff] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  if (!sel) return <div className="config-editor">편집 가능한 OpenCode 프로필이 없습니다.</div>

  const req = () => ({
    rawConfigPath: sel.rawConfigPath,
    rawFormat: sel.rawFormat as 'json' | 'markdown',
    profileName: sel.name,
    edits,
  })
  const val = <K extends keyof ProfileEdits>(k: K, fallback: ProfileEdits[K]): ProfileEdits[K] =>
    (edits[k] !== undefined ? edits[k] : fallback)

  const onValidate = async () => { const r = await api.configPreview(req()); setErrors(r.errors); setDiff(r.ok ? null : diff); setMsg(r.ok ? '유효함' : null) }
  const onDiff = async () => { const r = await api.configPreview(req()); setErrors(r.errors); setDiff(r.diff || '(변경 없음)') }
  const onApply = async () => { const r = await api.configApply(req()); setErrors(r.errors); setMsg(r.ok ? `적용됨 (백업: ${r.snapshotPath})` : null) }
  const onRollback = async () => { const r = await api.configRollback({ rawConfigPath: sel.rawConfigPath }); setMsg(r.ok ? `롤백됨 (${r.restoredFrom})` : `롤백 실패: ${r.error}`) }

  return (
    <div className="config-editor">
      <select value={selId} onChange={(e) => { setSelId(e.target.value); setEdits({}); setDiff(null); setErrors([]); setMsg(null) }}>
        {editable.map((p) => <option key={p.id} value={p.id}>{p.provider}:{p.name} ({p.rawFormat})</option>)}
      </select>

      <label>model
        <input aria-label="model" value={String(val('model', sel.model ?? ''))} onChange={(e) => setEdits((s) => ({ ...s, model: e.target.value }))} />
      </label>
      <label>mode
        <select aria-label="mode" value={String(val('mode', sel.mode))} onChange={(e) => setEdits((s) => ({ ...s, mode: e.target.value }))}>
          {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      {PERM_KEYS.map((k) => (
        <label key={k}>{k}
          <select aria-label={`perm-${k}`} value={edits.permissions?.[k] ?? sel.permissions?.[k] ?? ''}
            onChange={(e) => setEdits((s) => ({ ...s, permissions: { ...s.permissions, [k]: e.target.value || undefined } }))}>
            {PERMS.map((p) => <option key={p} value={p}>{p || '(unset)'}</option>)}
          </select>
        </label>
      ))}
      <label>temperature
        <input aria-label="temperature" type="number" value={String(val('temperature', sel.temperature ?? ''))}
          onChange={(e) => setEdits((s) => ({ ...s, temperature: e.target.value === '' ? undefined : Number(e.target.value) }))} />
      </label>

      <div className="config-editor__actions">
        <button type="button" onClick={() => void onValidate()}>Validate</button>
        <button type="button" onClick={() => void onDiff()}>Diff</button>
        <button type="button" onClick={() => void onApply()}>Apply</button>
        <button type="button" onClick={() => void onRollback()}>Rollback</button>
      </div>

      {errors.length > 0 && <ul className="config-editor__errors">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {msg && <p className="config-editor__msg">{msg}</p>}
      {diff && <DiffViewer patch={diff} />}
    </div>
  )
}
```

- [ ] **Step 4: Run the test + typecheck, confirm PASS** (2 tests). `cd apps/desktop && npx vitest run src/renderer/components/AgentConfigEditorPanel.test.tsx && cd ../.. && pnpm typecheck`.

- [ ] **Step 5: Wire a "Config" tab into HarnessDashboard.** In `apps/desktop/src/renderer/components/HarnessDashboard.tsx`:
(a) Import: `import { AgentConfigEditorPanel } from './AgentConfigEditorPanel.js'`
(b) Extend `Tab`: add `| 'config'` to the union.
(c) Add a tab button after the others:
```tsx
            <button type="button" className={tab === 'config' ? 'harness-dashboard__tab harness-dashboard__tab--active' : 'harness-dashboard__tab'} onClick={() => setTab('config')}>Config</button>
```
(d) Add content after the others (`profiles` is already a prop of HarnessDashboard):
```tsx
            {tab === 'config' && <AgentConfigEditorPanel profiles={profiles} />}
```

- [ ] **Step 6: Verify** — `cd apps/desktop && npx vitest run && cd ../.. && pnpm typecheck` (full desktop suite green).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/components/AgentConfigEditorPanel.tsx apps/desktop/src/renderer/components/AgentConfigEditorPanel.test.tsx apps/desktop/src/renderer/components/HarnessDashboard.tsx
git commit -m "feat(desktop): AgentConfigEditorPanel + Config tab (form edit/validate/diff/apply/rollback)"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run all affected suites + typecheck.**
```bash
npx vitest run packages/harness
cd apps/desktop && npx vitest run && cd ../..
pnpm typecheck
```
Expected: all green, typecheck clean.

- [ ] **Step 2: Confirm acceptance criteria (spec §10).**
1. Form edit + Validate/Diff/Apply for OpenCode. ✔ (Task 5)
2. Apply snapshots then atomic-writes; no write if snapshot fails (copyFileSync throws → no write). ✔ (Task 3)
3. Diff shows current↔proposed unified diff. ✔ (Task 2/5)
4. Rollback restores latest snapshot. ✔ (Task 3)
5. Validate failure blocks Apply (`applyConfigText` returns ok:false without writing). ✔ (Task 3)
6. New + existing tests + typecheck pass; 3 IPC commands added, no migration. ✔

---

## Notes for the implementer
- `serializeProfileEdit`/`validateConfigText`/`diffText` are PURE (text in, text/result out) — unit-tested directly. `applyConfigText`/`rollbackConfig`/`previewEdit`/`applyEdit` do fs IO — tested with temp dirs.
- `ProfileEdits.permissions` (plural, normalized) serializes to the config key `permission` (singular) — that's intentional (matches `OpenCodeConfigAdapter.mapPermissions`).
- jsonc comments are reformatted on apply by design (Approach A); the diff + snapshot are the safety net.
- The IPC handlers live in `ipc.ts` (not the container), mirroring the existing `listProfiles` dynamic-import handler.
