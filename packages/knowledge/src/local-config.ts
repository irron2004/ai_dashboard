import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export function findLocalProjectConfig(startDir: string): string | undefined {
  let current = resolve(startDir)
  while (true) {
    const candidate = join(current, '.pmw', 'project.yml')
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}
