export type KeyedPtyEvent = { id: string }

/** One Electron channel listener fans into pane-scoped renderer subscriptions in O(1) lookup time. */
export class PtyEventRouter<Event extends KeyedPtyEvent> {
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()

  subscribe(id: string, listener: (event: Event) => void): () => void {
    let listeners = this.listeners.get(id)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(id, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners?.delete(listener)
      if (listeners?.size === 0) this.listeners.delete(id)
    }
  }

  emit(event: Event): void {
    const listeners = this.listeners.get(event.id)
    if (!listeners) return
    for (const listener of [...listeners]) listener(event)
  }

  subscriberCount(id?: string): number {
    if (id) return this.listeners.get(id)?.size ?? 0
    let count = 0
    for (const listeners of this.listeners.values()) count += listeners.size
    return count
  }
}
