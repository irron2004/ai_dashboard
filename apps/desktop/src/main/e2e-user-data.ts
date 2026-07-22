import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

type PathOverride = { setPath(name: 'userData', path: string): void }

/**
 * Keep Electron E2E state away from the developer's real profile. This must run before app.ready:
 * BrowserWindow/Session and the application DB both derive their paths from userData.
 */
export function configureE2EUserDataPath(
  electronApp: PathOverride,
  requested = process.env.APC_E2E_USER_DATA_DIR,
): string | null {
  const trimmed = requested?.trim()
  if (!trimmed) return null
  const directory = resolve(trimmed)
  mkdirSync(directory, { recursive: true })
  electronApp.setPath('userData', directory)
  return directory
}
