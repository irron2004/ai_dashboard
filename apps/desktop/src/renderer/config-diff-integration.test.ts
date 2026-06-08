import { describe, expect, test } from 'vitest'
import { AgentConfigEditor } from '@apc/harness'
import { parseUnifiedDiff } from './harness-utils.js'

describe('diffText ↔ parseUnifiedDiff integration', () => {
  test('DiffViewer can parse the editor diff (non-empty, shows the changed lines)', () => {
    const patch = new AgentConfigEditor().diffText('model: gpt-4\nmode: primary\n', 'model: gpt-5\nmode: primary\n', '/p/.opencode/agent/build.md')
    const files = parseUnifiedDiff(patch)
    expect(files.length).toBeGreaterThan(0)
    const text = JSON.stringify(files)
    expect(text).toContain('gpt-4')   // removed line should be in rows
    expect(text).toContain('gpt-5')   // added line should be in rows
  })
})
