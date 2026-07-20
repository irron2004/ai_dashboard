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
    expect(store.listByProject('p1')[0]).toMatchObject({ updatedAt: '2026-07-07T11:00:00Z', pinned: false })
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

  test('edits text, pins first, and rejects cross-project mutation', () => {
    const timestamps = ['2026-07-07T12:00:00Z', '2026-07-07T13:00:00Z']
    store = new NextNoteStore(db, () => timestamps.shift() ?? '2026-07-07T14:00:00Z')
    const older = store.add('p1', 'older', '2026-07-07T10:00:00Z')
    const newer = store.add('p1', 'newer', '2026-07-07T11:00:00Z')
    expect(store.updateText('p2', older.id, 'wrong')).toEqual({ ok: false, reason: 'project-mismatch' })
    expect(store.updateText('p1', older.id, '  edited older  ')).toMatchObject({
      ok: true, note: { text: 'edited older', updatedAt: '2026-07-07T12:00:00Z' },
    })
    store.setPinned('p1', older.id, true)
    expect(store.listByProject('p1').map((note) => note.id)).toEqual([older.id, newer.id])
  })

  test('supports completed and archived filters while preserving completion across archive', () => {
    const active = store.add('p1', 'active', '2026-07-07T10:00:00Z')
    const completed = store.add('p1', 'completed', '2026-07-07T11:00:00Z')
    store.setLifecycle('p1', completed.id, 'completed')
    store.setLifecycle('p1', completed.id, 'archived')
    expect(store.get(completed.id)).toMatchObject({ done: true, archivedAt: expect.any(String) })
    expect(store.listByProject('p1').map((note) => note.id)).toEqual([active.id])
    expect(store.listByProject('p1', { includeCompleted: true }).map((note) => note.id)).toEqual([active.id])
    expect(store.listByProject('p1', { includeArchived: true }).map((note) => note.id)).toEqual([completed.id, active.id])
    expect(store.listByProject('p1', { includeCompleted: true, includeArchived: true })).toHaveLength(2)

    store.setLifecycle('p1', completed.id, 'completed')
    expect(store.get(completed.id)).toMatchObject({ done: true, archivedAt: undefined })
  })

  test('deleteForProject checks ownership and returns the removed note', () => {
    const note = store.add('p1', 'delete me', '2026-07-07T10:00:00Z')
    expect(store.deleteForProject('p2', note.id)).toEqual({ ok: false, reason: 'project-mismatch' })
    expect(store.deleteForProject('p1', note.id)).toMatchObject({ ok: true, note: { id: note.id } })
    expect(store.get(note.id)).toBeUndefined()
  })
})
