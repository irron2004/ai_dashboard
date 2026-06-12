import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { createDefaultHarnessConfig, GATE_WIRING, HARNESS_FEATURE_GATES } from '../harness-utils.js'
import { HarnessStructurePanel } from './HarnessStructurePanel.js'

const noop = { onModelChange: vi.fn(), onSafetyChange: vi.fn(), onToggleGate: vi.fn(), onPromptChange: vi.fn(), onClose: vi.fn() }

describe('HarnessStructurePanel', () => {
  test('renders all pipeline stages in order', () => {
    render(<HarnessStructurePanel config={createDefaultHarnessConfig()} activeState={null} {...noop} />)
    for (const name of ['수집 (materialize)', 'project-discovery', 'conversation-history', 'document-intent', 'node-extractor', 'wiki-graph-lead', 'policy-guard', '인간 리뷰 → Promote']) {
      expect(screen.getByText(name)).toBeDefined()
    }
  })

  test('clicking an agent stage opens its prompt editor and edits flow to onPromptChange', () => {
    const onPromptChange = vi.fn()
    render(<HarnessStructurePanel config={createDefaultHarnessConfig()} activeState={null} {...noop} onPromptChange={onPromptChange} />)
    fireEvent.click(screen.getByText('node-extractor'))
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'new prompt' } })
    expect(onPromptChange).toHaveBeenCalledWith('knowledgeNodeExtractor', 'new prompt')
  })

  test('clicking the gate stage shows safety controls', () => {
    render(<HarnessStructurePanel config={createDefaultHarnessConfig()} activeState={null} {...noop} />)
    fireEvent.click(screen.getByText('policy-guard'))
    expect(screen.getByText(/secret scan/i)).toBeDefined()
    expect(screen.getByText(/evidence/i)).toBeDefined()
  })

  test('highlights the stage for the active run state', () => {
    render(<HarnessStructurePanel config={createDefaultHarnessConfig()} activeState="NODE_PROPOSALS_CREATED" {...noop} />)
    expect(screen.getByText('node-extractor').closest('.structure-panel__card')?.className).toContain('--now')
  })

  test('engine badge reflects config and changes flow to onModelChange', () => {
    const onModelChange = vi.fn()
    render(<HarnessStructurePanel config={createDefaultHarnessConfig()} activeState={null} {...noop} onModelChange={onModelChange} />)
    fireEvent.click(screen.getByText('project-discovery'))
    fireEvent.change(screen.getByLabelText('엔진'), { target: { value: 'codex' } })
    expect(onModelChange).toHaveBeenCalledWith({ engine: 'codex' })
  })

  test('close button calls onClose', () => {
    const onClose = vi.fn()
    render(<HarnessStructurePanel config={createDefaultHarnessConfig()} activeState={null} {...noop} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('설정 닫기'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  test('gate editor: honored gates are toggleable, non-honored are disabled', () => {
    const onToggleGate = vi.fn()
    render(<HarnessStructurePanel config={createDefaultHarnessConfig()} activeState={null} {...noop} onToggleGate={onToggleGate} />)
    fireEvent.click(screen.getByText('policy-guard'))
    const honored = HARNESS_FEATURE_GATES.find((g) => GATE_WIRING[g.key] === 'honored')!
    const nonHonored = HARNESS_FEATURE_GATES.find((g) => GATE_WIRING[g.key] !== 'honored')!
    // Each gate <label> wraps the <input> directly — getByLabelText resolves via the enclosing label element
    const honoredCheckbox = screen.getByLabelText(new RegExp(honored.label, 'i'))
    const nonHonoredCheckbox = screen.getByLabelText(new RegExp(nonHonored.label, 'i'))
    expect((nonHonoredCheckbox as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(honoredCheckbox)
    expect(onToggleGate).toHaveBeenCalledWith(honored.key)
  })
})
