import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { createDefaultHarnessConfig, GATE_WIRING, HARNESS_FEATURE_GATES } from '../harness-utils.js'
import { HarnessStructurePanel } from './HarnessStructurePanel.js'

const noop = { onModelChange: vi.fn(), onSafetyChange: vi.fn(), onToggleGate: vi.fn(), onPromptChange: vi.fn(), onClose: vi.fn(), policy: null, policyPreview: null, policyBusy: false, onProposePolicy: vi.fn(), onApprovePolicy: vi.fn(), onRevertPolicy: vi.fn() }

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
    const textarea = screen.getByLabelText('프롬프트 오버라이드')
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

  test('engine settings: model + sandbox flow to onModelChange (codex)', () => {
    const onModelChange = vi.fn()
    const config = createDefaultHarnessConfig()
    config.model.engine = 'codex'
    render(<HarnessStructurePanel config={config} activeState={null} {...noop} onModelChange={onModelChange} />)
    fireEvent.change(screen.getByLabelText('모델'), { target: { value: 'gpt-5.5' } })
    expect(onModelChange).toHaveBeenCalledWith({ model: 'gpt-5.5' })
    fireEvent.change(screen.getByLabelText('sandbox'), { target: { value: 'workspace-write' } })
    expect(onModelChange).toHaveBeenCalledWith({ sandbox: 'workspace-write' })
  })

  test('worker concurrency control flows to onModelChange', () => {
    const onModelChange = vi.fn()
    render(<HarnessStructurePanel config={createDefaultHarnessConfig()} activeState={null} {...noop} onModelChange={onModelChange} />)
    fireEvent.change(screen.getByLabelText('워커 동시 실행'), { target: { value: '3' } })
    expect(onModelChange).toHaveBeenCalledWith({ workerConcurrency: 3 })
  })

  test('claude shows permission mode, not codex sandbox', () => {
    const config = createDefaultHarnessConfig() // engine defaults to claude
    render(<HarnessStructurePanel config={config} activeState={null} {...noop} />)
    expect(screen.getByLabelText('permission mode')).toBeDefined()
    expect(screen.queryByLabelText('sandbox')).toBeNull()
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

  test('renders the wiki-policy section with a 정책 제안 받기 button and fires onProposePolicy', () => {
    const onProposePolicy = vi.fn()
    render(<HarnessStructurePanel config={createDefaultHarnessConfig()} activeState={null} {...noop} onProposePolicy={onProposePolicy} />)
    fireEvent.click(screen.getByRole('button', { name: /정책 제안 받기/ }))
    expect(onProposePolicy).toHaveBeenCalledTimes(1)
  })

  test('shows 승인 button only when a proposed policy exists', () => {
    const proposal = { project_id: 'p1', generated_by: 'a', project_character: '', node_type_priorities: [], canonical_definition: '', scan_scope_notes: '', tailoring_markdown: '', rationale: '', evidence: [] }
    const { rerender } = render(<HarnessStructurePanel config={createDefaultHarnessConfig()} activeState={null} {...noop} policy={null} />)
    expect(screen.queryByRole('button', { name: /^승인$/ })).toBeNull()
    rerender(<HarnessStructurePanel config={createDefaultHarnessConfig()} activeState={null} {...noop} policy={{ status: 'proposed', proposal, generatedAt: '', body: '' }} />)
    expect(screen.getByRole('button', { name: /^승인$/ })).toBeTruthy()
  })
})
