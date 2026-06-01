import { describe, expect, test } from 'vitest'
import { ConflictManager } from './conflict-manager.js'

describe('ConflictManager', () => {
  const cm = new ConflictManager()

  test('hash is stable for the same content', () => {
    expect(cm.hash('hello')).toBe(cm.hash('hello'))
    expect(cm.hash('hello')).not.toBe(cm.hash('world'))
  })

  test('detectConflict is false when last-read hash matches current content', () => {
    const current = '# current\n'
    const lastRead = cm.hash(current)
    expect(cm.detectConflict(lastRead, current)).toBe(false)
  })

  test('detectConflict is true when the file changed since last read', () => {
    const lastRead = cm.hash('# old\n')
    expect(cm.detectConflict(lastRead, '# changed on disk\n')).toBe(true)
  })

  test('buildConflictDoc includes all four sections', () => {
    const doc = cm.buildConflictDoc({
      targetPath: 'projects/apc/current.md',
      previousVersion: '# v1\n',
      currentVersion: '# v2 (edited in Obsidian)\n',
      proposedChange: '# v3 (LLM proposal)\n',
    })
    expect(doc).toContain('projects/apc/current.md')
    expect(doc).toContain('# v1')
    expect(doc).toContain('# v2 (edited in Obsidian)')
    expect(doc).toContain('# v3 (LLM proposal)')
    expect(doc).toContain('## Merge proposal')
  })
})
