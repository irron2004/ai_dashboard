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
  domain: 'project-docs',
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

  test('update changes fields in place (same id)', () => {
    registry.register(sample)
    registry.mapNativeKey('claude', '-mnt-c-work-apc', 'apc')
    registry.update({ ...sample, name: 'Renamed', repoPaths: ['/new/path'] })
    expect(registry.get('apc')?.name).toBe('Renamed')
    expect(registry.findByRepoPath('/new/path')?.id).toBe('apc')
    expect(registry.list()).toHaveLength(1) // updated, not duplicated
    expect(registry.resolveProjectId('claude', '-mnt-c-work-apc')).toBe('apc') // update is not DELETE+INSERT
  })

  test('normalizes user context and preserves an unconfirmed agent proposal', () => {
    const fixedNow = '2026-07-20T12:00:00.000Z'
    registry = new ProjectRegistry(db, () => fixedNow)
    registry.register({ ...sample, goal: 'User goal', currentFocus: 'Ship UI' })
    expect(registry.get('apc')).toMatchObject({
      goalSource: 'user', goalConfirmedAt: fixedNow,
      currentFocusSource: 'user', currentFocusConfirmedAt: fixedNow,
    })

    registry.update({
      ...sample,
      goal: 'Agent proposal',
      goalSource: 'agent',
    })
    expect(registry.get('apc')).toMatchObject({ goal: 'Agent proposal', goalSource: 'agent' })
    expect(registry.get('apc')?.goalConfirmedAt).toBeUndefined()
  })

  test('round-trips a confirmed agent proposal without losing its origin', () => {
    registry.register({
      ...sample,
      goal: 'Agent proposal',
      goalSource: 'agent',
      goalConfirmedAt: '2026-07-20T13:00:00.000Z',
    })
    expect(registry.get('apc')).toMatchObject({
      goalSource: 'agent', goalConfirmedAt: '2026-07-20T13:00:00.000Z',
    })
  })

  test('remove deletes the project and cascades its source map', () => {
    registry.register(sample)
    registry.mapNativeKey('claude', '-mnt-c-work-apc', 'apc')
    registry.remove('apc')
    expect(registry.get('apc')).toBeUndefined()
    expect(registry.list()).toHaveLength(0)
    expect(registry.resolveProjectId('claude', '-mnt-c-work-apc')).toBeUndefined() // cascaded
  })
})
