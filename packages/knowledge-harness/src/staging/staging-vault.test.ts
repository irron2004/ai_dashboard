import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StagingVault } from './staging-vault.js'

describe('StagingVault', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kh-stage-'))
    mkdirSync(join(root, 'vault'), { recursive: true })
    writeFileSync(join(root, 'vault', 'a.md'), '# A\n')
  })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  test('prepare copies vault → vault-staging', () => {
    const sv = new StagingVault(join(root, 'vault'), join(root, 'vault-staging'))
    sv.prepare()
    expect(existsSync(join(root, 'vault-staging', 'a.md'))).toBe(true)
  })

  test('writeDoc writes only into staging; diff() reports the new file', async () => {
    const sv = new StagingVault(join(root, 'vault'), join(root, 'vault-staging'))
    sv.prepare()
    sv.writeDoc('concepts/n1.md', '# N1\n')
    expect(existsSync(join(root, 'vault', 'concepts', 'n1.md'))).toBe(false)  // real vault untouched
    const patch = await sv.diff()
    expect(patch).toContain('n1.md')
  })

  test('writeDoc rejects a path that escapes the staging dir', () => {
    const sv = new StagingVault(join(root, 'vault'), join(root, 'vault-staging'))
    sv.prepare()
    expect(() => sv.writeDoc('../escape.md', 'x')).toThrow(/escapes/)
  })

  test('writeDoc rejects a sibling-directory escape that shares the staging prefix', () => {
    // vault-staging vs ../vault-staging-evil — a plain startsWith(prefix) check would wrongly pass this
    const sv = new StagingVault(join(root, 'vault'), join(root, 'vault-staging'))
    sv.prepare()
    expect(() => sv.writeDoc('../vault-staging-evil/x.md', 'x')).toThrow(/escapes/)
  })
})
