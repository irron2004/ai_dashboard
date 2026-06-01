import { beforeEach, describe, expect, test } from 'vitest'
import type { Project } from '@apc/shared'
import { openDb, migrate, type Db } from './db.js'
import { ProjectRegistry } from './project-registry.js'

const sample: Project = {
  id: 'apc',
  name: 'Agent Project Console',
  status: 'active',
  projectType: 'hybrid',
  repoPaths: ['/mnt/c/work/apc'],
  vaultPaths: ['vault/projects/apc'],
  sourcePaths: ['~/.claude'],
}

describe('ProjectRegistry', () => {
  let db: Db
  let registry: ProjectRegistry

  beforeEach(() => {
    db = openDb(':memory:')
    migrate(db)
    registry = new ProjectRegistry(db)
  })

  test('register then get returns the project', () => {
    registry.register(sample)
    expect(registry.get('apc')?.name).toBe('Agent Project Console')
  })

  test('list returns all registered projects', () => {
    registry.register(sample)
    registry.register({ ...sample, id: 'b', name: 'B', repoPaths: ['/b'] })
    expect(registry.list().map((p) => p.id).sort()).toEqual(['apc', 'b'])
  })

  test('findByRepoPath matches the canonical key', () => {
    registry.register(sample)
    expect(registry.findByRepoPath('/mnt/c/work/apc')?.id).toBe('apc')
    expect(registry.findByRepoPath('/nope')).toBeUndefined()
  })

  test('native-key mapping resolves to a project id', () => {
    registry.register(sample)
    registry.mapNativeKey('claude', '-mnt-c-work-apc', 'apc')
    expect(registry.resolveProjectId('claude', '-mnt-c-work-apc')).toBe('apc')
    expect(registry.resolveProjectId('codex', 'unknown')).toBeUndefined()
  })
})
