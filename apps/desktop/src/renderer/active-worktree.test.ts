import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('./api.js', () => ({ api: {} }))

import { useStore } from './store.js'

describe('active worktree store', () => {
  afterEach(() => useStore.setState({ activeWorktrees: {} }))

  test('stores and clears an active path independently for each project', () => {
    useStore.getState().setActiveWorktree('p1', '/repo/wt-feature')
    useStore.getState().setActiveWorktree('p2', '/other/main')

    expect(useStore.getState().activeWorktrees).toEqual({
      p1: '/repo/wt-feature',
      p2: '/other/main',
    })

    useStore.getState().setActiveWorktree('p1', null)
    expect(useStore.getState().activeWorktrees.p1).toBeNull()
    expect(useStore.getState().activeWorktrees.p2).toBe('/other/main')
  })
})
