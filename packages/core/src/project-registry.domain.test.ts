import { describe, expect, test, beforeEach } from 'vitest'
import { openDb, migrate } from './db.js'
import { ProjectRegistry } from './project-registry.js'

const base = { status: 'active' as const, projectType: 'git' as const, repoPaths: [], vaultPaths: [], sourcePaths: [], domain: 'project-docs' as const }

describe('ProjectRegistry domain', () => {
  let reg: ProjectRegistry
  beforeEach(() => { const db = openDb(':memory:'); migrate(db); reg = new ProjectRegistry(db) })

  test('round-trips paper domain', () => {
    reg.register({ ...base, id: 'p', name: 'P', domain: 'paper' })
    expect(reg.get('p')!.domain).toBe('paper')
  })
  test('defaults to project-docs', () => {
    reg.register({ ...base, id: 'q', name: 'Q' })
    expect(reg.get('q')!.domain).toBe('project-docs')
  })
  test('migrate is idempotent (second call does not throw)', () => {
    const db = openDb(':memory:'); migrate(db); expect(() => migrate(db)).not.toThrow()
  })
})
