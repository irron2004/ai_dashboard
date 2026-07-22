import { describe, expect, test, vi } from 'vitest'
import { installNavigationGuard, type NavigationEventLike } from './navigation-guard.js'

describe('installNavigationGuard', () => {
  test('denies popup windows and renderer navigation/redirects', () => {
    let windowHandler: (() => { action: 'deny' }) | undefined
    const listeners = new Map<string, (event: NavigationEventLike) => void>()
    installNavigationGuard({
      setWindowOpenHandler: (handler) => { windowHandler = handler },
      on: (event, handler) => { listeners.set(event, handler) },
    })

    expect(windowHandler?.()).toEqual({ action: 'deny' })
    for (const name of ['will-navigate', 'will-redirect']) {
      const event = { preventDefault: vi.fn() }
      listeners.get(name)?.(event)
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }
  })
})
