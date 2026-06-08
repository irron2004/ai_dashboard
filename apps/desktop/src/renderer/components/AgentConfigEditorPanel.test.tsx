import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { AgentProfile } from '@apc/shared'
import { AgentConfigEditorPanel } from './AgentConfigEditorPanel.js'

vi.mock('../api.js', () => ({
  api: {
    configPreview: vi.fn().mockResolvedValue({ ok: true, errors: [], diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-model: gpt-4\n+model: gpt-5\n' }),
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
