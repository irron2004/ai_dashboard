import { describe, expect, test, vi } from 'vitest'
import { PtyEventRouter } from './pty-event-router.js'

type Event = { id: string; launchId: string; data: string }

describe('PtyEventRouter', () => {
  test('routes only to subscribers for the matching pane id', () => {
    const router = new PtyEventRouter<Event>()
    const paneOne = vi.fn()
    const paneTwo = vi.fn()
    router.subscribe('pane-1', paneOne)
    router.subscribe('pane-2', paneTwo)

    const event = { id: 'pane-2', launchId: 'L2', data: 'hello' }
    router.emit(event)

    expect(paneOne).not.toHaveBeenCalled()
    expect(paneTwo).toHaveBeenCalledWith(event)
  })

  test('removes empty pane buckets and tolerates unsubscribe during delivery', () => {
    const router = new PtyEventRouter<Event>()
    const second = vi.fn()
    let offFirst = () => {}
    const first = vi.fn(() => offFirst())
    offFirst = router.subscribe('pane-1', first)
    const offSecond = router.subscribe('pane-1', second)

    router.emit({ id: 'pane-1', launchId: 'L1', data: 'first' })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(router.subscriberCount('pane-1')).toBe(1)

    offSecond()
    expect(router.subscriberCount()).toBe(0)
  })
})
