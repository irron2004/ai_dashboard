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
