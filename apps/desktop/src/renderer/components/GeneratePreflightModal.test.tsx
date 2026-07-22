import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useStore } from '../store.js'
import { GeneratePreflightModal } from './GeneratePreflightModal.js'

vi.mock('../api.js', () => ({ api: new Proxy({}, { get: () => vi.fn(async () => ({ ok: true })) }) }))

describe('GeneratePreflightModal', () => {
  beforeEach(() => {
    useStore.setState({
      selectedProjectId: 'p1', preflighting: false, generating: false, generation: null,
      generatePreflight: {
        ok: true, projectId: 'p1', projectName: 'APC', totalCount: 3, status: 'scanned',
        categories: [{ id: 'agent-conversations', label: 'LLM CLI conversations', description: 'd', count: 3, selectedByDefault: true, required: true }],
      },
    })
  })

  test('renders nothing when closed', () => {
    render(<GeneratePreflightModal open={false} onClose={vi.fn()} />)
    expect(screen.queryByText('Generate preflight')).toBeNull()
  })

  test('open renders categories and Proceed', () => {
    const generate = vi.fn(async () => undefined)
    useStore.setState({ generate })
    render(<GeneratePreflightModal open onClose={vi.fn()} />)
    expect(screen.getByText('Generate preflight')).toBeDefined()
    expect(screen.getByText('LLM CLI conversations')).toBeDefined()
    const engine = screen.getByLabelText('Engine') as HTMLInputElement
    expect(engine.value).toBe('codex')
    expect(engine.disabled).toBe(true)
    expect(screen.queryByText('claude')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Proceed' }))
    expect(generate).toHaveBeenCalledWith(['agent-conversations'])
  })
})
