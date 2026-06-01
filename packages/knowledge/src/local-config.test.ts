import { afterEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findLocalProjectConfig } from './local-config.js'

describe('findLocalProjectConfig', () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  test('walks upward until it finds .pmw/project.yml', () => {
    const root = mkdtempSync(join(tmpdir(), 'apc-pmw-'))
    dirs.push(root)
    const nested = join(root, 'packages', 'app')
    mkdirSync(nested, { recursive: true })
    mkdirSync(join(root, '.pmw'))
    writeFileSync(join(root, '.pmw', 'project.yml'), 'projectId: p1\n')
    expect(findLocalProjectConfig(nested)).toBe(join(root, '.pmw', 'project.yml'))
  })

  test('returns undefined when no local project config exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'apc-no-pmw-'))
    dirs.push(root)
    expect(findLocalProjectConfig(root)).toBeUndefined()
  })
})
