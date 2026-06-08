import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import matter from 'gray-matter'
import { parseJsonc } from './jsonc.js'
import { AgentConfigEditor } from './agent-config-editor.js'

const ed = new AgentConfigEditor()

describe('serializeProfileEdit', () => {
  test('markdown: merges edits into frontmatter, keeps other keys, prompt → content', () => {
    const current = matter.stringify('old prompt', { model: 'gpt-4', mode: 'primary', description: 'd' })
    const out = ed.serializeProfileEdit(current, 'markdown', 'build', { model: 'gpt-5', prompt: 'new prompt' })
    const parsed = matter(out)
    expect(parsed.data.model).toBe('gpt-5')
    expect(parsed.data.mode).toBe('primary')
    expect(parsed.data.description).toBe('d')
    expect(parsed.content.trim()).toBe('new prompt')
  })

  test('json: updates agent[name] fields, preserves other agents', () => {
    const current = JSON.stringify({ agent: { build: { model: 'gpt-4', mode: 'primary' }, plan: { model: 'x' } } }, null, 2)
    const out = ed.serializeProfileEdit(current, 'json', 'build', { model: 'gpt-5', permissions: { bash: 'deny' } })
    const obj = parseJsonc(out) as any
    expect(obj.agent.build.model).toBe('gpt-5')
    expect(obj.agent.build.mode).toBe('primary')
    expect(obj.agent.build.permission.bash).toBe('deny')
    expect(obj.agent.plan.model).toBe('x')
  })
})

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
    expect(d).not.toContain('-a')
  })
})

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
    expect(readFileSync(path, 'utf8')).toBe(proposed)
    expect(readFileSync(res.snapshotPath!, 'utf8')).toBe('{ "agent": { "b": { "model": "old" } } }\n')

    const rb = ed.rollbackConfig(path)
    expect(rb.ok).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('{ "agent": { "b": { "model": "old" } } }\n')
  })

  test('apply refuses invalid content (no write, no snapshot)', () => {
    const path = join(dir, 'opencode.json')
    writeFileSync(path, '{ "ok": true }\n')
    const res = ed.applyConfigText(path, '{ not json', 'json')
    expect(res.ok).toBe(false)
    expect(res.errors.length).toBeGreaterThan(0)
    expect(readFileSync(path, 'utf8')).toBe('{ "ok": true }\n')
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
    expect(readFileSync(path, 'utf8')).toContain('gpt-4')
  })
})
