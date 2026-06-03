import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { folderPathFor, normalizeRoots, walkFiles } from './source-discovery.js'

describe('source-discovery helpers', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apc-sources-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('normalizes roots to absolute unique paths', () => {
    expect(normalizeRoots([dir, dir])).toEqual([resolve(dir)])
  })

  test('walkFiles recursively finds accepted files across roots and dedupes results', () => {
    const nested = join(dir, 'a', 'b')
    mkdirSync(nested, { recursive: true })
    const first = join(nested, 'one.jsonl')
    const ignored = join(nested, 'ignore.txt')
    writeFileSync(first, '{}')
    writeFileSync(ignored, 'no')
    const found = walkFiles([dir, dir], (path) => path.endsWith('.jsonl'))
    expect(found).toEqual([first])
  })

  test('folderPathFor returns the locator directory', () => {
    expect(folderPathFor(join(dir, 'x', 'file.jsonl'))).toBe(join(dir, 'x'))
  })
})
