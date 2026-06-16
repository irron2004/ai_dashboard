import { describe, expect, test } from 'vitest'
import { planFolders, docFolder, type WorkUnit } from './folder-plan.js'
import type { SourceDoc } from './source-reader.js'

const doc = (path: string, len = 100): SourceDoc => ({
  source_id: path, source_path: path, text: 'x'.repeat(len), hash: path,
})
const ids = (u: WorkUnit) => u.docSourceIds.slice().sort()
const HUGE = 100_000_000

describe('docFolder', () => {
  test('maps project-doc paths to <repo>/<dir>; root file → <repo>/; non-doc → null', () => {
    expect(docFolder('raw/project-docs/0/paper-A/x.md')).toBe('0/paper-A')
    expect(docFolder('raw/project-docs/0/paper-A/exp/y.md')).toBe('0/paper-A/exp')
    expect(docFolder('raw/project-docs/0/README.md')).toBe('0/')
    expect(docFolder('raw/conversations/codex/s1/001q_a.txt')).toBeNull()
    expect(docFolder('raw/context/home/h/CLAUDE.md')).toBeNull()
  })
})

describe('planFolders', () => {
  test('non-doc sources are unplaced; every project doc is covered exactly once', () => {
    const sources = [
      doc('raw/project-docs/0/paper-A/a.md'),
      doc('raw/project-docs/0/paper-B/c.md'),
      doc('raw/conversations/codex/s1/001q_a.txt'),
      doc('raw/context/home/h/CLAUDE.md'),
    ]
    const plan = planFolders(sources, HUGE)
    expect(plan.unplacedSourceIds.sort()).toEqual([
      'raw/context/home/h/CLAUDE.md', 'raw/conversations/codex/s1/001q_a.txt',
    ])
    expect(plan.units.flatMap(ids).sort()).toEqual([
      'raw/project-docs/0/paper-A/a.md', 'raw/project-docs/0/paper-B/c.md',
    ])
  })

  test('everything fits in one window → a single unit (no needless splitting)', () => {
    const sources = [doc('raw/project-docs/0/a/x.md'), doc('raw/project-docs/0/b/y.md')]
    expect(planFolders(sources, HUGE).units.length).toBe(1)
  })

  test('separate folders when the budget cannot hold both, each still covered', () => {
    const a = doc('raw/project-docs/0/paper-A/a.md')
    const b = doc('raw/project-docs/0/paper-B/b.md')
    const oneFolder = planFolders([a], HUGE).units[0].estChars
    // budget holds one folder but not two → they must split into 2 units
    const plan = planFolders([a, b], oneFolder + 1)
    expect(plan.units.length).toBe(2)
    expect(plan.units.map((u) => u.label).sort()).toEqual(['paper-A', 'paper-B'])
  })

  test('merges small folders into one unit when they jointly fit', () => {
    const sources = [
      doc('raw/project-docs/0/a/x.md', 20), doc('raw/project-docs/0/b/y.md', 20), doc('raw/project-docs/0/c/z.md', 20),
    ]
    const plan = planFolders(sources, HUGE)
    expect(plan.units.length).toBe(1)
    expect(plan.units[0].memberPaths.sort()).toEqual(['a', 'b', 'c'])
    expect(plan.units[0].label).toContain('misc')
  })

  test('splits an oversized folder into multiple units, each within budget, all covered', () => {
    const docs = [doc('raw/project-docs/0/big/1.md', 60), doc('raw/project-docs/0/big/2.md', 60), doc('raw/project-docs/0/big/3.md', 60)]
    const full = planFolders(docs, HUGE).units[0].estChars        // whole folder size
    const oneDoc = JSON.stringify(docs[0]).length + 1
    const plan = planFolders(docs, Math.floor(full / 2))           // can't hold the whole folder
    expect(plan.units.length).toBeGreaterThan(1)
    expect(plan.units.every((u) => u.splitOf === 'big')).toBe(true)
    // each unit fits the budget (a lone doc may equal one doc's size, which is < full/2 here)
    expect(plan.units.every((u) => u.estChars <= Math.floor(full / 2) || u.docSourceIds.length === 1)).toBe(true)
    expect(oneDoc).toBeLessThanOrEqual(Math.floor(full / 2))
    expect(plan.units.flatMap(ids).sort()).toEqual([
      'raw/project-docs/0/big/1.md', 'raw/project-docs/0/big/2.md', 'raw/project-docs/0/big/3.md',
    ])
  })

  test('derives role: a unit holding a canonical doc is canonical, else reference', () => {
    const canon = doc('raw/project-docs/0/canon/current.md')
    const notes = doc('raw/project-docs/0/notes/x.md')
    const oneFolder = planFolders([canon], HUGE).units[0].estChars
    const plan = planFolders([canon, notes], oneFolder + 1) // keep them as separate units
    const byLabel = Object.fromEntries(plan.units.map((u) => [u.label, u.role]))
    expect(byLabel['canon']).toBe('canonical')
    expect(byLabel['notes']).toBe('reference')
  })

  test('deterministic', () => {
    const sources = [doc('raw/project-docs/0/z/1.md'), doc('raw/project-docs/0/a/1.md'), doc('raw/project-docs/0/a/2.md')]
    expect(JSON.stringify(planFolders(sources, 5000))).toBe(JSON.stringify(planFolders(sources, 5000)))
  })
})
