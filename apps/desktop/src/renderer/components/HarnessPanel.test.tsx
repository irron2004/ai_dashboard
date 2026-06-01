import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { HarnessPanel } from './HarnessPanel.js'
import type { AgentProfile } from '@apc/shared'

const profiles: AgentProfile[] = [
  {
    id: 'p-claude-1',
    provider: 'claude',
    name: 'Claude Primary',
    scope: 'global',
    mode: 'primary',
    description: 'Main claude agent',
    rawConfigPath: '/config/claude.json',
    rawFormat: 'json',
  },
  {
    id: 'p-codex-1',
    provider: 'codex',
    name: 'Codex Builder',
    scope: 'project',
    mode: 'builder',
    rawConfigPath: '/project/.codex.json',
    rawFormat: 'json',
  },
]

describe('HarnessPanel', () => {
  test('renders profile names and scopes', () => {
    const onSelect = vi.fn()
    render(<HarnessPanel profiles={profiles} onSelect={onSelect} />)
    expect(screen.getByText('Claude Primary')).toBeDefined()
    expect(screen.getByText('Codex Builder')).toBeDefined()
    expect(screen.getByText('global')).toBeDefined()
    expect(screen.getByText('project')).toBeDefined()
  })

  test('fires onSelect(profileId) when a profile is chosen', () => {
    const onSelect = vi.fn()
    render(<HarnessPanel profiles={profiles} onSelect={onSelect} />)
    // Click the first "Use" button (corresponds to p-claude-1)
    const useButtons = screen.getAllByText('Use')
    fireEvent.click(useButtons[0])
    expect(onSelect).toHaveBeenCalledWith('p-claude-1')
  })
})
