import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migrateHarness } from './migrate.js'
import { TaskProfileStore } from './task-profile-store.js'

describe('TaskProfileStore', () => {
  let db: Db; let store: TaskProfileStore
  beforeEach(() => { db = openDb(':memory:'); migrate(db); migrateHarness(db); store = new TaskProfileStore(db) })

  test('select then get returns the chosen profile id', () => {
    store.select('TASK-001', 'opencode:json:build')
    expect(store.get('TASK-001')).toBe('opencode:json:build')
  })
  test('selecting again overwrites the choice', () => {
    store.select('TASK-001', 'a'); store.select('TASK-001', 'b')
    expect(store.get('TASK-001')).toBe('b')
  })
  test('get returns undefined when nothing selected', () => {
    expect(store.get('TASK-999')).toBeUndefined()
  })
})
