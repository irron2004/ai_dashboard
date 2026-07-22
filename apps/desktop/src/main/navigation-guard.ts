export type NavigationEventLike = { preventDefault(): void }

export type GuardedWebContents = {
  setWindowOpenHandler(handler: () => { action: 'deny' }): void
  on(event: 'will-navigate' | 'will-redirect', handler: (event: NavigationEventLike) => void): void
}

/** Keep renderer and preview content inside the application-owned BrowserWindow. */
export function installNavigationGuard(webContents: GuardedWebContents): void {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const prevent = (event: NavigationEventLike) => event.preventDefault()
  webContents.on('will-navigate', prevent)
  webContents.on('will-redirect', prevent)
}
