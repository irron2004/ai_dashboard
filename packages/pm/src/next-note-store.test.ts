import { beforeEach, describe, expect, test } from 'vitest'
import { openDb, migrate, type Db } from '@apc/core'
import { migratePm } from './migrate.js'
import { NextNoteStore } from './next-note-store.js'

describe('NextNoteStore', () => {
  let db: Db; let store: NextNoteStore
  beforeEach(() => { db = openDb(':memory:'); migrate(db); migratePm(db); store = new NextNoteStore(db) })

  test('add + listByProject: newest-first, excludes done, scoped by project', () => {
    store.add('p1', '7/10 상장 반영', '2026-07-07T10:00:00Z')
    store.add('p1', 'bear 2차 검증', '2026-07-07T11:00:00Z')
    store.add('p2', '다른 프로젝트', '2026-07-07T12:00:00Z')
    expect(store.listByProject('p1').map((n) => n.text)).toEqual(['bear 2차 검증', '7/10 상장 반영'])
    expect(store.listByProject('p2').map((n) => n.text)).toEqual(['다른 프로젝트'])
  })

  test('toggleDone hides from default list; includeDone shows it', () => {
    const a = store.add('p1', 'note', '2026-07-07T10:00:00Z')
    store.toggleDone(a.id, true)
    expect(store.listByProject('p1')).toHaveLength(0)
    expect(store.listByProject('p1', { includeDone: true })).toHaveLength(1)
  })

  test('delete removes the note', () => {
    const a = store.add('p1', 'note', '2026-07-07T10:00:00Z')
    store.delete(a.id)
    expect(store.listByProject('p1', { includeDone: true })).toHaveLength(0)
  })
})
